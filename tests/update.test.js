const assert = require('node:assert/strict');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { test } = require('node:test');
const releases = require('../dist/cli/updateReleases');
const updates = require('../dist/cli/commands/update');
const processHelpers = require('../dist/cli/process');
const pm2 = require('../dist/cli/pm2');
const config = require('../dist/cli/config');
const { setBindHost, listen, freePort, captureBinds } = require('./helpers/manifest-port');

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

function commandFixture(t, local, remote) {
  const exists = fs.existsSync;
  const read = fs.readFileSync;
  t.mock.method(fs, 'existsSync', (file) => path.basename(file) === 'package.json' || exists(file));
  t.mock.method(fs, 'readFileSync', (file, ...args) =>
    path.basename(file) === 'package.json' ? JSON.stringify({ version: local }) : read(file, ...args));
  const fetch = t.mock.method(releases, 'fetchLatestRelease', async () =>
    releases.selectRelease([release(remote)], true));
  const run = t.mock.method(processHelpers, 'runSync', () => ({ status: 0 }));
  t.mock.method(pm2, 'isPm2Available', () => false);
  const lines = [];
  t.mock.method(console, 'log', (...args) => lines.push(args.join(' ')));
  return { fetch, run, lines };
}

function runningBot(t, port, previousHost) {
  setBindHost(t);
  const current = {
    mode: 'marketplace', botDir: path.resolve(__dirname, '..'),
    servePort: port, publicHost: 'bot.example.test',
  };
  t.mock.method(pm2, 'isPm2Available', () => true);
  t.mock.method(pm2, 'isBotRunning', () => true);
  t.mock.method(pm2, 'ensurePm2', () => {});
  t.mock.method(pm2, 'findBotProcess', () => ({
    name: 'monkybot', pm_id: 31, pid: 12345,
    pm2_env: {
      status: 'online', pm_exec_path: config.getBotEntryPath(current.botDir),
      MONKY_SERVE_HOST: previousHost,
    },
  }));
  t.mock.method(config, 'readConfig', () => current);
  const ecosystem = t.mock.method(pm2, 'writeEcosystem', () => 'existing-ecosystem');
  return { current, ecosystem };
}

test('update --beta --yes installs selected beta once', async (t) => {
  const { fetch, run } = commandFixture(t, '2.0.1', '3.0.0-beta');
  await updates.updateCommand(['--beta', '--yes']);
  assert.deepEqual(fetch.mock.calls[0].arguments, [true]);
  assert.deepEqual(run.mock.calls[0].arguments.slice(0, 2),
    ['npm', ['install', '-g', release('3.0.0-beta').assets[0].browser_download_url]]);
  assert.equal(run.mock.callCount(), 1);
});

test('stable promotion is newer than an installed beta of the same base', async (t) => {
  const { fetch, run } = commandFixture(t, '3.0.0-beta', '3.0.0');
  await updates.updateCommand(['--yes']);
  assert.deepEqual(fetch.mock.calls[0].arguments, [false]);
  assert.equal(run.mock.callCount(), 1);
});

for (const [local, remote, args] of [
  ['3.0.0-beta', '2.0.1', ['--yes']],
  ['3.0.0-beta', '3.0.0-beta', ['--beta', '--yes']],
  ['3.0.0', '3.0.0-beta', ['--beta', '--yes']],
  ['2.0.1', '3.0.0-beta', ['--beta', '--check']],
]) {
  test(`no install for ${local} -> ${remote} (${args.join(' ')})`, async (t) => {
    const { run } = commandFixture(t, local, remote);
    await updates.updateCommand(args);
    assert.equal(run.mock.callCount(), 0);
  });
}

test('unknown flags fail before network or installation', async () => {
  await assert.rejects(updates.updateCommand(['--btea']), /Opção desconhecida/);
});

test('failed install does not restart the bot or report success', async (t) => {
  const { run } = commandFixture(t, '2.0.1', '3.0.0-beta');
  run.mock.mockImplementation(() => ({ status: 1 }));
  await assert.rejects(updates.updateCommand(['--beta', '--yes']), /Falha ao instalar/);
  assert.equal(run.mock.callCount(), 1);
});

