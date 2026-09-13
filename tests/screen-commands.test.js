const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const { registerTicTacToe } = require('../dist/commands/ticTacToe');
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(t, lifetime) {
  const bot = new EventEmitter();
  const screens = new Map(), updates = [], closed = [], replies = [];
  let command, count = 0;
  bot.command = value => { command = value; };
  bot.updateScreen = async (server, id, patch) => {
    const screen = screens.get(id);
    assert.equal(patch.expectedRevision, screen.revision);
    screen.revision++;
    screen.state = patch.state;
    updates.push(patch);
    return { ...screen };
  };
  bot.closeScreen = async (server, id) => { screens.delete(id); closed.push(id); };
  const dispose = registerTicTacToe(bot, lifetime);
  t.after(dispose);
  async function create(locale = 'en', overrides = {}) {
    const id = `game-${++count}`;
    const ctx = {
      serverId: 'server', channelId: 'text', invokerVoiceChannelId: 'voice', invokerId: 'x', invokerNickname: 'X', invocationId: id,
      locale, signal: new AbortController().signal, reply: text => replies.push(text),
      createScreen: async input => {
        const screen = { ...input, id, channelId: 'voice', revision: 0 };
        screens.set(id, screen);
        return screen;
      },
      ...overrides,
    };
    await command.handler(ctx);
    return { id, ctx };
  }
  function action(id, userId, action, payload = {}, revision = screens.get(id)?.revision, actionId = `${Math.random()}`) {
    bot.emit('screenAction', { serverId: 'server', channelId: 'voice', screenId: id,
      userId, userNickname: userId, action, payload, revision, actionId });
  }
  return { bot, screens, updates, closed, replies, create, action, dispose, get command() { return command; } };
}

test('shared screen command localizes, serializes racing joins and rejects stale/deduplicated actions', async t => {
  const f = fixture(t);
  assert.equal(f.command.voiceRequirement, 'joined');
  const { id } = await f.create('en');
  assert.match(f.replies[0], /Game created/);
  assert.match(f.replies[0], /voice room.*invitation.*stage/);
  assert.doesNotMatch(f.replies[0], /card/);
  f.action(id, 'o', 'join', {}, 0, 'join');
  f.action(id, 'other', 'join', {}, 0, 'race');
  await tick();
  assert.equal(f.updates.length, 1);
  assert.deepEqual(f.screens.get(id).state.players.map(p => p.id), ['x', 'o']);
  f.action(id, 'spectator', 'move', { position: 0, userId: 'x' });
  f.action(id, 'x', 'move', { position: 0 }, 1, 'move');
  f.action(id, 'x', 'move', { position: 1 }, 1, 'move');
  await tick();
  assert.equal(f.updates.length, 2);
  assert.equal(f.screens.get(id).state.board[0], 'X');
  assert.equal(f.screens.get(id).state.board[1], null);
  const second = await f.create('pt-BR');
  assert.match(f.replies.at(-1), /Jogo criado/);
  assert.equal(f.screens.get(second.id).state.locale, 'pt-BR');
  await f.dispose();
  assert.equal(f.screens.size, 0);
  assert.equal(f.bot.listenerCount('screenAction'), 0);
  assert.equal(f.bot.listenerCount('screenRemoved'), 0);
});

test('games close on uncertain update acknowledgements, expiry and server disconnect', async t => {
  const logged = t.mock.method(console, 'error', () => {});
  const f = fixture(t, 30);
  const first = await f.create();
  f.bot.updateScreen = async () => { throw new Error('lost acknowledgement'); };
  f.action(first.id, 'o', 'join');
  await tick();
  assert.ok(f.closed.includes(first.id));
  assert.equal(logged.mock.callCount(), 1);
  const second = await f.create();
  f.screens.delete(second.id);
  f.bot.emit('disconnected', { serverId: 'server' });
  await tick();
  assert.equal(f.closed.includes(second.id), false, 'A disconnected server has already removed its screens.');
  const third = await f.create();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.ok(f.closed.includes(third.id));
});

test('aborted invocations create no screen; cancel during creation closes the returned screen', async t => {
  const f = fixture(t);
  const controller = new AbortController();
  controller.abort();
  await f.command.handler({ signal: controller.signal });
  assert.equal(f.screens.size, 0);
  let resolve;
  const pending = new Promise(yes => { resolve = yes; });
  const active = new AbortController();
  const handler = f.command.handler({
    signal: active.signal, serverId: 'server', channelId: 'text', invokerId: 'x', invokerNickname: 'X',
    locale: 'en', invocationId: 'pending', createScreen: () => pending, reply: () => assert.fail('cancelled response'),
  });
  active.abort();
  resolve({ id: 'pending', revision: 0 });
  await handler;
  assert.ok(f.closed.includes('pending'));
});

test('authoritative removal releases game quotas without issuing another close request', async t => {
  const f = fixture(t);
  for (let i = 0; i < 16; i++) await f.create();
  await f.create();
  assert.match(f.replies.at(-1), /Active game limit/);
  for (const id of [...f.screens.keys()]) {
    f.screens.delete(id);
    f.bot.emit('screenRemoved', { serverId: 'server', channelId: 'voice', id });
  }
  assert.equal(f.closed.length, 0);
  for (let i = 0; i < 16; i++) {
    await f.create();
    assert.match(f.replies.at(-1), /Game created/);
  }
  await f.dispose();
  assert.equal(f.bot.listenerCount('screenRemoved'), 0);
});

test('removals bind to server and channel and cannot revive a game after a late update acknowledgement', async t => {
  const f = fixture(t);
  const { id } = await f.create();
  for (const [serverId, channelId] of [['other-server', 'voice'], ['server', 'other-channel']]) {
    f.bot.emit('screenRemoved', { serverId, channelId, id });
  }
  let complete;
  let updates = 0;
  f.bot.updateScreen = () => {
    updates++;
    return new Promise(resolve => { complete = resolve; });
  };
  f.action(id, 'o', 'join');
  await tick();
  assert.equal(updates, 1);
  f.screens.delete(id);
  f.bot.emit('screenRemoved', { serverId: 'server', channelId: 'voice', id });
  complete({ id, revision: 1 });
  await tick();
  f.action(id, 'x', 'move', { position: 0 }, 1);
  await tick();
  assert.equal(updates, 1);
  assert.equal(f.closed.length, 0);
});

test('removal or disconnect during creation prevents a late acknowledgement from registering a ghost game', async t => {
  t.mock.method(console, 'error', () => {});
  for (const type of ['screenRemoved', 'disconnected']) {
    const f = fixture(t);
    await f.create('en', {
      createScreen: async input => {
        f.bot.emit(type, { serverId: 'server', channelId: 'voice', id: input.id });
        return { ...input, channelId: 'voice', revision: 0 };
      },
    });
    assert.match(f.replies.at(-1), /Could not open/);
    assert.equal(f.closed.length, 0);
    for (let i = 0; i < 16; i++) {
      await f.create();
      assert.match(f.replies.at(-1), /Game created/);
    }
  }
});
