const assert = require('node:assert/strict');
const { test } = require('node:test');
const { once, EventEmitter } = require('node:events');
const { createHash, generateKeyPairSync, sign, randomUUID, randomBytes } = require('node:crypto');
const { gzipSync, gunzipSync } = require('node:zlib');
const { WebSocket } = require('ws');
const { GamesService, NES_EMULATOR } = require('../dist/games/service');
const { registerGames } = require('../dist/commands/games');
const { botMessageText } = require('./helpers/bot-message');
const nesFixture = require('./helpers/nes-fixture');

const tick = () => new Promise(resolve => setImmediate(resolve));
const hash = createHash('sha256').update(nesFixture()).digest('hex');
let jsnes;
/** A real jsnes snapshot of the fixture after holding player 1's A button for `frames` frames. */
async function saveData({ frames = 0, romHash = hash, emulator = NES_EMULATOR, format = 'monky-nes-save', version = 1, state, thumbnail } = {}) {
  jsnes ??= await import('jsnes');
  let snapshot = state;
  if (!snapshot) {
    const nes = new jsnes.NES({ onFrame() {}, onAudioSample() {}, sampleRate: 48000 });
    nes.loadROM(nesFixture());
    for (let i = 0; i < frames; i++) { nes.buttonDown(1, 0); nes.frame(); }
    snapshot = nes.toJSON();
  }
  return gzipSync(JSON.stringify({ format, version, emulator, romHash, romName: 'fixture.nes', savedAt: Date.now(),
    ...thumbnail === undefined ? {} : { thumbnail }, state: snapshot })).toString('base64');
}
const saveHash = data => createHash('sha256').update(Buffer.from(data, 'base64')).digest('hex');
async function until(client, type, check) {
  for (;;) {
    const value = await client.receive(type);
    if (check(value)) return value;
  }
}
async function storeSave(f, requester, host, slot, data) {
  requester.send({ type: 'save', slot, round: f.room.round });
  const capture = await host.receive('capture');
  assert.deepEqual(capture, { type: 'capture', slot, round: f.room.round });
  host.send({ type: 'state', slot, round: capture.round, data });
  return until(requester, 'saved', value => value.slot === slot);
}
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
  return { socket, key, uid: auth.uid, auth, send, receive, messages };
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

test('the NES fixture counts each held A button once per frame and restores exactly from JSON', async () => {
  jsnes ??= await import('jsnes');
  const nes = new jsnes.NES({ onFrame() {}, onAudioSample() {}, sampleRate: 48000 });
  nes.loadROM(nesFixture());
  const run = (count, first, second) => {
    for (let frame = 0; frame < count; frame++) {
      if (first) nes.buttonDown(1, 0); else nes.buttonUp(1, 0);
      if (second) nes.buttonDown(2, 0); else nes.buttonUp(2, 0);
      nes.frame();
    }
  };
  run(10, false, false);
  assert.deepEqual([0x20, 0x21, 0x22, 0x23].map(address => nes.cpu.mem[address]), [0, 0, 0, 0]);
  assert.equal(nes.ppu.vramMem[0x3f00], 0x21);
  run(5, true, false);
  run(3, false, true);
  assert.deepEqual([0x20, 0x21, 0x22, 0x23].map(address => nes.cpu.mem[address]), [0, 1, 5, 3]);
  assert.equal(nes.ppu.vramMem[0x3f00], 0x29, 'Both counters tint the backdrop');
  const restored = new jsnes.NES({ onFrame() {}, onAudioSample() {}, sampleRate: 48000 });
  restored.loadROM(nesFixture());
  restored.fromJSON(JSON.parse(JSON.stringify(nes.toJSON())));
  assert.equal(restored.cpu.mem[0x22], 5);
});

