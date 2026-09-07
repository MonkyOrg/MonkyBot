const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { bundleDependencies, parseArgs } = require('../scripts/pack');

function fixture(t) {
  const root = path.resolve(__dirname, '..', 'release', `pack-test-${randomUUID()}`);
  const source = path.join(root, 'source');
  const output = path.join(root, 'output');
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(output, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  return { root, source, output };
}

function json(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

function moduleAt(directory, name, version, extra = {}, code = `module.exports = ${JSON.stringify(version)};`) {
  json(path.join(directory, 'package.json'), { name, version, main: 'index.js', ...extra });
  fs.writeFileSync(path.join(directory, 'index.js'), code);
}

function fromPackage(output, name) {
  return createRequire(path.join(output, 'node_modules', name, 'package.json'));
}

test('bundling preserves per-requester nested versions instead of using a global first match', (t) => {
  const { source, output } = fixture(t);
  json(path.join(source, 'package.json'), { dependencies: { first: '*', second: '*' } });
  for (const [name, version] of [['first', '1.0.0'], ['second', '2.0.0']]) {
    const directory = path.join(source, 'node_modules', name);
    moduleAt(directory, name, '1.0.0', { dependencies: { leaf: '*' } }, "module.exports = require('leaf');");
    moduleAt(path.join(directory, 'node_modules', 'leaf'), 'leaf', version, { exports: './index.js' });
  }
  moduleAt(path.join(source, 'node_modules', 'leaf'), 'leaf', '9.0.0');
  const result = bundleDependencies(source, output);
  assert.equal(result.packageCount, 4);
  assert.equal(fromPackage(output, 'first')('./index.js'), '1.0.0');
  assert.equal(fromPackage(output, 'second')('./index.js'), '2.0.0');
  assert.equal(fs.existsSync(path.join(output, 'node_modules', 'leaf')), false);
});

test('npm tarballs retain nested versions through an offline install, including paths with spaces', (t) => {
  const { root, source } = fixture(t);
  const output = path.join(root, 'package with spaces');
  fs.mkdirSync(output, { recursive: true });
  json(path.join(source, 'package.json'), { dependencies: { first: '*', second: '*' } });
  for (const [name, version] of [['first', '1.0.0'], ['second', '2.0.0']]) {
    const directory = path.join(source, 'node_modules', name);
    moduleAt(directory, name, '1.0.0', { dependencies: { leaf: '*' } }, "module.exports = require('leaf');");
    moduleAt(path.join(directory, 'node_modules', 'leaf'), 'leaf', version);
  }
  const { dependencies } = bundleDependencies(source, output);
  moduleAt(output, '@monky/bundle-fixture', '1.0.0',
    { dependencies, bundleDependencies: Object.keys(dependencies) },
    "module.exports = [require('first'), require('second')];");

  const npmHelper = path.resolve(__dirname, '..', 'scripts', 'npm.js');
  const install = path.join(root, 'install with spaces');
  const driver = `
    const fs = require('node:fs');
    const path = require('node:path');
    const { runNpm } = require(${JSON.stringify(npmHelper)});
    const packed = JSON.parse(runNpm(['pack', '--json', '--ignore-scripts'], { cwd: ${JSON.stringify(output)} }))[0].filename;
    runNpm([
      'install', '--prefix', ${JSON.stringify(install)},
      '--cache', ${JSON.stringify(path.join(root, 'empty cache'))},
      '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
      path.join(${JSON.stringify(output)}, packed)
    ], { cwd: ${JSON.stringify(root)} });
  `;
  const installed = spawnSync(process.execPath, ['-e', driver], {
    cwd: root,
    env: { ...process.env, npm_execpath: '' },
    encoding: 'utf8',
    timeout: 120000,
  });
  if (installed.error) throw installed.error;
  assert.equal(installed.status, 0, installed.stderr);

  const runtime = spawnSync(process.execPath, [
    '--no-global-search-paths', '--require', path.resolve(__dirname, '..', 'scripts', 'isolated-runtime.cjs'),
    '-e', "console.log(JSON.stringify(require('@monky/bundle-fixture')));",
  ], {
    cwd: install,
    env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', MONKYBOT_SMOKE_MODULES: path.join(install, 'node_modules') },
    encoding: 'utf8',
    timeout: 15000,
  });
  if (runtime.error) throw runtime.error;
  assert.equal(runtime.status, 0, runtime.stderr);
  assert.deepEqual(JSON.parse(runtime.stdout), ['1.0.0', '2.0.0']);
});

test('workspace links resolve dependencies from the real requesting workspace', (t) => {
  const { root, source, output } = fixture(t);
  const workspace = path.join(root, 'workspace');
  const sdk = path.join(workspace, 'packages', 'sdk');
  moduleAt(sdk, '@monky/bot-sdk', '1.0.0',
    { main: 'dist/index.js', dependencies: { nested: '*' } });
  fs.mkdirSync(path.join(sdk, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(sdk, 'dist', 'index.js'), "module.exports = require('nested');");
  moduleAt(path.join(workspace, 'node_modules', 'nested'), 'nested', '2.0.0',
    { dependencies: { leaf: '*' } }, "module.exports = require('leaf');");
  moduleAt(path.join(workspace, 'node_modules', 'nested', 'node_modules', 'leaf'), 'leaf', '3.0.0');
  moduleAt(path.join(source, 'node_modules', 'nested'), 'nested', '9.0.0');
  json(path.join(source, 'package.json'), { dependencies: { '@monky/bot-sdk': 'file:workspace' } });
  fs.mkdirSync(path.join(source, 'node_modules', '@monky'), { recursive: true });
  fs.symlinkSync(sdk, path.join(source, 'node_modules', '@monky', 'bot-sdk'),
    process.platform === 'win32' ? 'junction' : 'dir');
  bundleDependencies(source, output);
  assert.equal(fromPackage(output, '@monky/bot-sdk')('./dist/index.js'), '3.0.0');
});

test('missing required and transitive modules fail instead of being skipped', (t) => {
  const { source, output } = fixture(t);
  json(path.join(source, 'package.json'), { dependencies: { missing: '*' } });
  assert.throws(() => bundleDependencies(source, output), /Missing required dependency "missing"/);
  moduleAt(path.join(source, 'node_modules', 'missing'), 'missing', '1.0.0',
    { dependencies: { transitive: '*' } });
  assert.throws(() => bundleDependencies(source, output), /Missing required dependency "transitive"/);
});

test('only genuinely optional dependencies may be absent', (t) => {
  const { source, output } = fixture(t);
  json(path.join(source, 'package.json'), {
    optionalDependencies: { optional: '*' },
    peerDependencies: { peer: '*' },
    peerDependenciesMeta: { peer: { optional: true } },
  });
  assert.deepEqual(bundleDependencies(source, output), { dependencies: {}, packageCount: 0 });
  json(path.join(source, 'package.json'), { peerDependencies: { requiredPeer: '*' } });
  assert.throws(() => bundleDependencies(source, output), /Missing required dependency "requiredPeer"/);
});

test('missing @monky build output and empty runtime modules fail immediately', (t) => {
  const { source, output } = fixture(t);
  json(path.join(source, 'package.json'), { dependencies: { '@monky/bot-sdk': '*' } });
  const sdk = path.join(source, 'node_modules', '@monky', 'bot-sdk');
  moduleAt(sdk, '@monky/bot-sdk', '1.0.0');
  assert.throws(() => bundleDependencies(source, output), /Missing or empty required file/);
  fs.mkdirSync(path.join(sdk, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(sdk, 'dist', 'index.js'), '');
  assert.throws(() => bundleDependencies(source, output), /Missing or empty required file/);

  json(path.join(source, 'package.json'), { dependencies: { empty: '*' } });
  json(path.join(source, 'node_modules', 'empty', 'package.json'), { name: 'empty', version: '1.0.0' });
  assert.throws(() => bundleDependencies(source, output), /Missing runtime entry/);
});

test('ordinary circular dependencies remain resolvable without infinite copying', (t) => {
  const { source, output } = fixture(t);
  json(path.join(source, 'package.json'), { dependencies: { alpha: '*' } });
  moduleAt(path.join(source, 'node_modules', 'alpha'), 'alpha', '1.0.0', { dependencies: { beta: '*' } });
  moduleAt(path.join(source, 'node_modules', 'beta'), 'beta', '1.0.0', { dependencies: { alpha: '*' } });
  const result = bundleDependencies(source, output);
  assert.equal(result.packageCount, 2);
  const beta = fromPackage(path.join(output, 'node_modules', 'alpha'), 'beta');
  assert.equal(beta('alpha'), '1.0.0');
});

test('pack argument errors fail before running npm', () => {
  assert.throws(() => parseArgs(['--out']), /requires a directory/);
  assert.throws(() => parseArgs(['--unknown']), /Unknown argument/);
  assert.equal(parseArgs(['v2.0.0']).version, '2.0.0');
});
