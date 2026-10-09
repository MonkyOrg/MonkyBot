const assert = require('node:assert/strict');
const { test, beforeEach } = require('node:test');
const { LocalExecutionError, LocalExecutionRpcError, ProtocolErrorCode, LIMITS } = require('@monky/bot-sdk');
const { createLocalMusicCommands, createMusicCommands, musicNoticeText } = require('../dist/commands/music');
const { MusicError, QueueFullError, musicError } = require('../dist/music/errors');
const { MusicQueues } = require('../dist/music/queue');
const { playRequest } = require('../dist/music/playlist');
const {
  LocalMusicSourceFactory, localMusicFailure, localMusicPlaylist,
} = require('../dist/music/localSource');
const { setCliLocale } = require('../dist/i18n');
const { botMessageText } = require('./helpers/bot-message');

beforeEach(() => setCliLocale('en'));

const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) {
  for (let attempt = 0; attempt < 400 && !predicate(); attempt++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(predicate(), true, 'Condition did not become true');
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const cancel = () => reject(new MusicError('cancelled'));
    if (signal.aborted) return cancel();
    signal.addEventListener('abort', cancel, { once: true });
    promise.then(resolve, reject);
  });
}

const videoId = 'abcdefghijk';
const videoLink = `https://www.youtube.com/watch?v=${videoId}`;
const listId = 'PLfixture0123456789';
const albumId = 'OLAK5uy_fixtureAlbum0123456789';
const playlistUrl = id => `https://www.youtube.com/playlist?list=${id}`;
const entryId = index => `pl${String(index).padStart(9, '0')}`;
const entry = (index, title = `Flat ${index}`) => Object.freeze({
  id: entryId(index), title, url: `https://www.youtube.com/watch?v=${entryId(index)}`, duration: 120,
});
const video = Object.freeze({ id: videoId, title: 'Linked video', url: videoLink, duration: 200 });
const actor = (overrides = {}) => ({
  botId: 'bot', serverId: 'server', voiceChannelId: 'voice', textChannelId: 'text', locale: 'en',
  invocationId: 'invocation', invokerId: 'user', invokerSessionId: 'physical-session',
  invokerNickname: 'Requester', ...overrides,
});
const info = (overrides = {}) => ({ title: 'Fixture playlist', album: false, skipped: 0, beyond: 0, ...overrides });

function voiceFixture() {
  const connections = new Map();
  const writes = [];
  return {
    connections, writes,
    voice: {
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
    },
  };
}

/** A generic source factory: playback holds each track until `finish` releases it. */
function queueFixture(t, { limit = 100, bind, checkAvailability, open, release } = {}) {
  const calls = { binds: [], bound: [], releases: [], resolves: [], opens: [], checks: [] };
  const finish = deferred();
  const factory = {
    bind: async (requester, url, signal) => {
      calls.binds.push(url);
      await abortable(Promise.resolve(bind?.(url, calls.binds.length)), signal);
      calls.bound.push(url);
      return {
        check: async () => {},
        checkAvailability: async () => {
          calls.checks.push(url);
          await checkAvailability?.(url);
        },
        resolve: async value => { calls.resolves.push(value); return { id: value, title: value, url: value, duration: 10 }; },
        open: async (track, playback) => {
          calls.opens.push(track.id);
          if (open) return open(track, playback);
          return {
            frames: (async function* () {
              yield Uint8Array.of(1);
              await abortable(finish.promise, playback);
            })(),
            close: async () => {},
          };
        },
        release: async () => { await release?.(url); calls.releases.push(url); },
      };
    },
  };
  const v = voiceFixture();
  const notices = [];
  const queues = new MusicQueues(factory, v.voice, async notice => { notices.push(notice); }, 10_000,
    undefined, () => limit);
  t.after(() => { finish.resolve(); return queues.dispose(); });
  return { queues, calls, notices, finish, ...v };
}

const flat = count => Array.from({ length: count }, (_, index) => ({
  id: `p${index}`, title: `p${index}`, url: `p${index}`, duration: 10,
}));

