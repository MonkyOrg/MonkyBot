const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createHash, generateKeyPairSync, randomUUID } = require('node:crypto');
const { EventEmitter, once } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const readline = require('node:readline');
const { setTimeout: delay } = require('node:timers/promises');
const { test, beforeEach } = require('node:test');
const { BotClient } = require('@monky/bot-sdk');
const configModule = require('../dist/cli/config');
const lifecycle = require('../dist/cli/commands/lifecycle');
const { setupCommand } = require('../dist/cli/commands/setup');
const { setCliLocale } = require('../dist/cli/i18n');
const pm2 = require('../dist/cli/pm2');
const processHelpers = require('../dist/cli/process');
const readiness = require('../dist/cli/manifestReadiness');
const { getManifestUrl, identifyManifest, MANIFEST_PUBLIC_KEY_HEADER } = require('../dist/utils/manifest');
const { closeServer, listen, freePort, setBindHost } = require('./helpers/manifest-port');

beforeEach(() => setCliLocale('en'));

function identity(t, registrations = true) {
  const botDir = path.join(__dirname, `.manifest-readiness-${randomUUID()}`);
  const keysDir = path.join(botDir, '.keys');
  fs.mkdirSync(keysDir, { recursive: true });
  const pair = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { format: 'der', type: 'spki' },
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
  });
  const publicKey = pair.publicKey.toString('hex');
  const files = new Map([['public.hex', publicKey + '\n'], ['private.pem', pair.privateKey]]);
  if (registrations) files.set('registrations.json', '{"fixture-registration":"must-not-be-read-or-deleted"}\n');
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  for (const [name, bytes] of files) fs.writeFileSync(path.join(keysDir, name), bytes);
  const cleanup = [];
  t.after(async () => {
    try { for (const dispose of cleanup.reverse()) await dispose(); }
    finally { fs.rmSync(botDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
  });
  return {
    publicKey, cleanup,
    config: { mode: 'marketplace', botDir, botName: 'MonkyBot', publicHost: 'bot.example.test', servePort: 0 },
    unchanged() {
      for (const [name, bytes] of files) {
        assert.equal(digest(fs.readFileSync(path.join(keysDir, name))), digest(bytes), `${name} must be preserved.`);
      }
    },
  };
}

function manifest(config) {
  return {
    name: config.botName,
    requestedCapabilities: ['commands'],
    commands: [{ name: 'ping', description: 'Ping' }],
    registrationUrl: new URL('register', getManifestUrl(config.publicHost, config.servePort)).href,
  };
}

function sendManifest(response, config, publicKey, options = {}) {
  response.writeHead(options.status ?? 200, {
    'Content-Type': options.contentType ?? 'application/json; charset=utf-8',
    ...(publicKey === undefined ? {} : { [MANIFEST_PUBLIC_KEY_HEADER]: publicKey }),
    ...options.headers,
  });
  response.end(options.rawBody ?? JSON.stringify(options.body ?? manifest(config)));
}

async function endpoint(t, state, respond, host = '127.0.0.1') {
  const requests = [];
  const server = await listen(t, http.createServer((request, response) => {
    requests.push({ method: request.method, url: request.url, host: request.headers.host });
    if (respond) respond(request, response);
    else sendManifest(response, state.config, state.publicKey);
  }), state.config.servePort, host);
  state.config.servePort = server.address().port;
  return { server, requests };
}

for (const host of ['127.0.0.1', '0.0.0.0', '::', '[::]']) {
  test(`readiness checks the local bind, not the advertised public IPv6 host (${host})`, async t => {
    const state = identity(t);
    state.config.publicHost = '2001:db8::15';
    const service = await endpoint(t, state, undefined, host === '[::]' ? '::' : host);
    const expected = `http://[2001:db8::15]:${state.config.servePort}/manifest`;
    assert.equal(await readiness.verifyManifest(state.config, host), expected);
    assert.deepEqual(service.requests.map(({ method, url }) => ({ method, url })), [{ method: 'GET', url: '/manifest' }]);
    assert.doesNotMatch(service.requests[0].host, /2001:db8/);
    assert.equal(service.server.listening, true);
    state.unchanged();
  });
}

test('the actual SDK listener keeps its strict JSON contract and supplies read-only identity on the same response', async t => {
  const state = identity(t);
  const bot = new BotClient({ publicKey: state.publicKey, requestedCapabilities: ['commands'] });
  state.cleanup.push(() => bot.close());
  bot.command({ name: 'ping', description: 'Ping', handler() {} });
  const server = await bot.serve({
    name: state.config.botName, port: 0, host: '127.0.0.1', publicHost: state.config.publicHost,
  });
  identifyManifest(server, state.publicKey);
  state.config.servePort = server.address().port;
  assert.equal(await readiness.verifyManifest(state.config, '127.0.0.1'),
    getManifestUrl(state.config.publicHost, state.config.servePort));
  assert.equal(server.listenerCount('request'), 2, 'No second HTTP service may be created.');
  await bot.close();
  assert.equal(server.listenerCount('request'), 1, 'The identity listener must be removed on close.');
  state.unchanged();
});

const responseSecret = 'synthetic-readiness-response-secret';
for (const [name, options, expected] of [
  ['wrong service', { contentType: 'text/html', rawBody: responseSecret }, /JSON manifest/],
  ['wrong public key', { key: '00'.repeat(44) }, /public identity/],
  ['missing public key header', { omitKey: true }, /public identity/],
  ['wrong bot name', { change: body => ({ ...body, name: 'Different Bot' }) }, /bot name/],
  ['stale registration URL', { change: body => ({ ...body, registrationUrl: 'http://old.example.test:7780/register' }) }, /registration URL/],
  ['wrong registration path', { change: body => ({ ...body, registrationUrl: body.registrationUrl + '/wrong' }) }, /registration URL/],
  ['credential-bearing URL', { change: body => ({ ...body, registrationUrl: body.registrationUrl.replace('http://', 'http://user:token@') }) }, /registration URL/],
  ['invalid JSON', { rawBody: `{"token":"${responseSecret}` }, /invalid JSON/],
  ['missing capabilities', { change: body => ({ name: body.name, registrationUrl: body.registrationUrl }) }, /SDK manifest contract/],
  ['unsupported capability', { change: body => ({ ...body, requestedCapabilities: ['unknown'] }) }, /SDK manifest contract/],
  ['duplicate capabilities', { change: body => ({ ...body, requestedCapabilities: ['commands', 'commands'] }) }, /SDK manifest contract/],
  ['commands without capability', { change: body => ({ ...body, requestedCapabilities: [] }) }, /SDK manifest contract/],
  ['malformed command', { change: body => ({ ...body, commands: [{ name: 'Invalid command', description: '' }] }) }, /SDK manifest contract/],
  ['unknown JSON field', { change: body => ({ ...body, publicKey: responseSecret }) }, /SDK manifest contract/],
  ['redirect', { status: 302, headers: { Location: 'http://unrelated.example.test/manifest' } }, /HTTP 302/],
  ['wrong endpoint', { status: 404 }, /HTTP 404/],
]) {
  test(`a real HTTP ${name} fails explicitly without retries, leaked content or listener mutations`, async t => {
    const state = identity(t);
    const service = await endpoint(t, state, (_request, response) => {
      const body = options.change ? options.change(manifest(state.config)) : undefined;
      sendManifest(response, state.config, options.omitKey ? undefined : options.key ?? state.publicKey, { ...options, body });
    });
    await assert.rejects(readiness.waitForManifest(state.config, '127.0.0.1', 600), error => {
      assert.ok(error instanceof readiness.ManifestReadinessError);
      assert.equal(error.retryable, false);
      assert.match(error.message, expected);
      assert.doesNotMatch(error.message, new RegExp(responseSecret));
      return true;
    });
    assert.equal(service.requests.length, 1);
    assert.equal(service.server.listening, true);
    state.unchanged();
  });
}

test('the readiness probe only reads botDir public.hex and never loads or generates keys in the CLI cwd', async t => {
  const state = identity(t);
  await endpoint(t, state);
  const original = fs.readFileSync;
  const files = [];
  const read = t.mock.method(fs, 'readFileSync', (file, ...args) => {
    files.push(file);
    return original(file, ...args);
  });
  await readiness.verifyManifest(state.config, '127.0.0.1');
  assert.deepEqual(files, [path.join(state.config.botDir, '.keys', 'public.hex')]);
  read.mock.restore();
  state.unchanged();
});

test('invalid and unreadable public identities fail closed without exposing file contents', async t => {
  const state = identity(t);
  state.config.servePort = await freePort(t);
  const publicFile = path.join(state.config.botDir, '.keys', 'public.hex');
  fs.writeFileSync(publicFile, responseSecret);
  await assert.rejects(readiness.verifyManifest(state.config, '127.0.0.1'), error => {
    assert.match(error.message, /not a valid Ed25519 key/);
    assert.doesNotMatch(error.message, new RegExp(responseSecret));
    return true;
  });
  t.mock.method(fs, 'readFileSync', () => {
    throw Object.assign(new Error(responseSecret), { code: 'EACCES' });
  });
  await assert.rejects(readiness.waitForManifest(state.config, '127.0.0.1', 600), error => {
    assert.match(error.message, /public identity.*EACCES/);
    assert.equal(error.retryable, false);
    assert.doesNotMatch(error.message, new RegExp(responseSecret));
    return true;
  });
});

test('startup can wait for first-run public identity and a delayed HTTP listener', async t => {
  const state = identity(t);
  state.config.servePort = await freePort(t);
  const publicFile = path.join(state.config.botDir, '.keys', 'public.hex');
  fs.unlinkSync(publicFile);
  const starting = delay(120).then(async () => {
    fs.writeFileSync(publicFile, state.publicKey + '\n');
    return endpoint(t, state);
  });
  assert.equal(await readiness.waitForManifest(state.config, '127.0.0.1', 1500),
    getManifestUrl(state.config.publicHost, state.config.servePort));
  await starting;
  state.unchanged();
});

test('a transient HTTP 503 during startup is retried until the real manifest is ready', async t => {
  const state = identity(t);
  let requests = 0;
  await endpoint(t, state, (_request, response) => {
    sendManifest(response, state.config, state.publicKey, { status: ++requests === 1 ? 503 : 200 });
  });
  assert.equal(await readiness.waitForManifest(state.config, '127.0.0.1', 1500),
    getManifestUrl(state.config.publicHost, state.config.servePort));
  assert.equal(requests, 2);
  state.unchanged();
});

for (const trickle of [false, true]) {
  test(`a slow HTTP ${trickle ? 'body' : 'response'} has an absolute timeout and releases its probe socket`, async t => {
    const state = identity(t);
    const service = await endpoint(t, state, (_request, response) => {
      if (trickle) {
        response.writeHead(200, { 'Content-Type': 'application/json', [MANIFEST_PUBLIC_KEY_HEADER]: state.publicKey });
        const interval = setInterval(() => response.write(' '), 20);
        response.once('close', () => clearInterval(interval));
      }
    });
    const started = Date.now();
    await assert.rejects(readiness.verifyManifest(state.config, '127.0.0.1', 150), /response timed out/);
    assert.ok(Date.now() - started < 2000);
    assert.equal(service.server.listening, true);
    await closeServer(service.server);
  });
}

test('an unavailable startup times out without announcing readiness or creating identity files', async t => {
  const state = identity(t);
  state.config.servePort = await freePort(t);
  const started = Date.now();
  await assert.rejects(readiness.waitForManifest(state.config, '127.0.0.1', 250),
    /did not become locally ready.*monkybot logs.*could not reach the service/);
  assert.ok(Date.now() - started < 2000);
  state.unchanged();
});

for (const contentLength of [true, false]) {
  test(`manifest body size is bounded ${contentLength ? 'before reading Content-Length' : 'while streaming chunked data'}`, async t => {
    const state = identity(t);
    const service = await endpoint(t, state, (_request, response) => {
      response.writeHead(200, {
        'Content-Type': 'application/json', [MANIFEST_PUBLIC_KEY_HEADER]: state.publicKey,
        ...(contentLength ? { 'Content-Length': String(8 * 1024 * 1024 + 1) } : {}),
      });
      if (contentLength) response.end();
      else response.end(Buffer.alloc(8 * 1024 * 1024 + 1, ' '));
    });
    await assert.rejects(readiness.verifyManifest(state.config, '127.0.0.1'), /8 MiB limit/);
    assert.equal(service.server.listening, true);
  });
}

async function managedRuntime(t, { online = false, serving = online, legacy = false, existing = true } = {}) {
  const state = identity(t);
  setBindHost(t);
  state.config.servePort = await freePort(t);
  state.current = existing ? structuredClone(state.config) : null;
  state.effects = [];
  state.lines = [];
  state.nextServes = true;
  state.requests = 0;
  state.servers = [];
  const entry = path.resolve(__dirname, '..', 'dist', 'index.js');
  const process = () => ({
    name: 'monkybot', pm_id: 17, pid: 12345,
    pm2_env: {
      status: 'online', pm_exec_path: entry, pm_cwd: state.config.botDir,
      MONKY_SERVE_HOST: '127.0.0.1', MONKY_SERVE: 'true',
    },
  });
  state.proc = online ? process() : null;
  const startListener = (settings, host, legacyIdentity = false) => {
    assert.equal(state.server?.listening ?? false, false, 'The managed runtime must not create duplicate listeners.');
    const snapshot = structuredClone(settings);
    const server = http.createServer((_request, response) => {
      state.requests++;
      sendManifest(response, snapshot, legacyIdentity ? undefined : state.servedKey ?? state.publicKey);
    });
    state.server = server;
    state.servers.push(server);
    server.listen({ port: snapshot.servePort, host, exclusive: true });
    return server;
  };
  state.cleanup.push(async () => { for (const server of state.servers) await closeServer(server); });
  if (serving) await once(startListener(state.config, '127.0.0.1', legacy), 'listening');
  t.mock.method(configModule, 'readConfig', () => state.current);
  state.write = t.mock.method(configModule, 'writeConfig', next => { state.current = structuredClone(next); });
  t.mock.method(configModule, 'getBotEntryPath', () => entry);
  t.mock.method(pm2, 'findBotProcess', () => state.proc);
  t.mock.method(pm2, 'requirePm2', () => true);
  t.mock.method(pm2, 'ensurePm2', () => state.effects.push('ensure'));
  t.mock.method(pm2, 'writeEcosystem', (settings, host) => {
    state.effects.push('ecosystem');
    state.launchConfig = structuredClone(settings);
    state.launchHost = host;
    state.ecosystem = pm2.generateEcosystem(settings, host);
    return 'fixture-ecosystem.cjs';
  });
  t.mock.method(require('../dist/music/process'), 'capture', () => assert.fail('Lifecycle must not run media tools.'));
  t.mock.method(processHelpers, 'runSync', (command, args) => {
    assert.equal(command, 'pm2', 'Never invoke a real package manager or media executable.');
    const [action, id] = args;
    state.effects.push(action);
    if (state.failAction === action) return { status: 1 };
    if (action === 'stop' || action === 'delete') {
      assert.equal(id, String(state.proc.pm_id), 'Only the identified pm_id may be mutated.');
      if (state.server?.listening) state.server.close();
      state.proc = action === 'delete' ? null : { ...state.proc, pid: 0, pm2_env: { ...state.proc.pm2_env, status: 'stopped' } };
    } else if (action === 'startOrRestart') {
      assert.equal(id, 'fixture-ecosystem.cjs');
      state.proc = process();
      if (state.startStatus) state.proc.pm2_env.status = state.startStatus;
      if (state.nextServes) startListener(state.launchConfig, state.launchHost);
    } else assert.equal(action, 'save');
    return { status: 0 };
  });
  t.mock.method(console, 'log', (...args) => state.lines.push(args.join(' ')));
  t.mock.method(console, 'error', (...args) => state.lines.push(args.join(' ')));
  return state;
}

function answers(t, values) {
  const pending = [...values];
  t.mock.method(readline, 'createInterface', () => {
    const rl = new EventEmitter();
    rl.question = (_question, callback) => {
      assert.ok(pending.length, 'Unexpected setup prompt.');
      const answer = pending.shift();
      queueMicrotask(() => callback(answer));
    };
    rl.close = () => rl.emit('close');
    t.after(() => {
      assert.equal(rl.listenerCount('close'), 0);
      assert.equal(rl.listenerCount('SIGINT'), 0);
    });
    return rl;
  });
  t.after(() => assert.deepEqual(pending, []));
}

test('start serves a real verified manifest and subsequent online starts only recheck and reprint its URL', async t => {
  const state = await managedRuntime(t);
  await lifecycle.startCommand();
  assert.deepEqual(state.effects, ['ensure', 'ecosystem', 'startOrRestart', 'save']);
  assert.match(state.ecosystem, /MONKY_SERVE: 'true'/);
  const mutations = [...state.effects];
  const requests = state.requests;
  await lifecycle.startCommand();
  await lifecycle.startCommand();
  assert.deepEqual(state.effects, mutations);
  assert.equal(state.requests, requests + 2);
  const output = state.lines.join('\n');
  assert.equal(output.split(`Manifest: ${getManifestUrl(state.current.publicHost, state.current.servePort)}`).length - 1, 3);
  assert.match(output, /verified locally.*external reachability were not tested/);
  assert.equal(state.write.mock.callCount(), 0);
  state.unchanged();
});

for (const reason of ['not serving', 'legacy identity', 'stale URL', 'stale name']) {
  test(`an already-online ${reason} runtime recovers once through a fresh owned restart`, async t => {
    const state = await managedRuntime(t, { online: true, serving: reason !== 'not serving', legacy: reason === 'legacy identity' });
    if (reason === 'not serving') state.proc.pm2_env.MONKY_SERVE = 'false';
    if (reason === 'stale URL') state.current.publicHost = 'new.example.test';
    if (reason === 'stale name') state.current.botName = 'Renamed Bot';
    await lifecycle.startCommand();
    assert.deepEqual(state.effects, ['stop', 'ensure', 'delete', 'ecosystem', 'startOrRestart', 'save']);
    assert.match(state.ecosystem, /MONKY_SERVE: 'true'/);
    assert.ok(state.lines.some(line => line === `   Manifest: ${getManifestUrl(state.current.publicHost, state.current.servePort)}`));
    const effects = [...state.effects];
    await lifecycle.startCommand();
    assert.deepEqual(state.effects, effects);
    state.unchanged();
  });
}

test('an online process never authorizes taking an unrelated manifest listener on the configured port', async t => {
  const state = await managedRuntime(t, { online: true, serving: false });
  const foreign = await endpoint(t, state, (_request, response) => sendManifest(response, state.config, '00'.repeat(44)));
  await assert.rejects(lifecycle.startCommand(), /EADDRINUSE/);
  assert.deepEqual(state.effects, ['stop']);
  assert.equal(foreign.server.listening, true);
  assert.doesNotMatch(state.lines.join('\n'), /Manifest:|Bot started!|Bot restarted with/);
  state.unchanged();
});

test('failed recovery is bounded to one launch and never treats pm2 online as manifest readiness', async t => {
  const state = await managedRuntime(t, { online: true, serving: false });
  state.nextServes = false;
  const wait = readiness.waitForManifest;
  t.mock.method(readiness, 'waitForManifest', (settings, host) => wait(settings, host, 250));
  await assert.rejects(lifecycle.startCommand(), /did not become locally ready/);
  assert.deepEqual(state.effects, ['stop', 'ensure', 'delete', 'ecosystem', 'startOrRestart']);
  assert.doesNotMatch(state.lines.join('\n'), /Manifest:|Bot started!|Bot restarted with/);
  state.unchanged();
});

test('a new start cannot announce a manifest with another public identity even if pm2 reports success', async t => {
  const state = await managedRuntime(t);
  state.servedKey = '00'.repeat(44);
  await assert.rejects(lifecycle.startCommand(), /public identity does not match/);
  assert.deepEqual(state.effects, ['ensure', 'ecosystem', 'startOrRestart']);
  assert.doesNotMatch(state.lines.join('\n'), /Monky Bot started!|Manifest:/);
  state.unchanged();
});

for (const fresh of [false, true]) {
  test(`restart verifies the newly served manifest and prints a copyable URL (fresh=${fresh})`, async t => {
    const state = await managedRuntime(t, { online: true });
    state.current.publicHost = '2001:db8::42';
    await lifecycle.restartCommand(fresh ? ['--fresh'] : []);
    assert.deepEqual(state.effects, fresh
      ? ['stop', 'ensure', 'delete', 'ecosystem', 'startOrRestart', 'save']
      : ['stop', 'ensure', 'ecosystem', 'startOrRestart', 'save']);
    assert.ok(state.lines.includes(`   Manifest: http://[2001:db8::42]:${state.current.servePort}/manifest`));
    assert.match(state.lines.join('\n'), /Monky Bot restarted!/);
    state.unchanged();
  });
}

for (const failure of ['save', 'errored']) {
  test(`startup surfaces ${failure} even when an HTTP manifest is available`, async t => {
    const state = await managedRuntime(t);
    if (failure === 'save') state.failAction = 'save';
    else state.startStatus = 'errored';
    await assert.rejects(lifecycle.startCommand(), failure === 'save' ? /pm2 state could not be saved/ : /did not confirm this bot online/);
    assert.doesNotMatch(state.lines.join('\n'), /Monky Bot started!|Manifest:/);
    state.unchanged();
  });
}

test('setup reconfigures its occupied port, saves, and fresh-restarts the same identity into a real ready manifest', async t => {
  const state = await managedRuntime(t, { online: true });
  answers(t, ['', '', '', 'new.example.test', 'Updated Bot']);
  await setupCommand();
  assert.deepEqual(state.effects, ['stop', 'ensure', 'delete', 'ecosystem', 'startOrRestart', 'save']);
  assert.equal(state.write.mock.callCount(), 1);
  assert.equal(state.current.botDir, state.config.botDir);
  assert.equal(state.current.servePort, state.config.servePort);
  assert.equal(state.current.publicHost, 'new.example.test');
  assert.equal(state.current.botName, 'Updated Bot');
  assert.equal(state.launchHost, '127.0.0.1');
  assert.ok(state.lines.includes(`   Manifest: http://new.example.test:${state.current.servePort}/manifest`));
  assert.doesNotMatch(state.lines.join('\n'), /monkybot start\s+—/);
  state.unchanged();
});

test('first setup automatically starts an unregistered managed runtime without a manual restart', async t => {
  const state = await managedRuntime(t, { existing: false });
  answers(t, ['', state.config.botDir, String(state.config.servePort), state.config.publicHost, '']);
  await setupCommand();
  assert.deepEqual(state.effects, ['ensure', 'ecosystem', 'startOrRestart', 'save']);
  assert.equal(state.write.mock.callCount(), 1);
  assert.ok(state.lines.includes(`   Manifest: ${getManifestUrl(state.current.publicHost, state.current.servePort)}`));
  state.unchanged();
});

test('setup recreates a stopped pm2 record before starting with the saved configuration', async t => {
  const state = await managedRuntime(t, { online: true, serving: false });
  state.proc.pm2_env.status = 'stopped';
  state.proc.pid = 0;
  answers(t, ['', '', '', '', '']);
  await setupCommand();
  assert.deepEqual(state.effects, ['ensure', 'delete', 'ecosystem', 'startOrRestart', 'save']);
  assert.deepEqual(state.current, state.config);
  assert.ok(state.lines.includes(`   Manifest: ${getManifestUrl(state.current.publicHost, state.current.servePort)}`));
  state.unchanged();
});

test('setup distinguishes saved configuration from a failed fresh runtime launch', async t => {
  const state = await managedRuntime(t);
  state.failAction = 'startOrRestart';
  answers(t, ['', '', '', 'updated.example.test', 'Updated Bot']);
  await assert.rejects(setupCommand(), /Configuration was saved.*automatic restart\/start was not confirmed.*Failed to restart.*do not delete .keys/);
  assert.equal(state.current.publicHost, 'updated.example.test');
  assert.equal(state.current.botName, 'Updated Bot');
  assert.equal(state.write.mock.callCount(), 1);
  assert.doesNotMatch(state.lines.join('\n'), /Monky Bot restarted!|Manifest:/);
  state.unchanged();
});

test('the compiled bot runtime itself serves a ready manifest while reusing its identity', { timeout: 20000 }, async t => {
  const state = identity(t, false);
  state.config.servePort = await freePort(t);
  const child = spawn(process.execPath, [path.resolve(__dirname, '..', 'dist', 'index.js')], {
    cwd: state.config.botDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, NODE_OPTIONS: '', NODE_PATH: '', TEMP: state.config.botDir, TMP: state.config.botDir,
      MONKY_BOT_LOCALE: 'en', MONKY_BOT_NAME: state.config.botName,
      MONKY_SERVE: 'true', MONKY_SERVE_PORT: String(state.config.servePort),
      MONKY_SERVE_HOST: '127.0.0.1', MONKY_SERVE_PUBLIC_HOST: state.config.publicHost,
      MONKY_SERVER_URL: '', MONKY_BOT_TOKEN: '',
    },
  });
  let diagnostics = '';
  child.stdout.on('data', chunk => { diagnostics += chunk; });
  child.stderr.on('data', chunk => { diagnostics += chunk; });
  const exited = once(child, 'exit');
  state.cleanup.push(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      const force = setTimeout(() => child.kill('SIGKILL'), 3000);
      try { await exited; } finally { clearTimeout(force); }
    }
  });
  await once(child, 'spawn');
  assert.equal(await readiness.waitForManifest(state.config, '127.0.0.1'),
    getManifestUrl(state.config.publicHost, state.config.servePort));
  assert.equal(child.exitCode, null, 'The isolated bot must still be running.');
  assert.doesNotMatch(diagnostics, /Fatal:|BEGIN PRIVATE KEY/);
  state.unchanged();
});
