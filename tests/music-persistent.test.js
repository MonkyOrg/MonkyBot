const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { test } = require('node:test');
const timers = require('node:timers/promises');
const { registerMusicCommands } = require('../dist/commands/music');
const { MusicQueues } = require('../dist/music/queue');
const { YouTubeSource, audioUrl, IncompleteAudioError } = require('../dist/music/source');
const { createPersistentInput } = require('../dist/music/persistent-http');
const { SourceRecoveryError, SOURCE_RECOVERY_FAILURE_LIMIT } = require('../dist/music/errors');
const { bounded, cancellable, captureBytes, safeDiagnostic, terminate } = require('../dist/music/process');
const { OggOpusParser } = require('../dist/music/ogg');
const { MUSIC_IDLE_SETTING } = require('../dist/music/settings');
const { wave, server, range, send } = require('./fixtures/music-media.cjs');

const ffmpeg = process.env.MONKY_MUSIC_FFMPEG || 'ffmpeg';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const item = (duration = 8) => ({
  id: 'abcdefghijk', title: 'Authored persistent recording', duration,
  url: 'https://www.youtube.com/watch?v=abcdefghijk',
  audioUrl: 'https://rr1.googlevideo.com/videoplayback',
});
const actor = { serverId: 'server', voiceChannelId: 'voice', textChannelId: 'text', locale: 'en', invocationId: 'fixture' };

async function until(predicate, milliseconds = 2000) {
  const end = performance.now() + milliseconds;
  while (!predicate() && performance.now() < end) await wait(10);
  assert.ok(predicate(), 'Expected persistent playback state did not arrive.');
}

function packetHash(hash, packet) {
  const size = Buffer.alloc(2);
  size.writeUInt16LE(packet.length);
  hash.update(size).update(packet);
}

async function consume(stream, prefix = []) {
  const hash = createHash('sha256');
  let frames = 0;
  for (const frame of prefix) { frames++; packetHash(hash, frame); }
  try {
    for await (const frame of stream.frames) { frames++; packetHash(hash, frame); }
    return { frames, hash: hash.digest('hex') };
  } finally { await stream.close(); }
}

function sourceFor(t, fixture) {
  const source = new YouTubeSource('unused-extractor', ffmpeg, async () => assert.fail('No external media requests'));
  const inputs = [];
  source.persistentInput = async (url, signal) => {
    const input = await createPersistentInput(url, signal, audioUrl, fixture.request);
    inputs.push(input);
    return input;
  };
  source.check = async () => {};
  source.resolve = async () => item();
  t.after(async () => { for (const input of inputs) await input.close(); });
  return { source, inputs };
}

function childrenFor(t) {
  const spawn = childProcess.spawn;
  const children = [];
  t.mock.method(childProcess, 'spawn', (command, args, options) => {
    const child = spawn(command, args, options);
    if (command === ffmpeg) {
      const entry = { child, args };
      children.push(entry);
      entry.activePreviews = children.filter(({ child, args }) => args[args.indexOf('-t') + 1] === '10' &&
        child.exitCode === null && child.signalCode === null).length;
    }
    return child;
  });
  t.after(async () => {
    for (const { child } of children) await terminate(child);
    assert.ok(children.every(({ child }) => child.exitCode !== null || child.signalCode !== null || !child.pid));
  });
  return children;
}

function read(url, headers = {}, signal, onData) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { headers, signal, agent: false }, response => {
      const chunks = [];
      response.on('data', chunk => { chunks.push(chunk); onData?.(chunk); });
      response.once('error', reject);
      response.once('end', () => resolve({ status: response.statusCode, headers: response.headers, bytes: Buffer.concat(chunks) }));
    });
    request.once('error', reject);
  });
}

function quickRetries(t, onDelay = () => {}, milliseconds = 20) {
  const original = timers.setTimeout;
  let attempts = 0;
  t.mock.method(timers, 'setTimeout', (ms, value, options) => {
    assert.ok(ms >= 1000 && ms <= 5000, 'Production retry delays must remain bounded.');
    onDelay(++attempts);
    return original(milliseconds, value, options);
  });
}

