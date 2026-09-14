const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const state = JSON.parse(fs.readFileSync(process.env.FIXTURE_UPDATER_SCENARIO, 'utf8'));
const args = process.argv.slice(2);
assert.equal(process.env.HOME, state.home);
assert.equal(process.env.USERPROFILE, state.home);
assert.equal(process.env.PM2_HOME, state.pm2Home);
fs.appendFileSync(state.trace, `${JSON.stringify({ event: 'npm', pid: process.pid, args })}\n`);
if (args[0] === 'prefix') {
  assert.deepEqual(args, ['prefix', '-g']);
  if (state.prefixFailure) process.exit(state.prefixFailure);
  console.log(state.prefixOutput ?? state.prefix);
} else {
  assert.deepEqual(args.slice(0, 4), ['install', '-g', '--prefix', state.prefix]);
  assert.equal(args.length, 5);
  const archive = args[4];
  assert.ok(path.isAbsolute(archive));
  assert.equal(fs.readFileSync(archive, 'utf8'), 'synthetic npm tarball');
  assert.ok(archive.startsWith(path.join(state.home, '.monkybot', '.update-')));
  console.log('fixture npm installation (no percentage available)');
  if (state.installFailure) process.exit(state.installFailure);
  fs.mkdirSync(state.installed, { recursive: true });
  fs.cpSync(state.template, state.installed, { recursive: true });
  const packageFile = path.join(state.installed, 'package.json');
  const metadata = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  if (state.installedVersion) metadata.version = state.installedVersion;
  if (state.installedName) metadata.name = state.installedName;
  if (state.installedBin) metadata.bin.monkybot = state.installedBin;
  fs.writeFileSync(packageFile, state.badMetadata ? '{' : JSON.stringify(metadata));
  if (state.missingMetadata) fs.unlinkSync(packageFile);
  if (state.missingEntry) fs.unlinkSync(path.join(state.installed, 'dist', 'cli.js'));
}
