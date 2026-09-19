const assert = require('node:assert/strict');
const { test } = require('node:test');
const { randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { registerTicTacToe } = require('../dist/commands/ticTacToe');
const { MusicQueues } = require('../dist/music/queue');
const { botMessageText } = require('./helpers/bot-message');
const tick = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function ref(screen) {
  return { id: screen.id, instanceId: screen.instanceId };
}

function screenErrors(logged) {
  // Older Node runtimes also emit MockTimers warnings through console.error.
  return logged.mock.calls
    .filter(call => typeof call.arguments[0] === 'string' && call.arguments[0].startsWith('[screens] '))
    .map(call => call.arguments.join(' '));
}

function fixture(t, lifetime) {
  const bot = new EventEmitter();
  const screens = new Map(), updates = [], closed = [], replies = [];
  const keyOf = (serverId, id) => JSON.stringify([serverId, id]);
  const screen = (id, serverId = 'server') => screens.get(keyOf(serverId, id));
  let command, count = 0;
  bot.command = value => { command = value; };
  const requireRef = value => {
    assert.equal(typeof value, 'object', 'SDK17 screen operations require a ref, not a string ID');
    assert.equal(typeof value.id, 'string');
    assert.equal(typeof value.instanceId, 'string');
    assert.ok(value.id && value.instanceId);
  };
  bot.updateScreen = async (serverId, screenRef, patch) => {
    requireRef(screenRef);
    const current = screen(screenRef.id, serverId);
    assert.ok(current, 'Update must target an existing screen on this server');
    assert.equal(screenRef.instanceId, current.instanceId);
    assert.equal(patch.expectedRevision, current.revision);
    current.revision++;
    current.state = patch.state;
    updates.push({ serverId, ref: ref(screenRef), patch });
    return { ...current };
  };
  bot.closeScreen = async (serverId, screenRef) => {
    requireRef(screenRef);
    closed.push({ serverId, ref: ref(screenRef) });
    if (screen(screenRef.id, serverId)?.instanceId === screenRef.instanceId) screens.delete(keyOf(serverId, screenRef.id));
  };
  const dispose = registerTicTacToe(bot, lifetime);
  t.after(dispose);
  function storeScreen(input, { serverId = 'server', channelId = 'voice', instanceId = randomUUID(), revision = 0 } = {}) {
    assert.equal(input.instanceId, undefined, 'Only the server fixture generates the instance ID');
    const snapshot = { ...input, instanceId, channelId, revision };
    screens.set(keyOf(serverId, snapshot.id), snapshot);
    return { ...snapshot };
  }
  async function create(locale = 'en', overrides = {}) {
    const ctx = {
      serverId: 'server', channelId: 'text', invokerVoiceChannelId: 'voice', invokerId: 'x', invokerNickname: 'X',
      invocationId: `game-${++count}`, locale, signal: new AbortController().signal, reply: text => replies.push(botMessageText(text, locale)),
      createScreen: async input => storeScreen(input, { serverId: ctx.serverId, channelId: ctx.invokerVoiceChannelId }),
      ...overrides,
    };
    await command.handler(ctx);
    return { id: ctx.invocationId, ctx, screen: screen(ctx.invocationId, ctx.serverId) };
  }
  function action(snapshot, userId, action, payload = {}, revision, actionId = randomUUID(), overrides = {}) {
    const current = screen(snapshot.id, overrides.serverId ?? 'server');
    bot.emit('screenAction', {
      serverId: 'server', channelId: snapshot.channelId, screenId: snapshot.id, instanceId: snapshot.instanceId,
      userId, userNickname: userId, action, payload,
      revision: revision ?? (current?.instanceId === snapshot.instanceId ? current.revision : snapshot.revision),
      actionId, ...overrides,
    });
  }
  function remove(snapshot, overrides = {}) {
    const event = { serverId: 'server', channelId: snapshot.channelId, ...ref(snapshot),
      reason: 'ended', endedByUserId: 'creator-or-admin', ...overrides };
    if (event.reason !== 'ended') delete event.endedByUserId;
    const current = screen(event.id, event.serverId);
    if (event.reason !== 'view_revoked' && current?.instanceId === event.instanceId && current.channelId === event.channelId) {
      screens.delete(keyOf(event.serverId, event.id));
    }
    bot.emit('screenRemoved', event);
  }
  function disconnect(serverId = 'server') {
    for (const key of screens.keys()) if (JSON.parse(key)[0] === serverId) screens.delete(key);
    bot.emit('disconnected', { serverId });
  }
  return { bot, screens, screen, storeScreen, updates, closed, replies, create, action, remove, disconnect, dispose,
    get command() { return command; } };
}

test('shared screen command localizes, serializes racing joins and rejects stale/deduplicated actions', async t => {
  const f = fixture(t);
  assert.equal(f.command.voiceRequirement, 'joined');
  const { screen } = await f.create('en');
  assert.match(f.replies[0], /Game created/);
  assert.match(f.replies[0], /voice room.*invitation.*stage/);
  f.action(screen, 'o', 'join', {}, 0, 'join');
  f.action(screen, 'other', 'join', {}, 0, 'race');
  await tick();
  assert.equal(f.updates.length, 1);
  assert.deepEqual(f.updates[0].ref, ref(screen));
  assert.deepEqual(f.screen(screen.id).state.players.map(p => p.id), ['x', 'o']);
  f.action(screen, 'spectator', 'move', { position: 0, userId: 'x' });
  f.action(screen, 'x', 'move', { position: 0 }, 1, 'move');
  f.action(screen, 'x', 'move', { position: 1 }, 1, 'move');
  await tick();
  assert.equal(f.updates.length, 2);
  assert.equal(f.screen(screen.id).state.board[0], 'X');
  assert.equal(f.screen(screen.id).state.board[1], null);
  const second = await f.create('pt-BR');
  assert.match(f.replies.at(-1), /Jogo criado/);
  assert.equal(f.screen(second.id).state.locale, 'pt-BR');
  await f.dispose();
  assert.equal(f.screens.size, 0);
  for (const name of ['screenAction', 'screenRemoved', 'disconnected', 'closed']) assert.equal(f.bot.listenerCount(name), 0);
});

test('games close their exact ref on uncertain acknowledgements and expiry, but not after disconnect', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const logged = t.mock.method(console, 'error', () => {});
  console.error('(node:fixture) ExperimentalWarning: unrelated runtime diagnostic');
  const f = fixture(t, 30);
  const first = await f.create();
  f.bot.updateScreen = async () => { throw new Error('lost acknowledgement'); };
  f.action(first.screen, 'o', 'join');
  await tick();
  assert.deepEqual(f.closed, [{ serverId: 'server', ref: ref(first.screen) }]);
  assert.equal(screenErrors(logged).length, 1);
  assert.match(screenErrors(logged)[0], /lost acknowledgement/);
  const second = await f.create();
  f.disconnect();
  const third = await f.create();
  t.mock.timers.tick(31);
  await tick();
  assert.deepEqual(f.closed, [
    { serverId: 'server', ref: ref(first.screen) }, { serverId: 'server', ref: ref(third.screen) },
  ]);
  assert.equal(f.screen(second.id), undefined);
});