function registeredSource(t, source) {
  t.mock.method(YouTubeSource.prototype, 'check', source.check);
  t.mock.method(YouTubeSource.prototype, 'resolve', source.resolve);
  t.mock.method(YouTubeSource.prototype, 'persistentInput', source.persistentInput);
  const open = YouTubeSource.prototype.open;
  const opens = [], sent = [], chats = [], commands = new Map();
  let current, connection, invocation = 0;
  t.mock.method(YouTubeSource.prototype, 'open', async function (track, signal, options) {
    assert.deepEqual(options, { mode: 'persistent', progress: 'playback' });
    current = track;
    opens.push(track.id);
    return open.call(this, track, signal, options);
  });
  const bot = Object.assign(new EventEmitter(), {
    settings: () => {},
    getServerSettings: () => ({ schemaRevision: 1, revision: 1, values: { [MUSIC_IDLE_SETTING]: 60 } }),
    onSettingsChanged: () => () => {},
    command: command => commands.set(command.name, command),
    sendMessage: async (_serverId, _channelId, content) => { chats.push(content); },
    getVoiceConnection: () => connection,
    joinVoice: async () => connection = {
      channelId: 'voice', humanParticipantCount: 1,
      writeOpus: async packet => { sent.push({ id: current.id, packet, at: performance.now() }); },
    },
    leaveVoice: async () => { connection = undefined; },
  });
  const dispose = registerMusicCommands(bot);
  t.after(dispose);
  const play = async url => {
    const replies = [];
    await commands.get('play').handler({
      serverId: 'server', channelId: 'text', locale: 'en', invocationId: `budget-${++invocation}`,
      signal: new AbortController().signal, args: { busca: url },
      getVoiceChannel: async () => 'voice', reply: value => replies.push(value),
    });
    assert.match(replies[0], /Added to queue/);
  };
  return { play, sent, chats, opens, dispose };
}

function compressed(t) {
  const root = path.join(__dirname, '..', 'release');
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'music-persistent-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const output = path.join(directory, 'authored.m4a');
  const result = childProcess.spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-i', 'pipe:0',
    '-c:a', 'aac', '-b:a', '96k', output,
  ], { input: wave(8), windowsHide: true, timeout: 15000, maxBuffer: 65536 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, safeDiagnostic(result.stderr.toString()));
  const bytes = fs.readFileSync(output);
  assert.ok(bytes.indexOf('moov') > bytes.indexOf('mdat'), 'The M4A must require seeking, not rely on faststart.');
  return bytes;
}

for (const format of ['wave', 'seekable M4A']) {
  test(`persistent source survives five interruptions with identical ${format} Opus packet sequence`,
    { timeout: 25000 }, async t => {
      const bytes = format === 'wave' ? wave(8) : compressed(t);
      let cuts = 0;
      const offsets = [];
      const fixture = await server(t, (request, response) => {
        const { start, end } = range(request, bytes);
        const cut = start + Math.floor(bytes.length / 12);
        if (cuts && cut <= end) {
          cuts--;
          offsets.push(cut);
          send(request, response, bytes, { cut });
        } else send(request, response, bytes);
      });
      const children = childrenFor(t);
      const { source, inputs } = sourceFor(t, fixture);
      const originalTimeout = setTimeout;
      let lifetimeTimers = 0;
      t.mock.method(global, 'setTimeout', (...args) => {
        if (args[1] === 2 * 60 * 60 * 1000) lifetimeTimers++;
        return originalTimeout(...args);
      });
      const options = { mode: 'persistent' };
      const baseline = await consume(await source.open(item(), new AbortController().signal, options));
      const baselineRequests = fixture.requests.length;
      cuts = 5;
      const resumed = await consume(await source.open(item(), new AbortController().signal, options));
      assert.equal(cuts, 0);
      assert.deepEqual(resumed, baseline, 'The same decoder must retain sample/encoder state through every interruption.');
      assert.ok(resumed.frames >= 400 && resumed.frames <= 402);
      const resumes = fixture.requests.slice(baselineRequests).filter(request => request.ifRange === '"authored-v1"');
      assert.ok(resumes.length > 2);
      assert.equal(children.length, 2, 'Exactly one decoder per complete playback, not one per retry.');
      assert.equal(lifetimeTimers, 0, 'Persistent music must not inherit the two-hour wall-clock lifetime.');
      for (const { args } of children) {
        assert.equal(args[args.indexOf('-rw_timeout') + 1], '0');
        assert.equal(args.some(value => /reconnect/.test(value)), false);
      }
      for (const input of inputs) await assert.rejects(read(input.url), { code: 'ECONNREFUSED' });
      t.diagnostic(JSON.stringify({
        format, interruptions: offsets.length, resumeOrSeekRequests: resumes.length,
        packets: resumed.frames, identicalSequence: true,
      }));
    });
}