test('a playlist reserves contiguous slots, retains at most two sources at once and is accepted as a whole', async t => {
  const gate = deferred();
  const f = queueFixture(t, { limit: 10, bind: url => url.startsWith('p') ? gate.promise : undefined });
  await f.queues.enqueue(actor(), 'solo');
  await until(() => f.writes.length === 1);
  const adding = f.queues.enqueuePlaylist(actor(), flat(4), info());
  await until(() => f.calls.binds.length === 3);
  const late = await f.queues.enqueue(actor({ invocationId: 'late-invocation' }), 'late');
  assert.equal(late.id, 'late');
  assert.deepEqual(f.calls.binds, ['solo', 'p0', 'p1', 'late'], 'Only two playlist sources are retained at once');
  assert.deepEqual(f.queues.snapshot('server').upcoming.map(item => [item.title, item.pending]),
    [['…', true], ['…', true], ['…', true], ['…', true], ['late', false]]);
  gate.resolve();
  assert.deepEqual(await adding, { added: 4, unreserved: 0, limit: 10 });
  assert.deepEqual(f.queues.snapshot('server').upcoming.map(item => item.title), ['p0', 'p1', 'p2', 'p3', 'late']);
  assert.equal(f.calls.resolves.some(url => /^p\d/.test(url)), false,
    'Playlist entries are resolved by playback, not one by one on addition');
  const announced = f.notices.filter(notice => notice.type === 'playlist-queued');
  assert.equal(announced.length, 1);
  assert.deepEqual({ ...announced[0], actor: undefined },
    { type: 'playlist-queued', actor: undefined, playlist: info(), added: 4, unreserved: 0, limit: 10 });
  assert.deepEqual(f.notices.filter(notice => notice.type === 'queued').map(notice => notice.track.id), ['solo', 'late']);
});

test('a playlist larger than the free space queues what fits and reports the rest as unreserved', async t => {
  const f = queueFixture(t, { limit: 3 });
  await f.queues.enqueue(actor(), 'solo');
  await until(() => f.writes.length === 1);
  await f.queues.enqueue(actor(), 'queued');
  assert.deepEqual(f.queues.capacity('server'), { limit: 3, free: 2 });
  assert.deepEqual(await f.queues.enqueuePlaylist(actor(), flat(6), info()), { added: 2, unreserved: 4, limit: 3 });
  assert.deepEqual(f.calls.binds.filter(url => url.startsWith('p')), ['p0', 'p1']);
  assert.deepEqual(f.queues.capacity('server'), { limit: 3, free: 0 });
  const full = await f.queues.enqueuePlaylist(actor(), flat(2), info()).catch(error => error);
  assert.ok(full instanceof QueueFullError);
  assert.equal(full.limit, 3);
  assert.match(musicError(full, 'en'), /limit of 3 tracks/);
  assert.match(musicError(full, 'pt-BR'), /limite de 3 faixas/);
});

test('cancelling a playlist load removes every reservation and releases every retained source', async t => {
  const blocked = deferred();
  const f = queueFixture(t, { bind: (_url, count) => count >= 3 ? blocked.promise : undefined });
  const invocation = new AbortController();
  const adding = f.queues.enqueuePlaylist(actor(), flat(6), info(), invocation.signal);
  await until(() => f.calls.binds.length === 4);
  assert.equal(f.queues.snapshot('server').upcoming.length, 6);
  invocation.abort();
  await assert.rejects(adding, { code: 'cancelled' });
  assert.deepEqual(f.queues.snapshot('server').upcoming, []);
  assert.deepEqual(f.calls.releases.sort(), ['p0', 'p1']);
  assert.equal(f.calls.binds.length, 4, 'No source is retained after cancellation');
  assert.equal(f.notices.length, 0);
  assert.equal(f.connections.size, 0, 'A cancelled load never joins voice');
});

test('a failed retention fails the whole playlist and releases what was already retained', async t => {
  const f = queueFixture(t, { bind: (_url, count) => {
    if (count === 3) throw new MusicError('busy');
  } });
  await assert.rejects(f.queues.enqueuePlaylist(actor(), flat(5), info()), { code: 'busy' });
  assert.deepEqual(f.queues.snapshot('server').upcoming, []);
  assert.ok(f.calls.bound.length >= 2);
  assert.deepEqual(f.calls.releases.sort(), f.calls.bound.sort());
  assert.equal(f.notices.length, 0);
});

test('removing a pending playlist entry during the load keeps the others', async t => {
  const first = deferred();
  const f = queueFixture(t, { bind: (_url, count) => count <= 2 ? first.promise : undefined });
  const adding = f.queues.enqueuePlaylist(actor(), flat(4), info());
  await until(() => f.calls.binds.length === 2);
  await f.queues.control(actor(), 'remove', 2);
  first.resolve();
  assert.deepEqual(await adding, { added: 3, unreserved: 0, limit: 100 });
  assert.equal(f.notices.find(notice => notice.type === 'playlist-queued').added, 3);
  await until(() => f.calls.opens.length === 1);
  assert.deepEqual(f.queues.snapshot('server').upcoming.map(item => item.title), ['p2', 'p3']);
  assert.ok(!f.calls.bound.includes('p1'), 'The removed entry was never retained');
  assert.deepEqual(f.calls.releases, []);
});

