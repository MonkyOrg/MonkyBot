const assert = require('node:assert/strict');
const { test, beforeEach } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { EventEmitter } = require('node:events');
const { MusicQueues } = require('../dist/music/queue');
const { MusicError } = require('../dist/music/errors');
const { LocalMusicSourceFactory } = require('../dist/music/localSource');
const { musicInput, videoUrl, audioUrl, parseTrack, YouTubeSource } = require('../dist/music/source');
const { OggOpusParser } = require('../dist/music/ogg');
const { capture, captureBytes, safeDiagnostic } = require('../dist/music/process');
const { LIMITS } = require('@monky/bot-sdk');
const { createMusicCommands, registerMusicCommands } = require('../dist/commands/music');
const { setCliLocale } = require('../dist/cli/i18n');

beforeEach(() => setCliLocale('en'));

const tick = () => new Promise(resolve => setImmediate(resolve));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  for (let i = 0; i < 200 && !predicate(); i++) await wait(5);
  assert.ok(predicate(), 'Condition did not become true');
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const actor = (serverId = 'a', voiceChannelId = 'voice') => ({
  botId: 'bot', serverId, voiceChannelId, textChannelId: 'text', locale: 'en',
  invocationId: `invocation-${serverId}`, invokerId: `user-${serverId}`,
  invokerSessionId: `session-${serverId}`, invokerNickname: `Requester ${serverId}`,
});
const track = id => ({ id, title: id, url: id, duration: 10, audioUrl: 'unused by fake' });
function fixture(t, options = {}) {
  const connections = new Map();
  const writes = [];
  const opens = [];
  const notices = [];
  const closed = [];
  let frameCount = options.frames ?? 1000;
  const source = {
    check: async () => {},
    resolve: async url => track(url),
    open: async (item, signal) => {
      opens.push(item.id);
      return {
        frames: (async function* () {
          for (let i = 0; i < frameCount && !signal.aborted; i++) yield Uint8Array.of(i % 256);
        })(),
        close: async () => { closed.push(item.id); },
      };
    },
    ...options.source,
  };
  const voice = {
    getVoiceConnection: id => connections.get(id),
    joinVoice: async (id, channelId) => {
      const connection = {
        channelId, humanParticipantCount: 1,
        writeOpus: async frame => { writes.push({ id, frame: frame[0], at: Date.now() }); },
        close: async () => { connections.delete(id); },
      };
      connections.set(id, connection);
      return connection;
    },
    leaveVoice: async id => { connections.delete(id); },
    ...options.voice,
  };
  const queues = new MusicQueues(source, voice, async (event, signal) => {
    notices.push(event);
    await options.notify?.(event, signal);
  }, options.grace, options.configuredGrace);
  t.after(() => queues.dispose());
  return { queues, source, voice, writes, opens, notices, closed, connections };
}

test('accepts only canonical individual YouTube URLs and bounded search text', () => {
  for (const value of [
    'https://youtu.be/abcdefghijk?t=2',
    'https://www.youtube.com/watch?v=abcdefghijk',
    'http://m.youtube.com/shorts/abcdefghijk',
    'https://youtu.be/abcdefghijk?list=RDabcdefghijk&start_radio=1',
    'https://www.youtube.com/watch?v=abcdefghijk&list=PLfixture&index=7&t=2',
    'https://youtube.com/watch?list=PLfixture&index=7&v=abcdefghijk&start_radio=1',
    'https://music.youtube.com/watch?v=abcdefghijk&list=RDabcdefghijk&si=fixture',
    'http://m.youtube.com/shorts/abcdefghijk?list=PLfixture&index=2',
    'https://www.youtube.com/embed/abcdefghijk?list=PLfixture&index=2#t=3',
  ]) {
    assert.equal(videoUrl(value), 'https://www.youtube.com/watch?v=abcdefghijk');
    assert.deepEqual(musicInput(value), { kind: 'url', value: 'https://www.youtube.com/watch?v=abcdefghijk' });
  }
  assert.equal(videoUrl('https://www.youtube.com/watch?v=x5A9Aa-WU5E&list=RDx5A9Aa-WU5E&start_radio=1'),
    'https://www.youtube.com/watch?v=x5A9Aa-WU5E');
  for (const value of ['https://youtube.com/playlist?list=abc',
    'https://spotify.com/track/foo', 'file:///etc/passwd', 'http://127.0.0.1/x', 'https://youtube.com.evil.com/watch?v=abcdefghijk',
    'https://user:pass@youtube.com/watch?v=abcdefghijk', 'https://youtube.com:444/watch?v=abcdefghijk',
    'https://youtube.com/live/abcdefghijk', 'https://youtu.be/abcdefghijk/extra', 'https://youtu.be/%61bcdefghijk',
    'https://youtube.com/playlist?list=abc&v=abcdefghijk', 'https://youtube.com/watch?list=abc&index=2',
    'https://youtu.be/?list=abc', 'https://youtube.com/watch?v=&list=abc', 'https://youtube.com/watch?v=abcdefghij&list=abc',
    'https://youtube.com/watch?v=abcdefghijkl&index=2', 'https://youtube.com/watch?v=abcdefghijk%0A&list=abc',
    'https://youtube.com/watch?v=abcdefghijk%00&list=abc', 'https://youtube.com/watch?v=abcdefghij%2F&list=abc',
    'https://youtube.com/watch?v=abcdefghijk&v=12345678901&list=abc',
    'https://youtube.com/watch?v=abcdefghijk&v=abcdefghijk',
    'https://fixture-user:fixture-password@youtube.com/watch?v=abcdefghijk&list=abc',
    'https://@youtube.com/watch?v=abcdefghijk', 'https://youtube.com:443/watch?v=abcdefghijk',
    'http://youtube.com:80/watch?v=abcdefghijk', 'https://youtube.com:/watch?v=abcdefghijk',
    'ftp://youtube.com/watch?v=abcdefghijk', '//youtube.com/watch?v=abcdefghijk',
    'https:youtube.com/watch?v=abcdefghijk', 'https:////youtube.com/watch?v=abcdefghijk',
    'https://%79outube.com/watch?v=abcdefghijk', 'https://youtube.com\\watch?v=abcdefghijk',
    'https://youtube.com/watch?v=abcde\nfghijk', 'https://you\ttube.com/watch?v=abcdefghijk']) {
    assert.throws(() => videoUrl(value), { code: 'unsupported' });
  }
  assert.deepEqual(musicInput(' ambient original '), { kind: 'search', value: 'ambient original' });
  assert.throws(() => musicInput('ytsearch999:foo'));
  assert.throws(() => musicInput('https://localhost'));
  assert.throws(() => musicInput('a'.repeat(201)));
  assert.throws(() => musicInput(''));
  assert.equal(audioUrl('https://rr1---sn-abc.googlevideo.com/videoplayback?x=1'), 'https://rr1---sn-abc.googlevideo.com/videoplayback?x=1');
  for (const value of ['http://rr1.googlevideo.com/videoplayback', 'https://googlevideo.com.evil.test/videoplayback',
    'https://localhost/videoplayback', 'https://rr1.googlevideo.com/other', 'https://a:b@rr1.googlevideo.com/videoplayback']) assert.throws(() => audioUrl(value));
});

test('metadata rejects live, excessive duration, restricted and invalid items', () => {
  const base = { id: 'abcdefghijk', title: 'Example', duration: 60, live_status: 'not_live', availability: 'public' };
  assert.equal(parseTrack(base).duration, 60);
  for (const change of [{ duration: Infinity }, { duration: 0 }, { duration: 3601 }, { is_live: true },
    { was_live: true }, { live_status: 'is_upcoming' }, { availability: 'subscriber_only' }, { age_limit: 18 },
    { id: 'abcdefghijk\n' }]) {
    assert.throws(() => parseTrack({ ...base, ...change }, true));
  }
});

test('prerequisite failure releases an unused room reservation immediately', async t => {
  const f = fixture(t, { source: { check: async () => { throw new MusicError('tools'); } } });
  await assert.rejects(f.queues.enqueue(actor(), 'first'), { code: 'tools' });
  assert.equal(f.queues.snapshot('a').channelId, null);
  f.source.check = async () => {};
  await f.queues.enqueue(actor('a', 'different-room'), 'valid');
  await until(() => f.writes.length > 0);
  assert.equal(f.queues.snapshot('a').channelId, 'different-room');
});

test('actual bot membership authorizes controls and enqueue even before this queue owns a room', async t => {
  const f = fixture(t);
  const check = t.mock.method(f.source, 'check', async () => {});
  const connection = await f.voice.joinVoice('a', 'other-voice');
  assert.throws(() => f.queues.assertControl(actor()), { code: 'room' });
  for (const command of ['pause', 'resume', 'skip', 'stop', 'leave', 'clear', 'remove']) {
    await assert.rejects(f.queues.control(actor(), command, 1), { code: 'room' });
  }
  await assert.rejects(f.queues.enqueue(actor(), 'blocked'), { code: 'room' });
  assert.doesNotThrow(() => f.queues.assertControl(actor('a', 'other-voice')));
  assert.equal(check.mock.callCount(), 0);
  assert.equal(f.queues.snapshot('a').channelId, null);
  assert.deepEqual(f.opens, []);
  assert.equal(f.connections.get('a'), connection);
});