test('already-aborted and cancelled-before-start invocations never create a screen', async t => {
  const f = fixture(t);
  const controller = new AbortController();
  controller.abort();
  await f.command.handler({ signal: controller.signal });
  const active = new AbortController();
  const creating = f.create('en', {
    signal: active.signal, createScreen: () => assert.fail('Cancelled before starting the SDK request'),
  });
  active.abort();
  await creating;
  assert.equal(f.screens.size, 0);
  assert.deepEqual(f.replies, []);
});

test('cancellation during creation closes only the exact returned screen instance', async t => {
  const f = fixture(t);
  const started = deferred(), response = deferred();
  const controller = new AbortController();
  const creating = f.create('en', {
    invocationId: 'pending', signal: controller.signal,
    createScreen: input => { started.resolve(input); return response.promise; },
  });
  const input = await started.promise;
  controller.abort();
  const snapshot = f.storeScreen(input);
  response.resolve(snapshot);
  await creating;
  assert.deepEqual(f.closed, [{ serverId: 'server', ref: ref(snapshot) }]);
  assert.deepEqual(f.replies, []);
});

test('creator/admin END immediately releases quotas and timers without another close or chat notice', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const logged = t.mock.method(console, 'error', () => {});
  const f = fixture(t, 100);
  const active = [];
  for (let i = 0; i < 16; i++) active.push((await f.create()).screen);
  await f.create();
  assert.match(f.replies.at(-1), /Active game limit/);
  const messages = f.replies.length;
  for (const snapshot of active) f.remove(snapshot, { endedByUserId: 'admin-not-playing' });
  t.mock.timers.tick(101);
  await tick();
  assert.deepEqual(f.closed, []);
  assert.equal(f.replies.length, messages);
  assert.equal(screenErrors(logged).length, 0);
  for (let i = 0; i < 16; i++) {
    await f.create();
    assert.match(f.replies.at(-1), /Game created/);
  }
});

