const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const lifecycle = require('../dist/cli/commands/lifecycle');
const config = require('../dist/cli/config');
const pm2 = require('../dist/cli/pm2');
const processHelpers = require('../dist/cli/process');
const manifestPort = require('../dist/cli/manifestPort');
const { setBindHost, closeServer, listen, freePort, captureBinds } = require('./helpers/manifest-port');

const botDir = path.resolve(__dirname, '..');
const entry = path.join(botDir, 'dist', 'index.js');

function marketplace(port) {
  return { mode: 'marketplace', botDir, servePort: port, publicHost: 'bot.example.test', botName: 'MonkyBot' };
}

function managedProcess(status = 'online') {
  return {
    name: 'monkybot', pm_id: 17, pid: status === 'online' ? 12345 : 0,
    pm2_env: { status, pm_exec_path: entry, pm_cwd: botDir },
  };
}

function fixture(t, initial, proc = null) {
  setBindHost(t);
  const state = {
    current: structuredClone(initial),
    effects: [], lines: [],
    runBehavior: () => ({ status: 0 }),
  };
  t.mock.method(config, 'readConfig', () => state.current);
  state.write = t.mock.method(config, 'writeConfig', (next) => {
    state.current = structuredClone(next);
  });
  t.mock.method(config, 'getBotEntryPath', () => entry);
  state.find = t.mock.method(pm2, 'findBotProcess', () => proc);
  t.mock.method(pm2, 'requirePm2', () => true);
  state.ensure = t.mock.method(pm2, 'ensurePm2', () => state.effects.push('ensure'));
  state.ecosystem = t.mock.method(pm2, 'writeEcosystem', () => {
    state.effects.push('ecosystem');
    return 'test-ecosystem.cjs';
  });
  state.run = t.mock.method(processHelpers, 'runSync', (command, args) => {
    state.effects.push(args[0]);
    return state.runBehavior(command, args);
  });
  t.mock.method(console, 'log', (...args) => state.lines.push(args.join(' ')));
  return state;
}

function mockPm2Lookup(t, result = { status: 0 }) {
  return t.mock.method(childProcess, 'spawnSync', (command, args, options) => {
    assert.equal(command, process.platform === 'win32' ? 'where.exe' : 'sh');
    assert.deepEqual(args, process.platform === 'win32' ? ['pm2'] : ['-c', 'command -v pm2']);
    assert.equal(options.stdio, 'ignore');
    if (result instanceof Error) throw result;
    return result;
  });
}

for (const proc of [null, managedProcess('stopped')]) {
  test(`start rejects a real conflict before installing, writing or starting (${proc ? 'stopped' : 'unregistered'})`, async (t) => {
    const service = await listen(t);
    const initial = marketplace(service.address().port);
    const state = fixture(t, initial, proc);
    await assert.rejects(lifecycle.startCommand(), /já está em uso por um bot ou outro serviço/);
    assert.deepEqual(state.effects, []);
    assert.equal(state.write.mock.callCount(), 0);
    assert.deepEqual(state.current, initial);
    assert.doesNotMatch(state.lines.join('\n'), /iniciado!|Manifest:/);
    assert.equal(service.listening, true);
  });
}

test('start remains idempotent for the managed online process without assuming it owns the configured port', async (t) => {
  const service = await listen(t);
  const state = fixture(t, marketplace(service.address().port), managedProcess());
  const probe = t.mock.method(manifestPort, 'assertManifestPortAvailable', () => assert.fail('An idempotent start must not probe.'));
  await lifecycle.startCommand();
  assert.equal(probe.mock.callCount(), 0);
  assert.deepEqual(state.effects, []);
  assert.match(state.lines.join('\n'), /já está rodando/);
  assert.doesNotMatch(state.lines.join('\n'), /iniciado!|Manifest:/);
  assert.equal(service.listening, true);
});

test('start accepts an available port and releases the probe before writing the ecosystem', async (t) => {
  const port = await freePort(t);
  const state = fixture(t, marketplace(port));
  await lifecycle.startCommand();
  assert.deepEqual(state.effects, ['ensure', 'ecosystem', 'startOrRestart', 'save']);
  assert.deepEqual(state.run.mock.calls[0].arguments.slice(0, 2),
    ['pm2', ['startOrRestart', 'test-ecosystem.cjs']]);
  assert.match(state.lines.join('\n'), new RegExp(`http://bot\\.example\\.test:${port}/manifest`));
  await listen(t, undefined, port);
});