test('a pending queue room and actual bot membership must both match after delayed resolution', async t => {
  const resolution = deferred();
  const f = fixture(t, { grace: 20, source: { resolve: () => resolution.promise } });
  const addition = f.queues.enqueue(actor(), 'pending');
  await tick();
  assert.throws(() => f.queues.assertControl(actor('a', 'other-voice')), { code: 'room' });
  const connection = await f.voice.joinVoice('a', 'other-voice');
  assert.throws(() => f.queues.assertControl(actor()), { code: 'room' });
  assert.throws(() => f.queues.assertControl(actor('a', 'other-voice')), { code: 'room' });
  resolution.resolve(track('pending'));
  await assert.rejects(addition, { code: 'room' });
  assert.equal(f.queues.snapshot('a').channelId, null);
  assert.deepEqual(f.opens, []);
  await wait(50);
  assert.equal(f.connections.get('a'), connection, 'A rejected old-room reservation must not leave the new bot room.');
});

test('membership changing before queue reservation serializes leaves no stale reservation or provider work', async t => {
  const f = fixture(t);
  const check = t.mock.method(f.source, 'check', async () => {});
  const addition = f.queues.enqueue(actor(), 'raced');
  const joining = f.voice.joinVoice('a', 'other-voice');
  await assert.rejects(addition, { code: 'room' });
  const connection = await joining;
  assert.equal(check.mock.callCount(), 0);
  assert.equal(f.queues.snapshot('a').channelId, null);
  assert.equal(f.connections.get('a'), connection);
});

test('external resolver ignores user config, uses bounded search and checks libopus before enqueue', async () => {
  const calls = [];
  const run = async (exe, args) => {
    calls.push({ exe, args });
    if (args.includes('--version')) return exe === 'node-local' ? 'v22.0.0' : '2026.01.01';
    if (args[0] === '-version') {
      assert.equal(exe, 'ffmpeg-local');
      assert.deepEqual(args, ['-version']);
      return 'ffmpeg version 7.1-fixture';
    }
    if (args.includes('-encoders')) return ' A....D libopus';
    return JSON.stringify({ entries: Array.from({ length: 10 }, (_, i) => ({ id: `abcdefghij${i}`, title: 'Result', duration: 10 })) });
  };
  const source = new YouTubeSource('yt-dlp-local', 'ffmpeg-local', run, 'node-local');
  const signal = new AbortController().signal;
  await source.check(signal);
  const versionCheck = calls.findIndex(call => call.args[0] === '-version');
  assert.ok(versionCheck >= 0 && versionCheck < calls.findIndex(call => call.args.includes('-encoders')));
  assert.equal((await source.search('name', signal)).length, 8);
  const search = calls.find(call => call.args.includes('--flat-playlist')).args;
  assert.ok(search.includes('--ignore-config'));
  assert.ok(search.includes('--flat-playlist'));
  assert.equal(search[search.indexOf('--js-runtimes') + 1], 'node:node-local');
  assert.ok(search.includes('--no-js-runtimes'));
  assert.ok(search.includes('--no-remote-components'));
  assert.ok(search.includes('--no-plugin-dirs'));
  assert.deepEqual(search.slice(-2), ['--', 'ytsearch8:name']);
  assert.equal(search.some(arg => /cookie|password|username/.test(arg)), false);
  await assert.rejects(new YouTubeSource('yt', 'ff', async () => '').check(signal), { code: 'runtime' });
  await assert.rejects(new YouTubeSource('yt', 'ff', async () => 'v20.0.0').check(signal), { code: 'runtime' });
  await assert.rejects(new YouTubeSource('yt', 'ff', async (exe) => exe === process.execPath ? 'v22.0.0' : '').check(signal), { code: 'tools' });
});

test('process runner reports absent tools, bounded output, timeout and cancellation', async () => {
  const signal = new AbortController().signal;
  await assert.rejects(capture('monky-missing-media-tool', [], signal), { code: 'tools' });
  await assert.rejects(capture(process.execPath, ['-e', "console.error('Provider denied public access');process.exitCode=1"], signal),
    { code: 'unavailable', detail: 'Provider denied public access' });
  await assert.rejects(capture(process.execPath, ['-e', "process.stdout.write('x'.repeat(1024))"], signal, 1000, 32), { code: 'unavailable' });
  await assert.rejects(capture(process.execPath, ['-e', 'setInterval(()=>{},1000)'], signal, 30), { code: 'timeout' });
  const controller = new AbortController();
  const pending = capture(process.execPath, ['-e', 'setInterval(()=>{},1000)'], controller.signal);
  controller.abort();
  await assert.rejects(pending, { code: 'cancelled' });
});

test('binary process capture preserves non-UTF8 audio and enforces its byte limit', async () => {
  const signal = new AbortController().signal;
  const bytes = await captureBytes(process.execPath,
    ['-e', 'process.stdout.write(Buffer.from([0,255,128,195,40,10]))'], signal);
  assert.deepEqual(bytes, Buffer.from([0, 255, 128, 195, 40, 10]));
  await assert.rejects(captureBytes(process.execPath,
    ['-e', 'process.stdout.write(Buffer.alloc(1024,255))'], signal, 1000, 32), { code: 'unavailable' });
});

test('media failure diagnostics are bounded and never expose signed URLs or credentials', async t => {
  const secret = 'fixture-not-a-real-secret';
  const raw = `HTTP 403 https://rr1.googlevideo.com/videoplayback?signature=${secret} password=${secret}`;
  const error = await capture(process.execPath,
    ['-e', `console.error(${JSON.stringify(raw)});process.exitCode=1`], new AbortController().signal).catch(error => error);
  assert.equal(error.code, 'unavailable');
  assert.match(error.detail, /HTTP 403/);
  assert.equal(error.detail.includes(secret), false);
  assert.equal(error.detail.includes('googlevideo.com'), false);
  assert.ok(safeDiagnostic('x'.repeat(4096)).length <= 1024);
  const logs = t.mock.method(console, 'error', () => {});
  const f = fixture(t, { source: { open: async () => { throw error; } } });
  await f.queues.enqueue(actor(), 'denied');
  await until(() => f.notices.some(notice => notice.type === 'failed'));
  assert.equal(f.notices.some(notice => notice.type === 'started'), false);
  assert.equal(logs.mock.callCount(), 1);
  const message = logs.mock.calls[0].arguments[0];
  assert.match(message, /stage=open, code=unavailable, advancedMs=0/);
  assert.match(message, /HTTP 403/);
  assert.equal(message.includes(secret), false);
});

test('a voice write failure is identified as voice, never provider success or a started track', async t => {
  const logs = t.mock.method(console, 'error', () => {});
  const f = fixture(t, { voice: {
    joinVoice: async () => {
      const connection = {
        channelId: 'voice', humanParticipantCount: 1,
        writeOpus: async () => { throw new Error('Current SRTP send failed.'); },
      };
      f.connections.set('a', connection);
      return connection;
    },
  } });
  await f.queues.enqueue(actor(), 'transport-failure');
  await until(() => f.notices.some(notice => notice.type === 'failed'));
  assert.equal(f.notices.some(notice => notice.type === 'started'), false);
  const failed = f.notices.find(notice => notice.type === 'failed');
  assert.equal(failed.error.code, 'voice_runtime');
  assert.match(failed.error.detail, /SRTP/);
  assert.match(logs.mock.calls[0].arguments[0], /stage=write, code=voice_runtime, advancedMs=0/);
});

test('queue explicitly enables silent persistent recovery without retaining command cancellation', async t => {
  const f = fixture(t, { source: {
    open: async (_track, signal, options) => {
      assert.deepEqual(options, { mode: 'persistent', progress: 'playback' });
      return {
        recoveryMode: 'persistent',
        frames: (async function* () {
          yield Uint8Array.of(11);
          await wait(40);
          assert.equal(signal.aborted, false);
          yield Uint8Array.of(22);
        })(),
        close: async () => {},
      };
    },
  } });
  const invocation = new AbortController();
  await f.queues.enqueue(actor(), 'recoverable', invocation.signal);
  invocation.abort();
  await until(() => f.notices.some(notice => notice.type === 'ended'));
  assert.deepEqual(f.writes.map(write => write.frame), [11, 22]);
  assert.deepEqual(f.notices.map(notice => notice.type), ['loading', 'started', 'ended']);
});

test('per-item sources retain requester identity and outlive the command signal', async t => {
  const command = new AbortController();
  const frame = deferred();
  const connections = new Map();
  const bindings = [];
  const releases = [];
  let sourceSignal, playbackSignal;
  const factory = {
    bind: async (requester, url, signal) => {
      bindings.push({ requester, url });
      sourceSignal = signal;
      return {
        check: async () => {},
        resolve: async value => ({ id: value, title: value, url: value, duration: 10 }),
        open: async (_item, signal) => {
          playbackSignal = signal;
          return {
            frames: (async function* () {
              yield Uint8Array.of(1);
              await frame.promise;
            })(),
            close: async () => { frame.resolve(); },
          };
        },
        release: async () => { releases.push(url); },
      };
    },
  };
  const voice = {
    getVoiceConnection: id => connections.get(id),
    joinVoice: async (id, channelId) => {
      const connection = {
        channelId, humanParticipantCount: 1, writeOpus: async () => {}, close: async () => {},
      };
      connections.set(id, connection);
      return connection;
    },
    leaveVoice: async id => { connections.delete(id); },
  };
  const queues = new MusicQueues(factory, voice, async () => {}, 10_000);
  t.after(() => queues.dispose());
  const requester = {
    ...actor(), invokerId: 'human', invokerSessionId: 'physical-session',
    invokerNickname: 'Original requester',
  };
  const accepted = await queues.enqueue(requester, 'local-track', command.signal);
  assert.equal('audioUrl' in accepted, false);
  await until(() => playbackSignal !== undefined);
  command.abort();
  assert.equal(sourceSignal.aborted, false, 'Command completion must not revoke an accepted source context.');
  assert.equal(playbackSignal.aborted, false, 'Command completion must not stop accepted playback.');
  assert.deepEqual(releases, []);
  assert.deepEqual(bindings, [{ requester, url: 'local-track' }]);
  await queues.control(requester, 'stop');
  assert.equal(sourceSignal.aborted, true);
  assert.equal(playbackSignal.aborted, true);
  await until(() => releases.length === 1);
  assert.deepEqual(releases, ['local-track']);
});