test('both NES players save through the host emulator; spectators cannot save, load or download', async t => {
  const f = await setup(t);
  const { host, guest } = await players(f);
  const viewer = await connect(f, 'viewer');
  assert.equal(host.auth.emulator, NES_EMULATOR);
  const data = await saveData({ frames: 7 });
  assert.deepEqual(await storeSave(f, guest, host, 2, data), { type: 'saved', slot: 2, nickname: 'guest', hash: saveHash(data) });
  assert.deepEqual(await viewer.receive('saved'), { type: 'saved', slot: 2, nickname: 'guest', hash: saveHash(data) });
  const stored = f.room.saves.get(2);
  assert.ok(stored.data.equals(Buffer.from(data, 'base64')), 'The bot keeps the uploaded envelope as-is');
  assert.equal(stored.romName, 'fixture.nes');
  const lobby = await until(guest, 'lobby', value => value.saves.length === 1);
  assert.deepEqual(lobby.saves.map(({ slot, nickname, romName }) => ({ slot, nickname, romName })), [{ slot: 2, nickname: 'guest', romName: 'fixture.nes' }]);
  assert.equal(await storeSave(f, host, host, 1, await saveData({ frames: 3 })).then(value => value.nickname), 'host');

  for (const [peer, message] of [[viewer, { type: 'save', slot: 3 }], [guest, { type: 'save', slot: 0 }],
    [viewer, { type: 'download', slot: 2 }], [guest, { type: 'load', slot: 2 }], [host, { type: 'load', slot: 3 }]]) {
    peer.send({ ...message, round: f.room.round });
    assert.equal((await peer.receive('unavailable')).action, message.type);
  }
  assert.equal(f.room.base, undefined, 'Only the host loads an existing save');
  host.send({ type: 'state', slot: 3, round: f.room.round, data });
  assert.equal((await host.receive('unavailable')).action, 'state', 'Uploads need a pending capture request');
  assert.equal(f.room.saves.has(3), false);
  for (const peer of f.room.peers) peer.lastSave = 0;
  guest.send({ type: 'save', slot: 3, round: f.room.round });
  await host.receive('capture');
  host.send({ type: 'save', slot: 3, round: f.room.round });
  assert.equal((await host.receive('unavailable')).action, 'save', 'One pending capture per slot');
  guest.send({ type: 'download', slot: 2 });
  const file = await guest.receive('save-data');
  assert.equal(file.data, data);
  assert.equal(file.romName, 'fixture.nes');
  const denied = once(viewer.socket, 'close');
  viewer.send({ type: 'state', slot: 1, round: f.room.round, data });
  assert.equal((await denied)[0], 4002, 'Only the host emulator produces snapshots');
});

test('only the host loads a save; every viewer gets the base before the new round and late viewers replay from it', async t => {
  const f = await setup(t);
  const { host, guest } = await players(f);
  await storeSave(f, host, host, 1, await saveData({ frames: 9 }));
  host.send({ type: 'frames', frames: [[1, 0]], round: f.room.round });
  await guest.receive('frames');
  const oldRound = f.room.round;
  host.send({ type: 'load', slot: 1, round: oldRound });
  const base = await guest.receive('base');
  assert.equal(base.hash, f.room.saves.get(1).hash);
  assert.ok(Buffer.from(base.data, 'base64').equals(f.room.saves.get(1).data));
  assert.equal(base.slot, 1);
  assert.deepEqual(await guest.receive('start'), { type: 'start', round: oldRound + 1, base: base.hash });
  assert.equal(f.room.base, f.room.saves.get(1));
  host.send({ type: 'frames', frames: [[255, 255]], round: oldRound });
  host.send({ type: 'frames', frames: [[1, 1]], round: f.room.round });
  assert.deepEqual((await guest.receive('frames')).frames, [[1, 1]]);
  assert.deepEqual(f.room.frames, [[1, 1]], 'The loaded save starts a fresh replay');
  const viewer = await connect(f, 'viewer');
  await viewer.receive('binary');
  assert.equal((await viewer.receive('base')).hash, base.hash, 'Late viewers receive the base right after the ROM');
  viewer.send({ type: 'watch', hash, round: f.room.round });
  assert.deepEqual(await viewer.receive('replay'), { type: 'replay', frames: [[1, 1]], round: f.room.round, base: base.hash });
  host.send({ type: 'restart', round: f.room.round });
  assert.deepEqual(await guest.receive('base'), { type: 'base', hash: '' });
  assert.equal((await guest.receive('start')).base, '', 'Restarting the ROM returns to power-on');
  assert.ok(f.room.saves.has(1), 'Restarting keeps the saves');
});

