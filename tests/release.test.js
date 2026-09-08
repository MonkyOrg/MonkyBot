const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { gzipSync, gunzipSync } = require('node:zlib');
const { test } = require('node:test');
const { runNpm } = require('../scripts/npm');
const {
  parseVersionTag, compareVersionTags, latestReleaseTag, collectBumps, nextBetaVersion, promotionVersion,
} = require('../scripts/release-version');
const { promotePackage, promoteFile } = require('../scripts/promote-package');
const { repositoryName, validatePromotion, verifyDownloadedAsset, releaseNotes, releaseArguments } = require('../scripts/release');

const ROOT = path.resolve(__dirname, '..');
const REPOSITORY = 'MonkyOrg/MonkyBot';

function release(tag, overrides = {}) {
  return {
    tag_name: tag, draft: false, prerelease: tag.includes('-beta'),
    published_at: '2026-09-08T12:00:00Z',
    assets: [{
      id: 123, name: `monky-bot-${tag.slice(1)}.tgz`, state: 'uploaded', size: 100,
      browser_download_url: `https://github.com/${REPOSITORY}/releases/download/${tag}/monky-bot-${tag.slice(1)}.tgz`,
    }],
    ...overrides,
  };
}

test('latest baseline includes betas, ignores drafts and unrecognized tags, and sorts numerically', () => {
  const releases = [
    release('v1.0.9'), release('v1.0.10-beta'), release('v1.0.10-beta002'),
    release('v1.0.10-beta.3'), release('v9.0.0', { draft: true }), release('nightly'),
    release('v8.0.0', { published_at: null }),
  ];
  assert.equal(latestReleaseTag(releases), 'v1.0.10-beta.3');
  assert.equal(latestReleaseTag(releases, true), 'v1.0.9');
  releases.push(release('v1.0.10'));
  assert.equal(latestReleaseTag(releases), 'v1.0.10');
  assert.equal(latestReleaseTag([]), null);
  assert.ok(compareVersionTags('v1.0.10', 'v1.0.10-beta001') > 0);
});

test('versioning always emits beta and applies each commit chronologically, resetting lower fields', () => {
  assert.equal(nextBetaVersion('v1.0.0', ['fix: one', 'fix: two', 'fix: three']), '1.0.3-beta');
  assert.equal(nextBetaVersion('v1.0.3-beta', ['feat(cli): option', 'fix: repair']), '1.1.1-beta');
  assert.equal(nextBetaVersion('v1.0.3-beta001', ['fix: repair', 'feat: option']), '1.1.0-beta');
  assert.equal(nextBetaVersion('v1.0.3-beta.2', []), '1.0.4-beta');
  assert.equal(nextBetaVersion('1.0.0', ['docs: explain']), '1.0.1-beta');
  assert.throws(() => nextBetaVersion('bad', []), /baseline/);
});

test('breaking markers, scoped aliases, and squash entries follow Monky semantics', () => {
  assert.deepEqual(collectBumps([
    'fix(api)!: incompatibility', 'refactor: new API\n\nBREAKING CHANGE: new protocol',
    'feat(cli): flags\n\nBREAKING-CHANGE: renamed', 'major(api): breaking',
    'feature(cli): mode', 'minor: capability', 'bugfix: crash',
  ]), ['major', 'major', 'major', 'major', 'minor', 'minor', 'patch']);
  assert.equal(nextBetaVersion('1.0.0', [
    'feat: summary (#42)\n\n* feat: first\n* feat(cli): second\n* fix: one\n* fix: two\n* fix: three',
  ]), '1.2.3-beta');
  assert.equal(nextBetaVersion('1.0.0', [
    'feat: summary\n\n* fix: repair\n  BREAKING CHANGE: incompatible\n* fix: polish',
  ]), '2.0.1-beta');
  assert.deepEqual(collectBumps(['', null]), []);
});

test('promotion strips only the beta suffix without bumping, including historical tags', () => {
  for (const suffix of ['beta', 'beta001', 'beta.12']) {
    assert.equal(promotionVersion(`v3.4.2-${suffix}`), '3.4.2');
  }
  for (const tag of ['v1.2.3', '1.2.3-beta', ' v1.2.3-beta', 'v1.2.3-beta\n',
    'v1.2.3-rc', 'v1.2.3-beta;echo hi', 'v01.2.3-beta', '--help', undefined]) {
    assert.throws(() => promotionVersion(tag), /beta release tag/);
  }
  assert.equal(parseVersionTag('v9007199254740992.0.0'), null);
  assert.throws(() => nextBetaVersion('9007199254740991.0.0', ['feat!: overflow']), /overflow/);
});

