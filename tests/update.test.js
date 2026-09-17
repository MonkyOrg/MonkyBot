const assert = require('node:assert/strict');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { test, after } = require('node:test');
const suiteHome = fs.mkdtempSync(path.join(__dirname, '.update-home-'));
const previousEnv = {};
for (const [key, value] of Object.entries({
  HOME: suiteHome, USERPROFILE: suiteHome, PM2_HOME: path.join(suiteHome, 'pm2'),
  MONKY_BOT_LOCALE: 'pt-BR', MONKYBOT_LOCALE: 'pt-BR',
})) {
  previousEnv[key] = process.env[key];
  process.env[key] = value;
}
after(() => {
  fs.rmSync(suiteHome, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
const releases = require('../dist/cli/updateReleases');
const updates = require('../dist/cli/commands/update');
const processHelpers = require('../dist/cli/process');
const pm2 = require('../dist/cli/pm2');
const config = require('../dist/cli/config');
const i18n = require('../dist/cli/i18n');
const installation = require('../dist/cli/updateInstallation');
const progress = require('../dist/cli/progress');
const lifecycle = require('../dist/cli/commands/lifecycle');
const { listen, freePort } = require('./helpers/manifest-port');
const { updaterFixture, packageDirectory } = require('./helpers/updater-fixture');

function release(version, changes = {}) {
  const tag = `v${version}`;
  return {
    tag_name: tag, draft: false, prerelease: version.includes('-beta'),
    assets: [{
      name: `monky-bot-${version}.tgz`,
      browser_download_url: `https://github.com/MonkyOrg/MonkyBot/releases/download/${tag}/monky-bot-${version}.tgz`,
    }],
    ...changes,
  };
}

test('semantic ordering supports promotion and both legacy beta counters', () => {
  for (const [newer, older] of [
    ['3.0.0-beta', '2.0.1'], ['3.0.0', '3.0.0-beta'],
    ['3.0.1-beta', '3.0.0'], ['3.0.0-beta010', '3.0.0-beta009'],
    ['3.0.0-beta.10', '3.0.0-beta.9'], ['3.0.0-beta001', '3.0.0-beta'],
  ]) {
    assert.ok(releases.compareVersions(newer, older) > 0);
    assert.ok(releases.compareVersions(older, newer) < 0);
  }
  assert.equal(releases.compareVersions('v3.0.0-beta003', '3.0.0-beta.3'), 0);
  assert.throws(() => releases.compareVersions('invalid', '3.0.0'), /inválida/);
  assert.equal(releases.parseVersion('3.0.0-rc.1'), null);
  assert.equal(releases.parseVersion('999999999999999999999.0.0'), null);
});

test('beta feed selects highest installable version, not publication order', () => {
  const data = [
    release('2.0.1'), release('3.0.0-beta'), release('3.0.0'),
    release('4.0.0-beta', { draft: true }), release('5.0.0', { assets: [] }),
    release('6.0.0', { prerelease: true }),
    release('7.0.0', { assets: [{ name: 'monky-bot-7.0.0.tgz', browser_download_url: 'https://other.example/pkg.tgz' }] }),
  ];
  assert.equal(releases.selectRelease(data, true).version, '3.0.0');
  assert.equal(releases.selectRelease([...data, release('3.0.1-beta')], true).version, '3.0.1-beta');
  assert.equal(releases.selectRelease(release('3.0.0-beta'), false), null);
  assert.equal(releases.selectRelease(release('2.0.1'), false).version, '2.0.1');
  assert.throws(() => releases.selectRelease({}, true), /inválida/);
  assert.throws(() => releases.selectRelease(null, false), /inválida/);
});

test('official release metadata is retained for the exact selected update asset', () => {
  const offered = release('6.0.4-beta');
  offered.assets[0].size = 15;
  offered.assets[0].digest = `sha256:${'a'.repeat(64)}`;
  const selected = releases.selectRelease([release('6.0.3-beta'), offered], true);
  assert.equal(selected.size, 15);
  assert.equal(selected.sha256, 'a'.repeat(64));
  for (const legacy of [release('6.0.3-beta'), release('6.0.4-beta')]) {
    legacy.assets[0].digest = null;
    const selectedLegacy = releases.selectRelease([legacy], true);
    assert.ok(selectedLegacy);
    assert.equal(selectedLegacy.size, undefined);
    assert.equal(selectedLegacy.sha256, undefined);
  }
});

test('malformed or ambiguous published update metadata is not treated as an installable release', () => {
  for (const metadata of [
    { size: 0 }, { size: -1 }, { size: 1.5 }, { size: Number.MAX_SAFE_INTEGER + 1 },
    { size: '15' }, { digest: '' }, { digest: 'sha256:invalid' }, { digest: `sha512:${'a'.repeat(64)}` },
  ]) {
    const offered = release('6.0.4-beta');
    Object.assign(offered.assets[0], metadata);
    assert.equal(releases.selectRelease([offered], true), null, JSON.stringify(metadata));
  }
  const duplicate = release('6.0.4-beta');
  duplicate.assets.push({ ...duplicate.assets[0] });
  assert.equal(releases.selectRelease([duplicate], true), null);
});

function mockHttp(t, status, body, failure) {
  let requested;
  t.mock.method(https, 'get', (url, _options, callback) => {
    requested = url;
    const req = new EventEmitter();
    req.destroy = (error) => queueMicrotask(() => req.emit('error', error));
    req.setTimeout = (_ms, onTimeout) => {
      if (failure === 'timeout') queueMicrotask(onTimeout);
      return req;
    };
    queueMicrotask(() => {
      if (failure === 'timeout') return;
      if (failure) { req.emit('error', new Error(failure)); return; }
      const response = Readable.from([body]);
      response.statusCode = status;
      callback(response);
    });
    return req;
  });
  return () => requested;
}

test('stable and beta checks use their respective GitHub endpoints', async (t) => {
  const url = mockHttp(t, 200, JSON.stringify([release('3.0.0-beta')]));
  assert.equal((await releases.fetchLatestRelease(true)).version, '3.0.0-beta');
  assert.match(url(), /releases\?per_page=100$/);
});

test('stable API parses the exact tagged package', async (t) => {
  const url = mockHttp(t, 200, JSON.stringify(release('3.0.0')));
  const target = await releases.fetchLatestRelease(false);
  assert.match(url(), /releases\/latest$/);
  assert.equal(target.tgzUrl, release('3.0.0').assets[0].browser_download_url);
});

for (const [name, status, body, failure, error] of [
  ['HTTP error', 403, '', null, /HTTP 403/],
  ['bad JSON', 200, '{', null, /JSON inválido/],
  ['null JSON', 200, 'null', null, /inválida/],
  ['network error', 200, '', 'offline', /offline/],
  ['timeout', 200, '', 'timeout', /Tempo limite/],
]) {
  test(`release lookup surfaces ${name}`, async (t) => {
    mockHttp(t, status, body, failure);
    await assert.rejects(releases.fetchLatestRelease(false), error);
  });
}

test('no stable release yet is not a network error', async (t) => {
  mockHttp(t, 404, '');
  assert.equal(await releases.fetchLatestRelease(false), null);
});

function commandFixture(t, local, remote, metadata = {}) {
  const root = fs.mkdtempSync(path.join(suiteHome, 'command-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const exists = fs.existsSync;
  const read = fs.readFileSync;
  const packageFile = path.resolve(__dirname, '..', 'dist', 'package.json');
  t.mock.method(fs, 'existsSync', (file) => file === packageFile || exists(file));
  t.mock.method(fs, 'readFileSync', (file, ...args) =>
    file === packageFile ? JSON.stringify({ version: local }) : read(file, ...args));
  const fetch = t.mock.method(releases, 'fetchLatestRelease', async () => {
    const offered = release(remote);
    Object.assign(offered.assets[0], metadata);
    return releases.selectRelease([offered], true);
  });
  const download = t.mock.method(global, 'fetch', async () =>
    new Response('fixture package', { headers: { 'content-length': '15' } }));
  const resolve = t.mock.method(installation, 'resolveNpmInstallation', () => ({
    command: { executable: 'fixture-npm', args: [] }, prefix: root,
  }));
  const install = t.mock.method(installation, 'installUpdate', async (_npm, archive) => {
    assert.equal(fs.readFileSync(archive, 'utf8'), 'fixture package');
    const directory = packageDirectory(root);
    fs.mkdirSync(path.join(directory, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({
      name: '@monky/bot', version: remote, bin: { monkybot: './dist/cli.js' },
    }));
    fs.writeFileSync(path.join(directory, 'dist', 'cli.js'), 'synthetic installed CLI');
  });
  const restart = t.mock.method(installation, 'restartInstalledCli', async () => {});
  t.mock.method(lifecycle, 'restartBot', () => assert.fail('Old in-memory restart must never run.'));
  const transfers = [];
  t.mock.method(progress, 'createDownloadProgress', () => ({
    update: value => transfers.push(value), finish() {},
  }));
  t.mock.method(pm2, 'isPm2Available', () => false);
  const lines = [];
  t.mock.method(console, 'log', (...args) => lines.push(args.join(' ')));
  return { fetch, install, resolve, restart, download, lines, transfers, root };
}

test('update --beta --yes installs selected beta once', async (t) => {
  const { fetch, install, transfers, lines } = commandFixture(t, '2.0.1', '3.0.0-beta');
  await updates.updateCommand(['--beta', '--yes']);
  assert.deepEqual(fetch.mock.calls[0].arguments, [true]);
  assert.equal(install.mock.callCount(), 1);
  assert.match(install.mock.calls[0].arguments[1], /monky-bot-3\.0\.0-beta\.tgz$/);
  assert.deepEqual(transfers.map(value => value.receivedBytes), [0, 15, 15]);
  const installing = lines.find(line => line.includes('npm;'));
  assert.match(installing, /não informa porcentagem/);
  assert.doesNotMatch(installing, /\d+%/);
});

test('published update integrity reaches the download before npm installation', async t => {
  const f = commandFixture(t, '6.0.3-beta', '6.0.4-beta', {
    size: 15, digest: `sha256:${'0'.repeat(64)}`,
  });
  await assert.rejects(updates.updateCommand(['--beta', '--yes']), /tamanho\/checksum/);
  assert.equal(f.install.mock.callCount(), 0);
  assert.equal(f.restart.mock.callCount(), 0);
  assert.doesNotMatch(f.lines.join('\n'), /atualizado para/);
});

test('published update size drives actual progress even when HTTP omits content-length', async t => {
  const f = commandFixture(t, '6.0.3-beta', '6.0.4-beta', {
    size: 15, digest: `sha256:${createHash('sha256').update('fixture package').digest('hex')}`,
  });
  f.download.mock.mockImplementation(async () => new Response('fixture package'));
  await updates.updateCommand(['--beta', '--yes']);
  assert.equal(f.install.mock.callCount(), 1);
  assert.ok(f.transfers.every(value => value.totalBytes === 15));
});

test('stable promotion is newer than an installed beta of the same base', async (t) => {
  const { fetch, install } = commandFixture(t, '3.0.0-beta', '3.0.0');
  await updates.updateCommand(['--yes']);
  assert.deepEqual(fetch.mock.calls[0].arguments, [false]);
  assert.equal(install.mock.callCount(), 1);
});

for (const [local, remote, args] of [
  ['3.0.0-beta', '2.0.1', ['--yes']],
  ['3.0.0-beta', '3.0.0-beta', ['--beta', '--yes']],
  ['3.0.0', '3.0.0-beta', ['--beta', '--yes']],
  ['2.0.1', '3.0.0-beta', ['--beta', '--check']],
]) {
  test(`no install for ${local} -> ${remote} (${args.join(' ')})`, async (t) => {
    const { install, resolve, download, restart } = commandFixture(t, local, remote);
    await updates.updateCommand(args);
    for (const operation of [install, resolve, download, restart]) assert.equal(operation.mock.callCount(), 0);
  });
}

test('unknown flags fail before network or installation', async () => {
  await assert.rejects(updates.updateCommand(['--btea']), /Opção desconhecida/);
});

test('failed install does not restart the bot or report success', async (t) => {
  const { install, restart, lines } = commandFixture(t, '2.0.1', '3.0.0-beta');
  install.mock.mockImplementation(async () => { throw new Error('fixture install failure'); });
  await assert.rejects(updates.updateCommand(['--beta', '--yes']), /fixture install failure/);
  assert.equal(install.mock.callCount(), 1);
  assert.equal(restart.mock.callCount(), 0);
  assert.doesNotMatch(lines.join('\n'), /atualizado para|Bot reiniciado/);
});

for (const failure of ['download', 'truncated', 'timeout', 'cancel']) {
  test(`failed or cancelled update transfer cleans staging without running npm (${failure})`, async t => {
    const f = commandFixture(t, '6.0.3-beta', '6.0.4-beta');
    const listenerCount = process.listenerCount('SIGINT');
    let started;
    const reading = new Promise(resolve => { started = resolve; });
    if (failure === 'timeout') t.mock.timers.enable({ apis: ['setTimeout'] });
    t.mock.method(progress, 'createDownloadProgress', () => ({
      update: () => started(), finish() {},
    }));
    f.download.mock.mockImplementation(async () => {
      if (failure === 'download') throw new Error('fixture offline');
      if (failure === 'truncated') return new Response('abc', { headers: { 'content-length': '4' } });
      return new Response(new ReadableStream({}));
    });
    const pending = updates.updateCommand(['--beta', '--yes']);
    const rejected = assert.rejects(pending, failure === 'download' ? /fixture offline/ :
      failure === 'truncated' ? /tamanho\/checksum/ : failure === 'timeout' ? /Tempo limite/ : /cancelada/);
    if (failure === 'timeout' || failure === 'cancel') {
      await reading;
      if (failure === 'timeout') t.mock.timers.tick(10 * 60_000 + 1);
      else process.emit('SIGINT');
    }
    await rejected;
    assert.equal(f.install.mock.callCount(), 0);
    assert.equal(f.restart.mock.callCount(), 0);
    assert.equal(process.listenerCount('SIGINT'), listenerCount);
    assert.equal(fs.readdirSync(path.join(suiteHome, '.monkybot')).some(name => name.startsWith('.update-')), false);
    assert.doesNotMatch(f.lines.join('\n'), /atualizado para|Bot reiniciado/);
  });
}

for (const replaceInPlace of [false, true]) {
  test(`old CLI launches the newly installed version in a fresh process (same location=${replaceInPlace})`, async t => {
    const f = updaterFixture(t, { replaceInPlace, port: await freePort(t) });
    const result = await f.run();
    assert.equal(result.status, 0, result.stderr);
    const old = result.calls.find(call => call.event === 'old-start');
    const fresh = result.calls.find(call => call.event === 'new-cli');
    assert.equal(old.version, '6.0.3-beta');
    assert.equal(fresh.version, '6.0.4-beta');
    assert.notEqual(fresh.pid, old.pid);
    assert.equal(fresh.entry, path.join(f.installed, 'dist', 'cli.js'));
    assert.deepEqual(fresh.args, ['restart']);
    assert.equal(fresh.cwd, f.state.cwd);
    assert.equal(fresh.home, f.home);
    assert.equal(fresh.pm2Home, f.state.pm2Home);
    assert.deepEqual(result.calls.filter(call => call.event === 'pm2').map(call => call.args[0]),
      ['stop', 'startOrRestart', 'save']);
    assert.deepEqual(result.calls.filter(call => call.event === 'manifest-ready').map(call => call.url),
      [`http://${f.config.publicHost}:${f.config.servePort}/manifest`]);
    assert.equal(result.calls.some(call => call.event === 'prepare'), false,
      'A fresh CLI restart must not prepare media tools on the bot host.');
    assert.match(result.stdout, /atualizado para 6\.0\.4-beta|Bot reiniciado/);
    const ecosystem = require(path.join(f.home, '.monkybot', 'ecosystem.config.cjs')).apps[0];
    assert.equal(ecosystem.cwd, f.config.botDir);
    assert.equal(ecosystem.script, path.join(f.installed, 'dist', 'index.js'));
    assert.equal(ecosystem.env.MONKY_SERVE_PUBLIC_HOST, f.config.publicHost);
    assert.equal(ecosystem.env.MONKY_SERVE_PORT, String(f.config.servePort));
  });
}

for (const shellOverride of [false, true]) {
  test(`fresh update restart preserves host precedence without preparing or injecting legacy media tools (${shellOverride})`, async t => {
    const f = updaterFixture(t, {
      port: await freePort(t),
      env: shellOverride ? { MONKY_SERVE_HOST: '127.0.0.1', MONKY_MUSIC_FFMPEG: 'operator ffmpeg' } : {},
    });
    f.state.managed.pm2_env.MONKY_SERVE_HOST = shellOverride ? '0.0.0.0' : '127.0.0.1';
    f.state.managed.pm2_env.MONKY_MUSIC_YTDLP = 'previous yt-dlp';
    f.state.managed.pm2_env.env = {
      MONKY_MUSIC_NODE: 'previous node 22', MONKY_MUSIC_FFMPEG: 'previous ffmpeg',
    };
    const result = await f.run();
    assert.equal(result.status, 0, result.stderr);
    const probe = result.calls.find(call => call.event === 'probe');
    assert.equal(probe.host, '127.0.0.1');
    assert.equal(result.calls.some(call => call.event === 'prepare'), false);
    const ecosystem = require(path.join(f.home, '.monkybot', 'ecosystem.config.cjs')).apps[0];
    assert.equal(ecosystem.env.MONKY_SERVE_HOST, '127.0.0.1');
    for (const key of ['MONKY_MUSIC_NODE', 'MONKY_MUSIC_YTDLP', 'MONKY_MUSIC_FFMPEG']) {
      assert.equal(ecosystem.env[key], undefined, 'Local client execution does not select a VPS media tool.');
    }
  });
}

test('manual config, identity and botDir are retained by the newly installed CLI', async t => {
  const f = updaterFixture(t, { config: {
    mode: 'manual', serverUrl: 'ws://fixture.invalid:3001', botToken: 'synthetic-fixture-token',
  } });
  const result = await f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.some(call => call.event === 'probe'), false);
  const ecosystem = require(path.join(f.home, '.monkybot', 'ecosystem.config.cjs')).apps[0];
  assert.equal(ecosystem.cwd, f.config.botDir);
  assert.equal(ecosystem.env.MONKY_SERVER_URL, f.config.serverUrl);
  assert.equal(ecosystem.env.MONKY_BOT_TOKEN, f.config.botToken);
});

test('fresh restart rejects a real port collision and never claims restart success', async t => {
  const otherService = await listen(t);
  const f = updaterFixture(t, { port: otherService.address().port });
  const result = await f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /já está em uso por um bot ou outro serviço/);
  assert.match(result.stderr, /Pacote atualizado, mas o reinício do bot falhou/);
  assert.deepEqual(result.calls.filter(call => call.event === 'pm2').map(call => call.args), [['stop', '31']]);
  assert.equal(result.calls.some(call => call.event === 'ecosystem'), false);
  assert.equal(otherService.listening, true);
  assert.doesNotMatch(result.stdout, /Bot reiniciado/);
});

for (const change of ['foreign path', 'invalid id', 'missing path']) {
  test(`fresh restart refuses an unowned PM2 process (${change})`, async t => {
    const f = updaterFixture(t);
    if (change === 'foreign path') f.state.managed.pm2_env.pm_exec_path = path.join(f.root, 'other-bot', 'index.js');
    if (change === 'invalid id') f.state.managed.pm_id = -1;
    if (change === 'missing path') delete f.state.managed.pm2_env.pm_exec_path;
    const result = await f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /identificado como este bot/);
    assert.equal(result.calls.some(call => ['pm2', 'prepare', 'ecosystem'].includes(call.event)), false);
  });
}

for (const scenario of [
  { running: false }, { pm2Available: false },
  { args: ['--beta'], answers: ['yes', 'no'] },
]) {
  test(`successful installation does not start a stopped bot or override restart decline (${JSON.stringify(scenario)})`, async t => {
    const f = updaterFixture(t, { scenario });
    const result = await f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /atualizado para/);
    assert.equal(result.calls.filter(call => call.event === 'npm' && call.args[0] === 'install').length, 1);
    assert.equal(result.calls.some(call => call.event === 'new-cli' || call.event === 'pm2'), false);
    assert.doesNotMatch(result.stdout, /Bot reiniciado/);
    assert.doesNotMatch(result.stdout, /[\u001b\r]/, 'Non-interactive update logs must be plain text.');
  });
}

for (const answer of ['no', undefined]) {
  test(`declining update or closing the prompt performs no npm operation (${answer})`, async t => {
    const f = updaterFixture(t, { scenario: { args: ['--beta'], answers: answer ? [answer] : [] } });
    const result = await f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Atualização cancelada/);
    assert.equal(result.calls.some(call => ['npm', 'download', 'new-cli'].includes(call.event)), false);
  });
}

for (const [scenario, error] of [
  [{ prefixFailure: 2 }, /prefixo global/],
  [{ prefixOutput: 'not-absolute' }, /prefixo global inválido/],
  [{ prefixOutput: 'C:\\prefix\nunexpected second line' }, /prefixo global inválido/],
  [{ installFailure: 7 }, /Falha ao instalar/],
  [{ installedVersion: '6.0.3-beta' }, /versão 6\.0\.3-beta; esperava 6\.0\.4-beta/],
  [{ installedName: '@some/other-package' }, /não é @monky\/bot/],
  [{ badMetadata: true }, /metadados/],
  [{ missingMetadata: true }, /metadados/],
  [{ missingEntry: true }, /entrada do CLI/],
  [{ installedBin: '../old-checkout/cli.js' }, /entrada do CLI/],
]) {
  test(`npm prefix, installation and installed package failures never run an old or missing CLI (${JSON.stringify(scenario)})`, async t => {
    const f = updaterFixture(t, { scenario });
    const result = await f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, error);
    assert.equal(result.calls.some(call => call.event === 'new-cli'), false);
    assert.doesNotMatch(result.stdout, /atualizado para|Bot reiniciado/);
  });
}

