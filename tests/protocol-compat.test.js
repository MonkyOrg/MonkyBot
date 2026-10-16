const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { once } = require('node:events');
const { generateKeyPairSync, randomUUID } = require('node:crypto');
const { WebSocketServer } = require('ws');
const { BotClient, MessageType, PROTOCOL_VERSION } = require('@monky/bot-sdk');
const { registerAllCommands, requestedCapabilities } = require('../dist/commands');

const publicKey = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
const withoutStorage = requestedCapabilities.filter(capability => capability !== 'device_storage');

/** A Monky server that negotiates `version` and answers like the real handshake, recording the bot declaration. */
async function fakeServer(t, version, features) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  t.after(() => new Promise(resolve => {
    for (const client of server.clients) client.terminate();
    server.close(resolve);
  }));
  await once(server, 'listening');
  const registrations = [], connects = [];
  server.on('connection', socket => socket.on('message', data => {
    const message = JSON.parse(data.toString());
    if (message.type === MessageType.AUTH_CONNECT) {
      connects.push(message.payload);
      socket.send(JSON.stringify({ type: MessageType.AUTH_SUCCESS, payload: {
        server: { protocol: { version, minimumVersion: 24, features } },
      } }));
    } else if (message.type === MessageType.BOT_UPDATE_PROFILE) {
      socket.send(JSON.stringify({ type: MessageType.BOT_PROFILE_UPDATED, requestId: message.requestId, payload: {} }));
    } else if (message.type === MessageType.COMMAND_REGISTER) registrations.push(message.payload);
  }));
  return { url: `ws://127.0.0.1:${server.address().port}`, registrations, connects };
}

async function connectBot(t, server) {
  const bot = new BotClient({ publicKey, requestedCapabilities, name: 'MonkyBot' });
  const dispose = registerAllCommands(bot);
  t.after(async () => { await dispose(); await bot.close(); });
  bot.on('error', () => {});
  const connected = once(bot, 'connected');
  bot.connect({ serverUrl: server.url, token: 'f'.repeat(64) });
  await connected;
  const deadline = Date.now() + 5000;
  while (!server.registrations.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(server.registrations.length, 1, 'The bot registers its commands once after authenticating.');
  return server.registrations[0];
}

test('a protocol 38 server accepts the bot without the storage capability it does not know', async t => {
  assert.equal(PROTOCOL_VERSION, 39);
  const server = await fakeServer(t, 38, ['message-length-setting', 'server-community', 'local-youtube-playlist']);
  const registration = await connectBot(t, server);
  assert.equal(server.connects[0].protocolVersion, 39);
  assert.equal(server.connects[0].protocolOffer.minimumVersion, 24, 'Servers down to protocol 24 can still negotiate.');
  assert.deepEqual(registration.requestedCapabilities, withoutStorage);
  assert.ok(registration.commands.some(command => command.name === 'nes'), '/nes keeps working without storage.');
});

test('a protocol 39 server receives the device storage request for NES saves', async t => {
  const server = await fakeServer(t, 39, ['message-length-setting', 'server-community', 'local-youtube-playlist', 'bot-storage']);
  const registration = await connectBot(t, server);
  assert.deepEqual(registration.requestedCapabilities, requestedCapabilities);
  assert.ok(registration.requestedCapabilities.includes('device_storage'));
  assert.equal(registration.requestedCapabilities.includes('server_storage'), false, 'Saves never go to the server.');
});

test('the manifest lists device storage only for servers that negotiate bot storage', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'monkybot-manifest-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bot = new BotClient({ publicKey, requestedCapabilities, name: 'MonkyBot',
    registrationFile: path.join(directory, `registrations-${randomUUID()}.json`) });
  const dispose = registerAllCommands(bot);
  t.after(async () => { await dispose(); await bot.close(); });
  const server = await bot.serve({ name: 'MonkyBot', description: 'Test', port: 0, host: '127.0.0.1', publicHost: '127.0.0.1' });
  if (!server.listening) await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/manifest`;
  const legacy = await (await fetch(url)).json();
  assert.deepEqual(legacy.requestedCapabilities, withoutStorage);
  const current = await (await fetch(url, { headers: { 'x-monky-protocol-features': 'local-youtube-playlist, bot-storage' } })).json();
  assert.deepEqual(current.requestedCapabilities, requestedCapabilities);
});