test('promotion requires published prerelease metadata and the exact uploaded artifact', () => {
  const tag = 'v2.0.0-beta';
  const source = release(tag);
  assert.equal(validatePromotion(tag, source, [source, release('v1.9.0')], REPOSITORY).version, '2.0.0');
  for (const override of [
    { draft: true }, { prerelease: false }, { published_at: null }, { published_at: 'bad' },
    { tag_name: 'v2.1.0-beta' }, { assets: [] }, { assets: [...source.assets, ...source.assets] },
    { assets: [{ ...source.assets[0], state: 'new' }] },
    { assets: [{ ...source.assets[0], size: 0 }] },
    { assets: [{ ...source.assets[0], id: '../other' }] },
    { assets: [{ ...source.assets[0], browser_download_url: 'https://example.com/package.tgz' }] },
    { assets: [{ ...source.assets[0], digest: 'sha256:wrong' }] },
  ]) {
    assert.throws(() => validatePromotion(tag, { ...source, ...override }, [source], REPOSITORY));
  }
  assert.throws(() => validatePromotion(tag, undefined, [], REPOSITORY), /published/);
  assert.throws(() => repositoryName('../untrusted/repo'), /repository/);
});

test('downloaded assets must match metadata size and available SHA-256 digest', () => {
  const buffer = Buffer.from('original published beta package');
  const asset = { size: buffer.length, digest: `sha256:${createHash('sha256').update(buffer).digest('hex')}` };
  verifyDownloadedAsset(buffer, asset);
  verifyDownloadedAsset(buffer, { size: buffer.length }); // Legacy GitHub assets omit digest.
  assert.throws(() => verifyDownloadedAsset(buffer, { ...asset, size: 1 }), /size mismatch/);
  assert.throws(() => verifyDownloadedAsset(buffer, { ...asset, digest: `sha256:${'0'.repeat(64)}` }), /digest mismatch/);
});

test('publish arguments force beta/latest=false unless explicitly promoting, and pin source commit', () => {
  for (const promotion of [false, true]) {
    const plan = { repository: REPOSITORY, version: promotion ? '2.0.0' : '2.0.0-beta', promotion, target: 'a'.repeat(40) };
    const args = releaseArguments(plan, 'notes with spaces.txt');
    assert.equal(args.includes('--prerelease'), !promotion);
    assert.equal(args.includes('--latest=false'), !promotion);
    assert.equal(args.includes('--latest=true'), promotion);
    assert.equal(args[args.indexOf('--target') + 1], plan.target);
    assert.equal(args[args.indexOf('--notes-file') + 1], 'notes with spaces.txt');
    assert.equal(args.includes('--notes'), false);
  }
});

test('promotion refuses stable downgrades, duplicates and draft target collisions but allows older than latest beta', () => {
  const tag = 'v2.0.0-beta';
  const source = release(tag);
  for (const stable of ['v2.0.0', 'v2.0.1', 'v3.0.0']) {
    assert.throws(() => validatePromotion(tag, source, [source, release(stable)], REPOSITORY), /equal or newer/);
  }
  assert.throws(() => validatePromotion(tag, source, [source, release('v2.0.0', { draft: true })], REPOSITORY), /already exists/);
  assert.equal(validatePromotion(tag, source, [source, release('v5.0.0-beta')], REPOSITORY).version, '2.0.0');
});

function tarEntry(name, contents, type = '0') {
  const data = Buffer.from(contents);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100);
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
  header.write('00000000000\0', 136);
  header.fill(32, 148, 156);
  header.write(type, 156);
  header.write('ustar\0', 257);
  header.write('00', 263);
  header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([header, data, Buffer.alloc((512 - data.length % 512) % 512)]);
}

function fixtureArchive(pkg = { name: '@monky/bot', version: '2.0.0-beta', dependencies: { sdk: '1.0.0-beta' } }) {
  const dependency = tarEntry('package/node_modules/sdk/package.json', '{"name":"sdk","version":"1.0.0-beta"}');
  const code = tarEntry('package/dist/cli.js', 'console.log("unchanged beta code");');
  return { dependency, code, archive: gzipSync(Buffer.concat([
    tarEntry('package/package.json', JSON.stringify(pkg)), dependency, code, Buffer.alloc(1024),
  ])) };
}

test('promotion changes only root manifest version and preserves bundled beta SDK and code bytes', () => {
  const { archive, dependency, code } = fixtureArchive();
  const output = gunzipSync(promotePackage(archive, 'v2.0.0-beta'));
  const size = Number.parseInt(output.subarray(124, 136).toString(), 8);
  const pkg = JSON.parse(output.subarray(512, 512 + size).toString());
  assert.deepEqual(pkg, { name: '@monky/bot', version: '2.0.0', dependencies: { sdk: '1.0.0-beta' } });
  assert.deepEqual(output.subarray(512 + Math.ceil(size / 512) * 512),
    Buffer.concat([dependency, code, Buffer.alloc(1024)]));
});