for (const scenario of [
  { childFailure: 9 }, { failPm2Action: 'stop' },
  { failPm2Action: 'startOrRestart' }, { failPm2Action: 'save' },
]) {
  test(`installed package remains installed while fresh restart failure is surfaced (${JSON.stringify(scenario)})`, async t => {
    const f = updaterFixture(t, { port: await freePort(t), scenario });
    const result = await f.run();
    assert.equal(result.status, 1);
    assert.match(result.stdout, /atualizado para 6\.0\.4-beta/);
    assert.match(result.stderr, /Pacote atualizado, mas o reinício do bot falhou/);
    assert.doesNotMatch(result.stdout, /Bot reiniciado/);
    if (scenario.failPm2Action === 'stop') assert.equal(result.calls.some(call => call.event === 'probe'), false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.installed, 'package.json'), 'utf8')).version, '6.0.4-beta');
  });
}

  test('fresh update restart does not call even a failing legacy host media preparation', async t => {
    const f = updaterFixture(t, { port: await freePort(t), scenario: { prepareFailure: true } });
    const result = await f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.calls.some(call => call.event === 'prepare'), false);
    assert.deepEqual(result.calls.filter(call => call.event === 'pm2').map(call => call.args[0]),
      ['stop', 'startOrRestart', 'save']);
    assert.match(result.stdout, /Bot reiniciado/);
  });

