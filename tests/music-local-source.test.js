const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const { LocalExecutionError, LocalExecutionRpcError, ProtocolErrorCode } = require('@monky/bot-sdk');
const { createLocalMusicCommands, registerMusicCommands } = require('../dist/commands/music');
const { MusicError, SourceRecoveryError, musicError } = require('../dist/music/errors');
const { MusicQueues } = require('../dist/music/queue');
const {
  LocalMusicSourceFactory,
  localMusicFailure,
  localVideoUrl,
} = require('../dist/music/localSource');

const url = 'https://www.youtube.com/watch?v=abcdefghijk';
const track = Object.freeze({ id: 'abcdefghijk', title: 'Fixture', url, duration: 120 });
const actor = {
  botId: 'bot', serverId: 'server', voiceChannelId: 'voice', textChannelId: 'text',
  locale: 'en', invocationId: 'invocation', invokerId: 'user',
  invokerSessionId: 'physical-session', invokerNickname: 'Requester',
};

function context(overrides = {}) {
  return {
    requestId: 'remapped-request', commandName: 'play', botId: 'bot',
    channelId: 'text', invokerId: 'user', invokerSessionId: 'physical-session',
    invokerNickname: 'Requester', invokerVoiceChannelId: 'voice',
    serverId: 'server', locale: 'en', optionName: 'busca', query: 'fixture',
    args: {}, settings: {}, signal: new AbortController().signal,
    ...overrides,
  };
}

function providerFixture(overrides = {}) {
  const calls = {
    servers: [], contexts: [], executes: [], streams: [], retains: [], releases: [],
    paused: [], available: [], advanced: 0, closed: 0,
  };
  const streamSignal = new AbortController();
  const preview = Object.freeze({
    operation: 'youtube.preview', localPreviewId: 'preview',
    taskId: 'wire-task', requestId: 'original-request',
    executorSessionId: 'physical-session',
  });
  const stream = {
    taskId: 'stream-task',
    track,
    frames: (async function* () { yield Uint8Array.of(1); yield Uint8Array.of(2); })(),
    signal: streamSignal.signal,
    closed: Promise.resolve(),
    markFrameAdvanced: () => { calls.advanced++; },
    setPaused: async value => { calls.paused.push(value); },
    close: async () => { calls.closed++; },
    ...overrides.stream,
  };
  const client = {
    executor: requestContext => {
      calls.contexts.push(requestContext);
      return {
        execute: async (spec, options) => {
          calls.executes.push({ spec, options });
          if (overrides.execute) return overrides.execute(spec, options);
          if (spec.operation === 'youtube.search') {
            return { operation: 'youtube.search', tracks: [track] };
          }
          if (spec.operation === 'youtube.resolve') {
            return { operation: 'youtube.resolve', track };
          }
          return preview;
        },
        stream: async (spec, options) => {
          calls.streams.push({ spec, options });
          overrides.beforeStreamResult?.();
          return stream;
        },
      };
    },
    retainSource: async (invocationId, retainedUrl, options) => {
      calls.retains.push({ invocationId, url: retainedUrl, options });
      overrides.beforeRetainResult?.();
      return overrides.reference ?? {
        sourceContextId: 'source-context', botId: 'bot',
        botPublicKey: 'a'.repeat(64), invokerId: 'user',
        invokerSessionId: 'physical-session', originChannelId: 'text',
        capability: 'youtube-audio', provider: 'youtube-local',
        url: retainedUrl, expiresAt: Date.now() + 60_000,
      };
    },
    releaseSource: async sourceContextId => { calls.releases.push(sourceContextId); },
    checkSourceAvailability: async (sourceContextId, voiceChannelId, options) => {
      calls.available.push({ sourceContextId, voiceChannelId, options });
      await overrides.checkAvailability?.();
    },
  };
  const provider = {
    localExecution: serverId => {
      calls.servers.push(serverId);
      return client;
    },
  };
  return { provider, client, calls, preview, stream, streamSignal };
}