test('an omitted configured port uses the runtime default without probing a fixed host port in the fixture', async (t) => {
  fixture(t, marketplace(undefined));
  const probe = t.mock.method(manifestPort, 'assertManifestPortAvailable', async () => {});
  await lifecycle.startCommand();
  assert.deepEqual(probe.mock.calls[0].arguments, [7780, '0.0.0.0']);
});

test('start does not announce a manifest if pm2 fails after the successful preflight', async (t) => {
  const state = fixture(t, marketplace(await freePort(t)));
  state.runBehavior = () => ({ status: 1 });
  await assert.rejects(lifecycle.startCommand(), /Falha ao iniciar/);
  assert.deepEqual(state.effects, ['ensure', 'ecosystem', 'startOrRestart']);
  assert.doesNotMatch(state.lines.join('\n'), /iniciado!|Manifest:/);
});

for (const fresh of [false, true]) {
  test(`restart stops only the managed ID, checks the released port and starts again (fresh=${fresh})`, async (t) => {
    const ownListener = await listen(t);
    const port = ownListener.address().port;
    const state = fixture(t, marketplace(port), managedProcess());
    state.runBehavior = (command, args) => {
      assert.equal(command, 'pm2');
      if (args[0] === 'stop') {
        assert.equal(args[1], '17');
        ownListener.close();
      }
      return { status: 0 };
    };
    await lifecycle.restartCommand(fresh ? ['--fresh'] : []);
    assert.deepEqual(state.effects, fresh
      ? ['stop', 'ensure', 'delete', 'ecosystem', 'startOrRestart', 'save']
      : ['stop', 'ensure', 'ecosystem', 'startOrRestart', 'save']);
    if (fresh) assert.deepEqual(state.run.mock.calls[1].arguments.slice(0, 2), ['pm2', ['delete', '17']]);
    assert.match(state.lines.join('\n'), /Monky Bot reiniciado!/);
    assert.equal(ownListener.listening, false);
    await listen(t, undefined, port);
  });
}

for (const [name, action, previousEnv, override, expected] of [
  ['previous loopback host', 'restart', { MONKY_SERVE_HOST: '127.0.0.1' }, undefined, '127.0.0.1'],
  ['previous host with --fresh', 'fresh', { MONKY_SERVE_HOST: '127.0.0.1' }, undefined, '127.0.0.1'],
  ['stopped process host', 'start', { MONKY_SERVE_HOST: '127.0.0.1' }, undefined, '127.0.0.1'],
  ['nested pm2 environment', 'restart', { env: { MONKY_SERVE_HOST: '127.0.0.1' } }, undefined, '127.0.0.1'],
  ['flattened host before nested environment', 'restart', {
    MONKY_SERVE_HOST: '127.0.0.1', env: { MONKY_SERVE_HOST: '0.0.0.0' },
  }, undefined, '127.0.0.1'],
  ['explicit operator override', 'restart', { MONKY_SERVE_HOST: '127.0.0.1' }, '0.0.0.0', '0.0.0.0'],
  ['default when no previous host exists', 'restart', {}, undefined, '0.0.0.0'],
]) {
  test(`probe and ecosystem use the same effective host: ${name}`, async (t) => {
    const previousHost = previousEnv.MONKY_SERVE_HOST ?? previousEnv.env?.MONKY_SERVE_HOST ?? '0.0.0.0';
    const ownListener = await listen(t, undefined, 0, previousHost);
    const port = ownListener.address().port;
    const proc = managedProcess(action === 'start' ? 'stopped' : 'online');
    Object.assign(proc.pm2_env, previousEnv);
    if (action === 'start') await closeServer(ownListener);
    const state = fixture(t, marketplace(port), proc);
    if (override !== undefined) process.env.MONKY_SERVE_HOST = override;
    const binds = captureBinds(t);
    state.runBehavior = (_command, args) => {
      if (args[0] === 'stop') {
        assert.equal(args[1], '17');
        ownListener.close();
      }
      return { status: 0 };
    };
    if (action === 'start') await lifecycle.startCommand();
    else await lifecycle.restartCommand(action === 'fresh' ? ['--fresh'] : []);
    assert.deepEqual(binds, [{ port, host: expected, exclusive: true }]);
    assert.deepEqual(state.ecosystem.mock.calls[0].arguments, [state.current, expected]);
    assert.equal(ownListener.listening, false);
  });
}