test('missing restart configuration reports installation success without launching a child', async t => {
  const f = updaterFixture(t, { missingConfig: true });
  const result = await f.run();
  assert.equal(result.status, 1);
  assert.match(result.stdout, /atualizado para/);
  assert.match(result.stderr, /configuração para reiniciar/);
  assert.equal(result.calls.some(call => call.event === 'new-cli'), false);
});

for (const [name, env] of [
  ['canonical', { MONKY_BOT_LOCALE: 'en', MONKYBOT_LOCALE: 'pt-BR' }],
  ['SDK alias', { MONKY_BOT_LOCALE: undefined, MONKY_LANG: 'en', MONKYBOT_LOCALE: 'pt-BR' }],
  ['legacy alias', { MONKY_BOT_LOCALE: undefined, MONKYBOT_LOCALE: 'en' }],
]) {
  test(`update stages and fresh CLI restart inherit the shared English language choice (${name})`, async t => {
    const f = updaterFixture(t, { port: await freePort(t), env });
    const result = await f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Local version: 6\.0\.3-beta/);
    assert.match(result.stdout, /Downloading Monky Bot/);
    assert.match(result.stdout, /Restarting with the newly installed CLI/);
    assert.match(result.stdout, /Bot restarted/);
    assert.doesNotMatch(result.stdout, /Versão local|Baixando|reiniciado|reiniciando|Atualizando/);
    assert.equal(result.calls.find(call => call.event === 'new-cli').locale, 'en');
    assert.equal(result.calls.find(call => call.event === 'new-cli').legacyLocale, 'en');
  });
}

