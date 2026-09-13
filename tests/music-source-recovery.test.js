const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { test } = require('node:test');
const { IncompleteAudioError, YouTubeSource } = require('../dist/music/source');
const { OggOpusParser } = require('../dist/music/ogg');
const { captureBytes, safeDiagnostic, terminate } = require('../dist/music/process');
const { wave } = require('./fixtures/music-media.cjs');

const ffmpeg = process.env.MONKY_MUSIC_FFMPEG || 'ffmpeg';
const installed = childProcess.spawnSync(ffmpeg, ['-version'], { windowsHide: true, timeout: 5000 });
const skip = installed.error?.code === 'ENOENT' ? 'Set MONKY_MUSIC_FFMPEG for generated source tests.' : false;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const track = duration => ({
  id: 'abcdefghijk', title: 'Authored changing sine', duration,
  url: 'https://www.youtube.com/watch?v=abcdefghijk',
  audioUrl: 'https://rr1.googlevideo.com/videoplayback',
});

function observeChildren(t, executable = ffmpeg) {
  const original = childProcess.spawn;
  const children = [];
  t.mock.method(childProcess, 'spawn', (command, args, options) => {
    const child = original(command, args, options);
    if (command === executable) {
      const entry = { child, args, diagnostic: '', startedAt: performance.now(), closedAt: undefined };
      children.push(entry);
      child.stderr.on('data', chunk => { entry.diagnostic = (entry.diagnostic + chunk.toString()).slice(-4096); });
      child.once('close', () => { entry.closedAt = performance.now(); });
    }
    return child;
  });
  t.after(async () => {
    for (const { child } of children) await terminate(child);
    assert.ok(children.every(({ child }) => child.exitCode !== null || child.signalCode !== null || !child.pid),
      'Every owned source process must terminate.');
  });
  return children;
}

async function server(t, handler) {
  const sockets = new Set();
  const requests = [];
  const instance = http.createServer((request, response) => {
    requests.push({ path: request.url, range: request.headers.range });
    handler(request, response);
  });
  instance.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  instance.listen(0, '127.0.0.1');
  await once(instance, 'listening');
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve, reject) => instance.close(error => error ? reject(error) : resolve()));
  });
  return { url: `http://127.0.0.1:${instance.address().port}/authored.wav`, requests };
}

function sendWave(request, response, bytes, { cut = bytes.length, stall = false, contentType = 'audio/wav' } = {}) {
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
  const start = range ? Number(range[1]) : 0;
  const end = Math.min(bytes.length, range?.[2] ? Number(range[2]) + 1 : bytes.length);
  if (start >= cut) { response.writeHead(503, { Connection: 'close' }); response.end(); return; }
  response.writeHead(range ? 206 : 200, {
    'Content-Type': contentType, 'Accept-Ranges': 'bytes', 'Content-Length': end - start,
    ...(range ? { 'Content-Range': `bytes ${start}-${end - 1}/${bytes.length}` } : {}),
    Connection: stall ? 'keep-alive' : 'close',
  });
  const body = bytes.subarray(start, Math.min(cut, end));
  if (stall) response.write(body);
  else response.end(body);
}

function localSource(url) {
  const source = new YouTubeSource('unused-extractor', ffmpeg, async () => assert.fail('No external media requests'));
  const productionArgs = source.transcodeArgs.bind(source);
  source.transcodeArgs = (item, seconds, recovery) => {
    const args = productionArgs(item, seconds, recovery);
    // Only the test input is loopback HTTP; production stays restricted to HTTPS googlevideo.
    assert.equal(args[args.indexOf('-i') + 1], item.audioUrl);
    args[args.indexOf('-i') + 1] = url;
    args[args.indexOf('-protocol_whitelist') + 1] = 'http,tcp';
    return args;
  };
  return source;
}

function smallOgg() {
  const result = childProcess.spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'lavfi',
    '-i', 'sine=frequency=440:sample_rate=48000:duration=0.12',
    '-ac', '2', '-ar', '48000', '-c:a', 'libopus', '-frame_duration', '20',
    '-f', 'ogg', '-page_duration', '20000', 'pipe:1',
  ], { windowsHide: true, timeout: 5000, maxBuffer: 65536 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, safeDiagnostic(result.stderr.toString()));
  return result.stdout;
}

function compressedMedia(t, { seconds, rate, channels, codec, extension, extra = [] }) {
  const root = path.join(__dirname, '..', 'release');
  fs.mkdirSync(root, { recursive: true });
  const directory = fs.mkdtempSync(path.join(root, 'music-source-media-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const file = path.join(directory, `authored.${extension}`);
  const result = childProcess.spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'lavfi',
    '-i', `aevalsrc=0.2*sin(2*PI*(220*t+t*t)):s=${rate}:d=${seconds}`,
    '-ac', String(channels), '-ar', String(rate), '-c:a', codec, '-b:a', '96k',
    ...extra, file,
  ], { windowsHide: true, timeout: 30000, maxBuffer: 65536 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, safeDiagnostic(result.stderr.toString()));
  return fs.readFileSync(file);
}

function opusResult(bytes) {
  const parser = new OggOpusParser();
  const hash = createHash('sha256');
  let frames = 0;
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    for (const packet of parser.push(bytes.subarray(offset, offset + 32768))) {
      frames++;
      hash.update(packet);
    }
  }
  parser.finish();
  return { frames, hash: hash.digest('hex') };
}