for (const reason of ['closed', 'access_revoked', 'bot_disconnected']) {
  test(`authoritative ${reason} removal releases the game without closing again`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture(t, 100);
    const { screen } = await f.create();
    f.remove(screen, { reason });
    f.action(screen, 'o', 'join');
    t.mock.timers.tick(101);
    await tick();
    assert.deepEqual(f.updates, []);
    assert.deepEqual(f.closed, []);
    assert.equal(f.replies.length, 1);
  });
}

test('local view revocation does not end the shared game or release its player seats', async t => {
  const f = fixture(t);
  const { screen } = await f.create();
  f.action(screen, 'o', 'join');
  await tick();
  f.remove(screen, { reason: 'view_revoked' });
  f.action(screen, 'x', 'move', { position: 0 });
  await tick();
  assert.deepEqual(f.screen(screen.id).state.players.map(player => player.id), ['x', 'o']);
  assert.equal(f.screen(screen.id).state.board[0], 'X');
  assert.deepEqual(f.closed, []);
  assert.equal(f.replies.length, 1);
});

test('ending tic-tac-toe leaves independent music advancing in the same server and voice room', { timeout: 5000 }, async t => {
  const f = fixture(t);
  let connection, frames = 0, leaves = 0;
  Object.assign(f.bot, {
    getVoiceConnection: () => connection,
    joinVoice: async (_serverId, channelId) => connection = {
      channelId, humanParticipantCount: 1, writeOpus: async () => { frames++; },
    },
    leaveVoice: async () => { leaves++; connection = undefined; },
  });
  const source = {
    check: async () => {},
    resolve: async url => ({ id: 'independent', title: 'Independent fixture', url, duration: 60, audioUrl: 'fixture' }),
    open: async (_track, signal) => ({
      frames: (async function* () { while (!signal.aborted) yield Uint8Array.of(248, 255, 254); })(),
      close: async () => {},
    }),
  };
  const queues = new MusicQueues(source, f.bot, async () => {});
  t.after(() => queues.dispose());
  const advancing = async minimum => {
    const deadline = Date.now() + 2000;
    while (frames < minimum && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(frames >= minimum, 'Independent music must keep advancing');
  };
  await queues.enqueue({
    serverId: 'server', voiceChannelId: 'voice', textChannelId: 'text',
    locale: 'en', invocationId: 'music-invocation',
  }, 'independent');
  await advancing(2);
  const { screen } = await f.create();
  const before = frames;
  f.remove(screen);
  await advancing(before + 1);
  assert.equal(queues.snapshot('server').current.id, 'independent');
  assert.equal(queues.snapshot('server').channelId, 'voice');
  assert.equal(leaves, 0);
  assert.deepEqual(f.closed, []);
  assert.equal(f.replies.length, 1);
});

test('actions and removals are bound to server, channel and exact screen instance', async t => {
  const f = fixture(t);
  const first = await f.create('en', { invocationId: 'shared-id' });
  const second = await f.create('en', { invocationId: 'shared-id', serverId: 'other-server' });
  for (const change of [
    { serverId: 'unknown-server' }, { channelId: 'other-channel' }, { instanceId: randomUUID() },
  ]) {
    f.remove(first.screen, change);
    f.action(first.screen, 'wrong', 'join', {}, 0, randomUUID(), change);
  }
  await tick();
  assert.deepEqual(f.updates, []);
  f.action(first.screen, 'first-o', 'join');
  f.action(second.screen, 'second-o', 'join', {}, 0, 'second', { serverId: 'other-server' });
  await tick();
  assert.equal(f.updates.length, 2);
  f.remove(first.screen);
  assert.ok(f.screen(second.id, 'other-server'));
  f.action(second.screen, 'x', 'move', { position: 0 }, 1, 'move', { serverId: 'other-server' });
  await tick();
  assert.equal(f.screen(second.id, 'other-server').state.board[0], 'X');
  assert.deepEqual(f.closed, []);
});

for (const completion of ['ack', 'reject']) {
  test(`old-instance actions, END events and a late update ${completion} cannot touch a reused ID`, async t => {
    const logged = t.mock.method(console, 'error', () => {});
    const f = fixture(t);
    const old = await f.create('en', { invocationId: 'reused-id' });
    const pending = deferred();
    const update = f.bot.updateScreen;
    const calls = [];
    f.bot.updateScreen = (serverId, screenRef, patch) => {
      calls.push(ref(screenRef));
      return screenRef.instanceId === old.screen.instanceId ? pending.promise : update(serverId, screenRef, patch);
    };
    f.action(old.screen, 'old-o', 'join');
    await tick();
    for (let i = 0; i < 20; i++) f.action(old.screen, 'old-o', 'join', {}, 0, `queued-${i}`);
    f.remove(old.screen);
    const current = await f.create('en', { invocationId: 'reused-id' });
    assert.notEqual(current.screen.instanceId, old.screen.instanceId);
    f.remove(old.screen);
    f.action(old.screen, 'late-old-o', 'join');
    f.action(current.screen, 'new-o', 'join');
    await tick();
    if (completion === 'ack') pending.resolve({ ...old.screen, revision: 1 });
    else pending.reject(new Error('retired update failed'));
    await tick();
    f.action(current.screen, 'x', 'move', { position: 0 });
    await tick();
    assert.deepEqual(calls, [ref(old.screen), ref(current.screen), ref(current.screen)]);
    assert.deepEqual(f.screen(current.id).state.players.map(player => player.id), ['x', 'new-o']);
    assert.equal(f.screen(current.id).state.board[0], 'X');
    assert.deepEqual(f.closed, []);
    assert.equal(f.replies.length, 2);
    assert.equal(screenErrors(logged).length, 0);
  });
}

test('a mismatched update acknowledgement closes only its own ref, never the returned foreign instance', async t => {
  const logged = t.mock.method(console, 'error', () => {});
  const f = fixture(t);
  const first = await f.create();
  const other = await f.create();
  f.bot.updateScreen = async () => ({ ...other.screen, revision: 1 });
  f.action(first.screen, 'o', 'join');
  await tick();
  assert.deepEqual(f.closed, [{ serverId: 'server', ref: ref(first.screen) }]);
  assert.ok(f.screen(other.id));
  assert.equal(screenErrors(logged).length, 1);
});

test('human END during pending creation is normal and a late create ack cannot revive the game', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const logged = t.mock.method(console, 'error', () => {});
  const f = fixture(t, 100);
  const started = deferred(), response = deferred();
  let calls = 0;
  const creating = f.create('en', {
    createScreen: input => { calls++; started.resolve(input); return response.promise; },
  });
  const snapshot = f.storeScreen(await started.promise);
  f.remove(snapshot);
  response.resolve(snapshot);
  await creating;
  f.action(snapshot, 'o', 'join');
  t.mock.timers.tick(101);
  await tick();
  assert.equal(calls, 1, 'An ended invocation must not automatically create another session');
  assert.deepEqual(f.replies, []);
  assert.deepEqual(f.closed, []);
  assert.deepEqual(f.updates, []);
  assert.equal(screenErrors(logged).length, 0);
  for (let i = 0; i < 16; i++) {
    await f.create();
    assert.match(f.replies.at(-1), /Game created/);
  }
});