test('a one-shot operator locale override reaches the new CLI even when the inherited locale is Portuguese', async t => {
  const f = updaterFixture(t, { port: await freePort(t), scenario: { operatorLocale: 'en' } });
  const result = await f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Local version|Bot restarted/);
  assert.doesNotMatch(result.stdout, /Versão local|reiniciado|reiniciando/);
  assert.equal(result.calls.find(call => call.event === 'new-cli').locale, 'en');
  assert.equal(result.calls.find(call => call.event === 'new-cli').legacyLocale, 'en');
  assert.equal(f.env.MONKY_BOT_LOCALE, 'pt-BR');
  assert.equal(f.env.MONKYBOT_LOCALE, 'pt-BR');
});

test('auto-update resolves installed channel on every tick and preserves explicit beta opt-in', () => {
  for (const includeBeta of [false, true]) {
    let version = '3.0.0-beta';
    const calls = [];
    const timers = [];
    const errors = [];
    const context = {
      require(name) {
        if (name === 'fs') return { readFileSync: () => JSON.stringify({ version }) };
        if (name === 'child_process') return { spawnSync: (_exe, args, options) => {
          assert.equal(options.shell, false);
          calls.push(args);
          return { status: 0 };
        } };
        if (name.endsWith('updateReleases.js')) return releases;
        if (name.endsWith('i18n.js')) return i18n;
        throw new Error(`Unexpected module: ${name}`);
      },
      process: { execPath: 'node' },
      console: { log() {}, error: (...args) => errors.push(args) },
      setTimeout: (fn) => timers.push(fn),
    };
    vm.runInNewContext(updates.generateUpdaterScript(path.resolve('dist', 'cli.js'), '04:00', includeBeta), context);
    timers.shift()();
    assert.ok(calls[0].includes('--beta'));
    version = '3.0.0';
    timers.shift()();
    assert.equal(calls[1].includes('--beta'), includeBeta);
    version = 'invalid';
    timers.shift()();
    assert.equal(calls.length, 2);
    assert.equal(errors.length, 1);
    assert.equal(timers.length, 1, 'a transient failure must schedule the next attempt');
  }
});

