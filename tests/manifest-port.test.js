const assert = require('node:assert/strict');
const net = require('node:net');
const { test } = require('node:test');
const { assertManifestPortAvailable } = require('../dist/cli/manifestPort');
const { setBindHost, closeServer, listen, freePort, captureBinds } = require('./helpers/manifest-port');

for (const host of ['0.0.0.0', '127.0.0.1']) {
  test(`a real TCP listener blocks the manifest port on the runtime bind (${host})`, async (t) => {
    setBindHost(t, host === '0.0.0.0' ? undefined : host);
    const service = await listen(t, undefined, 0, host);
    const port = service.address().port;
    await assert.rejects(assertManifestPortAvailable(port), (error) => {
      assert.equal(error.cause.code, 'EADDRINUSE');
      assert.match(error.message, new RegExp(`porta ${port} já está em uso por um bot ou outro serviço`));
      assert.match(error.message, /escolha outra porta/);
      assert.match(error.message, /monkybot stop antes de continuar/);
      assert.ok(error.message.includes(`${host}:${port}`));
      return true;
    });
    assert.equal(service.listening, true);
  });
}

test('the real probe releases its socket and listeners before resolving or rejecting', async (t) => {
  setBindHost(t);
  const port = await freePort(t);
  const createServer = net.createServer;
  const probes = [];
  t.mock.method(net, 'createServer', (...args) => {
    const server = createServer(...args);
    probes.push(server);
    return server;
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    await assertManifestPortAvailable(port);
  }
  const service = await listen(t, createServer(), port);
  for (let attempt = 0; attempt < 3; attempt++) {
    await assert.rejects(assertManifestPortAvailable(port), /EADDRINUSE/);
  }
  for (const probe of probes) {
    assert.equal(probe.listening, false);
    assert.equal(probe.address(), null);
    assert.equal(probe.listenerCount('error'), 0);
    assert.equal(probe.listenerCount('listening'), 0);
    assert.equal(probe.listenerCount('connection'), 0);
    assert.equal(probe.listenerCount('close'), 0);
  }
  await closeServer(service);
  await assertManifestPortAvailable(port);
  await listen(t, createServer(), port);
});

test('the probe honors the runtime listen-host override rather than the public host', async (t) => {
  setBindHost(t, '127.0.0.1');
  const port = await freePort(t);
  const original = net.Server.prototype.listen;
  const calls = [];
  t.mock.method(net.Server.prototype, 'listen', function (...args) {
    calls.push(args);
    return original.apply(this, args);
  });
  await assertManifestPortAvailable(port);
  assert.deepEqual(calls[0], [{ port, host: '127.0.0.1', exclusive: true }]);
});

test('an explicitly resolved probe host is not replaced by the current shell environment', async (t) => {
  setBindHost(t, '0.0.0.0');
  const port = await freePort(t);
  const binds = captureBinds(t);
  await assertManifestPortAvailable(port, '127.0.0.1');
  assert.deepEqual(binds, [{ port, host: '127.0.0.1', exclusive: true }]);
});

for (const [code, message, synchronous] of [
  ['EACCES', /Sem permissão/, false],
  ['EADDRNOTAVAIL', /Não foi possível verificar/, false],
  ['ERR_INVALID_ARG_VALUE', /Não foi possível verificar/, true],
]) {
  test(`probe reports ${code} explicitly and cleans up (${synchronous ? 'sync' : 'async'})`, async (t) => {
    setBindHost(t);
    const port = await freePort(t);
    const cause = Object.assign(new Error('synthetic bind failure'), { code });
    let probe;
    t.mock.method(net.Server.prototype, 'listen', function () {
      probe = this;
      if (synchronous) throw cause;
      queueMicrotask(() => this.emit('error', cause));
      return this;
    });
    await assert.rejects(assertManifestPortAvailable(port), (error) => {
      assert.equal(error.cause, cause);
      assert.match(error.message, message);
      assert.ok(error.message.includes(code));
      assert.ok(error.message.includes(`0.0.0.0:${port}`));
      return true;
    });
    assert.equal(probe.listening, false);
    assert.deepEqual(probe.eventNames(), []);
  });
}

test('invalid ports never pass as an available ephemeral port', async (t) => {
  const create = t.mock.method(net, 'createServer', () => assert.fail('Invalid ports must not bind.'));
  for (const port of [0, -1, 65536, 1.5, NaN, Infinity]) {
    await assert.rejects(assertManifestPortAvailable(port), /Porta do manifest inválida/);
  }
  assert.equal(create.mock.callCount(), 0);
});