test('requester departure defers existing source slots without blocking new valid work', async t => {
  const left = deferred();
  const finishSecond = deferred();
  const connections = new Map();
  const writes = [];
  const notices = [];
  const bindings = [];
  const releases = new Map();
  const factory = {
    bind: async (requester, url) => {
      bindings.push({ requester: requester.invokerSessionId, url });
      return {
        check: async () => {},
        resolve: async value => ({ id: value, title: value, url: value, duration: 10 }),
        open: async item => ({
          frames: (async function* () {
            yield Uint8Array.of(item.id === 'first' ? 1 : item.id === 'future' ? 2 : 3);
            if (item.id === 'first') {
              await left.promise;
              throw new MusicError('requester_left_voice');
            }
            if (item.id === 'future') await finishSecond.promise;
          })(),
          close: async () => {},
        }),
        release: async () => releases.set(url, (releases.get(url) ?? 0) + 1),
      };
    },
  };
  const voice = {
    getVoiceConnection: id => connections.get(id),
    joinVoice: async (id, channelId) => {
      const connection = {
        channelId, humanParticipantCount: 2,
        writeOpus: async frame => writes.push(frame[0]),
        close: async () => {},
      };
      connections.set(id, connection);
      return connection;
    },
    leaveVoice: async id => { connections.delete(id); },
  };
  const queues = new MusicQueues(factory, voice, async notice => { notices.push(notice); }, 10_000);
  t.after(() => { finishSecond.resolve(); return queues.dispose(); });
  const firstRequester = {
    ...actor(), invocationId: 'first-invocation', invokerId: 'first-user',
    invokerSessionId: 'first-session', invokerNickname: 'First',
  };
  const otherRequester = {
    ...actor(), invocationId: 'other-invocation', invokerId: 'other-user',
    invokerSessionId: 'other-session', invokerNickname: 'Other',
  };
  await queues.enqueue(firstRequester, 'first');
  await until(() => writes.includes(1));
  await queues.enqueue(firstRequester, 'future');
  await queues.enqueue(otherRequester, 'other');
  queues.participantsChanged('a', 'voice', 1);
  left.resolve();
  await until(() => notices.some(notice => notice.type === 'started' && notice.track.id === 'other'));
  await until(() => releases.get('other') === 1);
  assert.deepEqual(queues.snapshot('a').upcoming, [{ title: 'future', pending: false, waitingForRequester: true }]);
  const departureNotice = notices.findIndex(notice => notice.type === 'requester-left');
  const otherStarted = notices.findIndex(notice => notice.type === 'started' && notice.track.id === 'other');
  assert.ok(departureNotice >= 0 && otherStarted > departureNotice);
  assert.equal(releases.get('first'), 1);
  assert.equal(releases.has('future'), false);
  queues.assertControl(firstRequester);
  const readReplies = [];
  await createMusicCommands(queues, {}).find(command => command.name === 'queue').handler({
    serverId: 'a', channelId: 'text', locale: 'en', args: {},
    invocationId: 'read-invocation', invokerId: firstRequester.invokerId,
    invokerSessionId: firstRequester.invokerSessionId, invokerNickname: firstRequester.invokerNickname,
    invokerVoiceChannelId: 'voice', getVoiceChannel: async () => 'voice',
    signal: new AbortController().signal, reply: value => readReplies.push(value),
  });
  await tick();
  assert.equal(queues.snapshot('a').current, null, 'Read-only authorization must not reactivate held playback.');
  assert.match(readReplies.join('\n'), /future/);
  queues.assertControl({ ...firstRequester, invokerSessionId: 'replacement-session' });
  queues.participantsChanged('a', 'voice', 2);
  await tick();
  assert.equal(queues.snapshot('a').current, null, 'Another physical session must not inherit retained work.');
  queues.participantsChanged('a', 'voice', 3);
  await tick();
  assert.equal(queues.snapshot('a').current, null, 'Participant counts cannot authorize an existing retained source.');
  await queues.enqueue(firstRequester, 'new');
  await until(() => releases.get('new') === 1);
  assert.deepEqual(queues.snapshot('a').upcoming, [{ title: 'future', pending: false, waitingForRequester: true }]);
  await queues.control(firstRequester, 'remove', 1);
  assert.deepEqual(bindings, [
    { requester: 'first-session', url: 'first' },
    { requester: 'first-session', url: 'future' },
    { requester: 'other-session', url: 'other' },
    { requester: 'first-session', url: 'new' },
  ]);
  assert.deepEqual([...releases.entries()], [['first', 1], ['other', 1], ['new', 1], ['future', 1]]);
});

test('requester disconnection interrupts paused playback and preserves old source slots', async t => {
  const disconnected = new AbortController();
  const currentBlocked = deferred();
  const finishOther = deferred();
  const connections = new Map();
  const writes = [];
  const notices = [];
  const paused = [];
  const releases = new Map();
  const factory = {
    bind: async (_requester, url) => ({
      check: async () => {},
      resolve: async value => ({ id: value, title: value, url: value, duration: 10 }),
      open: async item => ({
        signal: item.id === 'current' ? disconnected.signal : undefined,
        frames: (async function* () {
          yield Uint8Array.of(item.id === 'current' ? 1 : item.id === 'future' ? 2 : 3);
          if (item.id === 'current') await currentBlocked.promise;
          if (item.id === 'other') await finishOther.promise;
        })(),
        setPaused: async value => { if (item.id === 'current') paused.push(value); },
        close: async () => { if (item.id === 'current') currentBlocked.resolve(); },
      }),
      release: async () => releases.set(url, (releases.get(url) ?? 0) + 1),
    }),
  };
  const voice = {
    getVoiceConnection: id => connections.get(id),
    joinVoice: async (id, channelId) => {
      const connection = {
        channelId, humanParticipantCount: 2,
        writeOpus: async frame => writes.push(frame[0]),
        close: async () => {},
      };
      connections.set(id, connection);
      return connection;
    },
    leaveVoice: async id => { connections.delete(id); },
  };
  const queues = new MusicQueues(factory, voice, async notice => { notices.push(notice); }, 10_000);
  t.after(() => {
    finishOther.resolve();
    currentBlocked.resolve();
    return queues.dispose();
  });
  const firstRequester = {
    ...actor(), invocationId: 'first-invocation', invokerId: 'same-user',
    invokerSessionId: 'first-session', invokerNickname: 'First',
  };
  const otherRequester = {
    ...actor(), invocationId: 'other-invocation', invokerId: 'other-user',
    invokerSessionId: 'other-session', invokerNickname: 'Other',
  };
  await queues.enqueue(firstRequester, 'current');
  await until(() => writes.includes(1));
  await queues.enqueue(firstRequester, 'future');
  await queues.enqueue(otherRequester, 'other');
  await queues.control(firstRequester, 'pause');
  queues.participantsChanged('a', 'voice', 1);
  disconnected.abort(new MusicError('requester_disconnected'));
  await until(() => notices.some(notice => notice.type === 'requester-disconnected'));
  await until(() => queues.snapshot('a').current?.id === 'other' && queues.snapshot('a').started);
  assert.deepEqual(paused, [false, true]);
  assert.deepEqual(queues.snapshot('a').upcoming, [{ title: 'future', pending: false, waitingForRequester: true }]);
  const departureNotice = notices.findIndex(notice => notice.type === 'requester-disconnected');
  const otherStarted = notices.findIndex(notice => notice.type === 'started' && notice.track.id === 'other');
  assert.ok(otherStarted > departureNotice);
  assert.equal(releases.get('current'), 1);
  assert.equal(releases.has('future'), false);

  finishOther.resolve();
  await until(() => queues.snapshot('a').current === null);
  queues.participantsChanged('a', 'voice', 2);
  await tick();
  assert.equal(queues.snapshot('a').current, null, 'A replacement device must not inherit the retained source.');
  queues.participantsChanged('a', 'voice', 3);
  await tick();
  assert.equal(queues.snapshot('a').current, null, 'Participant counts cannot revive an old socket-bound source.');
  await queues.enqueue(firstRequester, 'new');
  await until(() => releases.get('new') === 1);
  assert.deepEqual(queues.snapshot('a').upcoming, [{ title: 'future', pending: false, waitingForRequester: true }]);
  await queues.control(firstRequester, 'remove', 1);
  assert.deepEqual(writes, [1, 3, 3]);
  assert.deepEqual([...releases.entries()], [['current', 1], ['other', 1], ['new', 1], ['future', 1]]);
});

test('deferred tracks resume only after a source-bound availability check without another command', async t => {
  const left = deferred();
  const checks = [], opened = [], released = [];
  let available = false;
  const f = fixture(t, { grace: 10_000, source: {
    bind: async (_requester, url) => ({
      check: async () => {},
      checkAvailability: async () => {
        checks.push(url);
        if (!available) throw new MusicError('requester_left_voice');
      },
      resolve: async () => track(url),
      open: async () => {
        opened.push(url);
        return {
          frames: (async function* () {
            yield Uint8Array.of(1);
            if (url === 'current') { await left.promise; throw new MusicError('requester_left_voice'); }
          })(),
          close: async () => {},
        };
      },
      release: async () => { released.push(url); },
    }),
  } });
  await f.queues.enqueue(actor(), 'current');
  await until(() => f.writes.length === 1);
  await f.queues.enqueue(actor(), 'future');
  left.resolve();
  await until(() => f.queues.snapshot('a').current === null && checks.length === 1);
  assert.equal(f.queues.snapshot('a').upcoming[0].waitingForRequester, true);
  f.queues.participantsChanged('a', 'voice', 2);
  await until(() => checks.length === 2);
  assert.deepEqual(opened, ['current'], 'Another participant does not authorize the original source');
  available = true;
  f.queues.participantsChanged('a', 'voice', 3);
  await until(() => released.includes('future'));
  assert.deepEqual(opened, ['current', 'future']);
  assert.deepEqual(released, ['current', 'future']);
  assert.equal(f.notices.filter(notice => notice.type === 'requester-left').length, 1);
});