function scriptedDecoder(script) {
  const source = new YouTubeSource('unused-extractor', process.execPath, async () => assert.fail('No external requests'));
  source.transcodeArgs = () => ['-e', script];
  return source;
}

async function consume(stream, onFrame) {
  const hash = createHash('sha256');
  let frames = 0;
  try {
    for await (const frame of stream.frames) {
      frames++;
      hash.update(frame);
      if (onFrame) await onFrame(frames);
    }
    return { frames, hash: hash.digest('hex') };
  } finally { await stream.close(); }
}

test('source reliability: three complete minutes survive consumer pause with identical Opus and bounded buffering',
  { skip, timeout: 30000 }, async t => {
    const bytes = wave(180);
    const fixture = await server(t, (request, response) => sendWave(request, response, bytes));
    const children = observeChildren(t);
    const source = localSource(fixture.url);
    const first = await consume(await source.open(track(180), new AbortController().signal));
    let paused = false;
    const second = await consume(await source.open(track(180), new AbortController().signal), async frames => {
      if (frames !== 3) return;
      paused = true;
      await wait(250);
      const stdout = children.at(-1).child.stdout;
      assert.ok(stdout.readableLength <= stdout.readableHighWaterMark * 2,
        `Paused source buffered ${stdout.readableLength} bytes.`);
      assert.equal(children.at(-1).child.exitCode, null, 'A paused long decoder should be backpressured, not drained eagerly.');
    });
    assert.equal(paused, true);
    assert.ok(first.frames >= 9000 && first.frames <= 9002);
    assert.deepEqual(second, first, 'Pausing must not reopen, duplicate, omit or change source samples.');
    assert.equal(children.length, 2);
    assert.ok(children.every(entry => entry.child.exitCode === 0));
    t.diagnostic(JSON.stringify({ durationSeconds: 180, packets: first.frames, opusMs: first.frames * 20, pausedHashMatches: true }));
  });

test('source reliability: a valid short input and FFmpeg exit zero cannot complete a longer track',
  { skip, timeout: 15000 }, async t => {
    const bytes = wave(2);
    const fixture = await server(t, (request, response) => sendWave(request, response, bytes));
    const children = observeChildren(t);
    const source = localSource(fixture.url);
    let frames = 0;
    const error = await consume(await source.open(track(180), new AbortController().signal), () => { frames++; })
      .then(() => undefined, failure => failure);
    t.diagnostic(JSON.stringify({ expectedMs: 180000, receivedPacketMs: frames * 20,
      exitCode: children[0].child.exitCode, stderr: safeDiagnostic(children[0].diagnostic) }));
    assert.equal(children[0].child.exitCode, 0, 'The completeness guard must not rely on process failure.');
    assert.equal(error?.code, 'unavailable', 'A clean short source must not resolve as natural completion.');
    assert.match(error.detail, /early|incomplete/i);
    assert.ok(error instanceof IncompleteAudioError);
    assert.equal(error.expectedDurationMs, 180000);
    assert.equal(error.emittedDurationMs, frames * 20);
  });

test('source reliability: a prematurely closed HTTP body never becomes normal completion',
  { skip, timeout: 25000 }, async t => {
    const bytes = wave(30);
    const cut = 44 + 3 * 192000;
    const fixture = await server(t, (request, response) => sendWave(request, response, bytes, { cut }));
    const children = observeChildren(t);
    const source = localSource(fixture.url);
    let frames = 0;
    const error = await consume(await source.open(track(30), new AbortController().signal), () => { frames++; })
      .then(() => undefined, failure => failure);
    t.diagnostic(JSON.stringify({ expectedMs: 30000, receivedPacketMs: frames * 20,
      exitCode: children[0].child.exitCode, stderr: safeDiagnostic(children[0].diagnostic), requests: fixture.requests.length }));
    assert.equal(error?.code, 'unavailable', 'HTTP truncation must not turn into a natural queue EOF.');
    assert.ok(error.detail);
    assert.ok(frames * 20 < 30000);
  });

test('source reliability: a stalled upstream terminates explicitly within the production read timeout',
  { skip, timeout: 35000 }, async t => {
    const bytes = wave(30);
    const fixture = await server(t, (request, response) =>
      sendWave(request, response, bytes, { cut: 44 + 3 * 192000, stall: true }));
    const children = observeChildren(t);
    const source = localSource(fixture.url);
    const started = performance.now();
    const error = await consume(await source.open(track(30), new AbortController().signal))
      .then(() => undefined, failure => failure);
    const elapsedMs = performance.now() - started;
    t.diagnostic(JSON.stringify({ elapsedMs, exitCode: children[0].child.exitCode,
      stderr: safeDiagnostic(children[0].diagnostic) }));
    assert.ok(error && ['unavailable', 'timeout'].includes(error.code), 'Stalled media must fail explicitly.');
    assert.ok(elapsedMs < 32000, 'The source must not hang after its network/read deadlines.');
  });