test('pending creations ignore early removals from another instance, server or voice channel', async t => {
  const f = fixture(t);
  const created = await f.create('en', {
    createScreen: async input => {
      const snapshot = f.storeScreen(input);
      for (const change of [
        { instanceId: randomUUID() }, { serverId: 'other-server' }, { channelId: 'text' }, { id: 'another-screen' },
        { reason: 'view_revoked' },
      ]) f.remove(snapshot, change);
      f.disconnect('other-server');
      return snapshot;
    },
  });
  assert.match(f.replies.at(-1), /Game created/);
  f.action(created.screen, 'o', 'join');
  await tick();
  assert.equal(f.updates.length, 1);
  assert.deepEqual(f.closed, []);
});

test('END cancellation of an active SDK invocation makes a rejected pending creation a normal lifecycle event', async t => {
  const logged = t.mock.method(console, 'error', () => {});
  const f = fixture(t);
  const started = deferred(), response = deferred();
  const controller = new AbortController();
  const creating = f.create('en', {
    signal: controller.signal, createScreen: input => { started.resolve(input); return response.promise; },
  });
  const snapshot = f.storeScreen(await started.promise);
  f.remove(snapshot);
  controller.abort();
  response.reject(new Error('The SDK rejected the ended screen instance'));
  await creating;
  assert.deepEqual(f.replies, []);
  assert.deepEqual(f.closed, []);
  assert.equal(screenErrors(logged).length, 0);
  await f.create();
  assert.match(f.replies.at(-1), /Game created/);
});

