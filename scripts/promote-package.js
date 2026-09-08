const fs = require('node:fs');
const { gunzipSync, gzipSync } = require('node:zlib');
const { promotionVersion } = require('./release-version');

function octal(header, start, length) {
  const value = header.subarray(start, start + length).toString('ascii').replace(/\0/g, '').trim();
  if (!/^[0-7]+$/.test(value)) throw new Error('Invalid tar numeric field.');
  const number = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(number)) throw new Error('Tar numeric field overflow.');
  return number;
}

function checksum(header) {
  return header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
}

// Rewrite one tar member without extracting/repacking dependencies. Every other
// header, file, symlink and permission is retained byte-for-byte.
function promotePackage(buffer, sourceTag) {
  const version = promotionVersion(sourceTag);
  const archive = gunzipSync(buffer);
  const chunks = [];
  let roots = 0;
  let offset = 0;
  let ended = false;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      if (archive.length - offset < 1024 || !archive.subarray(offset).every((byte) => byte === 0)) {
        throw new Error('Invalid tar end marker.');
      }
      chunks.push(archive.subarray(offset));
      ended = true;
      break;
    }
    if (octal(header, 148, 8) !== checksum(header)) throw new Error('Invalid tar checksum.');
    const size = octal(header, 124, 12);
    const end = offset + 512 + Math.ceil(size / 512) * 512;
    if (end > archive.length) throw new Error('Truncated tar member.');
    const name = header.subarray(0, 100).toString('utf8').split('\0')[0];
    const prefix = header.subarray(345, 500).toString('utf8').split('\0')[0];
    if (name === 'package/package.json' && !prefix) {
      if (++roots !== 1 || ![0, 48].includes(header[156])) throw new Error('Invalid root package member.');
      const pkg = JSON.parse(archive.subarray(offset + 512, offset + 512 + size).toString('utf8'));
      if (pkg.name !== '@monky/bot' || pkg.version !== sourceTag.slice(1)) {
        throw new Error('Beta artifact package name/version does not match its release tag.');
      }
      pkg.version = version;
      const contents = Buffer.from(JSON.stringify(pkg, null, 2) + '\n');
      const changed = Buffer.from(header);
      changed.write(contents.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
      changed.write(checksum(changed).toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
      chunks.push(changed, contents, Buffer.alloc((512 - contents.length % 512) % 512));
    } else {
      // Extended headers could override a member's path/size. Fail closed rather
      // than accidentally changing metadata for a different package.
      if ([120, 103, 76, 75].includes(header[156])) throw new Error('Extended tar headers are not supported for promotion.');
      chunks.push(archive.subarray(offset, end));
    }
    offset = end;
  }
  if (!ended || roots !== 1) throw new Error('Tarball must contain exactly one root package.json and a valid end marker.');
  return gzipSync(Buffer.concat(chunks));
}

function promoteFile(source, target, sourceTag) {
  fs.writeFileSync(target, promotePackage(fs.readFileSync(source), sourceTag), { flag: 'wx' });
}

module.exports = { promotePackage, promoteFile };