test('lowering the configured limit blocks new entries without evicting queued ones', async t => {
  let limit = 4;
  const f = queueFixture(t);
  const queues = new MusicQueues({ bind: async () => ({
    check: async () => {}, resolve: async url => ({ id: url, title: url, url, duration: 10 }),
    open: async (_track, signal) => ({
      frames: (async function* () { yield Uint8Array.of(1); await abortable(f.finish.promise, signal); })(),
      close: async () => {},
    }),
  }) }, f.voice, async () => {}, 10_000, undefined, () => limit);
  t.after(() => queues.dispose());
  await queues.enqueue(actor(), 'solo');
  await until(() => queues.snapshot('server').started);
  for (const url of ['a', 'b', 'c']) await queues.enqueue(actor(), url);
  limit = 2;
  assert.deepEqual(queues.capacity('server'), { limit: 2, free: 0 });
  await assert.rejects(queues.enqueue(actor(), 'blocked'), { code: 'full' });
  assert.deepEqual(queues.snapshot('server').upcoming.map(item => item.title), ['a', 'b', 'c']);
  limit = 0;
  await assert.rejects(queues.enqueue(actor(), 'invalid'), { code: 'settings' });
  assert.throws(() => queues.capacity('server'), { code: 'settings' });
});

test('deferred playlist entries need one availability confirmation per invocation, not one per track', async t => {
  const left = deferred();
  let available = false;
  const f = queueFixture(t, {
    checkAvailability: async () => { if (!available) throw new MusicError('requester_left_voice'); },
    open: (track, signal) => ({
      frames: (async function* () {
        yield Uint8Array.of(1);
        if (track.id === 'p0') { await left.promise; throw new MusicError('requester_left_voice'); }
        await abortable(new Promise(() => {}), signal);
      })(),
      close: async () => {},
    }),
  });
  await f.queues.enqueuePlaylist(actor(), flat(4), info());
  await until(() => f.writes.length === 1);
  left.resolve();
  await until(() => f.calls.checks.length === 1 && f.queues.snapshot('server').current === null);
  assert.ok(f.queues.snapshot('server').upcoming.every(item => item.waitingForRequester));
  f.queues.participantsChanged('server', 'voice', 2);
  await until(() => f.calls.checks.length === 2);
  await tick();
  assert.equal(f.calls.checks.length, 2, 'One check covers all deferred entries of the invocation');
  available = true;
  f.queues.participantsChanged('server', 'voice', 3);
  await until(() => f.calls.opens.length === 2);
  assert.equal(f.calls.checks.length, 3);
  assert.deepEqual(f.queues.snapshot('server').upcoming.map(item => [item.title, item.waitingForRequester]),
    [['p2', false], ['p3', false]]);
});

function localProvider(options = {}) {
  const calls = {
    contexts: [], executes: [], retains: [], releases: [], streams: [], supports: [],
    pending: 0, maxPending: 0, releasing: 0, maxReleasing: 0,
  };
  const client = {
    supports: operation => { calls.supports.push(operation); return options.supports ?? true; },
    executor: context => {
      calls.contexts.push(context);
      return {
        execute: async (spec, taskOptions) => {
          calls.executes.push({ spec, options: taskOptions, context });
          calls.pending++;
          calls.maxPending = Math.max(calls.maxPending, calls.pending);
          try {
            await tick();
            const custom = await options.execute?.(spec);
            if (custom !== undefined) return custom;
            if (spec.operation === 'youtube.search') return { operation: 'youtube.search', tracks: [video] };
            if (spec.operation === 'youtube.resolve') return { operation: 'youtube.resolve', track: video };
            if (spec.operation === 'youtube.playlist') {
              const entries = options.entries ?? 12;
              const skipped = Math.min(options.skipped ?? 0, spec.limit);
              const tracks = Array.from({ length: Math.min(entries - skipped, spec.limit - skipped) }, (_, index) => entry(index));
              return {
                operation: 'youtube.playlist', title: 'title' in options ? options.title : 'Fixture playlist',
                total: 'total' in options ? options.total : entries, tracks, skipped,
              };
            }
            throw new Error(`Unexpected ${spec.operation}`);
          } finally {
            calls.pending--;
          }
        },
        stream: async (spec, streamOptions) => {
          calls.streams.push({ spec, options: streamOptions, context });
          const id = new URL(spec.url).searchParams.get('v');
          if (options.restricted?.includes(id)) {
            throw new LocalExecutionError({
              state: 'failed', taskId: `stream-${id}`, reason: 'provider_unavailable', sourceFailure: { code: 'unsupported' },
            });
          }
          return {
            taskId: `stream-${id}`,
            track: { id, title: `Streamed ${id}`, url: spec.url, duration: 150 },
            frames: (async function* () { yield Uint8Array.of(1); })(),
            signal: new AbortController().signal,
            closed: Promise.resolve(),
            markFrameAdvanced: () => {},
            setPaused: async () => {},
            close: async () => {},
          };
        },
      };
    },
    retainSource: async (invocationId, retainedUrl) => {
      calls.retains.push(retainedUrl);
      await tick();
      return {
        sourceContextId: `source-${calls.retains.length}`, botId: 'bot', botPublicKey: 'a'.repeat(64),
        invokerId: 'user', invokerSessionId: 'physical-session', originChannelId: 'text',
        capability: 'youtube-audio', provider: 'youtube-local', url: retainedUrl, expiresAt: Date.now() + 60_000,
      };
    },
    releaseSource: async sourceContextId => {
      calls.releasing++;
      calls.maxReleasing = Math.max(calls.maxReleasing, calls.releasing);
      await new Promise(resolve => setTimeout(resolve, 2));
      calls.releasing--;
      calls.releases.push(sourceContextId);
    },
    checkSourceAvailability: async () => {},
  };
  return { provider: { localExecution: () => client }, client, calls };
}

