const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { performance } = require('node:perf_hooks');
const path = require('node:path');
const { test } = require('node:test');
const { OggOpusParser } = require('../dist/music/ogg');
const { MusicQueues } = require('../dist/music/queue');
const { YouTubeSource, audioUrl } = require('../dist/music/source');
const { createPersistentInput } = require('../dist/music/persistent-http');
const { captureBytes } = require('../dist/music/process');
const { wave, server, send } = require('./fixtures/music-media.cjs');
const sdkEntry = require.resolve('@monky/bot-sdk');
const fromSdk = createRequire(sdkEntry);
const { RTCPeerConnection } = fromSdk('werift');
const { MessageType } = require('@monky/bot-sdk');
const { OpusPeer, opusCodec } = require(path.join(path.dirname(sdkEntry), 'voice', 'OpusPeer.js'));
const { BotVoiceConnection } = require(path.join(path.dirname(sdkEntry), 'voice', 'BotVoiceConnection.js'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  for (let i = 0; i < 200 && !predicate(); i++) await wait(10);
  assert.ok(predicate(), 'Condition did not become true');
}

test('production preview encoding produces bounded ten-second Opus from generated audio', { timeout: 30_000 }, async t => {
  const ffmpeg = process.env.MONKY_MUSIC_FFMPEG || 'ffmpeg';
  const source = new YouTubeSource('unused-extractor', ffmpeg, async () => assert.fail('No external metadata requests'),
    process.execPath, async (exe, args, signal, timeout, limit) => {
      const input = args.indexOf('-i');
      assert.equal(args[input + 1], 'https://rr1.googlevideo.com/videoplayback');
      const generated = [...args];
      for (const option of ['-protocol_whitelist', '-rw_timeout']) {
        const index = generated.indexOf(option);
        assert.ok(index !== -1);
        generated.splice(index, 2);
      }
      generated.splice(generated.indexOf('-i'), 2, '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=30');
      return captureBytes(exe, generated, signal, timeout, limit);
    });
  source.check = async () => {};
  source.resolve = async () => ({
    id: 'abcdefghijk', title: 'Generated original sine', duration: 30,
    url: 'https://www.youtube.com/watch?v=abcdefghijk',
    audioUrl: 'https://rr1.googlevideo.com/videoplayback',
  });
  let bytes;
  try {
    bytes = await source.preview('https://youtu.be/abcdefghijk', new AbortController().signal);
  } catch (error) {
    if (error.code !== 'tools') throw error;
    t.skip('FFmpeg is not installed; set MONKY_MUSIC_FFMPEG to run generated preview encoding.');
    return;
  }
  assert.ok(bytes.length > 1000 && bytes.length <= 256 * 1024);
  assert.equal(bytes.subarray(0, 4).toString(), 'OggS');
  const parser = new OggOpusParser();
  const frames = parser.push(bytes);
  parser.finish();
  assert.ok(frames.length >= 500 && frames.length <= 502, `Expected ten seconds, got ${frames.length} packets`);
  assert.ok(frames.every(frame => frame.length > 0 && frame.length <= 1275));
});

test('real FFmpeg sine passes incremental Ogg, queue pacing and SDK ICE/DTLS/SRTP transport', { timeout: 30_000 }, async t => {
  const encoded = spawnSync(process.env.MONKY_MUSIC_FFMPEG || 'ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=0.12',
    '-ac', '2', '-ar', '48000', '-c:a', 'libopus', '-b:a', '96k',
    '-frame_duration', '20', '-f', 'ogg', '-page_duration', '20000', 'pipe:1',
  ], { shell: false, windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024 });
  if (encoded.error?.code === 'ENOENT') {
    t.skip('FFmpeg is not installed; set MONKY_MUSIC_FFMPEG to run generated-audio integration.');
    return;
  }
  if (encoded.error) throw encoded.error;
  assert.equal(encoded.status, 0, encoded.stderr.toString());
  const parser = new OggOpusParser();
  const frames = [];
  for (let offset = 0; offset < encoded.stdout.length; offset += 17) {
    frames.push(...parser.push(encoded.stdout.subarray(offset, offset + 17)));
  }
  parser.finish();
  assert.ok(frames.length >= 6 && frames.length <= 8);
  assert.ok(frames.every(frame => frame.length > 0 && frame.length <= 1275));
  const errors = [];
  const sender = new OpusPeer([], error => errors.push(error));
  const receiver = new RTCPeerConnection({ codecs: { audio: [opusCodec()] }, iceServers: [] });
  t.after(async () => { await sender.close(); await receiver.close(); });
  const received = [];
  receiver.onTrack.subscribe(track => track.onReceiveRtp.subscribe(packet => received.push(packet)));
  await sender.pc.setLocalDescription(await sender.pc.createOffer());
  await receiver.setRemoteDescription(sender.pc.localDescription);
  await receiver.setLocalDescription(await receiver.createAnswer());
  await sender.pc.setRemoteDescription(receiver.localDescription);
  await sender.ready;
  const sent = [];
  let ended = false;
  const item = { id: 'generated', title: 'Original generated sine', duration: 0.12, url: 'generated', audioUrl: '' };
  const source = {
    check: async () => {}, resolve: async () => item,
    open: async () => ({
      frames: (async function* () { yield* frames; })(),
      close: async () => { ended = true; },
    }),
  };
  const connection = { channelId: 'voice', humanParticipantCount: 1, writeOpus: async frame => {
    sent.push({ frame, at: Date.now() });
    await sender.write(frame);
  } };
  const voice = { getVoiceConnection: () => connection, joinVoice: async () => connection, leaveVoice: async () => {} };
  const queues = new MusicQueues(source, voice, async () => {});
  t.after(() => queues.dispose());
  await queues.enqueue({ serverId: 'server', voiceChannelId: 'voice', textChannelId: 'text', locale: 'en', invocationId: 'generated' }, 'generated');
  for (let i = 0; i < 100 && (!ended || received.length < frames.length); i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(ended);
  assert.deepEqual(sent.map(item => item.frame), frames);
  assert.deepEqual(received.map(packet => packet.payload), frames);
  for (let index = 1; index < received.length; index++) {
    assert.equal((received[index].header.timestamp - received[index - 1].header.timestamp) >>> 0, 960);
  }
  assert.deepEqual(errors, []);
  assert.ok(sent.at(-1).at - sent[0].at >= (frames.length - 1) * 15);
});

test('thirty seconds of production FFmpeg streaming stays on clock while bounded previews run', { timeout: 60_000 }, async t => {
  const ffmpeg = process.env.MONKY_MUSIC_FFMPEG || 'ffmpeg';
  const installed = spawnSync(ffmpeg, ['-version'], { windowsHide: true, timeout: 5000 });
  if (installed.error?.code === 'ENOENT') { t.skip('Set MONKY_MUSIC_FFMPEG to run generated streaming integration.'); return; }
  assert.ifError(installed.error);
  assert.equal(installed.status, 0);
  const childProcess = require('node:child_process');
  const spawn = childProcess.spawn;
  const children = [];
  let activePreviews = 0, peakPreviews = 0;
  t.mock.method(childProcess, 'spawn', (executable, args, options) => {
    const child = spawn(executable, args, options);
    if (executable === ffmpeg) {
      children.push(child);
      if (args[args.indexOf('-t') + 1] === '10') {
        activePreviews++;
        peakPreviews = Math.max(peakPreviews, activePreviews);
        child.once('close', () => { activePreviews--; });
      }
    }
    return child;
  });
  const item = {
    id: 'abcdefghijk', title: 'Generated original sine', duration: 30,
    url: 'https://www.youtube.com/watch?v=abcdefghijk', audioUrl: 'https://rr1.googlevideo.com/videoplayback',
  };
  const source = new YouTubeSource('unused-extractor', ffmpeg, async () => assert.fail('No external requests'));
  source.check = async () => {};
  source.resolve = async () => item;
  const bytes = wave(30);
  const fixture = await server(t, (request, response) => send(request, response, bytes));
  source.persistentInput = (url, signal) => createPersistentInput(url, signal, audioUrl, fixture.request);
  const transcodeArgs = source.transcodeArgs.bind(source);
  source.transcodeArgs = (track, seconds) => {
    const args = transcodeArgs(track, seconds);
    assert.equal(args[args.indexOf('-i') + 1], item.audioUrl);
    args[args.indexOf('-i') + 1] = fixture.url;
    args[args.indexOf('-protocol_whitelist') + 1] = 'http,tcp';
    return args;
  };
  let finish;
  const completed = new Promise(resolve => { finish = resolve; });
  let opened = 0;
  const open = source.open.bind(source);
  source.open = async (...args) => {
    opened++;
    const stream = await open(...args);
    return { ...stream, close: async () => { await stream.close(); finish(); } };
  };
  const errors = [], notices = [], received = [], sent = [];
  const sender = new OpusPeer([], error => errors.push(error));
  const receiver = new RTCPeerConnection({ codecs: { audio: [opusCodec()] }, iceServers: [] });
  receiver.onTrack.subscribe(track => track.onReceiveRtp.subscribe(packet => received.push(packet)));
  const connection = { channelId: 'voice', humanParticipantCount: 1, writeOpus: async frame => {
    sent.push({ frame, at: performance.now() });
    await sender.write(frame);
  } };
  const queues = new MusicQueues(source, {
    getVoiceConnection: () => connection, joinVoice: async () => connection, leaveVoice: () => sender.close(),
  }, async notice => { notices.push(notice); });
  t.after(async () => {
    await queues.dispose();
    await sender.close();
    await receiver.close();
    assert.ok(children.every(child => child.exitCode !== null || child.signalCode !== null), 'Every owned FFmpeg process must exit.');
  });
  await sender.pc.setLocalDescription(await sender.pc.createOffer());
  await receiver.setRemoteDescription(sender.pc.localDescription);
  await receiver.setLocalDescription(await receiver.createAnswer());
  await sender.pc.setRemoteDescription(receiver.localDescription);
  await sender.ready;
  await queues.enqueue({ serverId: 'server', voiceChannelId: 'voice', textChannelId: 'text', locale: 'en', invocationId: 'generated' }, item.url);
  await until(() => sent.length >= 5);
  const before = queues.snapshot('server').elapsedMs;
  const previews = await Promise.all(Array.from({ length: 5 }, () => source.preview(item.url, new AbortController().signal)));
  assert.ok(previews.every(bytes => bytes.length > 1000 && bytes.length <= 256 * 1024));
  assert.ok(peakPreviews >= 2 && peakPreviews <= 4);
  assert.equal(activePreviews, 0);
  assert.ok(queues.snapshot('server').elapsedMs > before, 'Preview work must not stop channel playback.');
  assert.equal(queues.snapshot('server').current.id, item.id);
  assert.equal(opened, 1, 'Preview work must not reopen or replace the playback decoder.');
  await completed;
  await until(() => received.length === sent.length);
  assert.ok(sent.length >= 1500 && sent.length <= 1502);
  assert.equal(children.length, 6);
  assert.deepEqual(received.map(packet => packet.payload), sent.map(entry => entry.frame));
  for (let i = 1; i < received.length; i++) {
    assert.equal((received[i].header.timestamp - received[i - 1].header.timestamp) >>> 0, 960);
    assert.equal((received[i].header.sequenceNumber - received[i - 1].header.sequenceNumber) & 65535, 1);
  }
  const mediaMs = (sent.length - 1) * 20;
  const wallMs = sent.at(-1).at - sent[0].at;
  const gaps = sent.slice(1).map((entry, i) => entry.at - sent[i].at).sort((a, b) => a - b);
  const p99Ms = gaps[Math.floor(gaps.length * 0.99)];
  t.diagnostic(JSON.stringify({
    frames: sent.length, mediaMs, wallMs, driftMs: wallMs - mediaMs,
    gapP50Ms: gaps[Math.floor(gaps.length / 2)], gapP99Ms: p99Ms, maxGapMs: gaps.at(-1),
    previewProcesses: 5, peakPreviews,
  }));
  assert.ok(wallMs >= mediaMs - 10 && wallMs - mediaMs < 500, `Playback drifted ${wallMs - mediaMs} ms.`);
  assert.ok(p99Ms < 60, `99th-percentile packet gap was ${p99Ms} ms.`);
  assert.equal(notices.filter(notice => notice.type === 'started').length, 1);
  assert.equal(notices.some(notice => notice.type === 'failed'), false);
  assert.deepEqual(errors, []);
});

test('real SDK moderation advances the queue silently without losing tracks or overriding manual pause', { timeout: 15_000 }, async t => {
  const self = { user: { id: 'bot', sessionId: 'bot:music', isBot: true }, voiceState: { sessionId: 'bot:music', channelId: 'voice' } };
  const human = { user: { id: 'human', sessionId: 'aaa:human' }, voiceState: { sessionId: 'aaa:human', channelId: 'voice' } };
  const receiver = new RTCPeerConnection({ codecs: { audio: [opusCodec()] }, iceServers: [], bundlePolicy: 'max-bundle' });
  const packets = [], errors = [], notices = [], activity = [], consumed = new Map();
  receiver.onTrack.subscribe(track => track.onReceiveRtp.subscribe(packet => packets.push(packet)));
  let signaling = Promise.resolve();
  const connection = new BotVoiceConnection('voice', {
    currentUser: self.user, server: { voiceMode: 'p2p' }, iceServers: [],
  }, {
    send(message) {
      if (message.type === MessageType.VOICE_JOIN) {
        assert.equal(message.payload.isMuted, false);
        assert.equal(message.payload.isDeafened, false);
        queueMicrotask(() => connection.handle({
          type: MessageType.VOICE_USER_JOINED, requestId: message.requestId,
          payload: { ...self, channelId: 'voice', sessionId: self.voiceState.sessionId, participants: [self, human] },
        }));
      } else if (message.type === MessageType.VOICE_LEAVE) {
        queueMicrotask(() => connection.handle({
          type: MessageType.VOICE_USER_LEFT, requestId: message.requestId,
          payload: { channelId: 'voice', sessionId: self.voiceState.sessionId },
        }));
      } else if (message.type === MessageType.VOICE_STATE_UPDATE) {
        activity.push(message.payload);
      } else if (message.type === MessageType.RTC_SIGNAL && message.payload.signalType === 'offer') {
        signaling = signaling.then(async () => {
          await receiver.setRemoteDescription(message.payload.sdp);
          await receiver.setLocalDescription(await receiver.createAnswer());
          connection.handle({ type: MessageType.RTC_SIGNAL, payload: {
            fromSessionId: human.voiceState.sessionId, targetSessionId: self.voiceState.sessionId,
            signalType: 'answer', sdp: receiver.localDescription,
          } });
        }).catch(error => errors.push(error));
      }
    },
    participants() {}, disconnected() {}, error(error) { errors.push(error); },
  });
  const queues = new MusicQueues({
    check: async () => {},
    resolve: async id => ({ id, title: id, url: id, audioUrl: '', duration: id === 'first' ? 1 : 20 }),
    open: async (track, signal) => ({
      frames: (async function* () {
        for (let i = 0; i < (track.id === 'first' ? 50 : 1000) && !signal.aborted; i++) {
          consumed.set(track.id, i + 1);
          yield Uint8Array.from([0xf8, 0xff, 0xfe]);
        }
      })(),
      close: async () => {},
    }),
  }, {
    getVoiceConnection: () => connection.isClosed ? undefined : connection,
    joinVoice: async () => { await connection.join(); return connection; },
    leaveVoice: () => connection.close(),
  }, async notice => { notices.push(notice); });
  t.after(async () => {
    try { await queues.dispose(); }
    finally { await connection.disconnect('test_finished'); await receiver.close(); await signaling; }
  });
  await connection.join();
  const actor = { serverId: 'server', voiceChannelId: 'voice', textChannelId: 'text', locale: 'en', invocationId: 'play' };
  for (const id of ['first', 'second', 'third']) await queues.enqueue(actor, id);
  await until(() => packets.length >= 2);
  assert.deepEqual(activity.at(-1), { isSpeaking: true });
  const restrict = (serverMuted, serverDeafened = false) => connection.handle({
    type: MessageType.VOICE_STATE_CHANGED,
    payload: { voiceState: { ...self.voiceState, serverMuted, serverDeafened } },
  });
  restrict(true);
  assert.deepEqual(activity.at(-1), { isSpeaking: false });
  await wait(50);
  const mutedPackets = packets.length;
  const before = queues.snapshot('server').elapsedMs;
  await until(() => queues.snapshot('server').elapsedMs >= before + 100);
  assert.equal(queues.snapshot('server').current.id, 'first');
  assert.equal(queues.snapshot('server').upcoming.length, 2);
  assert.equal(packets.length, mutedPackets);
  await queues.control(actor, 'pause');
  const paused = queues.snapshot('server').elapsedMs;
  const pausedActivity = activity.length;
  restrict(false);
  await wait(80);
  assert.equal(queues.snapshot('server').paused, true);
  assert.equal(queues.snapshot('server').elapsedMs, paused);
  assert.equal(packets.length, mutedPackets);
  assert.equal(activity.length, pausedActivity, 'Admin unmute must not announce activity while manually paused.');
  await queues.control(actor, 'resume');
  await until(() => packets.length > mutedPackets);
  assert.deepEqual(activity.at(-1), { isSpeaking: true });
  assert.ok(queues.snapshot('server').elapsedMs > paused);
  restrict(false, true);
  assert.deepEqual(activity.at(-1), { isSpeaking: false });
  await wait(50);
  const deafenedPackets = packets.length;
  await until(() => queues.snapshot('server').current?.id === 'second' && queues.snapshot('server').elapsedMs >= 60);
  assert.equal(consumed.get('first'), 50, 'Moderation must not prematurely end a track.');
  assert.equal(queues.snapshot('server').upcoming.length, 1);
  assert.equal(packets.length, deafenedPackets);
  assert.deepEqual(activity.at(-1), { isSpeaking: false }, 'Silently advancing to the next track is not speaking.');
  await queues.control(actor, 'skip');
  await until(() => queues.snapshot('server').current?.id === 'third');
  await queues.control(actor, 'stop');
  await until(() => queues.snapshot('server').current === null);
  assert.deepEqual(queues.snapshot('server').upcoming, []);
  await queues.control(actor, 'leave');
  assert.equal(connection.isClosed, true);
  assert.equal(notices.some(notice => notice.type === 'failed'), false);
  assert.deepEqual(errors, []);
});

test('same-session human rejoin preserves paused queue position, resumes real RTP, then skips and leaves cleanly', { timeout: 15_000 }, async t => {
  const self = { user: { id: 'bot', sessionId: 'bot:music', isBot: true }, voiceState: { sessionId: 'bot:music', channelId: 'voice' } };
  const human = { user: { id: 'human', sessionId: 'aaa:human' }, voiceState: { sessionId: 'aaa:human', channelId: 'voice' } };
  const receivers = [];
  function createReceiver() {
    const pc = new RTCPeerConnection({ codecs: { audio: [opusCodec()] }, iceServers: [], bundlePolicy: 'max-bundle' });
    const packets = [];
    pc.onTrack.subscribe(track => track.onReceiveRtp.subscribe(packet => packets.push(packet)));
    const entry = { pc, packets };
    receivers.push(entry);
    return entry;
  }
  let remote = createReceiver(), signaling = Promise.resolve(), queues;
  const errors = [], notices = [], opened = [], closed = [], activity = [];
  const connection = new BotVoiceConnection('voice', {
    currentUser: self.user, server: { voiceMode: 'p2p' }, iceServers: [],
  }, {
    send(message) {
      if (message.type === MessageType.VOICE_JOIN) queueMicrotask(() => connection.handle({
        type: MessageType.VOICE_USER_JOINED, requestId: message.requestId,
        payload: { ...self, channelId: 'voice', sessionId: self.user.sessionId, participants: [self, human] },
      }));
      else if (message.type === MessageType.VOICE_LEAVE) queueMicrotask(() => connection.handle({
        type: MessageType.VOICE_USER_LEFT, requestId: message.requestId,
        payload: { channelId: 'voice', sessionId: self.user.sessionId },
      }));
      else if (message.type === MessageType.VOICE_STATE_UPDATE) activity.push(message.payload);
      else if (message.type === MessageType.RTC_SIGNAL && message.payload.sdp) {
        const recipient = remote;
        signaling = signaling.then(async () => {
          if (recipient.pc.connectionState === 'closed') return;
          await recipient.pc.setRemoteDescription(message.payload.sdp);
          if (message.payload.signalType === 'offer') {
            await recipient.pc.setLocalDescription(await recipient.pc.createAnswer());
            if (recipient !== remote) return;
            connection.handle({ type: MessageType.RTC_SIGNAL, payload: {
              fromSessionId: human.user.sessionId, targetSessionId: self.user.sessionId,
              signalType: 'answer', sdp: recipient.pc.localDescription,
            } });
          }
        }).catch(error => errors.push(error));
      }
    },
    participants(count) { queues?.participantsChanged('server', 'voice', count); },
    disconnected() {}, error(error) { errors.push(error); },
  });
  queues = new MusicQueues({
    check: async () => {},
    resolve: async id => ({ id, title: id, url: id, duration: 20, audioUrl: '' }),
    open: async (track, signal) => {
      opened.push(track.id);
      return {
        frames: (async function* () {
          for (let i = 0; i < 1000 && !signal.aborted; i++) yield Uint8Array.from([0xf8, 0xff, 0xfe]);
        })(),
        close: async () => { closed.push(track.id); },
      };
    },
  }, {
    getVoiceConnection: () => connection.isClosed ? undefined : connection,
    joinVoice: async () => { await connection.join(); return connection; },
    leaveVoice: () => connection.close(),
  }, async notice => { notices.push(notice); });
  t.after(async () => {
    await queues.dispose();
    await connection.disconnect('test_finished');
    for (const receiver of receivers) await receiver.pc.close();
    await signaling;
  });
  await connection.join();
  const actor = { serverId: 'server', voiceChannelId: 'voice', textChannelId: 'text', locale: 'en', invocationId: 'rejoin' };
  await queues.enqueue(actor, 'first');
  await queues.enqueue(actor, 'second');
  await until(() => remote.packets.length >= 3);
  assert.deepEqual(activity.at(-1), { isSpeaking: true });
  await queues.control(actor, 'pause');
  assert.deepEqual(activity.at(-1), { isSpeaking: false });
  const pausedActivity = activity.length;
  const paused = queues.snapshot('server').elapsedMs;
  const retired = connection.peers.get(human.user.sessionId);
  connection.handle({ type: MessageType.VOICE_USER_LEFT, payload: { channelId: 'voice', sessionId: human.user.sessionId } });
  await remote.pc.close();
  remote = createReceiver();
  connection.handle({ type: MessageType.VOICE_USER_JOINED, payload: {
    ...human, channelId: 'voice', sessionId: human.user.sessionId,
  } });
  remote.pc.addTransceiver('audio', { direction: 'recvonly' });
  await remote.pc.setLocalDescription(await remote.pc.createOffer());
  connection.handle({ type: MessageType.RTC_SIGNAL, payload: {
    fromSessionId: human.user.sessionId, targetSessionId: self.user.sessionId,
    signalType: 'offer', sdp: remote.pc.localDescription,
  } });
  await until(() => connection.peers.get(human.user.sessionId)?.isReady);
  retired.failed(new Error('Fixture: late retired ICE timeout.'));
  assert.equal(connection.isClosed, false);
  assert.equal(queues.snapshot('server').elapsedMs, paused);
  assert.equal(queues.snapshot('server').paused, true);
  assert.deepEqual(opened, ['first']);
  assert.equal(remote.packets.length, 0);
  assert.equal(activity.length, pausedActivity, 'Rejoining without sending audio must not revive speaking.');
  await queues.control(actor, 'resume');
  await until(() => remote.packets.length >= 3);
  assert.deepEqual(activity.at(-1), { isSpeaking: true });
  assert.ok(queues.snapshot('server').elapsedMs > paused);
  assert.equal(queues.snapshot('server').current.id, 'first');
  assert.equal(notices.filter(notice => notice.type === 'started').length, 1);
  await queues.control(actor, 'skip');
  await until(() => queues.snapshot('server').current?.id === 'second' && queues.snapshot('server').started);
  assert.deepEqual(closed, ['first']);
  await queues.control(actor, 'leave');
  assert.equal(queues.snapshot('server').channelId, null);
  assert.deepEqual(closed, ['first', 'second']);
  assert.equal(connection.isClosed, true);
  assert.deepEqual(activity.at(-1), { isSpeaking: false });
  assert.equal(notices.some(notice => notice.type === 'failed'), false);
  assert.deepEqual(errors, []);
});