for (const fresh of [false, true]) {
  test(`restart never treats an online bot in another port as ownership of a conflict (fresh=${fresh})`, async (t) => {
    const otherService = await listen(t);
    const ownListener = await listen(t);
    const state = fixture(t, marketplace(otherService.address().port), managedProcess());
    state.runBehavior = (_command, args) => {
      assert.deepEqual(args, ['stop', '17']);
      ownListener.close();
      return { status: 0 };
    };
    await assert.rejects(lifecycle.restartCommand(fresh ? ['--fresh'] : []), /EADDRINUSE/);
    assert.deepEqual(state.effects, ['stop']);
    assert.equal(state.write.mock.callCount(), 0);
    assert.equal(ownListener.listening, false);
    assert.equal(otherService.listening, true);
    assert.doesNotMatch(state.lines.join('\n'), /reiniciado!|Manifest:/);
  });
}

test('a successful pm2 stop is not enough if the actual socket remains occupied', async (t) => {
  const service = await listen(t);
  const state = fixture(t, marketplace(service.address().port), managedProcess());
  await assert.rejects(lifecycle.restartCommand([]), /EADDRINUSE/);
  assert.deepEqual(state.effects, ['stop']);
  assert.equal(service.listening, true);
  assert.doesNotMatch(state.lines.join('\n'), /reiniciado!|Manifest:/);
});

test('a failed stop aborts restart before the port check or any further pm2 mutation', async (t) => {
  const state = fixture(t, marketplace(await freePort(t)), managedProcess());
  state.runBehavior = () => ({ status: 1 });
  const check = t.mock.method(manifestPort, 'assertManifestPortAvailable', () => assert.fail('A failed stop must abort first.'));
  await assert.rejects(lifecycle.restartCommand(['--fresh']), /Falha ao parar o bot antes do reinício/);
  assert.equal(check.mock.callCount(), 0);
  assert.deepEqual(state.effects, ['stop']);
  assert.doesNotMatch(state.lines.join('\n'), /reiniciado!|Manifest:/);
});

test('restart of an unregistered bot rejects conflicts without installing pm2 or stopping services', async (t) => {
  const service = await listen(t);
  const state = fixture(t, marketplace(service.address().port));
  await assert.rejects(lifecycle.restartCommand(['--fresh']), /EADDRINUSE/);
  assert.deepEqual(state.effects, []);
  assert.equal(service.listening, true);
});

test('restart of an unregistered bot still starts normally on a free port', async (t) => {
  const state = fixture(t, marketplace(await freePort(t)));
  await lifecycle.restartCommand(['--fresh']);
  assert.deepEqual(state.effects, ['ensure', 'ecosystem', 'startOrRestart', 'save']);
});

for (const action of ['delete', 'startOrRestart', 'save']) {
  test(`restart surfaces a pm2 ${action} failure without printing success`, async (t) => {
    const state = fixture(t, marketplace(await freePort(t)), managedProcess('stopped'));
    state.runBehavior = (_command, args) => ({ status: args[0] === action ? 1 : 0 });
    await assert.rejects(lifecycle.restartCommand(['--fresh']), /Falha|não foi possível salvar/);
    assert.equal(state.effects.at(-1), action);
    assert.doesNotMatch(state.lines.join('\n'), /reiniciado!|Manifest:/);
  });
}

test('a matching pm2 name alone cannot authorize start, stop or restart of a different entry', async (t) => {
  const service = await listen(t);
  const other = managedProcess();
  other.pm2_env.pm_exec_path = path.join(botDir, 'other-service.js');
  const state = fixture(t, marketplace(service.address().port), other);
  await assert.rejects(lifecycle.startCommand(), /não pôde ser identificado como este bot/);
  await assert.rejects(lifecycle.restartCommand(['--fresh']), /não pôde ser identificado como este bot/);
  assert.throws(() => lifecycle.stopCommand(), /não pôde ser identificado como este bot/);
  assert.deepEqual(state.effects, []);
  assert.equal(service.listening, true);
});