function lookup(query, overrides = {}) {
  return {
    requestId: 'remapped-request', commandName: 'play', botId: 'bot', channelId: 'text',
    invokerId: 'user', invokerSessionId: 'physical-session', invokerNickname: 'Requester',
    invokerVoiceChannelId: 'voice', serverId: 'server', locale: 'en', optionName: 'busca', query,
    args: {}, settings: {}, signal: new AbortController().signal, ...overrides,
  };
}

test('a video link with a playlist suggests the video first, then the playlist, probing both at once', async () => {
  const f = localProvider();
  const play = createLocalMusicCommands({}, f.provider).find(command => command.name === 'play');
  for (const locale of ['en', 'pt-BR']) {
    f.calls.executes.length = 0;
    const query = `https://www.youtube.com/watch?v=${videoId}&list=${listId}&index=3`;
    const ctx = lookup(query, { locale });
    const choices = await play.autocomplete(ctx);
    assert.deepEqual(choices.map(choice => choice.value), [videoLink, playlistUrl(listId)]);
    assert.equal(choices[0].audio.resourceId, videoId);
    assert.equal(choices[1].label, 'Fixture playlist');
    assert.equal(choices[1].audio, undefined);
    assert.equal(choices[1].description, locale === 'en' ? 'YouTube playlist · 12 videos' : 'Playlist do YouTube · 12 vídeos');
    assert.deepEqual(f.calls.executes.map(call => call.spec), [
      { operation: 'youtube.resolve', url: videoLink },
      { operation: 'youtube.playlist', url: playlistUrl(listId), limit: 1 },
    ]);
    assert.ok(f.calls.executes.every(call => call.options.signal === ctx.signal &&
      call.context.kind === 'autocomplete' && call.context.requestId === 'remapped-request'));
    assert.equal(f.calls.maxPending, 2, 'Video and playlist are read in parallel');
  }
});

test('YouTube Music albums are suggested as albums', async () => {
  const f = localProvider({ title: null, total: 1 });
  const play = createLocalMusicCommands({}, f.provider).find(command => command.name === 'play');
  const choices = await play.autocomplete(lookup(`https://music.youtube.com/playlist?list=${albumId}`, { locale: 'pt-BR' }));
  assert.deepEqual(choices, [{
    value: playlistUrl(albumId), label: 'Álbum do YouTube Music', description: 'Álbum do YouTube Music · 1 faixa',
  }]);
  assert.deepEqual(playRequest(`https://music.youtube.com/watch?v=${videoId}&list=${albumId}`).list,
    { kind: 'playlist', url: playlistUrl(albumId) });
});

test('without playlist support or with a failed probe, a video link suggests only the video', async () => {
  const unsupported = localProvider({ supports: false });
  const query = `https://youtu.be/${videoId}?list=${listId}`;
  let play = createLocalMusicCommands({}, unsupported.provider).find(command => command.name === 'play');
  assert.deepEqual((await play.autocomplete(lookup(query))).map(choice => choice.value), [videoLink]);
  assert.deepEqual(unsupported.calls.executes.map(call => call.spec.operation), ['youtube.resolve']);

  for (const reason of ['executor_unavailable', 'invalid_request']) {
    const failing = localProvider({ execute: spec => {
      if (spec.operation === 'youtube.playlist') {
        throw new LocalExecutionRpcError(ProtocolErrorCode.FEATURE_REQUIRES_UPDATE, reason);
      }
    } });
    play = createLocalMusicCommands({}, failing.provider).find(command => command.name === 'play');
    assert.deepEqual((await play.autocomplete(lookup(query))).map(choice => choice.value), [videoLink]);
  }

  const empty = localProvider({ entries: 0, total: 0 });
  play = createLocalMusicCommands({}, empty.provider).find(command => command.name === 'play');
  assert.deepEqual((await play.autocomplete(lookup(query))).map(choice => choice.value), [videoLink]);
});

test('an unplayable video beside a playable playlist leaves only the playlist suggestion', async () => {
  const f = localProvider({ execute: spec => {
    if (spec.operation === 'youtube.resolve') throw new MusicError('unsupported');
  } });
  const play = createLocalMusicCommands({}, f.provider).find(command => command.name === 'play');
  const choices = await play.autocomplete(lookup(`https://www.youtube.com/watch?v=${videoId}&list=${listId}`));
  assert.deepEqual(choices.map(choice => choice.value), [playlistUrl(listId)]);
});