test('source reliability: cancellation stops a blocked input without leaving FFmpeg running',
  { skip, timeout: 10000 }, async t => {
    let requested;
    const seen = new Promise(resolve => { requested = resolve; });
    const fixture = await server(t, (_request, _response) => { requested(); });
    const children = observeChildren(t);
    const source = localSource(fixture.url);
    const controller = new AbortController();
    const stream = await source.open(track(180), controller.signal);
    const consuming = consume(stream);
    const rejected = assert.rejects(consuming, { code: 'cancelled' });
    await seen;
    controller.abort();
    await rejected;
    assert.equal(children.length, 1);
    assert.ok(children[0].child.exitCode !== null || children[0].child.signalCode !== null);
    await stream.close();
  });

test('source reliability: close invalidates buffered frames even without a separate signal abort',
  { skip, timeout: 10000 }, async t => {
    const bytes = wave(5);
    const fixture = await server(t, (request, response) => sendWave(request, response, bytes));
    observeChildren(t);
    const stream = await localSource(fixture.url).open(track(5), new AbortController().signal);
    const iterator = stream.frames[Symbol.asyncIterator]();
    t.after(async () => { await stream.close(); await iterator.return(); });
    assert.equal((await iterator.next()).done, false);
    await stream.close();
    await assert.rejects(iterator.next(), { code: 'cancelled' });
    await stream.close();
  });

test('source reliability: already parsed Opus packets cannot escape after explicit close',
  { skip, timeout: 10000 }, async t => {
    const bytes = smallOgg();
    observeChildren(t, process.execPath);
    const source = scriptedDecoder(`process.stdout.write(Buffer.from('${bytes.toString('base64')}','base64'));setInterval(()=>{},1000);`);
    const stream = await source.open(track(0.12), new AbortController().signal);
    const iterator = stream.frames[Symbol.asyncIterator]();
    t.after(async () => { await stream.close(); await iterator.return(); });
    assert.equal((await iterator.next()).done, false);
    await stream.close();
    await assert.rejects(iterator.next(), { code: 'cancelled' });
  });