test('a missing pm2 ID fails closed rather than falling back to a process name', async (t) => {
  const proc = managedProcess();
  delete proc.pm_id;
  const state = fixture(t, marketplace(await freePort(t)), proc);
  await assert.rejects(lifecycle.restartCommand([]), /não pôde ser identificado como este bot/);
  assert.deepEqual(state.effects, []);
});

test('ambiguous duplicate pm2 names fail closed instead of selecting a process to stop or restart', (t) => {
  mockPm2Lookup(t);
  const run = t.mock.method(processHelpers, 'runSync', () => ({
    status: 0,
    stdout: JSON.stringify([managedProcess(), { ...managedProcess(), pm_id: 18 }]),
  }));
  assert.throws(() => pm2.findBotProcess(), /mais de um processo pm2 chamado monkybot/);
  assert.deepEqual(run.mock.calls.map((call) => call.arguments.slice(0, 2)), [['pm2', ['jlist']]]);
});

const inventorySecret = 'synthetic-jlist-secret';
for (const [name, output, expected] of [
  ['failed command', { status: 1, stdout: inventorySecret, stderr: inventorySecret }, /Falha.*pm2.*jlist/],
  ['spawn error', { status: null, error: new Error(inventorySecret) }, /Falha.*pm2.*jlist/],
  ['thrown error', new Error(inventorySecret), /Falha.*pm2.*jlist/],
  ['invalid JSON', { status: 0, stdout: `{"token":"${inventorySecret}"` }, /JSON inválido/],
  ['non-array JSON', { status: 0, stdout: JSON.stringify({ env: { TOKEN: inventorySecret } }) }, /estrutura inválida/],
  ['null entry', { status: 0, stdout: JSON.stringify([managedProcess(), null]) }, /estrutura inválida/],
  ['missing ID', { status: 0, stdout: JSON.stringify([{ ...managedProcess(), pm_id: undefined }]) }, /estrutura inválida/],
  ['invalid name', { status: 0, stdout: JSON.stringify([{ ...managedProcess(), name: 17 }]) }, /estrutura inválida/],
  ['invalid PID', { status: 0, stdout: JSON.stringify([{ ...managedProcess(), pid: inventorySecret }]) }, /estrutura inválida/],
  ['invalid environment', { status: 0, stdout: JSON.stringify([{ ...managedProcess(), pm2_env: [] }]) }, /estrutura inválida/],
  ['invalid saved bind host', { status: 0, stdout: JSON.stringify([{
    ...managedProcess(), pm2_env: { ...managedProcess().pm2_env, MONKY_SERVE_HOST: 127 },
  }]) }, /estrutura inválida/],
  ['invalid nested bind host', { status: 0, stdout: JSON.stringify([{
    ...managedProcess(), pm2_env: { ...managedProcess().pm2_env, env: { MONKY_SERVE_HOST: [] } },
  }]) }, /estrutura inválida/],
  ['invalid metrics', { status: 0, stdout: JSON.stringify([{ ...managedProcess(), monit: { cpu: inventorySecret } }]) }, /estrutura inválida/],
]) {
  test(`pm2 inventory ${name} blocks start/restart without side effects or leaking raw output`, async (t) => {
    const state = fixture(t, marketplace(await freePort(t)));
    state.find.mock.restore();
    mockPm2Lookup(t);
    t.mock.method(console, 'error', (...args) => state.lines.push(args.join(' ')));
    state.runBehavior = (command, args) => {
      assert.equal(command, 'pm2');
      assert.deepEqual(args, ['jlist']);
      if (output instanceof Error) throw output;
      return output;
    };
    const probe = t.mock.method(manifestPort, 'assertManifestPortAvailable', () => assert.fail('Invalid inventory must abort first.'));
    for (const command of [lifecycle.startCommand, () => lifecycle.restartCommand(['--fresh'])]) {
      await assert.rejects(command(), (error) => {
        assert.match(error.message, expected);
        assert.equal(error.cause, undefined);
        assert.equal(String(error).includes(inventorySecret), false);
        return true;
      });
    }
    assert.deepEqual(state.effects, ['jlist', 'jlist']);
    assert.equal(state.ensure.mock.callCount(), 0);
    assert.equal(state.ecosystem.mock.callCount(), 0);
    assert.equal(state.write.mock.callCount(), 0);
    assert.equal(probe.mock.callCount(), 0);
    assert.equal(state.lines.join('\n').includes(inventorySecret), false);
    assert.doesNotMatch(state.lines.join('\n'), /iniciado!|reiniciado!|Manifest:/);
  });
}