test('autosave checkpoints fold committed inputs into the base so late viewers replay only recent frames', async t => {
  const f = await setup(t);
  const { host, guest } = await players(f);
  const round = f.room.round;
  host.send({ type: 'frames', frames: [[1, 0], [1, 0]], round });
  host.send({ type: 'frames', frames: [[1, 0, 1]], round, checkpoint: 1 });
  host.send({ type: 'frames', frames: [[0, 1]], round });
  await guest.receive('frames');
  assert.deepEqual((await guest.receive('frames')).frames, [[1, 0, 1]], 'Viewers see where to reload');
  await guest.receive('frames');
  host.send({ type: 'state', slot: 0, round, checkpoint: 1, data: await saveData({ frames: 3 }) });
  const base = await guest.receive('base');
  assert.equal(base.checkpoint, true);
  assert.equal(base.slot, 0);
  assert.deepEqual(await guest.receive('saved'), { type: 'saved', slot: 0, nickname: '', hash: base.hash });
  assert.deepEqual(f.room.frames, [[0, 1]]);
  assert.equal(f.room.base, f.room.saves.get(0));
  assert.equal(f.room.dropped, 3);
  host.send({ type: 'state', slot: 0, round, data: await saveData() });
  assert.equal((await host.receive('unavailable')).action, 'state', 'Autosaves are rate limited');
  const viewer = await connect(f, 'viewer');
  assert.equal((await viewer.receive('base')).hash, base.hash);
  viewer.send({ type: 'watch', hash, round });
  assert.deepEqual(await viewer.receive('replay'), { type: 'replay', frames: [[0, 1]], round, base: base.hash });

  host.send({ type: 'return-lobby', round });
  await guest.receive('reset-lobby');
  const lobby = await until(guest, 'lobby', value => !value.started && value.round === f.room.round);
  assert.equal(lobby.canResume, true);
  assert.equal(lobby.resumeFrom, 'progress');
  host.send({ type: 'resume' });
  assert.equal((await guest.receive('resume')).base, base.hash);
  host.send({ type: 'return-lobby', round: f.room.round });
  await guest.receive('reset-lobby');
  host.send({ type: 'start' });
  assert.deepEqual(await guest.receive('base'), { type: 'base', hash: '' });
  assert.equal((await guest.receive('start')).base, '');
  assert.equal(f.room.base, undefined, 'Starting over discards the timeline');
  assert.ok(f.room.saves.has(0), 'Starting over keeps the autosave');
  const denied = once(host.socket, 'close');
  host.send({ type: 'frames', frames: [[1, 0, 1]], round: f.room.round });
  assert.equal((await denied)[0], 4002, 'A marker needs a checkpoint id');
});