test('availability rechecks coalesce and removal cannot resurrect a source from a late positive reply', async t => {
  const left = deferred();
  const replies = [], checks = [], opened = [], released = [];
  const f = fixture(t, { grace: 10_000, source: {
    bind: async (_requester, url) => ({
      check: async () => {},
      checkAvailability: async signal => {
        const reply = deferred();
        replies.push(reply);
        checks.push({ url, signal });
        await reply.promise;
      },
      resolve: async () => track(url),
      open: async () => {
        opened.push(url);
        return {
          frames: (async function* () {
            yield Uint8Array.of(1);
            await left.promise;
            throw new MusicError('requester_left_voice');
          })(),
          close: async () => {},
        };
      },
      release: async () => { released.push(url); },
    }),
  } });
  t.after(() => { for (const reply of replies) reply.resolve(); });
  await f.queues.enqueue(actor(), 'current');
  await until(() => f.writes.length === 1);
  await f.queues.enqueue(actor(), 'first');
  await f.queues.enqueue(actor(), 'second');
  left.resolve();
  await until(() => checks.length === 1 && f.queues.snapshot('a').current === null);
  for (let event = 0; event < 20; event++) f.queues.participantsChanged('a', 'voice', 2);
  await tick();
  assert.equal(checks.length, 1, 'Membership notifications share one in-flight source check');
  await f.queues.control(actor(), 'remove', 1);
  await until(() => checks.length === 2);
  assert.equal(checks[0].signal.aborted, true);
  assert.equal(checks[1].url, 'second');
  replies[0].resolve();
  await tick();
  assert.deepEqual(opened, ['current']);
  await f.queues.control(actor(), 'clear');
  replies[1].resolve();
  await tick();
  assert.deepEqual(opened, ['current']);
  assert.deepEqual(released, ['current', 'first', 'second']);
  assert.deepEqual(f.queues.snapshot('a').upcoming, []);
});

for (const command of ['stop', 'remove', 'clear']) {
  test(`${command} never starts requester-deferred work before applying the control`, async t => {
    const left = deferred();
    const connections = new Map();
    const opens = [];
    const writes = [];
    const factory = {
      bind: async (_requester, url) => ({
        check: async () => {},
        resolve: async value => ({ id: value, title: value, url: value, duration: 10 }),
        open: async item => {
          opens.push(item.id);
          assert.equal(item.id, 'current', 'A held future item must not start before the requested control.');
          return {
            frames: (async function* () {
              yield Uint8Array.of(1);
              await left.promise;
              throw new MusicError('requester_left_voice');
            })(),
            close: async () => {},
          };
        },
        release: async () => {},
      }),
    };
    const voice = {
      getVoiceConnection: id => connections.get(id),
      joinVoice: async (id, channelId) => {
        const connection = {
          channelId, humanParticipantCount: 1,
          writeOpus: async frame => writes.push(frame[0]),
          close: async () => {},
        };
        connections.set(id, connection);
        return connection;
      },
      leaveVoice: async id => { connections.delete(id); },
    };
    const queues = new MusicQueues(factory, voice, async () => {}, 10_000);
    t.after(() => queues.dispose());
    const requester = actor();
    await queues.enqueue(requester, 'current');
    await until(() => writes.length === 1);
    await queues.enqueue(requester, 'held-one');
    await queues.enqueue(requester, 'held-two');
    left.resolve();
    await until(() => queues.snapshot('a').current === null);
    queues.assertControl(requester);
    await queues.control(requester, command, command === 'remove' ? 1 : undefined);
    assert.deepEqual(opens, ['current']);
    assert.equal(queues.snapshot('a').upcoming.length, command === 'remove' ? 1 : 0);
  });
}

test('an all-deferred queue follows idle cleanup and releases retained sources', async t => {
  const left = deferred();
  const connections = new Map();
  const releases = new Map();
  const factory = {
    bind: async (_requester, url) => ({
      check: async () => {},
      resolve: async value => ({ id: value, title: value, url: value, duration: 10 }),
      open: async item => ({
        frames: (async function* () {
          yield Uint8Array.of(1);
          if (item.id === 'current') {
            await left.promise;
            throw new MusicError('requester_left_voice');
          }
        })(),
        close: async () => {},
      }),
      release: async () => releases.set(url, (releases.get(url) ?? 0) + 1),
    }),
  };
  const voice = {
    getVoiceConnection: id => connections.get(id),
    joinVoice: async (id, channelId) => {
      const connection = {
        channelId, humanParticipantCount: 1,
        writeOpus: async () => {},
        close: async () => {},
      };
      connections.set(id, connection);
      return connection;
    },
    leaveVoice: async id => { connections.delete(id); },
  };
  const queues = new MusicQueues(factory, voice, async () => {}, 20);
  t.after(() => queues.dispose());
  await queues.enqueue(actor(), 'current');
  await until(() => queues.snapshot('a').started);
  await queues.enqueue(actor(), 'held');
  left.resolve();
  await until(() => queues.snapshot('a').channelId === null);
  assert.deepEqual([...releases.entries()], [['current', 1], ['held', 1]]);
  assert.equal(connections.has('a'), false);
});

test('queue mutations await and release each owned source context exactly once', async t => {
  const currentFrame = deferred();
  const removableRelease = deferred();
  const connections = new Map();
  const releases = new Map();
  const factory = {
    bind: async (_requester, url) => ({
      check: async () => {},
      resolve: async value => {
        if (value === 'failed') throw new MusicError('unavailable');
        return { id: value, title: value, url: value, duration: 10 };
      },
      open: async item => ({
        frames: (async function* () {
          yield Uint8Array.of(1);
          if (item.id === 'current') await currentFrame.promise;
        })(),
        close: async () => { currentFrame.resolve(); },
      }),
      release: async () => {
        releases.set(url, (releases.get(url) ?? 0) + 1);
        if (url === 'remove') await removableRelease.promise;
      },
    }),
  };
  const voice = {
    getVoiceConnection: id => connections.get(id),
    joinVoice: async (id, channelId) => {
      const connection = {
        channelId, humanParticipantCount: 1, writeOpus: async () => {}, close: async () => {},
      };
      connections.set(id, connection);
      return connection;
    },
    leaveVoice: async id => { connections.delete(id); },
  };
  const queues = new MusicQueues(factory, voice, async () => {}, 10_000);
  t.after(() => { removableRelease.resolve(); currentFrame.resolve(); return queues.dispose(); });
  await assert.rejects(queues.enqueue(actor(), 'failed'), { code: 'unavailable' });
  await queues.enqueue(actor(), 'current');
  await queues.enqueue(actor(), 'remove');
  await queues.enqueue(actor(), 'clear-one');
  let removed = false;
  const removal = queues.control(actor(), 'remove', 1).then(() => { removed = true; });
  await tick();
  assert.equal(removed, false, 'A control must wait for retained source cleanup.');
  removableRelease.resolve();
  await removal;
  await queues.control(actor(), 'clear');
  await queues.control(actor(), 'stop');
  await until(() => releases.get('current') === 1);
  assert.deepEqual([...releases.entries()], [
    ['failed', 1], ['remove', 1], ['clear-one', 1], ['current', 1],
  ]);
});

test('owned source cleanup failures are reported without blocking the next item', async t => {
  const errors = t.mock.method(console, 'error', () => {});
  const connections = new Map();
  const played = [];
  const factory = {
    bind: async (_requester, url) => ({
      check: async () => {},
      resolve: async value => ({ id: value, title: value, url: value, duration: 10 }),
      open: async item => ({
        frames: (async function* () { yield Uint8Array.of(item.id === 'broken' ? 1 : 2); })(),
        close: async () => {},
      }),
      release: async () => {
        if (url === 'broken') throw new Error('Retained context cleanup failed');
      },
    }),
  };
  const voice = {
    getVoiceConnection: id => connections.get(id),
    joinVoice: async (id, channelId) => {
      const connection = {
        channelId, humanParticipantCount: 1,
        writeOpus: async frame => { played.push(frame[0]); },
        close: async () => {},
      };
      connections.set(id, connection);
      return connection;
    },
    leaveVoice: async id => { connections.delete(id); },
  };
  const queues = new MusicQueues(factory, voice, async () => {}, 10_000);
  t.after(() => queues.dispose());
  await Promise.all([
    queues.enqueue(actor(), 'broken'),
    queues.enqueue(actor(), 'next'),
  ]);
  await until(() => played.includes(2));
  assert.deepEqual(played, [1, 2]);
  assert.equal(errors.mock.callCount(), 1);
  assert.match(errors.mock.calls[0].arguments[0], /Could not release the source context.*cleanup failed/);
});