test('mixes are never read: a mix link offers only its video, with a warning', async () => {
  const f = localProvider();
  const play = createLocalMusicCommands({}, f.provider).find(command => command.name === 'play');
  for (const query of [
    `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}&start_radio=1`,
    `https://music.youtube.com/watch?v=${videoId}&list=RDCLAK5uy_fixtureRadio`,
  ]) {
    for (const locale of ['en', 'pt-BR']) {
      const choices = await play.autocomplete(lookup(query, { locale }));
      assert.equal(choices.length, 1);
      assert.equal(choices[0].value, videoLink);
      assert.match(choices[0].description, locale === 'en'
        ? /YouTube mixes are not supported; only this video will be added/
        : /Mixes do YouTube não são suportados; só este vídeo será adicionado/);
    }
  }
  assert.ok(f.calls.executes.every(call => call.spec.operation === 'youtube.resolve'));
  await assert.rejects(play.autocomplete(lookup(`https://www.youtube.com/playlist?list=RD${videoId}`)),
    /YouTube mixes are not supported/);
});

test('a playlist page link suggests the playlist alone and explains empty or outdated playlists', async () => {
  const f = localProvider({ total: null });
  let play = createLocalMusicCommands({}, f.provider).find(command => command.name === 'play');
  const choices = await play.autocomplete(lookup(`https://www.youtube.com/playlist?list=${listId}&si=share`));
  assert.deepEqual(choices, [{ value: playlistUrl(listId), label: 'Fixture playlist', description: 'YouTube playlist' }]);
  assert.deepEqual(f.calls.executes.map(call => call.spec), [{ operation: 'youtube.playlist', url: playlistUrl(listId), limit: 1 }]);

  const empty = localProvider({ entries: 0, total: 0 });
  play = createLocalMusicCommands({}, empty.provider).find(command => command.name === 'play');
  await assert.rejects(play.autocomplete(lookup(playlistUrl(listId))), /no playable videos/);
  await assert.rejects(play.autocomplete(lookup(playlistUrl(listId), { locale: 'pt-BR' })), /não tem vídeos que possam ser tocados/);

  for (const [reason, en, pt] of [
    ['invalid_request', /Monky server must be updated/, /servidor Monky precisa ser atualizado/],
    ['executor_unavailable', /Update the requester’s Monky client/, /Atualize o cliente Monky de quem fez o pedido/],
  ]) {
    const outdated = localProvider({ execute: () => {
      throw new LocalExecutionRpcError(ProtocolErrorCode.FEATURE_REQUIRES_UPDATE, reason);
    } });
    play = createLocalMusicCommands({}, outdated.provider).find(command => command.name === 'play');
    await assert.rejects(play.autocomplete(lookup(playlistUrl(listId))), en);
    await assert.rejects(play.autocomplete(lookup(playlistUrl(listId), { locale: 'pt-BR' })), pt);
  }
  assert.equal(localMusicFailure(new LocalExecutionRpcError(ProtocolErrorCode.FEATURE_REQUIRES_UPDATE, 'invalid_request')).code,
    'server_outdated');
  assert.equal(localMusicFailure(new LocalExecutionRpcError(ProtocolErrorCode.FEATURE_REQUIRES_UPDATE, 'executor_unavailable')).code,
    'client_outdated');
});

test('playlist reads use the invocation context and reject replies larger than requested', async () => {
  const f = localProvider();
  const signal = new AbortController().signal;
  const read = await localMusicPlaylist(f.provider, { serverId: 'server', invocationId: 'invocation', signal },
    playlistUrl(listId), 5);
  assert.equal(read.tracks.length, 5);
  assert.deepEqual(f.calls.executes[0].context, { kind: 'invocation', invocationId: 'invocation' });
  assert.deepEqual(f.calls.executes[0].spec, { operation: 'youtube.playlist', url: playlistUrl(listId), limit: 5 });
  const oversized = localProvider({ execute: spec => ({
    operation: 'youtube.playlist', title: 'x', total: null, tracks: [entry(0), entry(1)], skipped: spec.limit,
  }) });
  await assert.rejects(localMusicPlaylist(oversized.provider, { serverId: 'server', invocationId: 'i', signal },
    playlistUrl(listId), 2), { code: 'unavailable' });
  const titled = localProvider({ title: '  Line\none\t\u0007 two  ' });
  assert.equal((await localMusicPlaylist(titled.provider, { serverId: 'server', invocationId: 'i', signal },
    playlistUrl(listId), 1)).title, 'Line one two');
});

test('source releases are throttled so clearing a large queue cannot flood the server', async () => {
  const f = localProvider();
  const factory = new LocalMusicSourceFactory(f.provider);
  const sources = [];
  for (let index = 0; index < 12; index++) {
    sources.push(await factory.bind(actor(), entry(index).url, new AbortController().signal));
  }
  await Promise.all(sources.map(source => source.release()));
  assert.equal(f.calls.releases.length, 12);
  assert.ok(f.calls.maxReleasing <= 2, `released ${f.calls.maxReleasing} sources at once`);
});