test('saves follow the ROM, survive the host leaving and are released with the room', async t => {
  const f = await setup(t);
  const host = await connect(f, 'host');
  host.socket.send(nesFixture());
  await host.receive('binary');
  host.send({ type: 'ready', hash });
  host.send({ type: 'start' });
  await host.receive('start');
  await storeSave(f, host, host, 3, await saveData({ frames: 2 }));
  host.send({ type: 'return-lobby', round: f.room.round });
  await host.receive('reset-lobby');
  host.send({ type: 'load', slot: 3, round: f.room.round });
  assert.equal((await host.receive('base')).slot, 3);
  const lobby = await until(host, 'lobby', value => value.resumeFrom === 'save');
  assert.equal(lobby.base.slot, 3);
  assert.equal(lobby.base.nickname, 'host');
  assert.equal(f.room.started, false, 'Loading in the lobby only chooses the resume point');
  const other = nesFixture();
  other[other.length - 1] = 1;
  host.socket.send(other);
  assert.deepEqual(await host.receive('base'), { type: 'base', hash: '' });
  const hidden = await until(host, 'lobby', value => value.romHash !== hash && value.romHash !== '');
  assert.deepEqual(hidden.saves, [], 'Saves of another ROM stay hidden');
  assert.equal(hidden.canResume, false);
  host.socket.send(nesFixture());
  const shown = await until(host, 'lobby', value => value.romHash === hash);
  assert.deepEqual(shown.saves.map(save => save.slot), [3], 'The same ROM brings its saves back');
  host.socket.close();
  await waitFor(() => f.room.rom === undefined);
  assert.equal(f.room.base, undefined);
  assert.ok(f.room.saves.has(3), 'Saves stay in memory until the session ends');
  f.service.remove(f.room);
  assert.equal(f.room.saves.size, 0);
});

test('the host imports a save file in the lobby and resumes everyone from it', async t => {
  const f = await setup(t);
  const host = await connect(f, 'host');
  host.socket.send(nesFixture());
  await host.receive('binary');
  host.send({ type: 'ready', hash });
  const image = 'data:image/png;base64,' + Buffer.from('imported screen').toString('base64');
  const data = await saveData({ frames: 4, thumbnail: image });
  host.send({ type: 'import', data, round: f.room.round });
  const base = await host.receive('base');
  assert.equal(base.slot, null);
  assert.equal(base.nickname, 'host');
  assert.equal(base.thumb, true);
  const lobby = await until(host, 'lobby', value => value.canResume);
  assert.equal(lobby.resumeFrom, 'save');
  assert.deepEqual([lobby.base.hash, lobby.base.thumb], [base.hash, true]);
  host.send({ type: 'thumbnail', hash: base.hash });
  assert.deepEqual(await host.receive('thumbnail'), { type: 'thumbnail', hash: base.hash, thumbnail: image },
    'The resume point shows the screenshot kept in the file');
  host.send({ type: 'import', data, round: f.room.round });
  assert.equal((await host.receive('unavailable')).action, 'import', 'Imports are rate limited');
  host.send({ type: 'resume' });
  assert.equal((await host.receive('resume')).base, base.hash);
  host.send({ type: 'watch', hash, round: f.room.round });
  assert.deepEqual(await host.receive('replay'), { type: 'replay', frames: [], round: f.room.round, base: base.hash });
  assert.equal(f.room.saves.size, 0, 'Imported files do not occupy a slot');
});