test('persistent input resumes exactly the forwarded byte offset across five read failures', { timeout: 25000 }, async t => {
  const bytes = wave(8);
  let cuts = 5, forwarded = 0;
  const positions = [];
  const fixture = await server(t, (request, response) => {
    const { start } = range(request, bytes);
    send(request, response, bytes, { cut: cuts-- > 0 ? start + 128000 : bytes.length });
  });
  const input = await createPersistentInput(item().audioUrl, new AbortController().signal, audioUrl, (url, headers, signal) => {
    const position = Number(/^bytes=(\d+)-/.exec(headers.Range)[1]);
    positions.push(position);
    assert.equal(position, forwarded, 'A resumed request starts after exactly the bytes already forwarded, not bytes merely received upstream.');
    return fixture.request(url, headers, signal);
  });
  t.after(() => input.close());
  const result = await read(input.url, {}, undefined, chunk => { forwarded += chunk.length; });
  assert.deepEqual(result.bytes, bytes);
  assert.equal(positions.length, 6);
  assert.ok(positions.slice(1).every((position, index) => position > positions[index]));
  assert.equal(input.failure, undefined);
  t.diagnostic(JSON.stringify({ interruptions: 5, exactResumePositions: positions, receivedBytes: forwarded }));
});

test('persistent input clamps closed ranges and joins complete partial segments without an EOF loop', async t => {
  const bytes = wave(0.02);
  const fixture = await server(t, (request, response) => {
    const { start } = range(request, bytes);
    send(request, response, bytes, { segmentEnd: Math.min(start + 999, bytes.length - 1) });
  });
  const input = await createPersistentInput(item().audioUrl, new AbortController().signal, audioUrl, fixture.request);
  t.after(() => input.close());
  const result = await read(input.url, { Range: 'bytes=0-99999' });
  assert.equal(result.status, 206);
  assert.equal(result.headers['content-range'], `bytes 0-${bytes.length - 1}/${bytes.length}`);
  assert.deepEqual(result.bytes, bytes);
  assert.equal(fixture.requests.length, Math.ceil(bytes.length / 1000));
  assert.equal(input.failure, undefined);
  const count = fixture.requests.length;
  assert.equal((await read(`${input.url}/other`)).status, 404);
  assert.equal((await read(input.url, { Range: 'bytes=1-2,4-5' })).status, 416);
  assert.equal(fixture.requests.length, count, 'Invalid local requests cannot select an upstream resource.');
});

test('persistent seekability survives an initial HTTP 200 for a traditional M4A', { timeout: 10000 }, async t => {
  const bytes = compressed(t);
  const fixture = await server(t, (request, response) => {
    if (range(request, bytes).start !== 0) { send(request, response, bytes); return; }
    response.writeHead(200, {
      'Content-Length': bytes.length, 'Accept-Ranges': 'bytes', ETag: '"authored-v1"', Connection: 'close',
    }).end(bytes);
  });
  childrenFor(t);
  const { source } = sourceFor(t, fixture);
  const result = await consume(await source.open(item(), new AbortController().signal, { mode: 'persistent' }));
  assert.ok(result.frames >= 400 && result.frames <= 402);
  assert.ok(fixture.requests.some(request => !request.range.startsWith('bytes=0-')), 'The decoder must perform a real seek.');
});