async function until(predicate) {
  for (let attempt = 0; attempt < 200 && !predicate(); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(predicate(), true, 'Condition did not become true');
}

test('local command helpers use remapped interaction contexts and opaque previews only', async () => {
  const f = providerFixture();
  const commands = createLocalMusicCommands({}, f.provider);
  const play = commands.find(command => command.name === 'play');
  assert.deepEqual(play.localCapabilities, ['youtube-audio']);
  for (const command of commands.filter(command => command.name !== 'play')) {
    assert.equal(command.localCapabilities, undefined);
  }

  const lookup = context();
  const choices = await play.autocomplete(lookup);
  assert.equal(choices[0].value, url);
  assert.equal(choices[0].audio.resourceId, 'abcdefghijk');
  assert.deepEqual(f.calls.contexts[0], { kind: 'autocomplete', requestId: 'remapped-request' });
  assert.deepEqual(f.calls.executes[0], {
    spec: { operation: 'youtube.search', query: 'fixture' },
    options: { signal: lookup.signal },
  });

  const pasted = context({ query: 'https://youtu.be/abcdefghijk?t=3', requestId: 'url-request' });
  await play.autocomplete(pasted);
  assert.deepEqual(f.calls.executes[1].spec, { operation: 'youtube.resolve', url });

  const previewContext = context({ resourceId: 'abcdefghijk', requestId: 'preview-request' });
  const result = await play.audioPreview(previewContext);
  assert.strictEqual(result, f.preview, 'The bot must return the SDK opaque preview result unchanged.');
  assert.deepEqual(f.calls.contexts[2], { kind: 'audio-preview', requestId: 'preview-request' });
  assert.deepEqual(f.calls.executes[2], {
    spec: { operation: 'youtube.preview', url },
    options: { signal: previewContext.signal },
  });
  assert.equal('bytes' in result, false);
  assert.throws(() => localVideoUrl(url), { code: 'unsupported' });
});

test('local source factory retains immutable requester context and never performs a host tool check', async () => {
  const f = providerFixture();
  const signal = new AbortController().signal;
  const source = await new LocalMusicSourceFactory(f.provider).bind(actor, url, signal);
  assert.equal(source.resolvesOnOpen, true);
  assert.deepEqual(f.calls.retains, [{ invocationId: 'invocation', url, options: { signal } }]);
  assert.equal(Object.isFrozen(source.reference), true);

  await source.check(signal);
  assert.equal(f.calls.executes.length, 0, 'check must not probe VPS tools or create a delegated task.');
  await source.checkAvailability(signal);
  assert.deepEqual(f.calls.available, [{
    sourceContextId: 'source-context', voiceChannelId: 'voice', options: { signal },
  }]);
  assert.equal(f.calls.executes.length, 0, 'Availability is only a server query, never a client task.');
  const resolved = await source.resolve(url, signal);
  assert.deepEqual(resolved, track);
  assert.equal(Object.isFrozen(resolved), true);
  assert.deepEqual(f.calls.contexts[0], { kind: 'source', sourceContextId: 'source-context' });

  const opened = await source.open(resolved, signal);
  assert.deepEqual(f.calls.streams, [{
    spec: { operation: 'youtube.stream', url },
    options: { voiceChannelId: 'voice', signal },
  }]);
  const frames = [];
  for await (const frame of opened.frames) frames.push(frame[0]);
  assert.deepEqual(frames, [1, 2]);
  assert.equal(f.calls.advanced, 0, 'Reading frames must never acknowledge playback.');
  opened.markFrameAdvanced();
  assert.equal(f.calls.advanced, 1);
  await opened.setPaused(true);
  await opened.close();
  assert.deepEqual(f.calls.paused, [true]);
  assert.equal(f.calls.closed, 1);

  await Promise.all([source.release(), source.release()]);
  assert.deepEqual(f.calls.releases, ['source-context']);
});

test('invalid retained metadata is rejected and released without binding a source', async () => {
  const f = providerFixture({ reference: {
    sourceContextId: 'invalid-source', botId: 'bot', botPublicKey: 'a'.repeat(64),
    invokerId: 'user', invokerSessionId: 'another-device', originChannelId: 'text',
    capability: 'youtube-audio', provider: 'youtube-local',
    url, expiresAt: Date.now() + 60_000,
  } });
  await assert.rejects(
    new LocalMusicSourceFactory(f.provider).bind(actor, url, new AbortController().signal),
    { code: 'unavailable' },
  );
  assert.deepEqual(f.calls.releases, ['invalid-source']);
});

test('cancellation after source retention releases the late reference instead of binding it', async () => {
  const owner = new AbortController();
  const f = providerFixture({ beforeRetainResult: () => owner.abort() });
  await assert.rejects(new LocalMusicSourceFactory(f.provider).bind(actor, url, owner.signal), { code: 'cancelled' });
  assert.deepEqual(f.calls.releases, ['source-context']);
  assert.equal(f.calls.executes.length, 0);
  assert.equal(f.calls.streams.length, 0);
});

for (const rejection of ['cancelled', 'invalid-track']) {
  test(`an acquired ${rejection} stream is closed before open rejects`, async () => {
    const owner = new AbortController();
    let releaseClose;
    let closeStarted;
    const closing = new Promise(resolve => { closeStarted = resolve; });
    const closed = new Promise(resolve => { releaseClose = resolve; });
    const f = providerFixture({
      beforeStreamResult: () => { if (rejection === 'cancelled') owner.abort(); },
      stream: {
        track: rejection === 'cancelled' ? track : {
          ...track, id: 'jNQXAC9IVRw', url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
        },
        close: async () => { closeStarted(); await closed; },
      },
    });
    const source = await new LocalMusicSourceFactory(f.provider).bind(actor, url, new AbortController().signal);
    let settled = false;
    const opening = source.open(track, owner.signal);
    opening.then(() => { settled = true; }, () => { settled = true; });
    const rejected = assert.rejects(opening, { code: rejection === 'cancelled' ? 'cancelled' : 'unavailable' });
    await closing;
    assert.equal(settled, false, 'Acquired stream ownership must be settled before reporting rejection');
    releaseClose();
    await rejected;
    assert.equal(f.calls.releases.length, 0, 'Closing a task must not release its retained queue item');
    await source.release();
    assert.deepEqual(f.calls.releases, ['source-context']);
  });
}

test('playback acknowledgment preserves typed source recovery failures', async () => {
  const f = providerFixture({ stream: {
    markFrameAdvanced: () => {
      throw new LocalExecutionError({
        state: 'failed', taskId: 'stream-task', reason: 'provider_unavailable',
        sourceFailure: { code: 'recovery_failed', attempts: 5 },
      });
    },
  } });
  const source = await new LocalMusicSourceFactory(f.provider).bind(actor, url, new AbortController().signal);
  const stream = await source.open(track, new AbortController().signal);
  try {
    assert.throws(() => stream.markFrameAdvanced(), error => error instanceof SourceRecoveryError && error.attempts === 5);
  } finally {
    await stream.close();
    await source.release();
  }
});

test('typed local task failures retain source and requester cancellation distinctions', () => {
  const requesterLeft = localMusicFailure(new LocalExecutionError({
    state: 'cancelled', taskId: 'task-left', cause: 'requester_left_voice',
  }));
  const requesterDisconnected = localMusicFailure(new LocalExecutionError({
    state: 'cancelled', taskId: 'task-disconnected', cause: 'requester_disconnected',
  }));
  const transport = localMusicFailure(new LocalExecutionError({
    state: 'failed', taskId: 'task-transport', reason: 'transport_failed',
  }));
  const permissionDenied = localMusicFailure(new LocalExecutionError({
    state: 'failed', taskId: 'task-permission', reason: 'permission_denied',
  }));
  const permissionRevoked = localMusicFailure(new LocalExecutionError({
    state: 'cancelled', taskId: 'task-revoked', cause: 'permission_revoked',
  }));
  const clientUnavailable = localMusicFailure(new LocalExecutionError({
    state: 'failed', taskId: 'task-client', reason: 'executor_unavailable',
  }));
  const recovery = localMusicFailure(new LocalExecutionError({
    state: 'failed', taskId: 'task-recovery', reason: 'provider_unavailable',
    sourceFailure: { code: 'recovery_failed', attempts: 3 },
  }));
  assert.ok(requesterLeft instanceof MusicError);
  assert.equal(requesterLeft.code, 'requester_left_voice');
  assert.equal(requesterDisconnected.code, 'requester_disconnected');
  assert.equal(transport.code, 'local_transport');
  assert.equal(permissionDenied.code, 'local_permission');
  assert.equal(permissionRevoked.code, 'local_permission');
  assert.equal(clientUnavailable.code, 'local_client_unavailable');
  assert.ok(recovery instanceof SourceRecoveryError);
  assert.equal(recovery.attempts, 3);
  for (const locale of ['pt-BR', 'en']) {
    const permission = musicError(permissionDenied, locale);
    const client = musicError(clientUnavailable, locale);
    const privateTransport = musicError(transport, locale);
    assert.doesNotMatch(permission, /provider|provedor|autentica/i);
    assert.match(permission, locale === 'en' ? /not authorized|revoked/ : /não foi autorizada|revogada/);
    assert.match(client, locale === 'en' ? /requester.*client.*unavailable/ : /cliente original.*não está disponível/);
    assert.match(privateTransport, locale === 'en' ? /private audio channel/ : /canal privado de áudio/);
  }
});

test('pre-admission source errors preserve machine-readable departure and permission causes', async () => {
  for (const [reason, expected] of [
    ['requester_left_voice', 'requester_left_voice'], ['requester_disconnected', 'requester_disconnected'],
    ['permission_revoked', 'local_permission'], ['permission_denied', 'local_permission'], ['busy', 'busy'],
  ]) {
    const failure = new LocalExecutionRpcError(ProtocolErrorCode.PERMISSION_DENIED, reason);
    assert.equal(localMusicFailure(failure).code, expected);
    const f = providerFixture({ checkAvailability: async () => { throw failure; } });
    const source = await new LocalMusicSourceFactory(f.provider).bind(actor, url, new AbortController().signal);
    await assert.rejects(source.checkAvailability(new AbortController().signal), { code: expected });
    assert.equal(f.calls.executes.length, 0);
    await source.release();
  }
  const arbitrary = new LocalExecutionRpcError(ProtocolErrorCode.INTERNAL_ERROR, 'user left voice in an arbitrary diagnostic');
  assert.strictEqual(localMusicFailure(arbitrary), arbitrary, 'Free-text messages must not become authoritative departure causes');
});

test('queue preserves its signal and source after producer EOF until authoritative playback closure', async t => {
  let complete;
  const closed = new Promise(resolve => { complete = resolve; });
  const f = providerFixture({ stream: { closed } });
  let connection;
  const voice = {
    getVoiceConnection: () => connection,
    joinVoice: async () => connection = { channelId: 'voice', humanParticipantCount: 1, writeOpus: async () => {} },
    leaveVoice: async () => { connection = undefined; },
  };
  const queues = new MusicQueues(new LocalMusicSourceFactory(f.provider), voice, async () => {}, 10_000);
  t.after(async () => { complete(); await queues.dispose(); });
  await queues.enqueue(actor, url);
  await until(() => f.calls.advanced === 2);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.streams[0].options.signal.aborted, false, 'EOF must not cancel the pending PLAYED/drain completion');
  assert.equal(f.calls.closed, 0);
  assert.deepEqual(f.calls.releases, []);
  assert.equal(queues.snapshot('server').current?.id, track.id);
  complete();
  await until(() => f.calls.releases.length === 1);
  assert.equal(f.calls.closed, 1);
});