test('failed cancellation cleanup remains visible to the operator without a private success or error reply', async t => {
  const logged = t.mock.method(console, 'error', () => {});
  const f = fixture(t);
  const started = deferred(), response = deferred();
  const controller = new AbortController();
  f.bot.closeScreen = async () => { throw new Error('cleanup transport failed'); };
  const creating = f.create('en', {
    signal: controller.signal, createScreen: input => { started.resolve(input); return response.promise; },
  });
  const snapshot = f.storeScreen(await started.promise);
  controller.abort();
  response.resolve(snapshot);
  await creating;
  assert.deepEqual(f.replies, []);
  assert.equal(screenErrors(logged).length, 1);
  assert.match(screenErrors(logged)[0], /cleanup transport failed/);
});

test('duplicate stale removals do not consume pending tracking capacity', async t => {
  const f = fixture(t);
  await f.create('en', {
    createScreen: async input => {
      const snapshot = f.storeScreen(input);
      const staleInstance = randomUUID();
      for (let i = 0; i < 100; i++) f.remove(snapshot, { instanceId: staleInstance });
      return snapshot;
    },
  });
  assert.match(f.replies.at(-1), /Game created/);
  assert.deepEqual(f.closed, []);
});

test('bounded pending-removal overflow fails explicitly instead of accepting uncertain lifetime state', async t => {
  const logged = t.mock.method(console, 'error', () => {});
  const f = fixture(t);
  let returned;
  await f.create('en', {
    createScreen: async input => {
      returned = f.storeScreen(input);
      for (let i = 0; i < 40; i++) f.remove(returned, { instanceId: randomUUID() });
      return returned;
    },
  });
  assert.match(f.replies.at(-1), /Could not open/);
  assert.deepEqual(f.closed, [{ serverId: 'server', ref: ref(returned) }]);
  assert.equal(screenErrors(logged).length, 1);
  assert.match(screenErrors(logged)[0], /removal tracking exceeded its limit/);
  await f.create();
  assert.match(f.replies.at(-1), /Game created/);
});