for (const kind of ['ignored range', 'changed entity', 'mismatched range', 'HTTP 403', 'corrupt media', 'clean short media']) {
  test(`persistent source keeps ${kind} terminal and explicit`, { timeout: 10000 }, async t => {
    const bytes = kind === 'corrupt media' ? Buffer.alloc(10000, 42) : wave(kind === 'clean short media' ? 0.2 : 8);
    let count = 0;
    const fixture = await server(t, (request, response) => {
      count++;
      if (kind === 'HTTP 403') { response.writeHead(403, { Connection: 'close' }).end(); return; }
      const { start } = range(request, bytes);
      if (kind === 'ignored range') {
        response.writeHead(200, { 'Content-Length': bytes.length, Connection: 'close' });
        response.end(count === 1 ? bytes.subarray(0, 100000) : bytes);
      } else if (kind === 'changed entity') {
        send(request, response, bytes, { cut: count === 1 ? 100000 : bytes.length, etag: count === 1 ? '"first"' : '"different"' });
      } else if (kind === 'mismatched range') {
        response.writeHead(206, { 'Content-Range': `bytes ${start + 1}-${bytes.length - 1}/${bytes.length}`, Connection: 'close' });
        response.end(bytes.subarray(start + 1));
      } else send(request, response, bytes);
    });
    const children = childrenFor(t);
    const { source } = sourceFor(t, fixture);
    const error = await consume(await source.open(item(), new AbortController().signal, { mode: 'persistent' }))
      .then(() => undefined, failure => failure);
    assert.equal(error?.code, 'unavailable', kind);
    if (kind === 'clean short media') assert.ok(error instanceof IncompleteAudioError);
    if (kind === 'ignored range') assert.match(error.detail, /refused byte-range resume/);
    if (kind === 'changed entity') assert.match(error.detail, /changed while resuming/);
    if (kind === 'mismatched range') assert.match(error.detail, /mismatched byte range/);
    if (kind === 'HTTP 403') assert.match(error.detail, /HTTP 403/);
    assert.ok(count <= 2, 'Terminal responses are not retried forever.');
    assert.equal(children.length, 1);
  });
}

test('persistent input validates redirects and does not retry TLS validation failures', async t => {
  const fixture = await server(t, (_request, response) => {
    response.writeHead(302, { Location: 'https://example.test/not-a-public-source', Connection: 'close' }).end();
  });
  const input = await createPersistentInput(item().audioUrl, new AbortController().signal, audioUrl, fixture.request);
  t.after(() => input.close());
  await assert.rejects(read(input.url));
  assert.equal(input.failure.code, 'unavailable');
  assert.equal(fixture.requests.length, 1);
  let calls = 0;
  const tls = await createPersistentInput(item().audioUrl, new AbortController().signal, audioUrl, async () => {
    calls++;
    throw Object.assign(new Error('Certificate validation failed.'), { code: 'CERT_HAS_EXPIRED' });
  });
  t.after(() => tls.close());
  await assert.rejects(read(tls.url));
  assert.match(tls.failure.detail, /Certificate validation/);
  assert.equal(calls, 1);
});

test('persistent recoverable failures retain bounded local diagnostics without exposing source URLs', { timeout: 10000 }, async t => {
  const logs = t.mock.method(console, 'warn', () => {});
  const bytes = wave(0.1);
  const fixture = await server(t, (request, response) => send(request, response, bytes));
  let requests = 0;
  const input = await createPersistentInput(item().audioUrl, new AbortController().signal, audioUrl, async (...args) => {
    if (++requests <= 2) {
      throw Object.assign(new Error('Temporary read failure at https://private.example.test/?signature=fixture-secret'), { code: 'ECONNRESET' });
    }
    return fixture.request(...args);
  });
  t.after(() => input.close());
  assert.deepEqual((await read(input.url)).bytes, bytes);
  assert.equal(requests, 3);
  assert.equal(logs.mock.callCount(), 1, 'Repeated attempts in the same outage cannot spam diagnostics.');
  assert.match(logs.mock.calls[0].arguments[0], /Source transport interrupted.*byte=0/);
  assert.doesNotMatch(logs.mock.calls[0].arguments[0], /private\.example|fixture-secret|signature/);
});