test('recovery budget: only acknowledged voice writes advance the source recovery clock', async t => {
  const writing = deferred();
  let requested = false, advanced = 0;
  const pauses = [];
  const f = fixture(t, { source: {
    open: async (_track, signal, options) => {
      assert.deepEqual(options, { mode: 'persistent', progress: 'playback' });
      return {
        recoveryMode: 'persistent',
        frames: (async function* () { yield Uint8Array.of(1); })(),
        markFrameAdvanced: () => { assert.equal(signal.aborted, false); advanced++; },
        setPaused: value => pauses.push(value),
        close: async () => {},
      };
    },
  }, voice: {
    joinVoice: async () => {
      const connection = {
        channelId: 'voice', humanParticipantCount: 1,
        writeOpus: async () => { requested = true; await writing.promise; },
      };
      f.connections.set('a', connection);
      return connection;
    },
  } });
  await f.queues.enqueue(actor(), 'acknowledged-progress');
  await until(() => requested);
  assert.equal(advanced, 0, 'Metadata, decoded packets and a pending voice write are not played audio.');
  await f.queues.control(actor(), 'pause');
  assert.deepEqual(pauses, [false, true]);
  await f.queues.control(actor(), 'resume');
  assert.deepEqual(pauses, [false, true, false]);
  writing.resolve();
  await until(() => f.notices.some(notice => notice.type === 'ended'));
  assert.equal(advanced, 1);
});

test('persistent input waits beyond old queue deadlines and remains immediately cancellable', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let waiting = false, closed = false, signal;
  const input = deferred();
  const f = fixture(t, { source: {
    open: async (_track, receivedSignal, options) => {
      assert.deepEqual(options, { mode: 'persistent', progress: 'playback' });
      signal = receivedSignal;
      return {
        recoveryMode: 'persistent',
        frames: (async function* () {
          yield Uint8Array.of(1);
          waiting = true;
          await input.promise;
        })(),
        close: async () => { closed = true; input.resolve(); },
      };
    },
  } });
  await f.queues.enqueue(actor(), 'outage');
  for (let i = 0; i < 50 && !waiting; i++) await tick();
  assert.equal(waiting, true);
  t.mock.timers.tick(3 * 60 * 60 * 1000);
  await tick();
  assert.equal(f.queues.snapshot('a').current.id, 'outage');
  assert.deepEqual(f.notices.map(notice => notice.type), ['loading', 'started']);
  assert.equal(signal.aborted, false);
  await f.queues.control(actor(), 'stop');
  assert.equal(signal.aborted, true);
  assert.equal(closed, true);
  assert.equal(f.queues.snapshot('a').current, null);
  assert.deepEqual(f.notices.map(notice => notice.type), ['loading', 'started']);
});

test('manual pause keeps its exact position beyond the former total pause deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t);
  await f.queues.enqueue(actor(), 'long-pause');
  for (let i = 0; i < 50 && !f.writes.length; i++) await tick();
  await f.queues.control(actor(), 'pause');
  t.mock.timers.tick(1000);
  await tick();
  const position = f.queues.snapshot('a').elapsedMs;
  const writes = f.writes.length;
  t.mock.timers.tick(3 * 60 * 60 * 1000);
  await tick();
  assert.equal(f.queues.snapshot('a').current.id, 'long-pause');
  assert.equal(f.queues.snapshot('a').paused, true);
  assert.equal(f.queues.snapshot('a').elapsedMs, position);
  assert.equal(f.writes.length, writes);
  await f.queues.control(actor(), 'resume');
  await tick();
  assert.ok(f.writes.length > writes);
  assert.deepEqual(f.opens, ['long-pause']);
  assert.equal(f.notices.some(notice => notice.type === 'failed'), false);
  await f.queues.control(actor(), 'stop');
});

test('on-demand preview refreshes public audio, limits encoding to ten seconds and keeps bytes in memory', async () => {
  const calls = [];
  let resolved = 0;
  let metadata = { id: 'abcdefghijk', title: 'Original fixture', duration: 60, availability: 'public' };
  const run = async (exe, args) => {
    if (args.includes('--version')) return exe === 'node-local' ? 'v22.0.0' : '2026.01.01';
    if (args[0] === '-version') {
      assert.equal(exe, 'ff-local');
      assert.deepEqual(args, ['-version']);
      return 'ffmpeg version 7.1-fixture';
    }
    if (args.includes('-encoders')) return ' A....D libopus';
    assert.equal(args.at(-1), 'https://www.youtube.com/watch?v=abcdefghijk');
    return JSON.stringify({ ...metadata, url: `https://rr1.googlevideo.com/videoplayback?signature=${++resolved}` });
  };
  const expected = Buffer.concat([...headers(), ...Array.from({ length: 500 }, (_, index) =>
    page(index + 2, index === 499 ? 4 : 0, [3], Buffer.from([0xf8, 0xff, 0xfe])))]);
  let result = expected;
  const source = new YouTubeSource('yt-local', 'ff-local', run, 'node-local',
    async (...args) => { calls.push(args); return result; });
  const signal = new AbortController().signal;
  for (let index = 1; index <= 2; index++) {
    assert.deepEqual(await source.preview('https://youtu.be/abcdefghijk', signal), expected);
    const [executable, args, receivedSignal, timeout, limit, options] = calls.at(-1);
    assert.equal(executable, 'ff-local');
    assert.equal(receivedSignal, signal);
    assert.equal(timeout, 20_000);
    assert.equal(limit, LIMITS.MAX_BOT_AUDIO_PREVIEW_BYTES);
    assert.deepEqual(options, { rejectStderr: true });
    assert.ok(args.includes('-xerror'));
    assert.equal(args[args.indexOf('-t') + 1], '10');
    assert.equal(args[args.indexOf('-frame_duration') + 1], '20');
    assert.equal(args[args.indexOf('-i') + 1], `https://rr1.googlevideo.com/videoplayback?signature=${index}`);
    assert.equal(args.at(-1), 'pipe:1');
  }
  metadata = { ...metadata, availability: 'private' };
  await assert.rejects(source.preview('https://youtu.be/abcdefghijk', signal), { code: 'unsupported' });
  assert.equal(calls.length, 2);
  await assert.rejects(source.preview('http://localhost/private', signal), { code: 'unsupported' });
  assert.equal(calls.length, 2);
  metadata = { ...metadata, availability: 'public' };
  result = Buffer.alloc(0);
  await assert.rejects(source.preview('https://youtu.be/abcdefghijk', signal), { code: 'unavailable' });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(source.preview('https://youtu.be/abcdefghijk', controller.signal), { code: 'cancelled' });
  assert.equal(calls.length, 3);
});

test('search filters unsupported media but does not hide malformed provider responses', async () => {
  const valid = { id: 'abcdefghijk', title: 'Allowed', duration: 10 };
  let entries = [valid, { ...valid, id: 'abcdefghijl', is_live: true },
    { ...valid, id: 'abcdefghijm', duration: 3601 }, valid];
  const source = new YouTubeSource('yt', 'ff', async () => JSON.stringify({ entries }));
  const signal = new AbortController().signal;
  assert.deepEqual(await source.search('example', signal), [parseTrack(valid)]);
  entries = [valid, null];
  await assert.rejects(source.search('example', signal), { code: 'unavailable' });
});