test('a source past its 24-hour lifetime fails as expired without streaming or releasing it', async t => {
  const f = localProvider();
  const source = await new LocalMusicSourceFactory(f.provider).bind(actor(), entry(0).url, new AbortController().signal);
  const now = Date.now();
  t.mock.method(Date, 'now', () => now + 24 * 60 * 60_000 + 1);
  await assert.rejects(source.open(entry(0), new AbortController().signal), { code: 'expired' });
  await assert.rejects(source.checkAvailability(new AbortController().signal), { code: 'expired' });
  await source.release();
  assert.equal(f.calls.streams.length, 0);
  assert.deepEqual(f.calls.releases, []);
  assert.match(musicError(new MusicError('expired'), 'en'), /expired: a track can wait up to 24 hours in the queue/);
  assert.match(musicError(new MusicError('expired'), 'pt-BR'), /expirou: uma faixa pode esperar até 24 horas na fila/);
});

test('clearing or stopping a large queue never holds the queue while sources are released', async t => {
  const releasing = deferred();
  const f = queueFixture(t, { release: url => /^p\d/.test(url) ? releasing.promise : undefined });
  t.after(releasing.resolve);
  await f.queues.enqueue(actor(), 'solo');
  await until(() => f.writes.length === 1);
  await f.queues.enqueuePlaylist(actor(), flat(20), info());
  let cleared = false;
  const clearing = f.queues.control(actor(), 'clear').then(() => { cleared = true; });
  await tick();
  assert.deepEqual(f.queues.snapshot('server').upcoming, []);
  await f.queues.control(actor(), 'pause');
  await f.queues.control(actor(), 'resume');
  await f.queues.enqueue(actor({ invocationId: 'next' }), 'next');
  assert.equal(cleared, false, 'The command still reports completion only after its releases');
  await f.queues.enqueuePlaylist(actor({ invocationId: 'again' }), flat(3), info());
  const stopping = f.queues.control(actor(), 'stop');
  await until(() => f.queues.snapshot('server').current === null);
  assert.deepEqual(f.queues.snapshot('server').upcoming, [], 'Stop silences playback before releasing its sources');
  releasing.resolve();
  await Promise.all([clearing, stopping]);
  assert.equal(f.calls.releases.filter(url => /^p\d/.test(url)).length, 23);
});

function commandContext(args, overrides = {}) {
  const replies = [], published = [];
  return {
    replies, published, botId: 'bot', serverId: 'server', channelId: 'text', invokerId: 'user',
    invokerSessionId: 'physical-session', invokerNickname: 'Requester', invocationId: 'invocation',
    invokerVoiceChannelId: 'voice', locale: 'en', args, signal: new AbortController().signal,
    getVoiceChannel: async () => 'voice',
    reply: content => replies.push(botMessageText(content, 'en')),
    publish: content => published.push(botMessageText(content, 'en')),
    ...overrides,
  };
}

function localCommands(t, provider, limit) {
  const v = voiceFixture();
  const notices = [];
  const queues = new MusicQueues(new LocalMusicSourceFactory(provider), v.voice,
    async notice => { notices.push(notice); }, 10_000, undefined, () => limit);
  t.after(() => queues.dispose());
  const commands = createLocalMusicCommands(queues, provider);
  return { queues, notices, play: commands.find(command => command.name === 'play'), commands };
}

test('/play with a playlist reads only the free slots and retains each track without resolving it', async t => {
  const f = localProvider({ entries: 12, skipped: 1 });
  const { play, notices } = localCommands(t, f.provider, 5);
  const ctx = commandContext({ busca: playlistUrl(listId) });
  await play.handler(ctx);
  assert.match(ctx.replies[0], /Playlist received/);
  assert.equal(ctx.replies.length, 1, 'The summary is published by the queue, not repeated privately');
  assert.deepEqual(f.calls.executes[0].spec, { operation: 'youtube.playlist', url: playlistUrl(listId), limit: 5 });
  assert.deepEqual(f.calls.executes[0].context, { kind: 'invocation', invocationId: 'invocation' });
  assert.deepEqual(f.calls.retains, [0, 1, 2, 3].map(index => entry(index).url));
  const notice = notices.find(event => event.type === 'playlist-queued');
  assert.deepEqual({ ...notice, actor: undefined }, {
    type: 'playlist-queued', actor: undefined, added: 4, unreserved: 0, limit: 5,
    playlist: { title: 'Fixture playlist', album: false, skipped: 1, beyond: 7 },
  });
  assert.equal(musicNoticeText(notice, 'en'),
    '📃 Requester added the playlist “Fixture playlist”: 4 tracks queued, 1 skipped (over 1 hour, live, private or restricted) and 7 left out (queue full: 5-track limit).');
  assert.equal(musicNoticeText(notice, 'pt-BR'),
    '📃 Requester adicionou a playlist “Fixture playlist”: 4 faixas entraram na fila, 1 foi pulada (mais de 1 hora, ao vivo, privadas ou restritas) e 7 ficaram de fora (fila cheia: limite de 5).');
  await until(() => f.calls.streams.length === 4);
  assert.equal(f.calls.executes.filter(call => call.spec.operation === 'youtube.resolve').length, 0);
  const started = notices.filter(event => event.type === 'started').map(event => event.track.title);
  await until(() => notices.filter(event => event.type === 'started').length === 4);
  assert.deepEqual(notices.filter(event => event.type === 'started').map(event => event.track.title),
    [0, 1, 2, 3].map(index => `Streamed ${entryId(index)}`), `Playback adopts stream metadata (${started})`);
  await until(() => f.calls.releases.length === 4);
});