for (const responseKind of ['unavailable', 'headers and bytes']) {
  test(`recovery budget: five failed attempts after ${responseKind} cannot masquerade as resumed audio`, { timeout: 5000 }, async t => {
    quickRetries(t);
    t.mock.method(console, 'warn', () => {});
    const bytes = wave(8);
    const fixture = await server(t, (request, response) => {
      if (responseKind === 'unavailable') response.writeHead(503, { Connection: 'close' }).end();
      else send(request, response, bytes, { cut: range(request, bytes).start + 128000 });
    });
    const input = await createPersistentInput(item().audioUrl, new AbortController().signal, audioUrl, fixture.request);
    t.after(() => input.close());
    await assert.rejects(read(input.url));
    assert.ok(input.failure instanceof SourceRecoveryError);
    assert.equal(input.failure.attempts, SOURCE_RECOVERY_FAILURE_LIMIT);
    assert.equal(fixture.requests.length, 1 + SOURCE_RECOVERY_FAILURE_LIMIT, 'The initial interruption precedes five actual recovery attempts.');
    if (responseKind === 'headers and bytes') {
      assert.ok(fixture.requests.some(request => Number(/^bytes=(\d+)-/.exec(request.range)[1]) > 0),
        'Received body bytes, not only successful headers, must fail to reset the audio counter.');
    }
    const requests = fixture.requests.length;
    await wait(40);
    assert.equal(fixture.requests.length, requests);
  });
}

test('recovery budget: acknowledged audio resets four failures without introducing a per-song attempt cap', { timeout: 5000 }, async t => {
  t.mock.method(console, 'warn', () => {});
  let input;
  quickRetries(t, waits => { if (waits === 5) input.markAudioProgress(); });
  const bytes = wave(0.1);
  let requests = 0;
  const fixture = await server(t, (request, response) => {
    if (++requests < 10) response.writeHead(503, { Connection: 'close' }).end();
    else send(request, response, bytes);
  });
  input = await createPersistentInput(item().audioUrl, new AbortController().signal, audioUrl, fixture.request);
  t.after(() => input.close());
  assert.deepEqual((await read(input.url)).bytes, bytes);
  assert.equal(requests, 10);
  assert.equal(input.failure, undefined);
});

test('recovery budget: pause freezes consecutive failures without resetting them', { timeout: 5000 }, async t => {
  t.mock.method(console, 'warn', () => {});
  let input;
  quickRetries(t, waits => {
    if (waits === 5) input.setPaused(true);
    if (waits === 10) input.setPaused(false);
  });
  const fixture = await server(t, (_request, response) => response.writeHead(503, { Connection: 'close' }).end());
  input = await createPersistentInput(item().audioUrl, new AbortController().signal, audioUrl, fixture.request);
  t.after(() => input.close());
  await assert.rejects(read(input.url));
  assert.ok(input.failure instanceof SourceRecoveryError);
  assert.equal(input.failure.attempts, 5);
  assert.equal(fixture.requests.length, 11, 'Four failures before pause plus one afterward exhaust the same budget.');
});

test('recovery budget: cancellation aborts pending recovery without manufacturing an exhausted-track error', { timeout: 5000 }, async t => {
  t.mock.method(console, 'warn', () => {});
  const controller = new AbortController();
  quickRetries(t, waits => { if (waits === 3) controller.abort(); });
  const fixture = await server(t, (_request, response) => response.writeHead(503, { Connection: 'close' }).end());
  const input = await createPersistentInput(item().audioUrl, controller.signal, audioUrl, fixture.request);
  t.after(() => input.close());
  await assert.rejects(read(input.url));
  assert.equal(input.failure, undefined);
  await input.close();
  assert.equal(fixture.requests.length, 3);
});