test('auto-update validates schedule and flags before touching pm2', async () => {
  for (const args of [['on', '25:00'], ['on', '--btea'], ['on', '04:00', '05:00'], ['off', '--beta']]) {
    await assert.rejects(updates.autoUpdateCommand(args), /Uso:|Opções extras/);
  }
});

test('auto-update surfaces an update or restart failure and schedules another attempt', () => {
  const timers = [];
  const errors = [];
  const calls = [];
  const context = {
    require(name) {
      if (name === 'fs') return { readFileSync: () => JSON.stringify({ version: '3.0.0-beta' }) };
      if (name === 'child_process') return {
        spawnSync: (_exe, args) => { calls.push(args); return { status: 1 }; },
      };
      if (name.endsWith('updateReleases.js')) return releases;
      if (name.endsWith('i18n.js')) return i18n;
      throw new Error(`Unexpected module: ${name}`);
    },
    process: { execPath: 'node' },
    console: { log() {}, error: (...args) => errors.push(args.join(' ')) },
    setTimeout: (callback) => timers.push(callback),
  };
  vm.runInNewContext(updates.generateUpdaterScript(path.resolve('dist', 'cli.js'), '04:00'), context);
  timers.shift()();
  assert.deepEqual(Array.from(calls[0]).slice(1), ['update', '--yes', '--beta']);
  assert.match(errors[0], /Atualização falhou \(status 1\)/);
  assert.equal(timers.length, 1);
});