for (const [name, result] of [
  ['failed lookup', { status: 2 }],
  ['missing lookup utility', { status: null, error: Object.assign(new Error(inventorySecret), { code: 'ENOENT' }) }],
  ['thrown lookup error', new Error(inventorySecret)],
]) {
  test(`${name} cannot be mistaken for an absent pm2 installation`, async (t) => {
    const state = fixture(t, marketplace(await freePort(t)));
    state.find.mock.restore();
    mockPm2Lookup(t, result);
    await assert.rejects(lifecycle.startCommand(), /Não foi possível verificar se o pm2 está instalado/);
    await assert.rejects(lifecycle.restartCommand([]), /Não foi possível verificar se o pm2 está instalado/);
    assert.deepEqual(state.effects, []);
    assert.equal(state.write.mock.callCount(), 0);
    assert.equal(state.lines.join('\n').includes(inventorySecret), false);
  });
}

test('an absent pm2 executable returns an empty inventory without running pm2', (t) => {
  mockPm2Lookup(t, { status: 1 });
  const run = t.mock.method(processHelpers, 'runSync', () => assert.fail('An absent pm2 must not be invoked.'));
  assert.deepEqual(pm2.listPm2Processes(), []);
  assert.equal(run.mock.callCount(), 0);
});

test('valid empty and populated pm2 inventories are preserved', (t) => {
  mockPm2Lookup(t);
  let processes = [];
  t.mock.method(processHelpers, 'runSync', (command, args) => {
    assert.equal(command, 'pm2');
    assert.deepEqual(args, ['jlist']);
    return { status: 0, stdout: JSON.stringify(processes) };
  });
  assert.deepEqual(pm2.listPm2Processes(), []);
  processes = [
    managedProcess('stopped'),
    { ...managedProcess(), name: 'another-service', pm_id: 18, monit: { cpu: 0, memory: 4096 } },
  ];
  processes[0].pm2_env.MONKY_SERVE_HOST = '127.0.0.1';
  processes[0].pm2_env.env = { MONKY_SERVE_HOST: '127.0.0.1' };
  assert.deepEqual(pm2.listPm2Processes(), processes);
});

test('explicit stop targets only the identified pm2 ID and never probes ports', (t) => {
  const state = fixture(t, { mode: 'manual', botDir }, managedProcess());
  t.mock.method(manifestPort, 'assertManifestPortAvailable', () => assert.fail('Stop must not probe.'));
  lifecycle.stopCommand();
  assert.deepEqual(state.run.mock.calls[0].arguments.slice(0, 2), ['pm2', ['stop', '17']]);
});

for (const action of ['start', 'restart']) {
  test(`manual ${action} does not check an unused manifest port`, async (t) => {
    const service = await listen(t);
    const initial = {
      mode: 'manual', botDir, serverUrl: 'ws://127.0.0.1:3000/',
      botToken: 'synthetic-token', servePort: service.address().port,
    };
    const state = fixture(t, initial, action === 'restart' ? managedProcess() : null);
    t.mock.method(manifestPort, 'assertManifestPortAvailable', () => assert.fail('Manual mode must not probe.'));
    if (action === 'start') await lifecycle.startCommand();
    else await lifecycle.restartCommand([]);
    assert.ok(state.effects.includes('startOrRestart'));
    assert.equal(service.listening, true);
    assert.doesNotMatch(state.lines.join('\n'), /Manifest:/);
  });
}