test('cancelling an extractor also terminates its JavaScript runtime child', async t => {
  const directory = path.resolve(__dirname, '..', 'release', `music-process-${randomUUID()}`);
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'pid');
  const controller = new AbortController();
  let childPid;
  const running = () => {
    if (!childPid) return false;
    try { process.kill(childPid, 0); return true; } catch { return false; }
  };
  t.after(() => {
    controller.abort();
    if (running()) process.kill(childPid, 'SIGKILL');
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const script = `const {spawn}=require('node:child_process'); const fs=require('node:fs');
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
    fs.writeFileSync(${JSON.stringify(file)},String(child.pid));setInterval(()=>{},1000);`;
  const pending = capture(process.execPath, ['-e', script], controller.signal, 5000);
  const rejected = assert.rejects(pending, { code: 'cancelled' });
  await until(() => fs.existsSync(file));
  childPid = Number(fs.readFileSync(file, 'utf8'));
  assert.ok(running());
  controller.abort();
  await rejected;
  await until(() => !running());
});

function page(sequence, flags, laces, payload) {
  const header = Buffer.alloc(27 + laces.length);
  header.write('OggS');
  header[5] = flags;
  header.writeUInt32LE(7, 14);
  header.writeUInt32LE(sequence, 18);
  header[26] = laces.length;
  header.set(laces, 27);
  return Buffer.concat([header, payload]);
}
function headers() {
  const head = Buffer.alloc(19); head.write('OpusHead'); head[8] = 1;
  const tags = Buffer.alloc(16); tags.write('OpusTags');
  return [page(0, 2, [19], head), page(1, 0, [16], tags)];
}

test('Ogg parser handles arbitrarily split pages, continued packets, and skips headers', () => {
  const packet = Buffer.alloc(300, 248);
  const bytes = Buffer.concat([...headers(), page(2, 0, [255], packet.subarray(0, 255)), page(3, 5, [45], packet.subarray(255))]);
  for (const chunkSize of [1, 7, 128, bytes.length]) {
    const parser = new OggOpusParser();
    const result = [];
    for (let offset = 0; offset < bytes.length; offset += chunkSize) result.push(...parser.push(bytes.subarray(offset, offset + chunkSize)));
    parser.finish();
    assert.deepEqual(result, [packet]);
  }
});

test('Ogg parser rejects corrupt headers, unbounded buffers, missing continuations and truncated EOF', () => {
  assert.throws(() => new OggOpusParser().push(Buffer.alloc(400_000)));
  assert.throws(() => new OggOpusParser().push(Buffer.alloc(30)));
  assert.throws(() => new OggOpusParser().finish());
  const parser = new OggOpusParser();
  for (const header of headers()) parser.push(header);
  parser.push(page(2, 0, [255], Buffer.alloc(255)));
  assert.throws(() => parser.push(page(3, 4, [1], Buffer.alloc(1))));
  const wrongDuration = new OggOpusParser();
  for (const header of headers()) wrongDuration.push(header);
  assert.throws(() => wrongDuration.push(page(2, 4, [1], Buffer.from([0]))));
});

test('out-of-order resolution preserves enqueue reservation order', async t => {
  const first = deferred(), second = deferred();
  const f = fixture(t, { source: { resolve: async url => url === 'first' ? first.promise : second.promise } });
  const a = f.queues.enqueue(actor(), 'first');
  const b = f.queues.enqueue(actor(), 'second');
  await tick();
  second.resolve(track('second'));
  await b;
  assert.equal(f.opens.length, 0);
  first.resolve(track('first'));
  await a;
  await until(() => f.writes.length > 0);
  assert.deepEqual(f.opens, ['first']);
  assert.equal(f.queues.snapshot('a').upcoming[0].title, 'second');
});

test('stop cancels pending resolve and prevents stale tracks from starting', async t => {
  const pending = deferred();
  const f = fixture(t, { source: { resolve: () => pending.promise } });
  const addition = f.queues.enqueue(actor(), 'stale');
  await tick();
  await f.queues.control(actor(), 'stop');
  pending.resolve(track('stale'));
  await assert.rejects(addition, { code: 'cancelled' });
  assert.equal(f.opens.length, 0);
  assert.deepEqual(f.queues.snapshot('a').upcoming, []);
});

test('room authorization is checked again after delayed resolution', async t => {
  const pending = deferred();
  let current = actor();
  const f = fixture(t, { source: { resolve: () => pending.promise } });
  const addition = f.queues.enqueue(current, 'delayed', undefined, () => current);
  await tick();
  current = actor('a', null);
  pending.resolve(track('delayed'));
  await assert.rejects(addition, { code: 'not_in_voice' });
  assert.equal(f.opens.length, 0);
  assert.equal(f.queues.snapshot('a').upcoming.length, 0);
});

test('stop remains responsive while fresh server authorization is pending and cannot accept stale results', async t => {
  const authorization = deferred();
  const f = fixture(t);
  const addition = f.queues.enqueue(actor(), 'delayed', undefined, () => authorization.promise);
  await tick();
  await f.queues.control(actor(), 'stop');
  authorization.resolve(actor());
  await assert.rejects(addition, { code: 'cancelled' });
  assert.equal(f.opens.length, 0);
});

test('initial admission carries the live invocation and enqueue waits only for admission, not playback', async t => {
  const admission = deferred();
  const f = fixture(t);
  const join = f.voice.joinVoice;
  const grants = [];
  f.voice.joinVoice = async (serverId, channelId, options) => {
    grants.push(options);
    await admission.promise;
    return join(serverId, channelId);
  };
  let accepted = false;
  const addition = f.queues.enqueue(actor(), 'first').then(item => { accepted = true; return item; });
  await tick();
  assert.deepEqual(grants, [{ invocationId: 'invocation-a' }]);
  assert.equal(accepted, false);
  assert.equal(f.writes.length, 0);
  admission.resolve();
  await addition;
  assert.equal(accepted, true);
  assert.ok(!f.closed.includes('first'), 'Handler must not own the complete playback lifetime');
  await until(() => f.writes.length > 0);
});

test('stop cancels a pending invocation-authorized admission without stale playback', async t => {
  const admission = deferred();
  const f = fixture(t);
  const join = f.voice.joinVoice;
  f.voice.joinVoice = async (serverId, channelId) => {
    await admission.promise;
    return join(serverId, channelId);
  };
  const addition = f.queues.enqueue(actor(), 'stale');
  await tick();
  await f.queues.control(actor(), 'stop');
  admission.resolve();
  await assert.rejects(addition, { code: 'cancelled' });
  assert.equal(f.opens.length, 0);
});

test('stop and renewed playback rearm idle cleanup rather than leaving stale timers', async t => {
  const f = fixture(t, { frames: 1, grace: 45 });
  await f.queues.enqueue(actor(), 'first');
  await until(() => f.closed.includes('first'));
  await f.queues.enqueue(actor(), 'second');
  await until(() => f.closed.includes('second'));
  await until(() => f.queues.snapshot('a').channelId === null);
});

test('skip aborts a blocked decoder load; next track starts without stale frames', async t => {
  const pending = deferred();
  const f = fixture(t);
  const defaultOpen = f.source.open;
  f.source.open = async (item, signal) => item.id === 'slow' ? pending.promise : defaultOpen(item, signal);
  await f.queues.enqueue(actor(), 'slow');
  await f.queues.enqueue(actor(), 'next');
  await tick();
  await f.queues.control(actor(), 'skip');
  pending.resolve({ frames: (async function* () { yield Uint8Array.of(99); })(), close: async () => {} });
  await until(() => f.writes.length > 0);
  assert.equal(f.writes.some(item => item.frame === 99), false);
  assert.deepEqual(f.opens, ['next']);
});

test('pause retains decoder position; resume does not reopen or restart and uses paced frames', async t => {
  const f = fixture(t);
  await f.queues.enqueue(actor(), 'one');
  await until(() => f.writes.length >= 3);
  await f.queues.control(actor(), 'pause');
  const count = f.writes.length;
  const elapsed = f.queues.snapshot('a').elapsedMs;
  await wait(60);
  assert.equal(f.writes.length, count);
  assert.equal(f.queues.snapshot('a').elapsedMs, elapsed);
  await f.queues.control(actor(), 'resume');
  await until(() => f.writes.length > count + 1);
  assert.equal(f.writes[count].frame, count);
  assert.deepEqual(f.opens, ['one']);
  assert.ok(f.writes[2].at - f.writes[0].at >= 25);
});

test('a delegated stream cancellation interrupts a paused queue without another frame pull', async t => {
  const blocked = deferred();
  const stream = new AbortController();
  const paused = [];
  const f = fixture(t, { source: {
    open: async () => ({
      signal: stream.signal,
      frames: (async function* () {
        yield Uint8Array.of(1);
        await blocked.promise;
      })(),
      setPaused: async value => { paused.push(value); },
      close: async () => { blocked.resolve(); },
    }),
  } });
  await f.queues.enqueue(actor(), 'delegated');
  await until(() => f.writes.length === 1);
  await f.queues.control(actor(), 'pause');
  stream.abort(new MusicError('requester_left_voice'));
  await until(() => f.notices.some(notice => notice.type === 'requester-left'));
  assert.deepEqual(paused, [false, true]);
  assert.equal(f.writes.length, 1);
  assert.equal(f.queues.snapshot('a').current, null);
});

test('pause, skip, stop and EOF clear outbound speaking without restarting paused audio', async t => {
  const f = fixture(t);
  const join = f.voice.joinVoice;
  let stopped = 0;
  f.voice.joinVoice = async (...args) => {
    const connection = await join(...args);
    connection.stopSpeaking = () => { stopped++; };
    return connection;
  };
  await f.queues.enqueue(actor(), 'first');
  await f.queues.enqueue(actor(), 'second');
  await until(() => f.writes.length >= 2);
  await f.queues.control(actor(), 'pause');
  assert.equal(stopped, 1);
  const count = f.writes.length;
  await wait(40);
  assert.equal(f.writes.length, count);
  await f.queues.control(actor(), 'resume');
  await until(() => f.writes.length > count);
  assert.equal(stopped, 1);
  await f.queues.control(actor(), 'clear');
  assert.equal(stopped, 1);
  await f.queues.enqueue(actor(), 'second');
  await f.queues.control(actor(), 'skip');
  assert.ok(stopped >= 2);
  await until(() => f.queues.snapshot('a').current?.id === 'second' && f.queues.snapshot('a').started);
  const beforeStop = stopped;
  await f.queues.control(actor(), 'stop');
  assert.ok(stopped > beforeStop);
  await until(() => f.closed.includes('second'));
  assert.deepEqual(f.opens, ['first', 'second']);
  f.source.open = async () => ({
    frames: (async function* () { yield Uint8Array.from([0xf8, 0xff, 0xfe]); })(),
    close: async () => { f.closed.push('last'); },
  });
  const beforeEof = stopped;
  await f.queues.enqueue(actor(), 'last');
  await until(() => f.closed.includes('last'));
  assert.ok(stopped > beforeEof);
});

test('pacing compensates Windows timer rounding instead of accumulating it on every packet', async t => {
  let now = 0;
  const sent = [];
  const f = fixture(t, { frames: 3001, voice: {
    joinVoice: async () => {
      const connection = {
        channelId: 'voice', humanParticipantCount: 1,
        writeOpus: async () => { sent.push(now); },
      };
      f.connections.set('a', connection);
      return connection;
    },
  } });
  t.mock.method(performance, 'now', () => now);
  // Model the measured ~15.6 ms Windows wake-up quantum without a minute-long unit test.
  t.mock.method(f.queues, 'sleep', async ms => { now += Math.ceil(ms / 15.625) * 15.625; });
  await f.queues.enqueue(actor(), 'clock');
  await until(() => f.closed.includes('clock'));
  assert.equal(sent.length, 3001);
  const drift = sent.at(-1) - sent[0] - (sent.length - 1) * 20;
  assert.ok(drift >= 0 && drift < 16, `Clock accumulated ${drift} ms of timer rounding`);
  assert.ok(sent.slice(1).every((at, i) => at - sent[i] >= 15), 'Do not burst packets to compensate ordinary rounding.');
});

test('pacing rebases after a stalled source instead of bursting its whole backlog', async t => {
  let now = 0;
  const sent = [];
  const f = fixture(t, { frames: 12, voice: {
    joinVoice: async () => {
      const connection = {
        channelId: 'voice', humanParticipantCount: 1,
        writeOpus: async () => {
          sent.push(now);
          if (sent.length === 4) now += 2000;
        },
      };
      f.connections.set('a', connection);
      return connection;
    },
  } });
  t.mock.method(performance, 'now', () => now);
  t.mock.method(f.queues, 'sleep', async ms => { now += ms; });
  await f.queues.enqueue(actor(), 'stall');
  await until(() => f.closed.includes('stall'));
  assert.equal(sent.length, 12);
  assert.deepEqual(sent.slice(5).map((at, i) => at - sent[i + 4]), Array(7).fill(20));
  assert.equal(f.notices.filter(notice => notice.type === 'failed').length, 0);
});

test('the playback clock starts with the first decoded frame, not before decoder startup', async t => {
  let now = 0;
  const sent = [];
  const f = fixture(t, { source: {
    open: async () => ({
      frames: (async function* () {
        now += 75;
        for (let i = 0; i < 4; i++) yield Uint8Array.of(i);
      })(),
      close: async () => { f.closed.push('startup'); },
    }),
  }, voice: {
    joinVoice: async () => {
      const connection = { channelId: 'voice', humanParticipantCount: 1, writeOpus: async () => { sent.push(now); } };
      f.connections.set('a', connection);
      return connection;
    },
  } });
  t.mock.method(performance, 'now', () => now);
  t.mock.method(f.queues, 'sleep', async ms => { now += ms; });
  await f.queues.enqueue(actor(), 'startup');
  await until(() => f.closed.includes('startup'));
  assert.deepEqual(sent, [75, 95, 115, 135]);
});

test('first track and skip report loading before source startup and only report playing after a frame advances', async t => {
  const pending = new Map(['first', 'next'].map(id => [id, deferred()]));
  t.after(() => { for (const wait of pending.values()) wait.resolve(); });
  const f = fixture(t, { source: {
    resolvesOnOpen: true,
    open: async (item, signal) => {
      f.opens.push(item.id);
      await pending.get(item.id).promise;
      return {
        frames: (async function* () { while (!signal.aborted) yield Uint8Array.of(1); })(),
        close: async () => { f.closed.push(item.id); },
      };
    },
  } });
  await f.queues.enqueue(actor(), 'first');
  await until(() => f.opens.includes('first'));
  assert.deepEqual(f.notices.map(notice => notice.type), ['loading']);
  assert.equal(f.writes.length, 0);
  assert.equal(f.queues.snapshot('a').started, false);
  pending.get('first').resolve();
  await until(() => f.queues.snapshot('a').started);
  await f.queues.enqueue(actor(), 'next');
  await f.queues.control(actor(), 'skip');
  await until(() => f.opens.includes('next'));
  assert.equal(f.notices.filter(notice => notice.type === 'loading' && notice.track.id === 'next').length, 1);
  assert.equal(f.notices.some(notice => notice.type === 'started' && notice.track.id === 'next'), false);
  pending.get('next').resolve();
  await until(() => f.notices.some(notice => notice.type === 'started' && notice.track.id === 'next'));
  assert.deepEqual(f.notices.map(notice => [notice.type, notice.track?.id]),
    [['loading', 'first'], ['started', 'first'], ['loading', 'next'], ['started', 'next']]);
});

test('a slow loading notification cannot delay audio, and legacy sources still refresh their media URL', async t => {
  const message = deferred();
  const resolved = [];
  const f = fixture(t, { frames: 2, source: {
    resolve: async url => { resolved.push(url); return track(url); },
  }, notify: async event => { if (event.type === 'loading') await message.promise; } });
  t.after(() => message.resolve());
  await f.queues.enqueue(actor(), 'first');
  await until(() => f.writes.length === 2);
  assert.deepEqual(resolved, ['first', 'first']);
  assert.equal(f.notices.filter(notice => notice.type === 'loading').length, 1);
  assert.equal(f.notices.filter(notice => notice.type === 'started').length, 1);
});

test('EOF advances and skipped decoder failures remain local when the next track plays', async t => {
  const logs = t.mock.method(console, 'error', () => {});
  const f = fixture(t, { frames: 2 });
  const open = f.source.open;
  f.source.open = async (item, signal) => {
    if (item.id === 'broken') throw new MusicError('unavailable');
    return open(item, signal);
  };
  await Promise.all(['first', 'broken', 'last'].map(id => f.queues.enqueue(actor(), id)));
  await until(() => f.closed.includes('last'));
  assert.deepEqual(f.opens, ['first', 'last']);
  assert.equal(f.notices.filter(n => n.type === 'failed').length, 0);
  assert.equal(logs.mock.callCount(), 1);
  assert.equal(f.queues.snapshot('a').current, null);
});

test('audio cleanup failures are reported without wedging the remaining queue', async t => {
  const errors = t.mock.method(console, 'error', () => {});
  const f = fixture(t, { frames: 1 });
  const open = f.source.open;
  f.source.open = async (item, signal) => {
    const stream = await open(item, signal);
    return {
      frames: stream.frames,
      close: async () => {
        await stream.close();
        if (item.id === 'broken-close') throw new Error('Cleanup failed');
      },
    };
  };
  await Promise.all(['broken-close', 'last'].map(id => f.queues.enqueue(actor(), id)));
  await until(() => f.closed.includes('last'));
  assert.equal(errors.mock.callCount(), 1);
  assert.deepEqual(errors.mock.calls[0].arguments, ['[music] Could not close the audio stream. Cleanup failed']);
  assert.deepEqual(f.opens, ['broken-close', 'last']);
});

test('server isolation, same-room controls, upcoming removal and clear semantics', async t => {
  const f = fixture(t);
  await f.queues.enqueue(actor(), 'one');
  await f.queues.enqueue(actor('b', 'elsewhere'), 'two');
  await f.queues.enqueue(actor(), 'three');
  await f.queues.enqueue(actor(), 'four');
  await until(() => f.writes.some(item => item.id === 'b'));
  await assert.rejects(f.queues.control(actor('a', 'other-room'), 'stop'), { code: 'room' });
  await assert.rejects(f.queues.enqueue(actor('a', null), 'no'), { code: 'not_in_voice' });
  await assert.rejects(f.queues.control(actor(), 'remove', 0), { code: 'position' });
  await f.queues.control(actor(), 'remove', 1);
  assert.equal(f.queues.snapshot('a').upcoming[0].title, 'four');
  await f.queues.control(actor(), 'clear');
  assert.equal(f.queues.snapshot('a').current.id, 'one');
  assert.equal(f.queues.snapshot('a').upcoming.length, 0);
  await f.queues.control(actor(), 'leave');
  assert.equal(f.connections.has('a'), false);
  assert.equal(f.queues.snapshot('b').current.id, 'two');
});

test('accepted playback outlives invocation abort; empty-room grace cancels everything', async t => {
  const f = fixture(t, { grace: 35 });
  const invocation = new AbortController();
  await f.queues.enqueue(actor(), 'one', invocation.signal);
  invocation.abort();
  await until(() => f.writes.length > 0);
  f.queues.participantsChanged('a', 'voice', 0);
  await wait(10);
  f.queues.participantsChanged('a', 'voice', 1);
  await wait(40);
  assert.ok(f.queues.snapshot('a').current);
  f.queues.participantsChanged('a', 'voice', 0);
  await until(() => f.queues.snapshot('a').channelId === null);
  assert.equal(f.connections.has('a'), false);
});

for (const configured of [undefined, 1000, 600000]) {
  const grace = configured ?? 60000;
  test(`empty-room grace ${configured === undefined ? 'defaults to 60s' : `${grace}ms`} cancels at return and restarts from the next departure`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fixture(t, { grace: configured });
    await f.queues.enqueue(actor(), 'playing');
    await f.queues.control(actor(), 'pause');
    await tick();
    const setTimeout = global.setTimeout, callbacks = [];
    t.mock.method(global, 'setTimeout', (callback, delay, ...args) => {
      if (delay === grace) callbacks.push(callback);
      return setTimeout(callback, delay, ...args);
    });
    const participants = count => {
      f.connections.get('a').humanParticipantCount = count;
      f.queues.participantsChanged('a', 'voice', count);
    };
    participants(0);
    t.mock.timers.tick(grace - 1);
    await tick();
    assert.ok(f.connections.has('a'));
    participants(1);
    t.mock.timers.tick(2);
    await tick();
    assert.ok(f.connections.has('a'), 'Returning just before expiry cancels the pending departure.');
    participants(0);
    callbacks[0]();
    await tick();
    assert.ok(f.connections.has('a'), 'A retired deadline must not shorten the new empty-room grace.');
    t.mock.timers.tick(grace - 1);
    await tick();
    assert.ok(f.connections.has('a'));
    t.mock.timers.tick(1);
    await tick();
    assert.equal(f.connections.has('a'), false);
    assert.equal(f.queues.snapshot('a').channelId, null);
    assert.equal(f.notices.some(notice => notice.type === 'failed'), false);
  });
}