test('successful update restarts using the existing bot configuration', async (t) => {
  const { run } = commandFixture(t, '2.0.1', '3.0.0-beta');
  const listener = await listen(t);
  const { current, ecosystem } = runningBot(t, listener.address().port);
  run.mock.mockImplementation((_command, args) => {
    if (args[0] === 'stop') listener.close();
    return { status: 0 };
  });
  await updates.updateCommand(['--beta', '--yes']);
  assert.equal(ecosystem.mock.calls[0].arguments[0], current);
  assert.deepEqual(run.mock.calls.map((call) => call.arguments.slice(0, 2)), [
    ['npm', ['install', '-g', release('3.0.0-beta').assets[0].browser_download_url]],
    ['pm2', ['stop', '31']],
    ['pm2', ['startOrRestart', 'existing-ecosystem']], ['pm2', ['save']],
  ]);
});

test('update preserves the managed loopback bind when the shell has no host override', async (t) => {
  const { run } = commandFixture(t, '2.0.1', '3.0.0-beta');
  const listener = await listen(t, undefined, 0, '127.0.0.1');
  const port = listener.address().port;
  const { ecosystem } = runningBot(t, port, '127.0.0.1');
  const binds = captureBinds(t);
  run.mock.mockImplementation((_command, args) => {
    if (args[0] === 'stop') listener.close();
    return { status: 0 };
  });
  await updates.updateCommand(['--beta', '--yes']);
  assert.deepEqual(binds, [{ port, host: '127.0.0.1', exclusive: true }]);
  assert.equal(ecosystem.mock.calls[0].arguments[1], '127.0.0.1');
  assert.equal(listener.listening, false);
});

test('restart failure is surfaced after package installation', async (t) => {
  const { run } = commandFixture(t, '2.0.1', '3.0.0-beta');
  runningBot(t, await freePort(t));
  run.mock.mockImplementationOnce(() => ({ status: 1 }), 2);
  await assert.rejects(updates.updateCommand(['--beta', '--yes']), /reinício do bot falhou/);
  assert.equal(run.mock.callCount(), 3);
});

test('update shares the restart port check and never reports a successful restart on collision', async (t) => {
  const { run, lines } = commandFixture(t, '2.0.1', '3.0.0-beta');
  const otherService = await listen(t);
  const ownListener = await listen(t);
  const { ecosystem } = runningBot(t, otherService.address().port);
  run.mock.mockImplementation((_command, args) => {
    if (args[0] === 'stop') {
      assert.equal(args[1], '31');
      ownListener.close();
    }
    return { status: 0 };
  });
  await assert.rejects(updates.updateCommand(['--beta', '--yes']), (error) => {
    assert.match(error.message, /Pacote atualizado, mas o reinício do bot falhou/);
    assert.match(error.message, /já está em uso por um bot ou outro serviço/);
    return true;
  });
  assert.deepEqual(run.mock.calls.map((call) => call.arguments[1][0]), ['install', 'stop']);
  assert.equal(ecosystem.mock.callCount(), 0);
  assert.equal(ownListener.listening, false);
  assert.equal(otherService.listening, true);
  assert.doesNotMatch(lines.join('\n'), /Bot reiniciado|Manifest:/);
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
        if (name === 'child_process') return { spawnSync: (_exe, args) => { calls.push(args); return { status: 0 }; } };
        if (name.endsWith('updateReleases.js')) return releases;
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
  t.mock.method(console, 'log', () => {});
  t.mock.method(config, 'readConfig', () => ({ mode: 'marketplace', botDir: 'existing-bot-dir' }));
  t.mock.method(pm2, 'ensurePm2', () => {});
  t.mock.method(fs, 'mkdirSync', () => {});
  t.mock.method(fs, 'writeFileSync', (file, content) => {
    assert.equal(path.basename(file), '.monkybot-updater.cjs');
    script = content;
  });
  t.mock.method(processHelpers, 'runSync', (command, args) => {
    calls.push([command, args]);
    return { status: 0 };
  });
  await updates.autoUpdateCommand(['on', '--beta', '03:15']);
  assert.match(script, /const SCHEDULE = "03:15"/);
  assert.match(script, /const INCLUDE_BETA = true/);
  assert.deepEqual(calls.map(([, args]) => args[0]), ['delete', 'start', 'save']);
  assert.equal(calls[0][1][1], 'monkybot-updater');
  assert.equal(calls[1][1][3], 'monkybot-updater');
});