test('disconnect during pending creation releases its reservation without a redundant close or reply', async t => {
  const f = fixture(t);
  const started = deferred(), response = deferred();
  const creating = f.create('en', {
    createScreen: input => { started.resolve(input); return response.promise; },
  });
  const snapshot = f.storeScreen(await started.promise);
  f.disconnect();
  response.resolve(snapshot);
  await creating;
  assert.deepEqual(f.replies, []);
  assert.deepEqual(f.closed, []);
  for (let i = 0; i < 16; i++) await f.create();
  assert.match(f.replies.at(-1), /Game created/);
});

test('a removed old creation ack cannot revive or close a newer instance with the same ID', async t => {
  const f = fixture(t);
  const started = deferred(), response = deferred();
  const creating = f.create('en', {
    invocationId: 'pending-reused',
    createScreen: input => { started.resolve(input); return response.promise; },
  });
  const old = f.storeScreen(await started.promise);
  f.remove(old);
  const current = await f.create('en', { invocationId: 'pending-reused' });
  response.resolve(old);
  await creating;
  assert.equal(f.screen(current.id).instanceId, current.screen.instanceId);
  assert.equal(f.replies.length, 1);
  assert.deepEqual(f.closed, []);
  f.action(current.screen, 'o', 'join');
  await tick();
  assert.equal(f.updates.length, 1);
});

test('disposal retains removal observation until pending creation cleanup and then detaches all listeners', async t => {
  const f = fixture(t);
  const started = deferred(), response = deferred();
  const creating = f.create('en', {
    createScreen: input => { started.resolve(input); return response.promise; },
  });
  const snapshot = f.storeScreen(await started.promise);
  const disposing = f.dispose();
  assert.equal(f.bot.listenerCount('screenAction'), 0);
  assert.equal(f.bot.listenerCount('screenRemoved'), 1);
  f.remove(snapshot);
  response.resolve(snapshot);
  await creating;
  await disposing;
  assert.deepEqual(f.closed, []);
  assert.deepEqual(f.replies, []);
  for (const name of ['screenAction', 'screenRemoved', 'disconnected', 'closed']) assert.equal(f.bot.listenerCount(name), 0);
  assert.equal(f.dispose(), disposing);
});

test('synchronous bot closure inside createScreen still waits for the returned-instance cleanup', async t => {
  const f = fixture(t);
  const closing = deferred(), started = deferred();
  const close = f.bot.closeScreen;
  f.bot.closeScreen = async (serverId, screenRef) => {
    started.resolve(ref(screenRef));
    await closing.promise;
    await close(serverId, screenRef);
  };
  const creating = f.create('en', {
    createScreen: async input => {
      const snapshot = f.storeScreen(input);
      f.bot.emit('closed');
      return snapshot;
    },
  });
  const expectedRef = await started.promise;
  let finished = false;
  const disposing = f.dispose().then(() => { finished = true; });
  await tick();
  assert.equal(finished, false);
  closing.resolve();
  await creating;
  await disposing;
  assert.deepEqual(f.closed, [{ serverId: 'server', ref: expectedRef }]);
  assert.deepEqual(f.replies, []);
  for (const name of ['screenAction', 'screenRemoved', 'disconnected', 'closed']) assert.equal(f.bot.listenerCount(name), 0);
});