for (const [configured, grace] of [[undefined, 60000], ['1', 1000], ['600', 600000]]) {
  test(`registered music seeds the bot setting from MONKY_MUSIC_GRACE_SECONDS=${configured ?? '<default>'}`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const previous = process.env.MONKY_MUSIC_GRACE_SECONDS;
    if (configured === undefined) delete process.env.MONKY_MUSIC_GRACE_SECONDS;
    else process.env.MONKY_MUSIC_GRACE_SECONDS = configured;
    t.mock.method(LocalMusicSourceFactory.prototype, 'bind', async () => ({
      check: async () => {},
      resolve: async () => ({
        id: 'abcdefghijk', title: 'Generated fixture', url: 'https://www.youtube.com/watch?v=abcdefghijk', duration: 1,
      }),
      open: async () => ({
        frames: (async function* () { yield Uint8Array.from([0xf8, 0xff, 0xfe]); })(), close: async () => {},
      }),
    }));
    const commands = new Map(), replies = [];
    let connection;
    let settings;
    const bot = Object.assign(new EventEmitter(), {
      command: command => { commands.set(command.name, command); },
      settings: definition => {
        assert.equal(definition.server.fields[0].name, 'music_idle_seconds');
        assert.equal(definition.server.fields[0].defaultValue, grace / 1000);
        settings = { schemaRevision: 1, revision: 0, values: { music_idle_seconds: grace / 1000 } };
      },
      getServerSettings: () => settings,
      onSettingsChanged: listener => {
        bot.on('settingsChanged', listener);
        return () => bot.off('settingsChanged', listener);
      },
      sendMessage: async () => {},
      getVoiceConnection: () => connection,
      joinVoice: async (_serverId, channelId) => (connection = { channelId, humanParticipantCount: 1, writeOpus: async () => {} }),
      leaveVoice: async () => { connection = undefined; },
    });
    let dispose;
    try {
      dispose = registerMusicCommands(bot);
      await commands.get('play').handler({
        serverId: 'a', channelId: 'text', locale: 'en', invocationId: 'configured',
        args: { busca: 'https://youtu.be/abcdefghijk' }, signal: new AbortController().signal,
        getVoiceChannel: async () => 'voice', reply: message => { replies.push(message); },
      });
      await tick();
      assert.ok(connection);
      assert.match(replies[0], /Track received/);
      assert.match(replies.at(-1), /Added to queue/);
      t.mock.timers.tick(grace - 1);
      await tick();
      assert.ok(connection);
      t.mock.timers.tick(1);
      await tick();
      assert.equal(connection, undefined);
    } finally {
      await dispose?.();
      if (previous === undefined) delete process.env.MONKY_MUSIC_GRACE_SECONDS;
      else process.env.MONKY_MUSIC_GRACE_SECONDS = previous;
    }
  });
}

