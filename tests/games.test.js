const assert = require('node:assert/strict');
const { test } = require('node:test');
const { once, EventEmitter } = require('node:events');
const { createHash, generateKeyPairSync, sign, randomUUID } = require('node:crypto');
const { WebSocket } = require('ws');
const { GamesService } = require('../dist/games/service');
const { registerGames } = require('../dist/commands/games');
const { botMessageText } = require('./helpers/bot-message');
const nesFixture = require('./helpers/nes-fixture');

const tick = () => new Promise(resolve => setImmediate(resolve));
const hash = createHash('sha256').update(nesFixture()).digest('hex');
async function waitFor(check) {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Game state did not converge.');
    await tick();
  }
}
async function setup(t, game = 'nes') {
  const service = new GamesService({ host: '127.0.0.1', port: 0, publicUrl: 'http://127.0.0.1' });
  t.after(() => service.close());
  const base = await service.start();
  const room = service.create(game, 'host');
  return { service, base, room };
}
function credentials() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  return { privateKey: pair.privateKey,
    key: Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64') };
}
async function connect(f, id, { lateAuthorization = false } = {}) {
  const { key, privateKey } = credentials();
  if (!lateAuthorization) f.service.authorize(f.room, key, id, id);
  const socket = new WebSocket(f.base.replace('http:', 'ws:') + '/games/room/' + f.room.id);
  const messages = [], waiters = [];
  socket.on('message', (data, binary) => {
    const value = binary ? { type: 'binary', data } : JSON.parse(data.toString());
    const waiting = waiters.findIndex(item => item.type === value.type);
    if (waiting >= 0) waiters.splice(waiting, 1)[0].resolve(value);
    else messages.push(value);
  });
  function receive(type) {
    const index = messages.findIndex(value => value.type === type);
    if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Missing game event: ' + type)), 3000);
      waiters.push({ type, resolve: value => { clearTimeout(timer); resolve(value); } });
    });
  }
  const send = value => socket.send(JSON.stringify(value));
  const challenge = await receive('challenge');
  send({ type: 'authenticate', key, proof: sign('sha256', Buffer.from(f.room.id + ':' + challenge.challenge),
    { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64') });
  if (lateAuthorization) { await tick(); f.service.authorize(f.room, key, id, id); }
  const auth = await receive('authenticated');
  return { socket, key, uid: auth.uid, send, receive, messages };
}
async function players(f) {
  const host = await connect(f, 'host');
  const guest = await connect(f, 'guest');
  guest.send({ type: 'join' });
  if (f.room.game === 'nes') {
    host.socket.send(nesFixture());
    assert.deepEqual((await guest.receive('binary')).data, nesFixture());
  }
  host.send({ type: 'ready', hash });
  guest.send({ type: 'ready', hash });
  await waitFor(() => [...f.room.peers].filter(peer => peer.slot !== null && peer.ready).length === 2);
  host.send({ type: 'start' });
  await Promise.all([host.receive('start'), guest.receive('start')]);
  return { host, guest };
}

test('game assets are local, CORS-enabled and allowlisted; service shuts down cleanly', async t => {
  const f = await setup(t);
  assert.equal(await f.service.start(), f.base);
  const health = await fetch(f.base + '/games/health');
  assert.equal(health.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(await health.json(), { application: 'monky-games', version: 1 });
  for (const [url, type] of [['app.js', 'text/javascript'], ['nes.js', 'text/javascript'], ['doom/engine.wasm', 'application/wasm']]) {
    const response = await fetch(f.base + '/games/' + url, { method: 'HEAD' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), type);
  }
  assert.equal((await fetch(f.base + '/package.json')).status, 404);
  assert.equal((await fetch(f.base + '/games/health', { method: 'POST' })).status, 405);
  await f.service.close();
  assert.equal(f.service.rooms.size, 0);
  await assert.rejects(f.service.start(), /closed/);
});

test('game proofs work on either side of bridge authorization and bind the authenticated user', async t => {
  const f = await setup(t);
  const host = await connect(f, 'host', { lateAuthorization: true });
  assert.equal(host.uid, 1);
  assert.equal([...f.room.peers][0].identity.userId, 'host');
  assert.throws(() => f.service.authorize(f.room, host.key, 'attacker', 'Attacker'), /another user/);
  assert.throws(() => f.service.authorize(f.room, 'x'.repeat(88), 'host', 'host'), /Invalid/);
  const second = await connect(f, 'host');
  second.send({ type: 'join' });
  await second.receive('unavailable');
  assert.equal([...f.room.peers].filter(peer => peer.slot !== null).length, 1);
});

test('NES can start solo; only the authenticated host selects the in-memory ROM', async t => {
  const f = await setup(t);
  const host = await connect(f, 'host');
  host.socket.send(nesFixture());
  assert.equal((await host.receive('rom')).hash, hash);
  assert.deepEqual((await host.receive('binary')).data, nesFixture());
  host.send({ type: 'ready', hash });
  host.send({ type: 'start' });
  await host.receive('start');
  assert.equal(f.room.started, true);
  const viewer = await connect(f, 'viewer');
  assert.deepEqual((await viewer.receive('binary')).data, nesFixture(), 'Late viewers receive the host ROM automatically');
  assert.equal((await fetch(f.base + '/games/room/' + f.room.id + '/rom')).status, 404, 'No public ROM download endpoint');
  const denied = once(viewer.socket, 'close');
  viewer.socket.send(nesFixture());
  assert.equal((await denied)[0], 4002, 'Spectators cannot replace the ROM');
  assert.equal(f.room.started, true);
});

test('two NES players use authenticated slots, spectators replay only inputs and disconnect stops play', async t => {
  const f = await setup(t);
  const { host, guest } = await players(f);
  const viewer = await connect(f, 'viewer');
  guest.send({ type: 'input', slot: 0, buttons: 128, round: f.room.round });
  assert.deepEqual(await host.receive('input'), { type: 'input', slot: 1, buttons: 128, round: f.room.round });
  host.send({ type: 'frames', frames: [[1, 128]], round: f.room.round });
  assert.deepEqual((await guest.receive('frames')).frames, [[1, 128]]);
  viewer.send({ type: 'watch', hash: 'b'.repeat(64), round: f.room.round });
  await viewer.receive('mismatch');
  viewer.send({ type: 'watch', hash, round: f.room.round });
  assert.deepEqual((await viewer.receive('replay')).frames, [[1, 128]]);
  guest.socket.close();
  await host.receive('stopped');
  assert.equal(f.room.started, false);
  assert.ok([...f.room.peers].every(peer => !peer.ready));
});

test('unverified ROM readiness cannot start a game and spectators cannot inject input', async t => {
  const f = await setup(t);
  const host = await connect(f, 'host'), guest = await connect(f, 'guest');
  guest.send({ type: 'join' });
  host.socket.send(nesFixture());
  await guest.receive('binary');
  host.send({ type: 'ready', hash });
  guest.send({ type: 'ready', hash: 'b'.repeat(64) });
  await guest.receive('mismatch');
  host.send({ type: 'start' });
  await host.receive('unavailable');
  assert.equal(f.room.started, false);
  const viewer = await connect(f, 'viewer');
  const closed = once(viewer.socket, 'close');
  viewer.send({ type: 'input', buttons: 1, round: f.room.round });
  assert.equal((await closed)[0], 4002);
});

test('NES restart and lobby controls belong to the host and discard old round inputs', async t => {
  const f = await setup(t);
  const { host, guest } = await players(f);
  const viewer = await connect(f, 'viewer');
  const oldRound = f.room.round;
  host.send({ type: 'frames', frames: [[1, 2]], round: oldRound });
  await guest.receive('frames');
  for (const peer of [guest, viewer]) {
    for (const type of ['restart', 'return-lobby']) {
      peer.send({ type, round: oldRound });
      await peer.receive('unavailable');
      assert.equal(f.room.round, oldRound);
    }
  }
  host.send({ type: 'restart', round: oldRound });
  assert.equal((await guest.receive('start')).round, oldRound + 1);
  assert.deepEqual(f.room.frames, []);
  host.send({ type: 'frames', frames: [[255, 255]], round: oldRound });
  host.send({ type: 'frames', frames: [[0, 0]], round: f.room.round });
  assert.deepEqual((await guest.receive('frames')).frames, [[0, 0]]);
  assert.deepEqual(f.room.frames, [[0, 0]]);
  host.send({ type: 'return-lobby', round: f.room.round });
  await guest.receive('reset-lobby');
  assert.equal(f.room.started, false);
  assert.deepEqual(f.room.frames, [[0, 0]], 'Lobby preserves committed progress for resume');
  assert.ok([...f.room.peers].filter(peer => peer.slot !== null).every(peer => peer.ready));
  guest.send({ type: 'resume' });
  await guest.receive('unavailable');
  host.send({ type: 'resume' });
  await host.receive('resume');
  assert.deepEqual(f.room.frames, [[0, 0]], 'Resume does not clear committed inputs');
  host.send({ type: 'watch', hash, round: f.room.round });
  assert.deepEqual((await host.receive('replay')).frames, [[0, 0]], 'Host restores from the same authoritative replay');
  host.send({ type: 'return-lobby', round: f.room.round });
  await guest.receive('reset-lobby');
  const nextRom = nesFixture();
  nextRom[nextRom.length - 1] = 1;
  host.socket.send(nextRom);
  await waitFor(() => f.room.rom?.equals(nextRom));
  assert.deepEqual(f.room.frames, [], 'Changing the ROM discards the old progress');
  assert.ok([...f.room.peers].every(peer => !peer.ready), 'Changing the ROM invalidates every previous readiness');
  host.socket.close();
  await waitFor(() => f.room.rom === undefined);
  assert.equal(f.room.romHash, '', 'Host exit releases the ROM while retaining the reopenable miniapp');
  f.service.remove(f.room);
  assert.equal(f.service.rooms.has(f.room.id), false);
});

test('a prepared NES spectator can take the free player 2 seat during a solo game', async t => {
  const f = await setup(t);
  const host = await connect(f, 'host');
  host.socket.send(nesFixture());
  await host.receive('binary');
  host.send({ type: 'ready', hash });
  host.send({ type: 'start' });
  await host.receive('start');
  const guest = await connect(f, 'guest');
  await guest.receive('binary');
  guest.send({ type: 'join' });
  await guest.receive('unavailable');
  guest.send({ type: 'ready', hash });
  guest.send({ type: 'join' });
  await waitFor(() => [...f.room.peers].some(peer => peer.uid === guest.uid && peer.slot === 1));
  guest.send({ type: 'watch', hash, round: f.room.round });
  assert.deepEqual((await guest.receive('replay')).frames, []);
  guest.send({ type: 'input', buttons: 1, round: f.room.round });
  assert.equal((await host.receive('input')).slot, 1);
});

test('player 2 cannot choose a ROM even before the host prepares the game', async t => {
  const f = await setup(t);
  const host = await connect(f, 'host'), guest = await connect(f, 'guest');
  guest.send({ type: 'join' });
  await waitFor(() => [...f.room.peers].some(peer => peer.slot === 1));
  assert.equal(f.room.rom, undefined);
  const denied = once(guest.socket, 'close');
  guest.socket.send(nesFixture());
  assert.equal((await denied)[0], 4002);
  assert.equal(host.socket.readyState, WebSocket.OPEN);
  assert.equal(f.room.rom, undefined);
});

test('invalid host ROM data is rejected and room removal frees game bytes', async t => {
  const f = await setup(t);
  const host = await connect(f, 'host');
  const denied = once(host.socket, 'close');
  host.socket.send(Buffer.from('not an iNES ROM'));
  assert.equal((await denied)[0], 4002);
  await waitFor(() => f.room.peers.size === 0);
  assert.equal(f.room.rom, undefined);
});

test('DOOM relay replaces forged sender IDs and rejects expired room membership', async t => {
  const f = await setup(t, 'doom');
  const { host, guest } = await players(f);
  const data = Buffer.alloc(16);
  data.writeUInt32LE(f.room.round, 0);
  data.writeUInt32LE(1, 4);
  data.writeUInt32LE(9999, 8);
  guest.socket.send(data);
  assert.equal((await host.receive('binary')).data.readUInt32LE(8), guest.uid);
  f.room.identities.get(guest.key).expires = Date.now() - 1;
  const closed = once(guest.socket, 'close');
  guest.socket.send(data);
  assert.equal((await closed)[0], 4002);
});

test('DOOM host can restart and return to the lobby without accepting obsolete relay packets', async t => {
  const f = await setup(t, 'doom');
  const { host, guest } = await players(f);
  const viewer = await connect(f, 'viewer');
  for (const peer of [guest, viewer]) {
    for (const type of ['restart', 'return-lobby']) {
      peer.send({ type, round: f.room.round });
      await peer.receive('unavailable');
    }
  }
  const oldRound = f.room.round;
  host.send({ type: 'restart', round: oldRound });
  assert.equal((await guest.receive('start')).round, oldRound + 1);
  const packet = Buffer.alloc(16);
  packet.writeUInt32LE(oldRound, 0);
  packet.writeUInt32LE(1, 4);
  guest.socket.send(packet);
  packet.writeUInt32LE(f.room.round, 0);
  guest.socket.send(packet);
  const forwarded = (await host.receive('binary')).data;
  assert.equal(forwarded.readUInt32LE(0), f.room.round);
  assert.equal(forwarded.readUInt32LE(8), guest.uid);
  host.send({ type: 'return-lobby', round: f.room.round });
  await guest.receive('reset-lobby');
  assert.equal(f.room.started, false);
  guest.socket.send(packet);
  host.send({ type: 'resume' });
  await host.receive('unavailable');
  host.send({ type: 'start' });
  assert.equal((await guest.receive('start')).round, oldRound + 3);
  assert.equal(guest.socket.readyState, WebSocket.OPEN, 'A final old-round packet does not disconnect the guest');
});

test('/doom and /nes register independently without arguments and release exact screen instances', async t => {
  const service = new GamesService({ host: '127.0.0.1', port: 0, publicUrl: 'http://127.0.0.1' });
  const bot = new EventEmitter(), closed = [], replies = [];
  let screen;
  const commands = [];
  bot.command = value => { commands.push(value); };
  bot.closeScreen = async (serverId, ref) => { closed.push({ serverId, id: ref.id, instanceId: ref.instanceId }); };
  const dispose = registerGames(bot, service);
  t.after(dispose);
  const signal = new AbortController().signal;
  assert.deepEqual(commands.map(command => command.name), ['doom', 'nes']);
  for (const command of commands) {
    assert.equal(command.voiceRequirement, 'joined');
    assert.equal(command.options, undefined);
    assert.equal(command.autocomplete, undefined);
    await command.handler({
      args: {}, signal, locale: 'en', serverId: 'server', invocationId: command.name, invokerId: 'host',
      reply: value => replies.push(botMessageText(value, 'en')),
      createScreen: async input => (screen = { ...input, instanceId: randomUUID(), channelId: 'voice', revision: 0 }),
    });
    assert.equal(service.rooms.size, 1);
    assert.equal([...service.rooms.values()][0].game, command.name);
    assert.match(replies[0], /voice stage/);
    bot.emit('screenRemoved', { serverId: 'server', ...screen, reason: 'view_revoked' });
    assert.equal(service.rooms.size, 1);
    bot.emit('screenRemoved', { serverId: 'server', ...screen, reason: 'ended' });
    assert.equal(service.rooms.size, 0);
  }
  await dispose();
  assert.deepEqual(closed, []);
  for (const event of ['screenAction', 'screenRemoved', 'disconnected', 'closed']) assert.equal(bot.listenerCount(event), 0);
});