test('source reliability: error-level decoder diagnostics fail even with complete Ogg and exit zero',
  { skip, timeout: 10000 }, async t => {
    const bytes = smallOgg();
    const children = observeChildren(t, process.execPath);
    const diagnostic = `Decode error https://rr1.googlevideo.com/videoplayback?padding=${'x'.repeat(1200)}secret-marker${'y'.repeat(3400)}`;
    const source = scriptedDecoder(`
      process.stderr.write(${JSON.stringify(diagnostic)});
      process.stdout.write(Buffer.from('${bytes.toString('base64')}','base64'));
    `);
    const error = await consume(await source.open(track(0.12), new AbortController().signal))
      .then(() => undefined, failure => failure);
    assert.equal(children[0].child.exitCode, 0);
    assert.equal(error?.code, 'unavailable');
    assert.match(error.detail, /Decode error/);
    assert.doesNotMatch(error.detail, /secret-marker|https:\/\//);
  });

test('source reliability: an error beyond the retained stderr prefix still rejects the stream',
  { skip, timeout: 10000 }, async t => {
    const bytes = smallOgg();
    observeChildren(t, process.execPath);
    const source = scriptedDecoder(`
      process.stderr.write(' '.repeat(8192));process.stderr.write('late decoder error');
      process.stdout.write(Buffer.from('${bytes.toString('base64')}','base64'));
    `);
    await assert.rejects(consume(await source.open(track(0.12), new AbortController().signal)), error => {
      assert.equal(error.code, 'unavailable');
      assert.ok(error.detail);
      return true;
    });
  });

test('source reliability: decoder EOF at an Ogg page boundary without EOS remains an error',
  { skip, timeout: 10000 }, async t => {
    const bytes = smallOgg();
    let offset = 0, lastPage = 0;
    while (offset < bytes.length) {
      lastPage = offset;
      const segments = bytes[offset + 26];
      offset += 27 + segments + bytes.subarray(offset + 27, offset + 27 + segments).reduce((a, b) => a + b, 0);
    }
    observeChildren(t, process.execPath);
    const source = scriptedDecoder(`process.stdout.write(Buffer.from('${bytes.subarray(0, lastPage).toString('base64')}','base64'));`);
    const error = await consume(await source.open(track(0.12), new AbortController().signal))
      .then(() => undefined, failure => failure);
    assert.equal(error?.code, 'unavailable');
    assert.match(error.detail, /Ogg/);
  });

test('source reliability: private previews reject a short source but support genuinely short tracks',
  { skip, timeout: 10000 }, async t => {
    const bytes = wave(2);
    const fixture = await server(t, (request, response) => sendWave(request, response, bytes));
    observeChildren(t);
    const source = localSource(fixture.url);
    source.check = async () => {};
    source.resolve = async () => track(30);
    await assert.rejects(source.preview(track(30).url, new AbortController().signal), error => {
      assert.ok(error instanceof IncompleteAudioError);
      assert.equal(error.expectedDurationMs, 10000);
      assert.ok(error.emittedDurationMs >= 2000 && error.emittedDurationMs <= 2040);
      return true;
    });
    source.resolve = async () => track(2);
    const preview = await source.preview(track(2).url, new AbortController().signal);
    const parser = new OggOpusParser();
    const packets = parser.push(preview);
    parser.finish();
    assert.ok(packets.length >= 100 && packets.length <= 102);
    assert.ok(preview.length <= 256 * 1024);
  });

test('source reliability: strict decoder capture does not change ordinary subprocess stderr semantics', async () => {
  const args = ['-e', "process.stderr.write('Decode error token=secret-marker');process.stdout.write('bytes')"];
  const signal = new AbortController().signal;
  assert.equal((await captureBytes(process.execPath, args, signal)).toString(), 'bytes');
  await assert.rejects(captureBytes(process.execPath, args, signal, 5000, 65536, { rejectStderr: true }), error => {
    assert.equal(error.code, 'unavailable');
    assert.match(error.detail, /Decode error/);
    assert.doesNotMatch(error.detail, /secret-marker/);
    return true;
  });
});

test('source reliability: bounded capture preserves redaction context and notices late error output', async () => {
  const url = `https://rr1.googlevideo.com/videoplayback?padding=${'x'.repeat(1200)}secret-marker${'y'.repeat(3400)}`;
  const diagnostic = `Authorization: Bearer bearer-secret\nAuthorization: Basic basic-secret\nDecode error ${url}`;
  const args = ['-e', `process.stderr.write(${JSON.stringify(diagnostic)});process.stdout.write('bytes')`];
  await assert.rejects(captureBytes(process.execPath, args, new AbortController().signal, 5000, 65536, { rejectStderr: true }), error => {
    assert.equal(error.code, 'unavailable');
    assert.match(error.detail, /Decode error/);
    assert.doesNotMatch(error.detail, /secret-marker|bearer-secret|basic-secret|https:\/\//);
    assert.ok(error.detail.length <= 1024);
    return true;
  });
  await assert.rejects(captureBytes(process.execPath,
    ['-e', "process.stderr.write(' '.repeat(8192));process.stderr.write('late decoder error')"],
    new AbortController().signal, 5000, 65536, { rejectStderr: true }), error => {
    assert.equal(error.code, 'unavailable');
    assert.ok(error.detail, 'An error after the retained prefix must still have an explicit diagnostic.');
    return true;
  });
});

test('source reliability: metadata rounding allowance cannot accept most of a short track missing',
  { skip, timeout: 10000 }, async t => {
    const bytes = wave(3);
    const fixture = await server(t, (request, response) => sendWave(request, response, bytes));
    observeChildren(t);
    const source = localSource(fixture.url);
    const complete = await consume(await source.open(track(3.2), new AbortController().signal));
    assert.ok(complete.frames >= 150 && complete.frames <= 152);
    await assert.rejects(consume(await source.open(track(5), new AbortController().signal)), IncompleteAudioError);
  });

for (const [deadline, detail] of [[30000, /Decoded audio stalled/], [2 * 60 * 60 * 1000, /two-hour lifetime/]]) {
  test(`source reliability: ${deadline}ms decoder watchdog is explicit and terminates its process`,
    { timeout: 10000 }, async t => {
      const originalTimeout = global.setTimeout;
      let expire;
      t.mock.method(global, 'setTimeout', (callback, ms, ...args) => {
        if (ms === deadline) expire = callback;
        return originalTimeout(callback, ms, ...args);
      });
      const children = observeChildren(t, process.execPath);
      const stream = await scriptedDecoder('setInterval(()=>{},1000)').open(track(30), new AbortController().signal);
      const consuming = consume(stream);
      const rejection = assert.rejects(consuming, error => {
        assert.equal(error.code, 'timeout');
        assert.match(error.detail, detail);
        return true;
      });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(typeof expire, 'function');
      expire();
      await rejection;
      assert.ok(children.every(({ child }) => child.exitCode !== null || child.signalCode !== null));
    });
}

test('source reliability: excessive decoder stderr is bounded and stops its process', { timeout: 10000 }, async t => {
  const children = observeChildren(t, process.execPath);
  const source = scriptedDecoder("setInterval(()=>process.stderr.write('x'.repeat(16384)),5)");
  await assert.rejects(consume(await source.open(track(30), new AbortController().signal)), error => {
    assert.equal(error.code, 'unavailable');
    assert.match(error.detail, /excessive error output/);
    assert.ok(error.detail.length <= 1024);
    return true;
  });
  assert.ok(children.every(({ child }) => child.exitCode !== null || child.signalCode !== null));
});

const compressedCases = [
  { seconds: 235, rate: 48000, channels: 2, codec: 'libopus', extension: 'webm',
    extra: ['-frame_duration', '60'], contentType: 'audio/webm' },
  { seconds: 218, rate: 44100, channels: 2, codec: 'aac', extension: 'm4a',
    contentType: 'audio/mp4' },
  { seconds: 244, rate: 48000, channels: 1, codec: 'libopus', extension: 'ogg',
    extra: ['-frame_duration', '40'], contentType: 'audio/ogg' },
];

for (const spec of compressedCases) {
  test(`source reliability: ${spec.seconds}s ${spec.extension} ${spec.rate}Hz ${spec.channels}ch is not halved by transcoding/backpressure`,
    { skip, timeout: 60000 }, async t => {
      const bytes = compressedMedia(t, spec);
      const fixture = await server(t, (request, response) =>
        sendWave(request, response, bytes, { contentType: spec.contentType }));
      const children = observeChildren(t);
      const source = localSource(fixture.url);
      const reference = await consume(await source.open(track(spec.seconds), new AbortController().signal));
      const paused = await consume(await source.open(track(spec.seconds), new AbortController().signal), async frame => {
        if (frame === 20 || frame === 4000) {
          await wait(250);
          const stdout = children.at(-1).child.stdout;
          assert.ok(stdout.readableLength <= stdout.readableHighWaterMark * 2);
        }
      });
      assert.ok(Math.abs(reference.frames * 20 - spec.seconds * 1000) <= 60,
        `Expected ${spec.seconds}s, got ${reference.frames * 20}ms of output.`);
      assert.deepEqual(paused, reference);
      assert.equal(children.length, 2);
      t.diagnostic(JSON.stringify({ input: spec, bytes: bytes.length, packets: reference.frames,
        outputMs: reference.frames * 20, samePausedHash: true, httpRequests: fixture.requests.length }));
    });
}

test('source reliability: native seekable HTTP reconnect preserves every encoded packet in one decoder',
  { skip, timeout: 30000 }, async t => {
    const spec = { ...compressedCases[0], seconds: 30 };
    const bytes = compressedMedia(t, spec);
    let interrupt = false;
    const cut = Math.floor(bytes.length * 0.47);
    const fixture = await server(t, (request, response) => {
      const shouldCut = interrupt;
      interrupt = false;
      sendWave(request, response, bytes, { contentType: spec.contentType, cut: shouldCut ? cut : bytes.length });
    });
    const children = observeChildren(t);
    const source = localSource(fixture.url);
    const args = source.transcodeArgs(track(30), 3600);
    args[args.indexOf('-loglevel') + 1] = 'repeat+level+warning';
    args.splice(args.indexOf('-i'), 0, '-reconnect', '1', '-reconnect_at_eof', '0',
      '-reconnect_streamed', '0', '-reconnect_delay_max', '2');
    const reference = opusResult(await captureBytes(ffmpeg, args, new AbortController().signal, 20000, 4 * 1024 * 1024));
    const before = fixture.requests.length;
    interrupt = true;
    const resumed = opusResult(await captureBytes(ffmpeg, args, new AbortController().signal, 20000, 4 * 1024 * 1024));
    assert.deepEqual(resumed, reference);
    assert.ok(fixture.requests.slice(before).some(request => request.range === `bytes=${cut}-`));
    assert.equal(children.length, 2, 'Each complete decode, including recovery, must use one FFmpeg process.');
    t.diagnostic(JSON.stringify({ cut, packets: resumed.frames, identicalPackets: true,
      requests: fixture.requests.slice(before), nativeDiagnostic: safeDiagnostic(children.at(-1).diagnostic) }));
  });

test('source recovery: opt-in HTTP resume preserves packets and reports retry/completion without URLs',
  { skip, timeout: 30000 }, async t => {
    const spec = { ...compressedCases[0], seconds: 30 };
    const bytes = compressedMedia(t, spec);
    const cut = Math.floor(bytes.length * 0.47);
    let interrupt = false;
    const fixture = await server(t, (request, response) => {
      const shouldCut = interrupt;
      interrupt = false;
      sendWave(request, response, bytes, { contentType: spec.contentType, cut: shouldCut ? cut : bytes.length });
    });
    const children = observeChildren(t);
    const source = localSource(fixture.url);
    const reference = await consume(await source.open(track(30), new AbortController().signal));
    const notices = [];
    interrupt = true;
    const resumed = await consume(await source.open(track(30), new AbortController().signal, {
      onRecovery: async (notice, signal) => { assert.equal(signal.aborted, false); notices.push(notice); },
    }));
    assert.deepEqual(resumed, reference);
    assert.equal(children.length, 2);
    assert.deepEqual(notices.map(notice => notice.type), ['retrying', 'recovered']);
    assert.equal(notices[0].byteOffset, cut);
    assert.equal(notices[0].attempt, 1);
    assert.equal(notices[0].maxAttempts, 2);
    assert.equal(notices[1].emittedDurationMs, reference.frames * 20);
    assert.doesNotMatch(JSON.stringify(notices), /https?:|signature|token/);
    t.diagnostic(JSON.stringify({ packets: resumed.frames, identicalHash: true, notices }));
  });

test('source recovery: repeated interrupted responses are bounded and never claim recovery',
  { skip, timeout: 15000 }, async t => {
    const spec = { ...compressedCases[0], seconds: 30 };
    const bytes = compressedMedia(t, spec);
    const step = Math.floor(bytes.length / 10);
    const fixture = await server(t, (request, response) => {
      const start = Number(/^bytes=(\d+)-/.exec(request.headers.range || '')?.[1] || 0);
      sendWave(request, response, bytes, { contentType: spec.contentType, cut: Math.min(bytes.length, start + step) });
    });
    const children = observeChildren(t);
    const notices = [];
    await assert.rejects(consume(await localSource(fixture.url).open(track(30), new AbortController().signal, {
      onRecovery: notice => { notices.push(notice); },
    })), error => {
      assert.equal(error.code, 'unavailable');
      assert.match(error.detail, /exceeded 2 resume attempts/);
      return true;
    });
    assert.equal(children.length, 1);
    assert.deepEqual(notices.map(notice => notice.type), ['retrying', 'retrying']);
    assert.ok(fixture.requests.length <= 4, `Unexpected HTTP request count: ${fixture.requests.length}`);
    t.diagnostic(JSON.stringify({ requests: fixture.requests.length, notices }));
  });

test('source recovery: a genuinely short clean resource is not retried at EOF',
  { skip, timeout: 10000 }, async t => {
    const bytes = compressedMedia(t, { ...compressedCases[0], seconds: 2 });
    const fixture = await server(t, (request, response) => sendWave(request, response, bytes, { contentType: 'audio/webm' }));
    observeChildren(t);
    const notices = [];
    await assert.rejects(consume(await localSource(fixture.url).open(track(30), new AbortController().signal, {
      onRecovery: notice => { notices.push(notice); },
    })), IncompleteAudioError);
    assert.deepEqual(notices, []);
    assert.equal(fixture.requests.length, 1);
  });

test('source recovery: cancellation during a retry notice cannot restart or publish recovered',
  { skip, timeout: 15000 }, async t => {
    const bytes = compressedMedia(t, { ...compressedCases[0], seconds: 30 });
    let interrupt = true;
    const fixture = await server(t, (request, response) => {
      const cut = interrupt ? Math.floor(bytes.length * 0.47) : bytes.length;
      interrupt = false;
      sendWave(request, response, bytes, { cut, contentType: 'audio/webm' });
    });
    const children = observeChildren(t);
    const controller = new AbortController();
    const notices = [];
    await assert.rejects(consume(await localSource(fixture.url).open(track(30), controller.signal, {
      onRecovery: (notice, signal) => {
        notices.push(notice);
        controller.abort();
        assert.equal(signal.aborted, true);
      },
    })), { code: 'cancelled' });
    assert.equal(children.length, 1);
    assert.deepEqual(notices.map(notice => notice.type), ['retrying']);
  });

test('source recovery: notice failures remain explicit rather than becoming silent recovery',
  { skip, timeout: 15000 }, async t => {
    const bytes = compressedMedia(t, { ...compressedCases[0], seconds: 30 });
    let interrupt = true;
    const fixture = await server(t, (request, response) => {
      const cut = interrupt ? Math.floor(bytes.length * 0.47) : bytes.length;
      interrupt = false;
      sendWave(request, response, bytes, { cut, contentType: 'audio/webm' });
    });
    observeChildren(t);
    await assert.rejects(consume(await localSource(fixture.url).open(track(30), new AbortController().signal, {
      onRecovery: async () => { throw new Error('notice delivery failed'); },
    })), error => {
      assert.equal(error.code, 'unavailable');
      assert.match(error.detail, /Could not report source recovery: notice delivery failed/);
      return true;
    });
  });

test('source recovery: non-seekable interrupted input is not restarted from byte zero',
  { skip, timeout: 10000 }, async t => {
    const bytes = compressedMedia(t, { ...compressedCases[0], seconds: 30 });
    const fixture = await server(t, (_request, response) => {
      response.writeHead(200, { 'Content-Type': 'audio/webm', 'Content-Length': bytes.length, Connection: 'close' });
      response.end(bytes.subarray(0, Math.floor(bytes.length * 0.47)));
    });
    observeChildren(t);
    const notices = [];
    await assert.rejects(consume(await localSource(fixture.url).open(track(30), new AbortController().signal, {
      onRecovery: notice => { notices.push(notice); },
    })), { code: 'unavailable' });
    assert.deepEqual(notices, []);
    assert.equal(fixture.requests.length, 1);
  });

test('source recovery: a server ignoring the resume Range cannot duplicate a song into success',
  { skip, timeout: 15000 }, async t => {
    const bytes = compressedMedia(t, { ...compressedCases[0], seconds: 30 });
    let first = true;
    const fixture = await server(t, (request, response) => {
      if (first) {
        first = false;
        sendWave(request, response, bytes, { cut: Math.floor(bytes.length * 0.47), contentType: 'audio/webm' });
      } else {
        response.writeHead(200, { 'Content-Type': 'audio/webm', 'Content-Length': bytes.length, Connection: 'close' });
        response.end(bytes);
      }
    });
    observeChildren(t);
    const notices = [];
    await assert.rejects(consume(await localSource(fixture.url).open(track(30), new AbortController().signal, {
      onRecovery: notice => { notices.push(notice); },
    })), { code: 'unavailable' });
    assert.equal(notices.some(notice => notice.type === 'recovered'), false);
    assert.ok(notices.length <= 2);
  });

test('source recovery: notice callback is required before any process can start', async t => {
  const children = observeChildren(t);
  const source = new YouTubeSource('unused-extractor', ffmpeg);
  await assert.rejects(source.open(track(30), new AbortController().signal, {}), { code: 'input' });
  assert.equal(children.length, 0);
});

test('source recovery: two AAC byte-range resumes preserve the exact uninterrupted Opus sequence',
  { skip, timeout: 30000 }, async t => {
    const spec = { ...compressedCases[1], seconds: 30, extra: ['-movflags', '+faststart'] };
    const bytes = compressedMedia(t, spec);
    const cuts = [Math.floor(bytes.length * 0.37), Math.floor(bytes.length * 0.73)];
    let faults = false, cutIndex = 0;
    const fixture = await server(t, (request, response) => {
      const cut = faults && cutIndex < cuts.length ? cuts[cutIndex++] : bytes.length;
      sendWave(request, response, bytes, { cut, contentType: spec.contentType });
    });
    const children = observeChildren(t);
    const source = localSource(fixture.url);
    const reference = await consume(await source.open(track(30), new AbortController().signal));
    faults = true;
    const notices = [];
    const resumed = await consume(await source.open(track(30), new AbortController().signal, {
      onRecovery: notice => { notices.push(notice); },
    }));
    assert.deepEqual(resumed, reference);
    assert.equal(children.length, 2);
    assert.deepEqual(notices.map(notice => notice.type), ['retrying', 'retrying', 'recovered']);
    assert.deepEqual(notices.slice(0, 2).map(notice => notice.byteOffset), cuts);
    assert.equal(notices.at(-1).attempts, 2);
    t.diagnostic(JSON.stringify({ packets: resumed.frames, identicalHash: true, notices }));
  });

test('source recovery: successful HTTP retry cannot conceal a separate decoder error at exit zero',
  { skip, timeout: 10000 }, async t => {
    const bytes = smallOgg();
    observeChildren(t, process.execPath);
    const source = scriptedDecoder(`
      process.stderr.write('[http @ 1] [error] Stream ends prematurely\\n[http @ 1] [warning] Will reconnect at 100 in 0 second(s)\\n[decoder @ 1] [error] Decode failed\\n');
      process.stdout.write(Buffer.from('${bytes.toString('base64')}','base64'));
    `);
    const notices = [];
    await assert.rejects(consume(await source.open(track(0.12), new AbortController().signal, {
      onRecovery: notice => { notices.push(notice); },
    })), { code: 'unavailable' });
    assert.deepEqual(notices.map(notice => notice.type), ['retrying']);
  });

test('source recovery: unknown native retry messages cannot become unreported success',
  { skip, timeout: 10000 }, async t => {
    const bytes = smallOgg();
    observeChildren(t, process.execPath);
    const source = scriptedDecoder(`
      process.stderr.write('[http @ 1] [warning] Will reconnect using an unknown format\\n');
      process.stdout.write(Buffer.from('${bytes.toString('base64')}','base64'));
    `);
    const notices = [];
    await assert.rejects(consume(await source.open(track(0.12), new AbortController().signal, {
      onRecovery: notice => { notices.push(notice); },
    })), error => {
      assert.equal(error.code, 'unavailable');
      assert.match(error.detail, /Unsupported HTTP source recovery diagnostic/);
      return true;
    });
    assert.deepEqual(notices, []);
  });

test('source recovery: byte-zero restart after emitted audio is refused explicitly',
  { skip, timeout: 10000 }, async t => {
    const bytes = smallOgg();
    observeChildren(t, process.execPath);
    const source = scriptedDecoder(`
      process.stdout.write(Buffer.from('${bytes.toString('base64')}','base64'));
      setTimeout(()=>process.stderr.write('[http @ 1] [warning] Will reconnect at 0 in 0 second(s)\\n'),200);
      setInterval(()=>{},1000);
    `);
    const notices = [];
    let emitted = 0;
    await assert.rejects(consume(await source.open(track(30), new AbortController().signal, {
      onRecovery: notice => { notices.push(notice); },
    }), () => { emitted++; }), error => {
      assert.equal(error.code, 'unavailable');
      assert.match(error.detail, /Refusing to restart HTTP audio from byte zero/);
      return true;
    });
    assert.ok(emitted > 0);
    assert.deepEqual(notices, []);
  });

test('source recovery: a stuck notice callback is bounded and cannot leave its decoder alive',
  { skip, timeout: 10000 }, async t => {
    const bytes = smallOgg();
    const children = observeChildren(t, process.execPath);
    const source = scriptedDecoder(`
      process.stderr.write('[http @ 1] [warning] Will reconnect at 100 in 0 second(s)\\n');
      process.stdout.write(Buffer.from('${bytes.toString('base64')}','base64'));
      setInterval(()=>{},1000);
    `);
    await assert.rejects(consume(await source.open(track(0.12), new AbortController().signal, {
      onRecovery: () => new Promise(() => {}),
    })), error => {
      assert.equal(error.code, 'unavailable');
      assert.match(error.detail, /Could not report source recovery/);
      return true;
    });
    assert.ok(children.every(({ child }) => child.exitCode !== null || child.signalCode !== null));
  });

test('source recovery: retry notice reaches its caller while no decoded audio is available',
  { timeout: 10000 }, async t => {
    const children = observeChildren(t, process.execPath);
    const source = scriptedDecoder(`
      process.stderr.write('[http @ 1] [warning] Will reconnect at 100 in 1 second(s)\\n');
      setInterval(()=>{},1000);
    `);
    const controller = new AbortController();
    const notices = [];
    const started = performance.now();
    await assert.rejects(consume(await source.open(track(30), controller.signal, {
      onRecovery: notice => { notices.push(notice); controller.abort(); },
    })), { code: 'cancelled' });
    assert.deepEqual(notices.map(notice => notice.type), ['retrying']);
    assert.ok(performance.now() - started < 3000, 'Retry notification must not wait for the 30s audio-read deadline.');
    assert.ok(children.every(({ child }) => child.exitCode !== null || child.signalCode !== null));
  });

test('source recovery: explicit close aborts notice delivery without needing the caller signal',
  { timeout: 10000 }, async t => {
    const children = observeChildren(t, process.execPath);
    const source = scriptedDecoder(`
      process.stderr.write('[http @ 1] [warning] Will reconnect at 100 in 1 second(s)\\n');
      setInterval(()=>{},1000);
    `);
    const controller = new AbortController();
    let reportedSignal;
    const stream = await source.open(track(30), controller.signal, {
      onRecovery: (_notice, signal) => { reportedSignal = signal; return stream.close(); },
    });
    await assert.rejects(consume(stream), { code: 'cancelled' });
    assert.equal(controller.signal.aborted, false);
    assert.equal(reportedSignal.aborted, true);
    assert.ok(children.every(({ child }) => child.exitCode !== null || child.signalCode !== null));
  });

test('source recovery: private previews keep their pool and do not alter an opted-in playback stream',
  { skip, timeout: 20000 }, async t => {
    const spec = { ...compressedCases[0], seconds: 8 };
    const bytes = compressedMedia(t, spec);
    let interrupt = true;
    const fixture = await server(t, (request, response) => {
      const cut = interrupt ? Math.floor(bytes.length * 0.47) : bytes.length;
      interrupt = false;
      sendWave(request, response, bytes, { cut, contentType: spec.contentType });
    });
    const children = observeChildren(t);
    const source = localSource(fixture.url);
    source.check = async () => {};
    source.resolve = async () => track(8);
    const notices = [];
    let frames = 0, nextAt, done = false, started;
    const firstFrame = new Promise(resolve => { started = resolve; });
    const playing = consume(await source.open(track(8), new AbortController().signal, {
      onRecovery: notice => { notices.push(notice); },
    }), async count => {
      frames = count;
      if (count === 1) started();
      const now = performance.now();
      if (nextAt === undefined || now - nextAt > 100) nextAt = now;
      if (nextAt > now) await wait(nextAt - now);
      nextAt += 20;
    }).then(result => { done = true; return result; });
    t.after(async () => { await playing; });
    await Promise.race([firstFrame, playing]);
    const before = frames;
    const previews = await Promise.all(Array.from({ length: 5 }, () =>
      source.preview(track(8).url, new AbortController().signal)));
    assert.equal(done, false);
    assert.ok(frames > before);
    assert.ok(previews.every(bytes => bytes.length > 1000 && bytes.length <= 256 * 1024));
    const result = await playing;
    assert.ok(result.frames >= 400 && result.frames <= 402);
    assert.deepEqual(notices.map(notice => notice.type), ['retrying', 'recovered']);
    const captures = children.filter(entry => entry.args[entry.args.indexOf('-t') + 1] === '10');
    const peak = Math.max(...captures.map(entry => captures.filter(other =>
      other.startedAt <= entry.startedAt && other.closedAt > entry.startedAt).length));
    assert.equal(captures.length, 5);
    assert.equal(children.length, 6, 'Previews must not restart the playback decoder.');
    assert.ok(peak >= 2 && peak <= 4);
    assert.ok(captures.every(entry => !entry.args.includes('-reconnect') &&
      entry.args[entry.args.indexOf('-loglevel') + 1] === 'error'));
    t.diagnostic(JSON.stringify({ playbackFrames: result.frames, previewProcesses: captures.length, peak }));
  });

test('source reliability: 235s compressed input survives full real-time 20ms backpressure',
  { skip: skip || (process.env.MONKY_MUSIC_LONG_SOURCE_TEST !== '1' && 'Set MONKY_MUSIC_LONG_SOURCE_TEST=1 for real-time source validation.'),
    timeout: 300000 }, async t => {
    const spec = compressedCases[0];
    const bytes = compressedMedia(t, spec);
    let interrupt = false;
    const cut = Math.floor(bytes.length * 0.47);
    const fixture = await server(t, (request, response) => {
      const shouldCut = interrupt;
      interrupt = false;
      sendWave(request, response, bytes, { contentType: spec.contentType, cut: shouldCut ? cut : bytes.length });
    });
    const children = observeChildren(t);
    const source = localSource(fixture.url);
    const reference = await consume(await source.open(track(spec.seconds), new AbortController().signal));
    interrupt = true;
    const notices = [];
    let firstAt, lastAt, firstWall, lastWall, nextAt;
    const paced = await consume(await source.open(track(spec.seconds), new AbortController().signal, {
      onRecovery: notice => { notices.push(notice); },
    }), async () => {
      const now = performance.now();
      if (nextAt === undefined || now - nextAt > 100) nextAt = now;
      const delay = nextAt - now;
      if (delay > 0) await wait(delay);
      firstAt ??= performance.now();
      firstWall ??= Date.now();
      lastAt = performance.now();
      lastWall = Date.now();
      nextAt += 20;
    });
    assert.deepEqual(paced, reference, 'Sustained consumer backpressure must not lose or duplicate packets.');
    assert.deepEqual(notices.map(notice => notice.type), ['retrying', 'recovered']);
    assert.equal(notices[0].byteOffset, cut);
    assert.equal(children.length, 2);
    const expectedMs = (paced.frames - 1) * 20;
    const elapsedMs = lastAt - firstAt;
    const wallMs = lastWall - firstWall;
    assert.ok(elapsedMs >= expectedMs - 10 && elapsedMs - expectedMs < 3000);
    assert.ok(Math.abs(wallMs - elapsedMs) < 2000, 'Wall and monotonic time must not imply a half-speed clock.');
    t.diagnostic(JSON.stringify({ packets: paced.frames, expectedMs, elapsedMs, wallMs,
      identicalPacketHash: true, sourceProcesses: children.length, notices }));
  });