test('persistent cancellation closes the input before any frames are consumed', { timeout: 10000 }, async t => {
  const fixture = await server(t, (_request, response) => response.writeHead(503, { Connection: 'close' }).end());
  const children = childrenFor(t);
  const { source, inputs } = sourceFor(t, fixture);
  const controller = new AbortController();
  const stream = await source.open(item(), controller.signal, { mode: 'persistent' });
  t.after(() => stream.close());
  await until(() => fixture.requests.length > 0);
  controller.abort();
  await until(() => children.every(({ child }) => child.exitCode !== null || child.signalCode !== null));
  await assert.rejects(read(inputs[0].url), { code: 'ECONNREFUSED' });
  await assert.rejects(stream.frames.next(), { code: 'cancelled' });
});

test('persistent source bounds each stalled body read and resumes it without replacing the decoder', { timeout: 10000 }, async t => {
  const bytes = wave(8);
  let stall = false, stalled = false, expiredOperations = 0;
  const fixture = await server(t, (request, response) => {
    if (!stall || expiredOperations) { send(request, response, bytes); return; }
    stalled = true;
    const { start, end } = range(request, bytes);
    response.writeHead(206, {
      'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
      ETag: '"authored-v1"', Connection: 'close',
    });
    response.write(bytes.subarray(start, start + 200000));
  });
  const children = childrenFor(t);
  const { source } = sourceFor(t, fixture);
  const baseline = await consume(await source.open(item(), new AbortController().signal, { mode: 'persistent' }));
  const originalTimeout = setTimeout;
  let boundedOperations = 0;
  t.mock.method(global, 'setTimeout', (callback, ms, ...args) => {
    if (ms !== 15000) return originalTimeout(callback, ms, ...args);
    boundedOperations++;
    return originalTimeout(() => { expiredOperations++; callback(...args); }, 100);
  });
  stall = true;
  const resumed = await consume(await source.open(item(), new AbortController().signal, { mode: 'persistent' }));
  assert.equal(stalled, true);
  assert.ok(boundedOperations > 1);
  assert.ok(expiredOperations >= 1);
  assert.deepEqual(resumed, baseline);
  assert.equal(children.length, 2);
});

test('persistent previews preserve paused playback and keep their existing ten-second capture pool', { timeout: 15000 }, async t => {
  const bytes = wave(12);
  const fixture = await server(t, (request, response) => send(request, response, bytes));
  const children = childrenFor(t);
  const { source } = sourceFor(t, fixture);
  source.resolve = async () => item(12);
  source.runBytes = async (executable, args, ...options) => {
    assert.equal(args[args.indexOf('-t') + 1], '10');
    assert.equal(args[args.indexOf('-rw_timeout') + 1], '15000000');
    const local = [...args];
    local[local.indexOf('-i') + 1] = fixture.url;
    local[local.indexOf('-protocol_whitelist') + 1] = 'http,tcp';
    return captureBytes(executable, local, ...options);
  };
  const baseline = await consume(await source.open(item(12), new AbortController().signal, { mode: 'persistent' }));
  const stream = await source.open(item(12), new AbortController().signal, { mode: 'persistent' });
  t.after(() => stream.close());
  const first = await stream.frames.next();
  assert.equal(first.done, false);
  const previews = await Promise.all(Array.from({ length: 5 }, () => source.preview(item().url, new AbortController().signal)));
  for (const bytes of previews) {
    assert.ok(bytes.length <= 256 * 1024);
    const parser = new OggOpusParser();
    const frames = parser.push(bytes);
    parser.finish();
    assert.ok(frames.length >= 500 && frames.length <= 502);
  }
  const peak = Math.max(...children.map(entry => entry.activePreviews));
  assert.ok(peak >= 2 && peak <= 4, `Expected the existing four-capture pool, got ${peak}.`);
  assert.equal(children.filter(({ args }) => args[args.indexOf('-t') + 1] === '3600').length, 2);
  assert.deepEqual(await consume(stream, [first.value]), baseline, 'Private preview work cannot consume, cancel or reopen paused playback.');
});