test('save screenshots reach players with the notice or on request; spectators and invalid images get none', async t => {
  const f = await setup(t);
  const { host, guest } = await players(f);
  const viewer = await connect(f, 'viewer');
  const image = 'data:image/png;base64,' + Buffer.from('a tiny screen').toString('base64');
  const data = await saveData({ frames: 2, thumbnail: image });
  const shot = saveHash(data);
  assert.deepEqual(await storeSave(f, guest, host, 1, data), { type: 'saved', slot: 1, nickname: 'guest', hash: shot, thumbnail: image });
  assert.equal((await host.receive('saved')).thumbnail, image);
  assert.deepEqual(await viewer.receive('saved'), { type: 'saved', slot: 1, nickname: 'guest', hash: shot }, 'Spectators have no saves menu');
  const lobby = await until(guest, 'lobby', value => value.saves.length === 1);
  assert.deepEqual([lobby.saves[0].hash, lobby.saves[0].thumb], [shot, true]);
  assert.equal(f.room.saves.get(1).thumbnail, image);

  guest.send({ type: 'thumbnail', hash: shot });
  assert.deepEqual(await guest.receive('thumbnail'), { type: 'thumbnail', hash: shot, thumbnail: image });
  // Requests that get no answer: ordered replies to a later message prove nothing came back.
  const silent = async (peer, request) => {
    peer.send(request);
    peer.send({ type: 'download', slot: 9 });
    await peer.receive('unavailable');
    assert.equal(peer.messages.some(value => value.type === 'thumbnail'), false, JSON.stringify(request));
  };
  await silent(viewer, { type: 'thumbnail', hash: shot });
  await silent(guest, { type: 'thumbnail', hash: 'f'.repeat(64) });
  await silent(guest, { type: 'thumbnail', hash: 42 });
  [...f.room.peers].find(peer => peer.slot === 1).thumbnails = 128;
  await silent(guest, { type: 'thumbnail', hash: shot });

  for (const [slot, thumbnail] of [[2, 'data:image/svg+xml;base64,PHN2Zz4='], [3, 'javascript:alert(1)'],
    [2, 'data:image/png;base64,' + 'A'.repeat(96 * 1024)]]) {
    for (const peer of f.room.peers) peer.lastSave = 0;
    const saved = await storeSave(f, host, host, slot, await saveData({ thumbnail }));
    assert.equal(saved.thumbnail, undefined, thumbnail.slice(0, 30));
    assert.equal(f.room.saves.get(slot).thumbnail, '', 'The save is kept without the unusable image');
  }
});