test('registered music rejects invalid grace configuration rather than departing immediately', () => {
  const previous = process.env.MONKY_MUSIC_GRACE_SECONDS;
  try {
    for (const value of ['', '0', '-1', '601', '1.5', '1e2', 'NaN']) {
      process.env.MONKY_MUSIC_GRACE_SECONDS = value;
      assert.throws(() => registerMusicCommands({}), /whole number from 1 to 600/);
    }
  } finally {
    if (previous === undefined) delete process.env.MONKY_MUSIC_GRACE_SECONDS;
    else process.env.MONKY_MUSIC_GRACE_SECONDS = previous;
  }
});

test('queue completion is announced once before idle departure and not for an explicit stop', async t => {
  const f = fixture(t, { frames: 1, grace: 10000 });
  await f.queues.enqueue(actor(), 'one');
  await until(() => f.notices.some(notice => notice.type === 'ended'));
  assert.ok(f.connections.has('a'));
  assert.equal(f.notices.filter(notice => notice.type === 'ended').length, 1);
  f.queues.refreshGracePeriod('a');
  await tick();
  assert.equal(f.notices.filter(notice => notice.type === 'ended').length, 1);
  const live = fixture(t, { frames: 1000, grace: 10000 });
  await live.queues.enqueue(actor(), 'live');
  await until(() => live.writes.length > 0);
  await live.queues.control(actor(), 'stop');
  await until(() => live.queues.snapshot('a').current === null);
  assert.equal(live.notices.some(notice => notice.type === 'ended'), false);
});

test('changing the idle setting uses elapsed inactivity instead of restarting the whole timeout', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 0, grace = 60000;
  t.mock.method(performance, 'now', () => now);
  const advance = async milliseconds => { now += milliseconds; t.mock.timers.tick(milliseconds); await tick(); };
  const f = fixture(t, { frames: 1, configuredGrace: () => grace });
  await f.queues.enqueue(actor(), 'one');
  await tick();
  assert.ok(f.notices.some(notice => notice.type === 'ended'));
  await advance(20000);
  grace = 45000;
  f.queues.refreshGracePeriod('a');
  await advance(24999);
  assert.ok(f.connections.has('a'));
  await advance(1);
  assert.equal(f.connections.has('a'), false);
  assert.equal(f.notices.filter(notice => notice.type === 'ended').length, 1);
});

test('changing the empty-room setting preserves its own deadline and return cancellation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let now = 0, grace = 60000;
  t.mock.method(performance, 'now', () => now);
  const advance = async milliseconds => { now += milliseconds; t.mock.timers.tick(milliseconds); await tick(); };
  const f = fixture(t, { frames: 1000, configuredGrace: () => grace });
  await f.queues.enqueue(actor(), 'one');
  await tick();
  await f.queues.control(actor(), 'pause');
  f.queues.participantsChanged('a', 'voice', 0);
  await advance(20000);
  grace = 30000;
  f.queues.refreshGracePeriod('a');
  await advance(9999);
  f.queues.participantsChanged('a', 'voice', 1);
  await advance(1);
  assert.ok(f.connections.has('a'));
  f.queues.participantsChanged('a', 'voice', 0);
  await advance(30000);
  assert.equal(f.connections.has('a'), false);
});

test('runtime diagnostics are deduplicated without hiding a later confirmed playback stop', async t => {
  const logs = t.mock.method(console, 'error', () => {});
  const f = fixture(t, { grace: 10000 });
  await f.queues.enqueue(actor(), 'one');
  await until(() => f.writes.length > 0);
  const error = new Error('A media operation failed');
  await f.queues.reportRuntimeError('a', error);
  await f.queues.reportRuntimeError('a', error);
  await f.queues.reportRuntimeError('a', new Error('A different media operation failed'));
  const errors = f.notices.filter(notice => notice.type === 'runtime-error');
  assert.equal(errors.length, 0);
  assert.equal(logs.mock.callCount(), 2);
  await f.queues.disconnect('a', error);
  await f.queues.disconnect('a', error);
  const stopped = f.notices.filter(notice => notice.type === 'failed');
  assert.equal(stopped.length, 1);
  assert.deepEqual(stopped[0].actor, actor());
  assert.equal(f.notices.some(notice => notice.type === 'ended'), false);
});

test('missing voice at playback start reports one stop even without a connection to arm idle cleanup', async t => {
  t.mock.method(console, 'error', () => {});
  let resolutions = 0;
  const f = fixture(t, { source: {
    resolve: async url => {
      if (++resolutions === 2) f.connections.delete('a');
      return track(url);
    },
  } });
  await f.queues.enqueue(actor(), 'no-transport');
  await until(() => f.notices.some(notice => notice.type === 'failed'));
  assert.equal(f.queues.snapshot('a').channelId, null);
  assert.equal(f.notices.filter(notice => notice.type === 'failed').length, 1);
  assert.equal(f.notices.some(notice => notice.type === 'ended'), false);
});

test('idle grace disconnects and queue limit includes unresolved reservations', async t => {
  const f = fixture(t, { frames: 1, grace: 20 });
  await f.queues.enqueue(actor(), 'one');
  await until(() => f.queues.snapshot('a').channelId === null);
  const gate = deferred();
  f.source.resolve = () => gate.promise;
  const queued = Array.from({ length: 50 }, () => f.queues.enqueue(actor(), 'pending').catch(error => error));
  await tick();
  await assert.rejects(f.queues.enqueue(actor(), 'overflow'), { code: 'full' });
  await f.queues.control(actor(), 'stop');
  gate.resolve(track('pending'));
  const results = await Promise.all(queued);
  assert.ok(results.every(result => result.code === 'cancelled'));
});

for (const reason of ['idle', 'empty']) {
  test(`${reason}-room automatic departure reports teardown failures`, async t => {
    const errors = t.mock.method(console, 'error', () => {});
    const f = fixture(t, { frames: reason === 'idle' ? 1 : 1000, grace: 20 });
    const leave = f.voice.leaveVoice;
    f.voice.leaveVoice = async serverId => {
      await leave(serverId);
      throw new Error('Departure failed');
    };
    await f.queues.enqueue(actor(), 'one');
    await until(() => f.writes.length > 0);
    if (reason === 'empty') f.queues.participantsChanged('a', 'voice', 0);
    await until(() => errors.mock.callCount() === 1);
    assert.deepEqual(errors.mock.calls[0].arguments, [`[music] Could not leave an ${reason} voice room.`]);
    assert.equal(f.queues.snapshot('a').channelId, null);
    assert.equal(f.connections.has('a'), false);
    assert.equal(f.notices.some(notice => notice.type === 'runtime-error'), false,
      'A cleanup diagnostic after voice was released does not require a shared stopping error.');
  });
}

test('a genuinely stuck automatic departure is announced and manual leave can retry after queue cleanup', async t => {
  t.mock.method(console, 'error', () => {});
  const f = fixture(t, { frames: 1, grace: 20 });
  const leave = f.voice.leaveVoice;
  f.voice.leaveVoice = async () => { throw new Error('The current voice connection could not close.'); };
  await f.queues.enqueue(actor(), 'one');
  await until(() => f.notices.some(notice => notice.type === 'runtime-error'));
  assert.ok(f.connections.has('a'));
  assert.equal(f.queues.snapshot('a').channelId, null);
  assert.equal(f.notices.filter(notice => notice.type === 'runtime-error').length, 1);
  f.voice.leaveVoice = leave;
  await f.queues.control(actor(), 'leave');
  assert.equal(f.connections.has('a'), false);
});