test('a playlist entry refused at playback (restricted or now private) is skipped and the playlist continues', async t => {
  t.mock.method(console, 'error', () => {});
  const f = localProvider({ entries: 3, restricted: [entryId(1)] });
  const { play, notices } = localCommands(t, f.provider, 10);
  await play.handler(commandContext({ busca: playlistUrl(listId) }));
  await until(() => notices.some(event => event.type === 'ended'));
  assert.deepEqual(notices.filter(event => event.type === 'started').map(event => event.track.id), [entryId(0), entryId(2)]);
  assert.equal(notices.some(event => event.type === 'failed'), false, 'A later track that plays replaces the failure notice');
  await until(() => f.calls.releases.length === 3);
});

test('host-source commands read playlists through MusicSource.playlist and resolve each track at playback', async t => {
  const reads = [], resolved = [];
  const source = {
    check: async () => {},
    search: async () => [],
    resolve: async url => {
      resolved.push(url);
      return { ...(url === videoLink ? video : entry(Number(url.slice(-9)))), audioUrl: 'unused by fake' };
    },
    playlist: async (url, limit) => {
      reads.push({ url, limit });
      return { title: 'Host playlist', total: 2, tracks: [entry(0), entry(1)], skipped: 0 };
    },
    open: async () => ({ frames: (async function* () { yield Uint8Array.of(1); })(), close: async () => {} }),
  };
  const v = voiceFixture();
  const notices = [];
  const queues = new MusicQueues(source, v.voice, async notice => { notices.push(notice); }, 10_000, undefined, () => 10);
  t.after(() => queues.dispose());
  const play = createMusicCommands(queues, source).find(command => command.name === 'play');
  const choices = await play.autocomplete(lookup(`https://www.youtube.com/watch?v=${videoId}&list=${listId}`));
  assert.deepEqual(choices.map(choice => choice.value), [videoLink, playlistUrl(listId)]);
  assert.equal(choices[1].label, 'Host playlist');
  await play.handler(commandContext({ busca: playlistUrl(listId) }));
  assert.deepEqual(reads, [{ url: playlistUrl(listId), limit: 1 }, { url: playlistUrl(listId), limit: 10 }]);
  assert.equal(notices.find(event => event.type === 'playlist-queued').added, 2);
  await until(() => notices.filter(event => event.type === 'started').length === 2);
  assert.deepEqual(resolved, [videoLink, entry(0).url, entry(1).url]);
});
test('playlist summaries say when the provider total is unknown or nothing was left out', () => {
  const event = (playlist, extra = {}) => ({
    type: 'playlist-queued', actor: actor(), added: 1, unreserved: 0, limit: 100,
    playlist: info(playlist), ...extra,
  });
  assert.equal(musicNoticeText(event({ beyond: null, title: null }), 'en'),
    '📃 Requester added the playlist: 1 track queued, 0 skipped (over 1 hour, live, private or restricted) and the playlist may have more tracks that did not fit (queue full: 100-track limit).');
  assert.equal(musicNoticeText(event({ beyond: null, title: null }), 'pt-BR'),
    '📃 Requester adicionou a playlist: 1 faixa entrou na fila, 0 foram puladas (mais de 1 hora, ao vivo, privadas ou restritas) e a playlist pode ter mais faixas que não couberam (fila cheia: limite de 100).');
  assert.equal(musicNoticeText(event({ beyond: null, album: true }, { unreserved: 2 }), 'pt-BR'),
    '📃 Requester adicionou o álbum “Fixture playlist”: 1 faixa entrou na fila, 0 foram puladas (mais de 1 hora, ao vivo, privadas ou restritas) e 2 ficaram de fora; o álbum pode ter mais faixas (fila cheia: limite de 100).');
  assert.equal(musicNoticeText(event({ beyond: null, album: true }, { unreserved: 1 }), 'en'),
    '📃 Requester added the album “Fixture playlist”: 1 track queued, 0 skipped (over 1 hour, live, private or restricted) and 1 left out; the album may have more tracks (queue full: 100-track limit).');
  assert.match(musicNoticeText(event({ beyond: 0 }), 'en'), /and none left out\.$/);
  assert.match(musicNoticeText(event({ beyond: 0 }), 'pt-BR'), /e nenhuma ficou de fora\.$/);
});