for (const key of ['servePort', 'mode']) {
  test(`config set ${key} rejects collisions and leaves the previous object and persisted config intact`, async (t) => {
    const service = await listen(t);
    const occupied = service.address().port;
    const initial = {
      ...marketplace(key === 'servePort' ? await freePort(t) : occupied),
      mode: key === 'mode' ? 'manual' : 'marketplace',
      botToken: 'synthetic-preserved-token',
    };
    const state = fixture(t, initial);
    const original = state.current;
    const value = key === 'servePort' ? String(occupied) : 'marketplace';
    await assert.rejects(lifecycle.configCommand(['set', key, value]), /EADDRINUSE/);
    assert.deepEqual(original, initial);
    assert.deepEqual(state.current, initial);
    assert.equal(state.write.mock.callCount(), 0);
    assert.deepEqual(state.effects, []);
    assert.doesNotMatch(state.lines.join('\n'), /✅|Manifest:/);
    assert.equal(service.listening, true);
  });
}

test('public host/name changes and mode/port no-ops do not probe or stop the online bot', async (t) => {
  const service = await listen(t);
  const port = service.address().port;
  const state = fixture(t, marketplace(port), managedProcess());
  const probe = t.mock.method(manifestPort, 'assertManifestPortAvailable', () => assert.fail('The bind has not changed.'));
  await lifecycle.configCommand(['set', 'publicHost', 'new.example.test']);
  await lifecycle.configCommand(['set', 'botName', 'Renamed Bot']);
  await lifecycle.configCommand(['set', 'mode', 'marketplace']);
  await lifecycle.configCommand(['set', 'servePort', String(port)]);
  assert.equal(state.current.publicHost, 'new.example.test');
  assert.equal(state.current.botName, 'Renamed Bot');
  assert.equal(state.current.servePort, port);
  assert.equal(state.write.mock.callCount(), 4);
  assert.equal(state.find.mock.callCount(), 0);
  assert.equal(probe.mock.callCount(), 0);
  assert.deepEqual(state.effects, []);
  assert.equal(service.listening, true);
});

test('setting an omitted port to the runtime default is also a bind no-op', async (t) => {
  const state = fixture(t, marketplace(undefined), managedProcess());
  t.mock.method(manifestPort, 'assertManifestPortAvailable', () => assert.fail('The effective default port has not changed.'));
  await lifecycle.configCommand(['set', 'servePort', String(manifestPort.DEFAULT_MANIFEST_PORT)]);
  assert.equal(state.current.servePort, manifestPort.DEFAULT_MANIFEST_PORT);
  assert.equal(state.write.mock.callCount(), 1);
  assert.deepEqual(state.effects, []);
});

test('config set accepts a free port and a manual-to-marketplace transition', async (t) => {
  const port = await freePort(t);
  const state = fixture(t, { ...marketplace(port), mode: 'manual' });
  const previous = state.current;
  await lifecycle.configCommand(['set', 'mode', 'marketplace']);
  assert.equal(previous.mode, 'manual');
  assert.equal(state.current.mode, 'marketplace');
  await lifecycle.configCommand(['set', 'servePort', String(port)]);
  assert.equal(state.current.servePort, port);
  assert.equal(state.write.mock.callCount(), 2);
  await listen(t, undefined, port);
});

for (const args of [
  ['servePort', '0'], ['servePort', '65536'], ['servePort', '43210junk'],
  ['servePort', '1.5'], ['mode', 'invalid'], ['publicHost', 'http://bot.example.test'],
]) {
  test(`config set rejects invalid ${args.join(' ')} without mutating config`, async (t) => {
    const initial = marketplace(await freePort(t));
    const state = fixture(t, initial);
    await assert.rejects(lifecycle.configCommand(['set', ...args]), /serve port|Modo inválido|public host/i);
    assert.deepEqual(state.current, initial);
    assert.equal(state.write.mock.callCount(), 0);
  });
}