test('auto-update activation persists the beta option without touching bot identity', async (t) => {
  const calls = [];
  let script;
  i18n.setCliLocale('en');
  t.after(() => i18n.setCliLocale('pt-BR'));
  t.mock.method(console, 'log', () => {});
  t.mock.method(config, 'readConfig', () => ({ mode: 'marketplace', botDir: 'existing-bot-dir' }));
  t.mock.method(pm2, 'ensurePm2', () => {});
  t.mock.method(fs, 'mkdirSync', () => {});
  t.mock.method(fs, 'writeFileSync', (file, content) => {
    assert.equal(path.basename(file), '.monkybot-updater.cjs');
    script = content;
  });
  t.mock.method(processHelpers, 'runSync', (command, args, options) => {
    calls.push([command, args, options]);
    return { status: 0 };
  });
  await updates.autoUpdateCommand(['on', '--beta', '03:15']);
  assert.match(script, /const SCHEDULE = "03:15"/);
  assert.match(script, /const INCLUDE_BETA = true/);
  assert.deepEqual(calls.map(([, args]) => args[0]), ['delete', 'start', 'save']);
  assert.equal(calls[0][1][1], 'monkybot-updater');
  assert.equal(calls[1][1][3], 'monkybot-updater');
  assert.deepEqual(calls[1][2].env, { ...process.env, MONKY_BOT_LOCALE: 'en', MONKYBOT_LOCALE: 'en' });
  assert.equal(process.env.MONKY_BOT_LOCALE, 'pt-BR');
  assert.equal(process.env.MONKYBOT_LOCALE, 'pt-BR');
});
