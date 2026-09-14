const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const processes = require('node:child_process');
const { EventEmitter } = require('node:events');
const { test, after, beforeEach } = require('node:test');
const root = fs.mkdtempSync(path.join(__dirname, '.update-installation-'));
const previousEnv = {};
for (const [key, value] of Object.entries({
  HOME: root, USERPROFILE: root, PM2_HOME: path.join(root, 'pm2'),
  MONKY_BOT_LOCALE: 'pt-BR', MONKYBOT_LOCALE: 'pt-BR',
})) {
  previousEnv[key] = process.env[key];
  process.env[key] = value;
}
after(() => {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
const installation = require('../dist/cli/updateInstallation');

beforeEach(t => {
  t.mock.method(processes, 'spawn', () => assert.fail('Unexpected real child process'));
  t.mock.method(processes, 'spawnSync', () => assert.fail('Unexpected real npm/PM2 operation'));
});

function directory(t) {
  const value = fs.mkdtempSync(path.join(root, 'fixture-'));
  t.after(() => fs.rmSync(value, { recursive: true, force: true }));
  return value;
}

function npmEnvironment(t) {
  const dir = directory(t);
  const entry = path.join(dir, 'npm-cli.js');
  fs.writeFileSync(entry, 'synthetic npm CLI');
  const previous = process.env.npm_execpath;
  process.env.npm_execpath = entry;
  t.after(() => {
    if (previous === undefined) delete process.env.npm_execpath;
    else process.env.npm_execpath = previous;
  });
  return entry;
}

function packageFixture(t, platform = process.platform) {
  const prefix = directory(t);
  const pkg = platform === 'win32' ? path.join(prefix, 'node_modules', '@monky', 'bot')
    : path.join(prefix, 'lib', 'node_modules', '@monky', 'bot');
  fs.mkdirSync(path.join(pkg, 'dist'), { recursive: true });
  const metadata = { name: '@monky/bot', version: '6.0.4-beta', bin: { monkybot: './dist/cli.js' } };
  const write = () => fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify(metadata));
  write();
  const entry = path.join(pkg, 'dist', 'cli.js');
  fs.writeFileSync(entry, 'synthetic installed CLI');
  return { prefix, pkg, metadata, entry, write };
}

function childResult(t, result = 0) {
  return t.mock.method(processes, 'spawn', () => {
    const child = new EventEmitter();
    queueMicrotask(() => result instanceof Error ? child.emit('error', result) : child.emit('close', result, null));
    return child;
  });
}

test('npm launched through npm_execpath always uses direct Node argv', t => {
  const entry = npmEnvironment(t);
  assert.deepEqual(installation.resolveNpmCommand({ npm_execpath: entry, PATH: '' }), {
    executable: process.execPath, args: [entry],
  });
});

test('explicit npm runtime is retained when npm and the bot use different Node installations', t => {
  const entry = npmEnvironment(t);
  const executable = path.join(directory(t), 'node.exe');
  fs.writeFileSync(executable, 'synthetic npm runtime');
  assert.deepEqual(installation.resolveNpmCommand({
    npm_execpath: entry, npm_node_execpath: executable, PATH: '',
  }), { executable, args: [entry] });
});

test('Windows npm.cmd discovery resolves the adjacent npm JS entry without executing a shell', t => {
  const dir = directory(t);
  const entry = path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(path.join(dir, 'npm.cmd'), 'do not execute this shell wrapper');
  fs.writeFileSync(entry, 'synthetic npm CLI');
  assert.deepEqual(installation.resolveNpmCommand({ Path: `"${dir}"` }, 'win32'), {
    executable: process.execPath, args: [entry],
  });
  fs.unlinkSync(entry);
  assert.throws(() => installation.resolveNpmCommand({ PATH: dir }, 'win32'), /localizar o CLI do npm/);
});

test('Windows npm discovery preserves its adjacent Node or PATH runtime instead of changing the global prefix', t => {
  const dir = directory(t);
  const nodeDirectory = directory(t);
  const entry = path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(path.join(dir, 'npm.cmd'), 'synthetic shell wrapper');
  fs.writeFileSync(entry, 'synthetic npm CLI');
  const fromPath = path.join(nodeDirectory, 'node.exe');
  const adjacent = path.join(dir, 'node.exe');
  fs.writeFileSync(fromPath, 'synthetic PATH runtime');
  const env = { PATH: [dir, nodeDirectory].join(path.delimiter) };
  assert.deepEqual(installation.resolveNpmCommand(env, 'win32'), { executable: fromPath, args: [entry] });
  fs.writeFileSync(adjacent, 'synthetic adjacent runtime');
  assert.deepEqual(installation.resolveNpmCommand(env, 'win32'), { executable: adjacent, args: [entry] });
});

test('POSIX npm discovery respects PATH and executes the command without shell interpolation', t => {
  const dir = directory(t);
  const entry = path.join(dir, 'npm');
  fs.writeFileSync(entry, '#!/usr/bin/env node\n');
  fs.chmodSync(entry, 0o755);
  assert.deepEqual(installation.resolveNpmCommand({ PATH: dir }, 'linux'), { executable: entry, args: [] });
});

test('missing npm does not fall back to an unrelated checkout or executable', t => {
  assert.throws(() => installation.resolveNpmCommand({ PATH: directory(t) }), /localizar o CLI do npm/);
  assert.throws(() => installation.resolveNpmCommand({
    npm_execpath: path.join(directory(t), 'missing', 'npm-cli.js'), PATH: '',
  }), /localizar o CLI do npm/);
});

test('the actual configured npm global prefix is captured with a bounded direct query', t => {
  const entry = npmEnvironment(t);
  const prefix = path.join(root, "global & (prefix)' %literal%");
  const spawn = t.mock.method(processes, 'spawnSync', () => ({ status: 0, stdout: `${prefix}\r\n` }));
  const result = installation.resolveNpmInstallation();
  assert.equal(result.prefix, prefix);
  const [executable, args, options] = spawn.mock.calls[0].arguments;
  assert.equal(executable, process.execPath);
  assert.deepEqual(args, [entry, 'prefix', '-g']);
  assert.equal(options.shell, false);
  assert.equal(options.encoding, 'utf8');
  assert.equal(options.timeout, 15_000);
});

test('npm prefix parsing does not silently trim meaningful path characters', t => {
  npmEnvironment(t);
  const prefix = `${path.join(root, 'prefix')} `;
  t.mock.method(processes, 'spawnSync', () => ({ status: 0, stdout: `${prefix}\n` }));
  assert.equal(installation.resolveNpmInstallation().prefix, prefix);
});

for (const result of [
  { status: 2, stdout: '' }, { status: null, error: new Error('fixture npm unavailable'), stdout: '' },
  { status: 0, stdout: '' }, { status: 0, stdout: 'relative-prefix' },
  { status: 0, stdout: `${root}\nsecond path` }, { status: 0, stdout: `${root}\0invalid` },
]) {
  test(`invalid npm prefix output is rejected (${JSON.stringify(result)})`, t => {
    npmEnvironment(t);
    t.mock.method(processes, 'spawnSync', () => result);
    assert.throws(() => installation.resolveNpmInstallation(), /prefixo global/);
  });
}

for (const platform of ['linux', 'win32']) {
  test(`installed CLI is resolved only from the npm global package and checked against the requested version (${platform})`, t => {
    const f = packageFixture(t, platform);
    assert.equal(installation.installedCliEntry(f.prefix, '6.0.4-beta', platform), f.entry);
    assert.throws(() => installation.installedCliEntry(f.prefix, '6.0.5-beta', platform),
      /versão 6\.0\.4-beta; esperava 6\.0\.5-beta/);
  });
}

for (const mutate of [
  metadata => { metadata.name = '@another/bot'; },
  metadata => { metadata.version = 'invalid'; },
  metadata => { metadata.bin = './dist/cli.js'; },
  metadata => { metadata.bin = null; },
  metadata => { metadata.bin.monkybot = '../outside.js'; },
  metadata => { metadata.bin.monkybot = path.join(root, 'outside.js'); },
  metadata => { metadata.bin.monkybot = './dist/missing.js'; },
  metadata => { metadata.bin.monkybot = './dist/cli.cmd'; },
  metadata => { metadata.bin.monkybot = './dist/cli.js\n'; },
]) {
  test(`invalid installed package metadata never resolves an alternate entry (${mutate.toString()})`, t => {
    const f = packageFixture(t);
    mutate(f.metadata);
    f.write();
    assert.throws(() => installation.installedCliEntry(f.prefix, '6.0.4-beta'), /pacote instalado|entrada do CLI/);
  });
}

test('a linked CLI directory cannot escape the installed package', t => {
  const f = packageFixture(t);
  const external = directory(t);
  fs.writeFileSync(path.join(external, 'cli.js'), 'must never execute this external CLI');
  fs.rmSync(path.dirname(f.entry), { recursive: true });
  fs.symlinkSync(external, path.dirname(f.entry), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => installation.installedCliEntry(f.prefix, '6.0.4-beta'), /entrada do CLI/);
});

test('npm installation pins the queried prefix and passes the downloaded file as one direct argument', async t => {
  const spawn = childResult(t);
  const npm = { command: { executable: process.execPath, args: [path.join(root, "npm & 'cli.js")] }, prefix: path.join(root, '%prefix%') };
  const archive = path.join(root, "package & (literal)' %name%.tgz");
  await installation.installUpdate(npm, archive);
  const [executable, args, options] = spawn.mock.calls[0].arguments;
  assert.equal(executable, process.execPath);
  assert.deepEqual(args, [...npm.command.args, 'install', '-g', '--prefix', npm.prefix, archive]);
  assert.equal(options.shell, false);
  assert.equal(options.env, process.env);
  assert.equal(options.stdio, 'inherit');
});

for (const failure of [1, new Error('fixture spawn failed')]) {
  test(`npm install process failures are surfaced (${failure})`, async t => {
    childResult(t, failure);
    await assert.rejects(installation.installUpdate({
      command: { executable: 'fixture npm', args: [] }, prefix: root,
    }, path.join(root, 'package.tgz')), /Falha ao instalar/);
  });
}

test('restart uses a new Node process with exact argv, inherited config/PM2 environment and no shell', async t => {
  const spawn = childResult(t);
  const entry = path.join(root, "new & (installed)' %CLI%.js");
  await installation.restartInstalledCli(entry);
  const [executable, args, options] = spawn.mock.calls[0].arguments;
  assert.equal(executable, process.execPath);
  assert.deepEqual(args, [entry, 'restart']);
  assert.equal(options.shell, false);
  assert.deepEqual(options.env, { ...process.env, MONKY_BOT_LOCALE: 'pt-BR', MONKYBOT_LOCALE: 'pt-BR' });
  assert.equal(options.cwd, process.cwd());
  assert.equal(options.detached, undefined);
});

test('an in-memory operator language override survives the fresh-process handoff without changing the parent environment', async t => {
  const i18n = require('../dist/cli/i18n');
  i18n.setCliLocale('en');
  t.after(() => i18n.setCliLocale('pt-BR'));
  const originalLocale = process.env.MONKYBOT_LOCALE;
  const originalCanonicalLocale = process.env.MONKY_BOT_LOCALE;
  const spawn = childResult(t);
  await installation.restartInstalledCli(path.join(root, 'cli.js'));
  const options = spawn.mock.calls[0].arguments[2];
  assert.deepEqual(options.env, { ...process.env, MONKY_BOT_LOCALE: 'en', MONKYBOT_LOCALE: 'en' });
  assert.equal(process.env.MONKYBOT_LOCALE, originalLocale);
  assert.equal(process.env.MONKY_BOT_LOCALE, originalCanonicalLocale);
});

test('restart spawn failure is propagated rather than calling an old in-memory fallback', async t => {
  const error = new Error('fixture Node executable unavailable');
  childResult(t, error);
  await assert.rejects(installation.restartInstalledCli(path.join(root, 'cli.js')), failure => failure === error);
});

test('every updater/music progress message has both shared CLI translations', t => {
  const i18n = require('../dist/cli/i18n');
  t.after(() => i18n.setCliLocale('pt-BR'));
  const files = [
    path.join('commands', 'update.ts'), 'updateInstallation.ts', 'updateDownload.ts', 'musicTools.ts', 'musicToolDownload.ts',
  ];
  const keys = new Set(files.flatMap(file => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'cli', file), 'utf8');
    return [...source.matchAll(/cliT\('([^']+)'/g)].map(match => match[1]);
  }));
  for (const locale of ['pt-BR', 'en']) {
    i18n.setCliLocale(locale);
    for (const key of keys) assert.ok(i18n.cliT(key).length > 0, `${key} (${locale})`);
  }
});