test('a malformed, oversized or mismatched save file is refused without disturbing the game', async t => {
  const f = await setup(t);
  const { host, guest } = await players(f);
  const real = JSON.parse(gunzipSync(Buffer.from(await saveData({ frames: 1 }), 'base64')).toString('utf8'));
  const envelope = value => gzipSync(JSON.stringify(value)).toString('base64');
  const { savedAt, ...undated } = real;
  const cases = [
    ['not base64', '%%%%'],
    ['not gzip', Buffer.from('not a save at all').toString('base64')],
    ['gzip bomb', gzipSync(Buffer.alloc(5 * 1024 * 1024, 32)).toString('base64')],
    ['too large', randomBytes(600 * 1024).toString('base64')],
    ['other ROM', await saveData({ romHash: 'b'.repeat(64) })],
    ['other emulator', await saveData({ emulator: 'jsnes@0.0.1' })],
    ['other format', await saveData({ format: 'other' })],
    ['newer version', await saveData({ version: 2 })],
    ['missing state', await saveData({ state: { cpu: {}, ppu: {} } })],
    ['undated', envelope(undated)],
    ['array mapper', envelope({ ...real, state: { ...real.state, mmap: [] } })],
    ['numeric ROM name', envelope({ ...real, romName: 7 })],
  ];
  const round = f.room.round;
  for (const [label, data] of cases) {
    f.room.lastImport = 0;
    host.send({ type: 'import', data, round });
    assert.deepEqual(await host.receive('unavailable'), { type: 'unavailable', action: 'import', reason: 'invalid' }, label);
    assert.equal(f.room.base, undefined, label);
  }
  assert.equal(host.socket.readyState, WebSocket.OPEN, 'A refused file does not disconnect the host');
  assert.deepEqual([f.room.started, f.room.round], [true, round], 'The game goes on');
  assert.equal(guest.messages.some(value => value.type === 'stopped' || value.type === 'base'), false);
  const denied = once(host.socket, 'close');
  host.send({ type: 'state', slot: 0, round, data: '%%%%' });
  assert.equal((await denied)[0], 4002, 'A broken upload from the host emulator is still a protocol error');
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

test('/nes and /doom stay open while anyone is connected and end only after the idle limit', async t => {
  const service = new GamesService({ host: '127.0.0.1', port: 0, publicUrl: 'http://127.0.0.1' });
  const bot = new EventEmitter(), closed = [], replies = [], commands = [];
  bot.command = value => { commands.push(value); };
  bot.closeScreen = async (serverId, ref) => { closed.push(ref.instanceId); };
  const dispose = registerGames(bot, service, 200);
  t.after(dispose);
  const signal = new AbortController().signal;
  for (const command of commands) {
    await command.handler({
      args: {}, signal, locale: 'pt-BR', serverId: 'server', invocationId: command.name, invokerId: 'host',
      reply: value => replies.push(botMessageText(value, 'pt-BR')),
      createScreen: async input => ({ ...input, instanceId: command.name, channelId: 'voice', revision: 0 }),
    });
  }
  assert.match(replies[1], /termina 30 minutos depois que todos saírem.*baixe o save/);
  assert.doesNotMatch(replies[0], /save/, 'Only the NES reply mentions saves');
  const nes = [...service.rooms.values()].find(room => room.game === 'nes');
  const viewer = await connect({ service, base: await service.start(), room: nes }, 'host');
  await waitFor(() => closed.includes('doom'));
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.deepEqual(closed, ['doom'], 'A connected viewer keeps the NES session open past the idle limit');
  assert.equal(service.rooms.has(nes.id), true);
  viewer.socket.close();
  await waitFor(() => closed.includes('nes'));
  assert.equal(service.rooms.size, 0);
});

test('the games listener proves its identity to doctor and Monky servers without changing game routes', async t => {
  const reachability = require('@monky/bot-sdk/dist/reachability');
  const pair = (() => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'der' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    return { publicKeyHex: Buffer.from(publicKey).toString('hex'), privateKeyPem: privateKey };
  })();
  const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
  t.after(() => reachability.setRuntimeBotIdentity(undefined));
  const { base } = await setup(t);

  // Outside the SDK runner no identity is registered: the probe is answered, but never verified.
  assert.equal(await reachability.probeReachability(base, pair.publicKeyHex), 'unverified');
  reachability.setRuntimeBotIdentity(reachability.createReachabilityIdentity(pair.publicKeyHex, pair.privateKeyPem));
  assert.equal(await reachability.probeReachability(base, pair.publicKeyHex), 'verified');
  assert.equal(await reachability.probeReachability(base, other), 'unverified');

  const probe = await fetch(`${base}/.well-known/monky-bot-reachability`, { method: 'POST' });
  assert.equal(probe.status, 405);
  assert.equal(probe.headers.get('access-control-allow-origin'), null);
  const health = await fetch(`${base}/games/health`);
  assert.deepEqual(await health.json(), { application: 'monky-games', version: 1 });
  assert.equal(health.headers.get('access-control-allow-origin'), '*');
  assert.equal((await fetch(`${base}/.well-known/other`)).status, 404);
});
test('a busy games port explains how to move it instead of failing silently', async t => {
  const { setCliLocale } = require('../dist/i18n');
  const blocker = require('node:net').createServer();
  blocker.listen(0, '127.0.0.1');
  await once(blocker, 'listening');
  t.after(() => new Promise(resolve => blocker.close(resolve)));
  t.after(() => setCliLocale('pt-BR'));
  const { port } = blocker.address();
  for (const [locale, pattern] of [
    ['en', new RegExp(`Games port ${port} is already in use.*MONKY_GAMES_PORT <port>.*monkybot restart`)],
    ['pt-BR', new RegExp(`porta de jogos ${port} já está em uso.*MONKY_GAMES_PORT <porta>.*monkybot restart`)],
  ]) {
    setCliLocale(locale);
    const service = new GamesService({ host: '127.0.0.1', port, publicUrl: 'http://127.0.0.1' });
    t.after(() => service.close());
    const error = await service.start().then(() => assert.fail('Expected EADDRINUSE.'), failure => failure);
    assert.match(error.message, pattern);
    assert.equal(error.cause.code, 'EADDRINUSE');
  }
});