test('promotion rejects mismatched packages, corrupt archives, ambiguous root members and extended headers', () => {
  for (const pkg of [{ name: '@monky/bot', version: '2.0.1-beta' }, { name: 'other', version: '2.0.0-beta' }]) {
    assert.throws(() => promotePackage(fixtureArchive(pkg).archive, 'v2.0.0-beta'), /does not match/);
  }
  const root = tarEntry('package/package.json', '{"name":"@monky/bot","version":"2.0.0-beta"}');
  for (const raw of [
    Buffer.concat([root, root, Buffer.alloc(1024)]),
    Buffer.concat([tarEntry('other.json', '{}'), Buffer.alloc(1024)]),
    Buffer.concat([tarEntry('package/package.json', '{}', '2'), Buffer.alloc(1024)]),
    Buffer.concat([tarEntry('PaxHeader', 'path=package/package.json', 'x'), root, Buffer.alloc(1024)]),
    root.subarray(0, 600), root,
    Buffer.concat([root, Buffer.alloc(512), Buffer.from('hidden payload')]),
  ]) assert.throws(() => promotePackage(gzipSync(raw), 'v2.0.0-beta'));
  const corrupt = gunzipSync(fixtureArchive().archive);
  corrupt[0] ^= 1;
  assert.throws(() => promotePackage(gzipSync(corrupt), 'v2.0.0-beta'), /checksum/);
});

test('real npm package promotes and installs offline retaining bundled SDK without source/build dependencies', (t) => {
  const root = path.join(ROOT, 'release', `promotion-test-${randomUUID()}`);
  const source = path.join(root, 'source');
  const sdk = path.join(source, 'node_modules', '@monky', 'bot-sdk');
  fs.mkdirSync(sdk, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({
    name: '@monky/bot', version: '2.0.0-beta', main: 'index.js',
    dependencies: { '@monky/bot-sdk': '7.0.0-beta' }, bundleDependencies: ['@monky/bot-sdk'],
  }));
  fs.writeFileSync(path.join(source, 'index.js'), "module.exports = require('@monky/bot-sdk');");
  fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ name: '@monky/bot-sdk', version: '7.0.0-beta', main: 'index.js' }));
  fs.writeFileSync(path.join(sdk, 'index.js'), "module.exports = 'original SDK';");
  const packed = JSON.parse(runNpm(['pack', '--json', '--ignore-scripts'], { cwd: source }))[0].filename;
  const target = path.join(root, 'stable.tgz');
  promoteFile(path.join(source, packed), target, 'v2.0.0-beta');
  assert.throws(() => promoteFile(path.join(source, packed), target, 'v2.0.0-beta'), /EEXIST/);
  fs.rmSync(source, { recursive: true, force: true });
  const install = path.join(root, 'install');
  runNpm([
    'install', '--prefix', install, '--cache', path.join(root, 'cache'), '--offline',
    '--ignore-scripts', '--no-audit', '--no-fund', target,
  ], { cwd: root });
  const bot = path.join(install, 'node_modules', '@monky', 'bot');
  assert.equal(require(path.join(bot, 'package.json')).version, '2.0.0');
  assert.equal(require(bot), 'original SDK');
});

test('notes use the exact channel/version installation URL and treat source notes as data', () => {
  for (const promotion of [false, true]) {
    const version = promotion ? '2.0.0' : '2.0.0-beta';
    const changes = '$(touch SHOULD_NOT_RUN)\n`dangerous`\n"quotes"\nEOF';
    const notes = releaseNotes({ repository: REPOSITORY, version, promotion, sourceTag: 'v2.0.0-beta', target: 'a'.repeat(40), changes });
    assert.ok(notes.includes(`npm install -g "https://github.com/${REPOSITORY}/releases/download/v${version}/monky-bot-${version}.tgz"`));
    assert.ok(notes.includes(changes));
    assert.ok(!notes.includes('install-monkybot.sh'));
  }
});

test('workflow explicitly separates beta builds from promotion and never derives bot channel from SDK', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
  assert.match(workflow, /workflow_dispatch:\s+inputs:\s+promote_tag:/);
  assert.match(workflow, /group: release\s+cancel-in-progress: false/);
  assert.match(workflow, /PROMOTE_TAG: \$\{\{ inputs.promote_tag \}\}/);
  assert.equal((workflow.match(/if: steps\.release\.outputs\.promotion != 'true'/g) || []).length, 4);
  assert.ok(!workflow.includes('SDK_PRERELEASE'));
  assert.match(workflow, /run: npm run check:sdk/);
  assert.match(workflow, /run: npm run smoke:pack -- "release\/monky-bot-\$\{VERSION\}\.tgz"/);
  assert.ok(workflow.indexOf('Smoke test') < workflow.indexOf('Publish release'));
  assert.ok(!/run:[^\n]*\$\{\{/.test(workflow));
});

test('every workflow shell script passes bash -n', (t) => {
  const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
  if (process.platform === 'win32' && !fs.existsSync(bash)) return t.skip('Git Bash is unavailable.');
  const lines = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8').split(/\r?\n/);
  const scripts = [];
  for (let index = 0; index < lines.length; index++) {
    const match = /^        run: (.*)$/.exec(lines[index]);
    if (!match) continue;
    if (match[1] !== '|') scripts.push(match[1]);
    else {
      const body = [];
      while (lines[index + 1]?.startsWith('          ')) body.push(lines[++index].slice(10));
      scripts.push(body.join('\n'));
    }
  }
  assert.equal(scripts.length, 7);
  for (const script of scripts) {
    const result = spawnSync(bash, ['-n'], { input: script, encoding: 'utf8', cwd: ROOT });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr);
  }
});