test('production registration uses local execution and controls do not request capabilities or VPS tools', async t => {
  const f = providerFixture();
  const commands = new Map();
  const chats = [];
  let connection;
  const bot = Object.assign(new EventEmitter(), f.provider, {
    settings: () => {},
    getServerSettings: () => ({ schemaRevision: 1, revision: 1, values: { music_idle_seconds: 60 } }),
    onSettingsChanged: () => () => {},
    command: command => commands.set(command.name, command),
    sendMessage: async (_serverId, _channelId, content) => { chats.push(content); },
    getVoiceConnection: () => connection,
    joinVoice: async () => connection = { channelId: 'voice', humanParticipantCount: 1, writeOpus: async () => {} },
    leaveVoice: async () => { connection = undefined; },
  });
  const dispose = registerMusicCommands(bot);
  t.after(dispose);
  assert.deepEqual(commands.get('play').localCapabilities, ['youtube-audio']);
  assert.ok([...commands.values()].filter(command => command.name !== 'play').every(command =>
    command.localCapabilities === undefined));
  const replies = [];
  const ctx = {
    ...context({ args: { busca: url } }), invocationId: 'invocation',
    getVoiceChannel: async () => 'voice', reply: text => replies.push(text),
  };
  await commands.get('play').handler(ctx);
  assert.match(replies[0], /Track received/);
  assert.match(replies.at(-1), /Added to queue/);
  await until(() => f.calls.releases.length === 1);
  assert.equal(f.calls.retains.length, 1);
  assert.equal(f.calls.streams.length, 1);
  assert.equal(f.calls.advanced, 2);
  assert.ok(chats.some(text => /Queue finished/.test(text)));
  const operations = f.calls.executes.length;
  await commands.get('queue').handler(ctx);
  await commands.get('stop').handler(ctx);
  assert.equal(f.calls.executes.length, operations);
  await dispose();
  assert.equal(bot.listenerCount('voiceParticipantsChanged'), 0);
});