for (const action of ['stop', 'skip', 'leave', 'disconnect', 'dispose', 'empty-room']) {
  test(`persistent recovery ${action} cancels its decoder and input promptly`, { timeout: 10000 }, async t => {
    const fixture = await server(t, (_request, response) => {
      if (action !== 'stop') response.writeHead(503, { Connection: 'close' }).end();
    });
    const children = childrenFor(t);
    const { source, inputs } = sourceFor(t, fixture);
    let connection;
    const notices = [];
    const queues = new MusicQueues(source, {
      getVoiceConnection: () => connection,
      joinVoice: async () => connection = { channelId: 'voice', humanParticipantCount: 1, writeOpus: async () => {} },
      leaveVoice: async () => { connection = undefined; },
    }, async notice => notices.push(notice), 60000, () => 80);
    t.after(() => queues.dispose());
    await queues.enqueue(actor, item().url);
    await until(() => fixture.requests.length > 0);
    assert.equal(queues.snapshot('server').current.id, item().id);
    const started = performance.now();
    if (action === 'dispose') await queues.dispose();
    else if (action === 'disconnect') await queues.disconnect('server');
    else if (action === 'empty-room') queues.participantsChanged('server', 'voice', 0);
    else await queues.control(actor, action);
    await until(() => !queues.snapshot('server').current && children.every(({ child }) => child.exitCode !== null || child.signalCode !== null));
    await inputs[0].close();
    const elapsedMs = performance.now() - started;
    assert.ok(elapsedMs < 1500, `${action} needed ${elapsedMs} ms.`);
    await assert.rejects(read(inputs[0].url), { code: 'ECONNREFUSED' });
    assert.equal(notices.some(notice => notice.type === 'failed' || notice.type === 'source-recovery'), false);
    const count = fixture.requests.length;
    await wait(30);
    assert.equal(fixture.requests.length, count);
    t.diagnostic(JSON.stringify({ action, cancelledMs: elapsedMs, decoders: children.length }));
  });
}

test('cancellable waits consume rejected inputs even when already cancelled and preserve falsy failures', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(cancellable(Promise.reject(new Error('Retired read.')), controller.signal), { code: 'cancelled' });
  for (const failure of [undefined, null, false, 0, '']) {
    const result = await bounded(Promise.reject(failure), new AbortController().signal, 100)
      .then(() => ({ ok: true }), error => ({ ok: false, error }));
    assert.deepEqual(result, { ok: false, error: failure });
  }
});

test('recovery budget: seven successful native resumptions preserve the entire song and stay silent in chat',
  { timeout: 20000 }, async t => {
    quickRetries(t);
    t.mock.method(console, 'warn', () => {});
    const bytes = wave(8);
    const children = childrenFor(t);
    let player, cuts = 0, remaining = 7;
    const fixture = await server(t, (request, response) => {
      if (!player || remaining === 0) { send(request, response, bytes); return; }
      const { start, end } = range(request, bytes);
      response.writeHead(206, {
        'Content-Type': 'audio/wav', 'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${bytes.length}`, 'Accept-Ranges': 'bytes',
        ETag: '"authored-v1"', Connection: 'close',
      });
      const before = player.sent.length;
      let position = start, timer;
      const advance = () => {
        if (position - start >= 16384 && player.sent.length > before && position < end) {
          cuts++;
          remaining--;
          response.end();
          return;
        }
        const next = Math.min(end + 1, position + 8192);
        response.write(bytes.subarray(position, next));
        position = next;
        if (position === end + 1) response.end();
        else timer = setTimeout(advance, 5);
      };
      response.once('close', () => clearTimeout(timer));
      advance();
    });
    const { source } = sourceFor(t, fixture);
    const baseline = await consume(await source.open(item(), new AbortController().signal, { mode: 'persistent' }));
    player = registeredSource(t, source);
    await player.play(item().url);
    await until(() => player.chats.some(message => /Queue finished/.test(message)), 15000);
    const hash = createHash('sha256');
    for (const { packet } of player.sent) packetHash(hash, packet);
    assert.equal(cuts, 7);
    assert.deepEqual({ frames: player.sent.length, hash: hash.digest('hex') }, baseline);
    assert.equal(player.chats.filter(message => /Now playing/.test(message)).length, 1);
    assert.equal(player.chats.filter(message => /Queue finished/.test(message)).length, 1);
    assert.equal(player.chats.some(message => /resum|recover|failed|stopped/i.test(message)), false);
    assert.equal(player.opens.length, 1);
    assert.equal(children.length, 2, 'Recovery must not spawn another decoder.');
    t.diagnostic(JSON.stringify({ successfulResumptions: cuts, packets: player.sent.length, identicalSequence: true, chatMessages: player.chats.length }));
    await player.dispose();
  });