test('config changes unrelated to the endpoint and manual mode never probe an occupied manifest port', async (t) => {
  const service = await listen(t);
  const state = fixture(t, marketplace(service.address().port));
  t.mock.method(manifestPort, 'assertManifestPortAvailable', () => assert.fail('This setting must not probe.'));
  await lifecycle.configCommand(['set', 'botName', 'Renamed Bot']);
  await lifecycle.configCommand(['set', 'botDir', botDir]);
  await lifecycle.configCommand(['set', 'mode', 'manual']);
  await lifecycle.configCommand(['set', 'servePort', String(service.address().port)]);
  await lifecycle.configCommand(['set', 'publicHost', 'manual.example.test']);
  await lifecycle.configCommand(['set', 'serverUrl', 'ws://127.0.0.1:3000/']);
  await lifecycle.configCommand(['set', 'botToken', 'synthetic-token']);
  assert.equal(state.write.mock.callCount(), 7);
  assert.equal(state.current.mode, 'manual');
  assert.equal(state.current.botName, 'Renamed Bot');
  assert.equal(service.listening, true);
});

test('permission errors abort config changes and startup rather than counting as a free port', async (t) => {
  const initial = marketplace(await freePort(t));
  const state = fixture(t, initial);
  const error = new Error('Sem permissão para usar a porta (EACCES).');
  t.mock.method(manifestPort, 'assertManifestPortAvailable', async () => { throw error; });
  const nextPort = initial.servePort === 65535 ? 65534 : initial.servePort + 1;
  await assert.rejects(lifecycle.configCommand(['set', 'servePort', String(nextPort)]), /EACCES/);
  await assert.rejects(lifecycle.startCommand(), /EACCES/);
  assert.deepEqual(state.current, initial);
  assert.equal(state.write.mock.callCount(), 0);
  assert.deepEqual(state.effects, []);
});

test('the ecosystem pins the probed bind and default port, and explicitly disables serving in manual mode', (t) => {
  setBindHost(t);
  const evaluate = (settings) => {
    const context = { module: { exports: {} } };
    vm.runInNewContext(pm2.generateEcosystem(settings), context);
    return context.module.exports.apps[0].env;
  };
  const defaultEnv = evaluate(marketplace(undefined));
  assert.equal(defaultEnv.MONKY_SERVE, 'true');
  assert.equal(defaultEnv.MONKY_SERVE_HOST, '0.0.0.0');
  assert.equal(defaultEnv.MONKY_SERVE_PORT, '7780');
  process.env.MONKY_SERVE_HOST = '127.0.0.1';
  assert.equal(evaluate(marketplace(43210)).MONKY_SERVE_HOST, '127.0.0.1');
  const manualEnv = evaluate({ mode: 'manual', botDir, botName: 'Manual Bot' });
  assert.equal(manualEnv.MONKY_SERVE, 'false');
  assert.equal(manualEnv.MONKY_BOT_NAME, 'Manual Bot');
});

test('writeEcosystem persists the resolved host instead of replacing it with the shell value', (t) => {
  setBindHost(t, '0.0.0.0');
  let content;
  t.mock.method(fs, 'mkdirSync', () => {});
  t.mock.method(fs, 'writeFileSync', (_file, value) => { content = value; });
  pm2.writeEcosystem(marketplace(43210), '127.0.0.1');
  const context = { module: { exports: {} } };
  vm.runInNewContext(content, context);
  assert.equal(context.module.exports.apps[0].env.MONKY_SERVE_HOST, '127.0.0.1');
});

for (const [command, method] of [['start', 'startCommand'], ['restart', 'restartCommand'], ['config', 'configCommand']]) {
  test(`CLI awaits ${command} and reports an async failure with exit status 1`, async () => {
    const exits = [];
    const errors = [];
    const context = {
      require(name) {
        if (name === './cli/constants') return require('../dist/cli/constants');
        if (name === './cli/commands/lifecycle') {
          return { [method]: async () => { await Promise.resolve(); throw new Error('synthetic EADDRINUSE'); } };
        }
        if (['./cli/commands/setup', './cli/commands/update'].includes(name)) return {};
        throw new Error(`Unexpected CLI import: ${name}`);
      },
      process: { argv: ['node', 'cli.js', command], exit: (code) => exits.push(code) },
      console: { log() {}, error: (message) => errors.push(message) },
      exports: {},
    };
    vm.runInNewContext(fs.readFileSync(path.join(botDir, 'dist', 'cli.js'), 'utf8'), context);
    await new Promise(setImmediate);
    assert.deepEqual(exits, [1]);
    assert.match(errors.join('\n'), /Erro:.*synthetic EADDRINUSE/);
  });
}