test('/play estimates leftovers from a full window, and trusts a read that ended early', async t => {
  for (const [entries, total, beyond] of [[3, null, 0], [8, null, null], [3, 12, 0], [8, 12, 7]]) {
    const f = localProvider({ entries, total });
    const { play, notices } = localCommands(t, f.provider, 5);
    await play.handler(commandContext({ busca: playlistUrl(albumId) }));
    const notice = notices.find(event => event.type === 'playlist-queued');
    assert.equal(notice.playlist.beyond, beyond, `${entries} read of ${total}`);
    assert.equal(notice.playlist.album, true);
  }
});

test('/play refuses a playlist on a full queue without reading it, and explains empty playlists', async t => {
  const f = localProvider({ entries: 3 });
  const { play, queues } = localCommands(t, f.provider, 10);
  t.mock.method(queues, 'capacity', () => ({ limit: 10, free: 0 }));
  const full = commandContext({ busca: playlistUrl(listId) });
  await play.handler(full);
  assert.match(full.replies.at(-1), /queue is full \(limit of 10 tracks/);
  assert.equal(f.calls.executes.length, 0);

  const skipped = localProvider({ entries: 2, skipped: 2 });
  const empty = localCommands(t, skipped.provider, 10);
  const ctx = commandContext({ busca: playlistUrl(listId) });
  await empty.play.handler(ctx);
  assert.match(ctx.replies.at(-1), /no playable videos/);
  assert.equal(skipped.calls.retains.length, 0);
});

test('/play with a raw video link plays only the video, warning about mixes', async t => {
  const f = localProvider();
  const { play } = localCommands(t, f.provider, 10);
  const plain = commandContext({ busca: `https://www.youtube.com/watch?v=${videoId}&list=${listId}` });
  await play.handler(plain);
  assert.match(plain.replies[0], /Track received/);
  assert.doesNotMatch(plain.replies[0], /mix/i);
  const mix = commandContext({ busca: `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}` }, { invocationId: 'mix' });
  await play.handler(mix);
  assert.match(mix.replies[0], /Track received.*YouTube mixes are not supported; only this video will be added\./);
  assert.equal(mix.replies.length, 1);
  assert.equal(f.calls.executes.some(call => call.spec.operation === 'youtube.playlist'), false);
  assert.deepEqual(f.calls.retains, [videoLink, videoLink]);
  const mixOnly = commandContext({ busca: `https://www.youtube.com/playlist?list=RD${videoId}` });
  await play.handler(mixOnly);
  assert.match(mixOnly.replies.at(-1), /YouTube mixes are not supported/);
});

test('/remove accepts positions up to 500 and validates them against the real queue', async () => {
  const remove = createMusicCommands({}, {}).find(command => command.name === 'remove');
  assert.equal(remove.options[0].max, 500);
  const queues = new MusicQueues({}, { getVoiceConnection: () => undefined, leaveVoice: async () => {} }, async () => {});
  const ctx = commandContext({ position: 3 });
  await createMusicCommands(queues, {}).find(command => command.name === 'remove').handler(ctx);
  assert.match(ctx.replies[0], /Nothing is playing/);
  await queues.dispose();
  const controlled = [];
  const fake = { assertControl: () => {}, control: async (...args) => {
    controlled.push(args[2]);
    if (args[2] > 2) throw new MusicError('position');
  } };
  const invalid = commandContext({ position: 499 });
  await createMusicCommands(fake, {}).find(command => command.name === 'remove').handler(invalid);
  assert.deepEqual(controlled, [499]);
  assert.match(invalid.replies[0], /valid position/);
});

test('a 500-track queue lists every position within the reply size limit', async () => {
  const queues = { assertControl: () => {}, snapshot: () => ({
    current: { title: 'x'.repeat(512), duration: 3600 }, started: true, paused: false, elapsedMs: 1000,
    upcoming: Array.from({ length: 500 }, (_, index) => ({ title: `${index}-${'y'.repeat(505)}`, pending: false })),
  }) };
  for (const locale of ['en', 'pt-BR']) {
    const ctx = commandContext({}, { locale });
    await createMusicCommands(queues, {}).find(command => command.name === 'queue').handler(ctx);
    assert.ok(ctx.replies.length > 1);
    assert.ok(ctx.replies.every(reply => reply.length <= LIMITS.MAX_MESSAGE_LENGTH));
    const output = ctx.replies.join('\n');
    for (const position of [1, 250, 500]) assert.match(output, new RegExp(`^${position}\\. ${position - 1}-`, 'm'));
  }
});