test('delegated stream failure signal and iterator errors are mapped without fake success', async () => {
  const failure = new LocalExecutionError({
    state: 'cancelled', taskId: 'task-left', cause: 'requester_left_voice',
  });
  const f = providerFixture({ stream: {
    frames: (async function* () {
      throw new LocalExecutionError({
        state: 'failed', taskId: 'task-tools', reason: 'tools_missing',
        sourceFailure: { code: 'tools' },
      });
    })(),
  } });
  const source = await new LocalMusicSourceFactory(f.provider)
    .bind(actor, url, new AbortController().signal);
  const opened = await source.open(track, new AbortController().signal);
  const reading = opened.frames[Symbol.asyncIterator]().next();
  await assert.rejects(reading, { code: 'tools' });
  f.streamSignal.abort(failure);
  assert.equal(opened.signal.aborted, true);
  assert.equal(opened.signal.reason.code, 'requester_left_voice');
  await opened.close();
});

test('local command, retained source, queue clock and release compose without a VPS fallback', async t => {
  const f = providerFixture();
  const connections = new Map();
  const writes = [];
  const voice = {
    getVoiceConnection: serverId => connections.get(serverId),
    joinVoice: async (serverId, channelId) => {
      const connection = {
        channelId, humanParticipantCount: 1,
        writeOpus: async frame => { writes.push(frame[0]); },
        close: async () => {},
      };
      connections.set(serverId, connection);
      return connection;
    },
    leaveVoice: async serverId => { connections.delete(serverId); },
  };
  const queues = new MusicQueues(new LocalMusicSourceFactory(f.provider), voice, async () => {}, 10_000);
  t.after(() => queues.dispose());
  const replies = [];
  const ctx = {
    ...context({ args: { busca: url } }),
    invocationId: 'invocation',
    getVoiceChannel: async () => 'voice',
    reply: value => replies.push(value),
  };
  await createLocalMusicCommands(queues, f.provider)
    .find(command => command.name === 'play').handler(ctx);
  assert.match(replies[0], /Track received/);
  assert.match(replies.at(-1), /Added to queue/);
  await until(() => f.calls.releases.length === 1);
  assert.deepEqual(writes, [1, 2]);
  assert.equal(f.calls.advanced, 2);
  assert.equal(f.calls.executes.filter(call => call.spec.operation === 'youtube.resolve').length, 1,
    'The streaming operation resolves fresh media itself; the queue must not create a duplicate metadata task at playback time');
  assert.deepEqual(f.calls.releases, ['source-context']);
});