test('recovery budget: five failed native attempts notify once, discard the track and play the next one',
  { timeout: 12000 }, async t => {
    quickRetries(t);
    t.mock.method(console, 'warn', () => {});
    t.mock.method(console, 'error', () => {});
    const bytes = wave(8), nextBytes = wave(0.2);
    const children = childrenFor(t);
    let player, interrupted = false;
    const failures = [];
    const fixture = await server(t, (request, response) => {
      if (interrupted) {
        failures.push(player.sent.filter(frame => frame.id === item().id).length);
        response.writeHead(503, { Connection: 'close' }).end();
        return;
      }
      const { start, end } = range(request, bytes);
      response.writeHead(206, {
        'Content-Type': 'audio/wav', 'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${bytes.length}`, 'Accept-Ranges': 'bytes',
        ETag: '"authored-v1"', Connection: 'close',
      });
      let position = start, timer;
      const advance = () => {
        if (player?.sent.length && position < end) { interrupted = true; response.end(); return; }
        const next = Math.min(end + 1, position + 8192);
        response.write(bytes.subarray(position, next));
        position = next;
        if (position === end + 1) response.end();
        else timer = setTimeout(advance, 5);
      };
      response.once('close', () => clearTimeout(timer));
      advance();
    });
    const nextFixture = await server(t, (request, response) => send(request, response, nextBytes));
    const next = { ...item(0.2), id: 'nextclip001', title: 'Next authored clip',
      url: 'https://www.youtube.com/watch?v=nextclip001', audioUrl: `${item().audioUrl}?clip=next` };
    const { source, inputs } = sourceFor(t, fixture);
    source.resolve = async url => url.includes(next.id) ? next : item();
    source.persistentInput = async (url, signal) => {
      const input = await createPersistentInput(url, signal, audioUrl, url.includes('clip=next') ? nextFixture.request : fixture.request);
      inputs.push(input);
      return input;
    };
    player = registeredSource(t, source);
    await player.play(item().url);
    await player.play(next.url);
    await until(() => player.chats.some(message => /Queue finished/.test(message)), 9000);
    const recoveryErrors = player.chats.filter(message => /Could not resume/.test(message));
    assert.equal(recoveryErrors.length, 1);
    assert.match(recoveryErrors[0], /after 5 consecutive attempts.*track was removed from the queue/);
    assert.doesNotMatch(recoveryErrors[0], /googlevideo|token|signature|byteOffset/);
    assert.ok(failures.length >= 5);
    assert.ok(failures.slice(-5).every(count => count === failures.at(-1)), 'The exhausted attempts made no audio progress.');
    assert.deepEqual(player.opens, [item().id, next.id]);
    assert.equal(player.sent.filter(frame => frame.id === next.id).length, 11);
    assert.equal(player.chats.filter(message => /Queue finished/.test(message)).length, 1);
    assert.equal(player.chats.some(message => /Playback stopped/.test(message)), false);
    assert.equal(children.length, 2);
    t.diagnostic(JSON.stringify({ recoveryErrors: 1, finalFailedAttempts: 5, nextTrackPackets: 11, decoders: children.length }));
    await player.dispose();
  });
