const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const processes = require('node:child_process');
const { test, after } = require('node:test');
const suiteHome = fs.mkdtempSync(path.join(__dirname, '.music-tools-home-'));
const previousEnv = {};
for (const [key, value] of Object.entries({
  HOME: suiteHome, USERPROFILE: suiteHome, PM2_HOME: path.join(suiteHome, 'pm2'),
  MONKY_BOT_LOCALE: 'pt-BR', MONKYBOT_LOCALE: 'pt-BR',
})) {
  previousEnv[key] = process.env[key];
  process.env[key] = value;
}
after(() => {
  fs.rmSync(suiteHome, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
const { MusicError } = require('../dist/music/errors');
const checks = require('../dist/music/toolChecks');
const paths = require('../dist/music/toolPaths');
const capture = require('../dist/music/process');
// Native process fixtures must remain independent of the nested installer mocks below.
const nativeCapture = capture.capture;
const nativeSpawn = processes.spawn;
const download = require('../dist/cli/musicToolDownload');
const tools = require('../dist/cli/musicTools');
const { cliT, setCliLocale } = require('../dist/cli/i18n');
const progressRenderer = require('../dist/cli/progress');

const checksum = value => createHash('sha256').update(value).digest('hex');
const signal = () => new AbortController().signal;

function directory(t) {
  const root = fs.mkdtempSync(path.join(suiteHome, 'music-tools-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  return root;
}

function installation(t, {
  platform = 'linux', arch = 'x64', invalidHash = false, slowListing = false, deferExtraction = false,
} = {}) {
  const root = directory(t);
  const env = { PATH: '' };
  const requests = [];
  const probes = [];
  const binaries = { ytDlp: Buffer.from('synthetic yt-dlp'), ffmpeg: Buffer.from('synthetic FFmpeg archive') };
  const progress = [];
  const transfers = [];
  const events = [];
  const extractions = [];
  let finishExtraction;
  let started;
  const extractionStarted = new Promise(resolve => { started = resolve; });
  t.mock.method(capture, 'capture', async (executable, args) => {
    probes.push({ executable, args });
    if (executable === process.execPath) return 'v22.23.2\n';
    if (executable === 'yt-dlp' || executable === 'ffmpeg') throw new MusicError('tools', `spawn ${executable} ENOENT`);
    if (executable === 'tar') {
      if (args[0] === '-tf' && slowListing) throw new MusicError('timeout');
      assert.deepEqual(args, ['--version'], 'Extraction must not perform a preliminary archive listing.');
      return 'bsdtar 3.8';
    }
    assert.ok(fs.existsSync(executable), 'Only the downloaded candidate or installed executable may be probed.');
    if (args[0] === '-version') {
      assert.deepEqual(args, ['-version']);
      if (platform === 'win32') assert.ok(executable.endsWith('.exe'), 'Windows candidates need their executable extension.');
      return 'ffmpeg version 7.1-fixture';
    }
    if (args.includes('-encoders')) return ' A..... libopus Opus encoder\n';
    assert.deepEqual(args, [...checks.youtubeExtractorArgs(process.execPath), '--version']);
    if (platform === 'win32') assert.ok(executable.endsWith('.exe'), 'Windows candidates need their executable extension.');
    return '2026.08.19';
  });
  t.mock.method(global, 'fetch', async (input, options) => {
    const url = String(input);
    requests.push(url);
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Authorization, undefined, 'Public tool requests must never receive a bot/GitHub token.');
    for (const tool of ['ytDlp', 'ffmpeg']) {
      const repository = tool === 'ytDlp' ? 'yt-dlp/yt-dlp' : 'yt-dlp/FFmpeg-Builds';
      const name = tools.mediaAssetName(tool, platform, arch);
      const assetUrl = `https://github.com/${repository}/releases/download/fixture/${name}`;
      if (url === `https://api.github.com/repos/${repository}/releases/latest`) {
        return new Response(JSON.stringify({
          tag_name: 'fixture', draft: false, prerelease: false,
          assets: [{ name, browser_download_url: assetUrl, size: binaries[tool].length,
            digest: `sha256:${invalidHash ? '0'.repeat(64) : checksum(binaries[tool])}` }],
        }));
      }
      if (url === assetUrl) return new Response(new ReadableStream({
        start(controller) {
          const split = Math.floor(binaries[tool].length / 2);
          controller.enqueue(binaries[tool].subarray(0, split));
          controller.enqueue(binaries[tool].subarray(split));
          controller.close();
        },
      }));
    }
    assert.fail(`Unexpected network request: ${url}`);
  });
  t.mock.method(processes, 'spawn', (command, args) => {
    extractions.push({ command, args });
    assert.equal(command, 'tar');
    assert.equal(args[0], '-xOf');
    assert.equal(args[2], '--');
    const archiveRoot = tools.mediaAssetName('ffmpeg', platform, arch).replace(/\.tar\.xz$|\.zip$/, '');
    assert.equal(args[3], `${archiveRoot}/bin/ffmpeg${platform === 'win32' ? '.exe' : ''}`);
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.exitCode = null;
    child.signalCode = null;
    child.kill = () => assert.fail('A completed fixture must not need termination.');
    finishExtraction = (code = 0, diagnostic = '') => {
      child.stdout.end(code === 0 ? 'synthetic extracted FFmpeg' : '');
      child.stderr.end(diagnostic);
      child.exitCode = code;
      child.emit('close', code);
    };
    started(child);
    if (!deferExtraction) queueMicrotask(() => finishExtraction());
    return child;
  });
  return { root, env, requests, probes, progress, transfers, events, extractions, binaries,
    extractionStarted, finishExtraction: (...args) => finishExtraction(...args),
    options: {
      directory: root, env, platform, arch,
      progress: message => { progress.push(message); events.push({ stage: message }); },
      downloadProgress: (tool, value) => {
        transfers.push({ tool, ...value });
        events.push({ tool, ...value });
      },
    } };
}

test('tool paths preserve explicit overrides, prefer managed tools, then use PATH names', t => {
  const root = directory(t);
  assert.deepEqual(paths.musicToolPaths({}, root, 'linux'), {
    node: process.execPath, ytDlp: 'yt-dlp', ffmpeg: 'ffmpeg',
  });
  const managed = paths.managedMusicTool('ytDlp', root, 'win32');
  fs.writeFileSync(managed, 'fixture');
  assert.equal(paths.musicToolPaths({}, root, 'win32').ytDlp, managed);
  assert.equal(paths.musicToolPaths({ MONKY_MUSIC_YTDLP: 'explicit-missing' }, root, 'win32').ytDlp, 'explicit-missing');
  const ffmpeg = path.join(root, 'ffmpeg.exe');
  fs.writeFileSync(ffmpeg, 'fixture');
  assert.equal(paths.absoluteMusicToolPaths({ node: process.execPath, ytDlp: managed, ffmpeg: 'ffmpeg' },
    { Path: `"${root}"` }, 'win32').ffmpeg, ffmpeg);
});

test('diagnostics identify the failed tool without losing its safe technical reason', async () => {
  const runtime = { node: 'node-fixture', ytDlp: 'yt-fixture', ffmpeg: 'ff-fixture' };
  await assert.rejects(checks.checkMusicTool('ffmpeg', runtime, signal(), async () => {
    throw new MusicError('tools', 'spawn ff-fixture ENOENT token=secret https://private.example.test/path');
  }), error => error instanceof checks.MusicToolError && error.tool === 'ffmpeg' &&
    error.code === 'tools' && error.detail.includes('ENOENT') && !error.detail.includes('secret') &&
    !error.detail.includes('private.example'));
  await assert.rejects(checks.checkMusicTool('node', runtime, signal(), async () => 'v20.0.0'),
    error => error.code === 'runtime' && error.detail.includes('22+'));
  await assert.rejects(checks.checkMusicTool('ffmpeg', runtime, signal(), async (_executable, args) =>
    args[0] === '-version' ? 'ffmpeg version 7.1-fixture' : 'pcm_s16le'),
    error => error.tool === 'ffmpeg' && error.detail.includes('libopus'));
});

test('version probes reject empty, malformed or provider JSON output without exposing it', async () => {
  const runtime = { node: 'node-fixture', ytDlp: 'yt-fixture', ffmpeg: 'ff-fixture' };
  for (const [tool, values] of [
    ['node', ['', 'v22.garbage', 'v22.0.0\nunexpected', '{"token":"fixture-secret"}']],
    ['ytDlp', ['', 'another executable', '2026.08.19\nunexpected', '{"title":"fixture-secret"}']],
    ['ffmpeg', ['--enable-libopus', 'libopus is unavailable', '{"libopus":"fixture-secret"}']],
  ]) {
    for (const value of values) {
      await assert.rejects(checks.checkMusicTool(tool, runtime, signal(), async () => value), error => {
        assert.equal(error.tool, tool);
        assert.equal(error.code, tool === 'node' ? 'runtime' : 'tools');
        assert.doesNotMatch(error.detail, /fixture-secret|"token"|"title"|"libopus"/);
        return true;
      });
    }
  }
  for (const version of ['2026.08.19', '2026.08.19.232506', '2026.08.19+custom.1']) {
    assert.equal(await checks.checkMusicTool('ytDlp', runtime, signal(), async () => `${version}\n`), version);
  }
});

test('native checks retain finite per-operation deadlines and output bounds', async () => {
  const runtime = { node: 'node-fixture', ytDlp: 'yt-fixture', ffmpeg: 'ff-fixture' };
  const calls = [];
  await checks.checkMusicTools(runtime, signal(), async (executable, args, _signal, timeoutMs, limit) => {
    calls.push({ executable, args, timeoutMs, limit });
    if (executable === runtime.node) return 'v22.0.0';
    if (executable === runtime.ytDlp) return '2026.08.19';
    return args[0] === '-version' ? 'ffmpeg version 7.1-fixture' : ' A....D libopus Opus';
  });
  assert.deepEqual(calls, [
    { executable: runtime.node, args: ['--version'], timeoutMs: 5000, limit: 65536 },
    { executable: runtime.ytDlp, args: [...checks.youtubeExtractorArgs(runtime.node), '--version'], timeoutMs: 30_000, limit: 65536 },
    { executable: runtime.ffmpeg, args: ['-version'], timeoutMs: 15_000, limit: 65536 },
    { executable: runtime.ffmpeg, args: ['-hide_banner', '-encoders'], timeoutMs: 15_000, limit: 131072 },
  ]);
});

test('a native cold-start fixture taking six seconds passes without bypassing executable checks', { timeout: 20_000 }, async () => {
  const runtime = { node: process.execPath, ytDlp: 'slow-yt-fixture', ffmpeg: 'slow-ff-fixture' };
  const started = performance.now();
  const versions = await Promise.all(['ytDlp', 'ffmpeg'].map(tool =>
    checks.checkMusicTool(tool, runtime, signal(), (_executable, args, abortSignal, timeoutMs, limit) =>
      nativeCapture(process.execPath, ['-e',
        `setTimeout(() => console.log(${JSON.stringify(tool === 'ytDlp' ? '2026.08.19' :
          args[0] === '-version' ? 'ffmpeg version 7.1-fixture' : ' A....D libopus Opus')}), 6000)`,
      ], abortSignal, timeoutMs, limit))));
  assert.deepEqual(versions, ['2026.08.19', '7.1-fixture']);
  assert.ok(performance.now() - started >= 12_000, 'Both intentional FFmpeg probes must exercise the former five-second deadline.');
});

test('existing tools are checked exactly once before preparation returns without redundant probes', async t => {
  const root = directory(t);
  const calls = [];
  const progress = [];
  t.mock.method(capture, 'capture', async (executable, args) => {
    calls.push({ executable, args });
    if (executable === process.execPath) return 'v22.0.0';
    if (args[0] === '-version') return 'ffmpeg version 7.1-fixture';
    if (args.includes('-encoders')) return ' A....D libopus Opus';
    return '2026.08.19';
  });
  t.mock.method(global, 'fetch', () => assert.fail('Healthy tools must not download.'));
  const result = await tools.ensureMusicTools({ directory: root, env: { PATH: '' }, progress: message => progress.push(message) });
  assert.deepEqual(calls, [
    { executable: result.node, args: ['--version'] },
    { executable: result.ytDlp, args: [...checks.youtubeExtractorArgs(result.node), '--version'] },
    { executable: result.ffmpeg, args: ['-version'] },
    { executable: result.ffmpeg, args: ['-hide_banner', '-encoders'] },
  ]);
  assert.equal(progress.filter(message => message === cliT('music.available', { tool: checks.MUSIC_TOOL_NAMES.ytDlp })).length, 1);
  assert.equal(progress.filter(message => message === cliT('music.available', { tool: checks.MUSIC_TOOL_NAMES.ffmpeg })).length, 1);
  assert.deepEqual(fs.readdirSync(root), []);
});

for (const platform of ['linux', 'win32']) {
  test(`missing tools install privately and repeated preparation reuses them (${platform})`, async t => {
    const f = installation(t, { platform });
    const result = await tools.ensureMusicTools(f.options);
    assert.equal(result.ytDlp, paths.managedMusicTool('ytDlp', f.root, platform));
    assert.equal(result.ffmpeg, paths.managedMusicTool('ffmpeg', f.root, platform));
    assert.equal(fs.readFileSync(result.ytDlp, 'utf8'), 'synthetic yt-dlp');
    assert.equal(fs.readFileSync(result.ffmpeg, 'utf8'), 'synthetic extracted FFmpeg');
    assert.equal(f.requests.length, 4);
    assert.equal(f.probes.filter(probe => probe.executable === process.execPath).length, 1);
    assert.equal(f.probes.filter(probe => probe.executable.includes('.install-')).length, 3,
      'yt-dlp has one probe and FFmpeg has explicit version and encoder probes before rename.');
    assert.equal(f.probes.some(probe => probe.executable === result.ytDlp || probe.executable === result.ffmpeg), false);
    assert.ok(!fs.readdirSync(f.root).some(name => name.startsWith('.install-')));
    const probesBeforeReuse = f.probes.length;
    const initialProgress = f.progress.slice();
    const again = await tools.ensureMusicTools(f.options);
    assert.deepEqual(again, result);
    assert.deepEqual(f.probes.slice(probesBeforeReuse).map(probe => probe.executable),
      [result.node, result.ytDlp, result.ffmpeg, result.ffmpeg]);
    assert.equal(f.requests.length, 4, 'Healthy tools must not download again.');
    assert.ok(f.progress.some(message => message.includes('SHA-256')));
    const checksumVerification = f.progress.indexOf(cliT('music.verifyingDownload', { tool: checks.MUSIC_TOOL_NAMES.ffmpeg }));
    const extraction = f.progress.indexOf(cliT('music.extracting'));
    const verification = initialProgress.lastIndexOf(cliT('music.verifyingExecutable', { tool: checks.MUSIC_TOOL_NAMES.ffmpeg }));
    assert.ok(checksumVerification >= 0 && extraction > checksumVerification && verification > extraction);
    assert.equal(f.extractions.length, 1, 'Progress must not add a second extraction/listing pass.');
    for (const tool of ['ytDlp', 'ffmpeg']) {
      const transfers = f.transfers.filter(value => value.tool === tool);
      const size = f.binaries[tool].length;
      assert.deepEqual(transfers.map(value => value.receivedBytes), [0, Math.floor(size / 2), size, size]);
      assert.ok(transfers.every(value => value.totalBytes === size && value.receivedBytes <= size));
      assert.equal(transfers.at(-1).done, true);
      const complete = f.events.findIndex(event => event.tool === tool && event.done);
      const checked = f.events.findIndex(event => event.stage === cliT('music.verifyingDownload', { tool: checks.MUSIC_TOOL_NAMES[tool] }));
      assert.ok(checked > complete, 'Verification is a distinct stage after the transfer.');
    }
  });
}

test('checksum mismatch never executes or publishes the downloaded file', async t => {
  const f = installation(t, { invalidHash: true });
  await assert.rejects(tools.ensureMusicTools(f.options), /checksum/);
  assert.deepEqual(fs.readdirSync(f.root), []);
  assert.equal(f.probes.some(probe => probe.executable.includes('.install-')), false);
});

test('a verified download with an invalid executable version is never published or reported available', async t => {
  const f = installation(t);
  const run = capture.capture;
  t.mock.method(capture, 'capture', async (executable, ...args) => {
    if (executable.includes('.install-')) return '{"token":"fixture-secret","title":"provider JSON"}';
    return run(executable, ...args);
  });
  await assert.rejects(tools.ensureMusicTools(f.options), error => {
    assert.match(error.message, /yt-dlp version/);
    assert.doesNotMatch(error.message, /fixture-secret|provider JSON/);
    return true;
  });
  assert.deepEqual(fs.readdirSync(f.root), []);
  assert.equal(f.progress.some(message => /disponível|instalado/.test(message)), false);
});

test('a slow compressed archive does not require a separately timed full listing before extraction', async t => {
  const f = installation(t, { slowListing: true });
  await tools.ensureMusicTools(f.options);
  assert.equal(f.probes.some(probe => probe.executable === 'tar' && probe.args[0] === '-tf'), false);
});

test('extraction can exceed 30 seconds while remaining within the existing preparation deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = installation(t, { deferExtraction: true });
  const pending = tools.ensureMusicTools(f.options);
  await f.extractionStarted;
  t.mock.timers.tick(35_000);
  f.finishExtraction();
  const result = await pending;
  assert.equal(fs.readFileSync(result.ffmpeg, 'utf8'), 'synthetic extracted FFmpeg');
});

for (const failure of ['deadline', 'cancel', 'tar']) {
  test(`failed extraction terminates its owned process and removes staging files (${failure})`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = installation(t, { deferExtraction: true });
    const controller = new AbortController();
    const terminated = [];
    t.mock.method(capture, 'terminate', async child => {
      terminated.push(child);
      if (child.exitCode === null) {
        child.signalCode = 'SIGTERM';
        child.emit('close', null);
      }
    });
    const pending = tools.ensureMusicTools({ ...f.options, signal: controller.signal });
    const child = await f.extractionStarted;
    const rejection = assert.rejects(pending, failure === 'deadline' ? /Tempo limite/ :
      failure === 'cancel' ? /fixture cancel/ : /Não foi possível extrair FFmpeg.*fixture extraction error/);
    if (failure === 'deadline') t.mock.timers.tick(10 * 60_000 + 1);
    else if (failure === 'cancel') controller.abort(new Error('fixture cancel'));
    else f.finishExtraction(1, 'fixture extraction error');
    await rejection;
    assert.deepEqual(terminated, [child]);
    assert.ok(child.stdout.destroyed && child.stderr.destroyed);
    assert.equal(fs.existsSync(paths.managedMusicTool('ffmpeg', f.root, 'linux')), false);
    assert.ok(!fs.readdirSync(f.root).some(name => name.startsWith('.install-')));
  });
}

test('an invalid explicit tool override never downloads or replaces another executable', async t => {
  const f = installation(t);
  const custom = path.join(f.root, 'operator-tool');
  fs.writeFileSync(custom, 'keep-me');
  t.mock.method(capture, 'capture', async executable => {
    if (executable === process.execPath) return 'v22.23.2';
    throw new MusicError('tools', 'operator tool unavailable');
  });
  await assert.rejects(tools.ensureMusicTools({
    ...f.options, env: { ...f.env, MONKY_MUSIC_YTDLP: custom },
  }), /MONKY_MUSIC_YTDLP.*não será substituído/);
  assert.deepEqual(f.requests, []);
  assert.equal(fs.readFileSync(custom, 'utf8'), 'keep-me');
});

test('cancellation and unsupported platforms do not start a download', async t => {
  const f = installation(t);
  const controller = new AbortController();
  controller.abort(new Error('fixture cancelled'));
  await assert.rejects(tools.ensureMusicTools({ ...f.options, signal: controller.signal }), /cancelled/);
  await assert.rejects(tools.ensureMusicTools({ ...f.options, platform: 'freebsd' }), /freebsd/);
  assert.deepEqual(f.requests, []);
  assert.deepEqual(fs.readdirSync(f.root), []);
});

test('a stalled existing executable is reported rather than silently replaced', async t => {
  const f = installation(t);
  t.mock.method(capture, 'capture', async executable => {
    if (executable === process.execPath) return 'v22.23.2';
    throw new MusicError('timeout', 'fixture stalled');
  });
  await assert.rejects(tools.ensureMusicTools(f.options), /fixture stalled/);
  assert.deepEqual(f.requests, []);
  assert.equal(f.progress.some(message => /disponível|instalado/.test(message)), false);
});

test('cancellation after the last successful probe still prevents preparation from succeeding', async t => {
  const root = directory(t);
  const controller = new AbortController();
  t.mock.method(capture, 'capture', async (executable, args) => executable === process.execPath ? 'v22.0.0'
    : args[0] === '-version' ? 'ffmpeg version 7.1-fixture'
    : args.includes('-encoders') ? ' A....D libopus Opus' : '2026.08.19');
  t.mock.method(global, 'fetch', () => assert.fail('No downloads after cancellation.'));
  await assert.rejects(tools.ensureMusicTools({
    directory: root, env: { PATH: '' }, signal: controller.signal,
    progress: message => {
      if (message === cliT('music.available', { tool: checks.MUSIC_TOOL_NAMES.ffmpeg })) {
        controller.abort(new Error('fixture cancelled after checks'));
      }
    },
  }), /fixture cancelled after checks/);
  assert.deepEqual(fs.readdirSync(root), []);
});

for (const locale of ['pt-BR', 'en']) {
  test(`music tool errors include localized guidance and safe bounded native details (${locale})`, async t => {
    setCliLocale(locale);
    t.after(() => setCliLocale('pt-BR'));
    const native = 'Media process exceeded 30000 ms. https://rr1.googlevideo.com/videoplayback?sig=fixture-secret token=fixture-secret';
    const failure = new checks.MusicToolError('ytDlp', 'fixture-ytdlp', 'timeout', native);
    const result = download.toolDownloadError(failure);
    assert.match(result.message, locale === 'en' ? /Music tool preparation failed.*Loading timed out/ : /Preparação.*excedeu o tempo limite/);
    assert.match(result.message, /yt-dlp: Media process exceeded 30000 ms/);
    assert.doesNotMatch(capture.errorDiagnostic(result), /fixture-secret|googlevideo/);
    assert.ok(capture.errorDiagnostic(result).length <= 1024);
    const logs = [];
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'error', message => logs.push(message));
    t.mock.method(checks, 'checkMusicTool', async tool => {
      if (tool === 'ytDlp') throw failure;
      return tool === 'node' ? 'v22.0.0' : '7.1-fixture';
    });
    await assert.rejects(tools.checkMusicToolsCommand(), /monkybot music-setup/);
    assert.equal(logs.length, 1);
    assert.match(logs[0], locale === 'en' ? /Loading timed out/ : /excedeu o tempo limite/);
    assert.doesNotMatch(logs[0], /fixture-secret|googlevideo/);
  });
}

test('queue-slot timeouts have a distinct bounded diagnostic and release their slots', { timeout: 15_000 }, async t => {
  const controllers = Array.from({ length: 5 }, () => new AbortController());
  const started = [];
  t.mock.method(processes, 'spawn', (...args) => {
    const child = nativeSpawn(...args);
    if (args[0] === process.execPath) started.push(child);
    return child;
  });
  const active = controllers.slice(0, 4).map(controller =>
    nativeCapture(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], controller.signal, 60_000)
      .catch(error => error));
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(started.length, 4);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const waiting = nativeCapture(process.execPath, ['-e', 'process.exit(0)'], controllers[4].signal);
    const rejected = assert.rejects(waiting, error => {
      assert.equal(error.code, 'timeout');
      assert.match(error.detail, /Waiting for a media process slot exceeded 30000 ms/);
      return true;
    });
    t.mock.timers.tick(30_000);
    await rejected;
    assert.equal(started.length, 4, 'A timed-out waiter must never start a native process.');
  } finally {
    t.mock.timers.reset();
    controllers.forEach(controller => controller.abort());
    const failures = await Promise.all(active);
    assert.deepEqual(failures.map(error => error.code), ['cancelled', 'cancelled', 'cancelled', 'cancelled']);
  }
  assert.ok(started.every(child => child.exitCode !== null || child.signalCode !== null));
  assert.equal(await nativeCapture(process.execPath, ['-e', "process.stdout.write('released')"], signal()), 'released');
});

test('public tool downloads reject unapproved redirects before making another request', async t => {
  const root = directory(t);
  const request = t.mock.method(global, 'fetch', async () =>
    new Response(null, { status: 302, headers: { location: 'https://attacker.example.test/file' } }));
  await assert.rejects(download.downloadToolAsset({
    name: 'fixture', url: 'https://github.com/yt-dlp/yt-dlp/releases/download/test/fixture',
    size: 3, sha256: checksum(Buffer.from('abc')), version: 'test',
  }, path.join(root, 'download'), signal()), /origem não autorizada/);
  assert.equal(request.mock.callCount(), 1);
});

for (const value of [
  { size: 2, data: 'abc', expected: /excedeu/ },
  { size: 4, data: 'abc', expected: /tamanho\/checksum/ },
  { size: 3, data: 'abd', expected: /tamanho\/checksum/ },
]) {
  test(`tool download rejects size/hash mismatch (${value.size}, ${value.data})`, async t => {
    const root = directory(t);
    t.mock.method(global, 'fetch', async () => new Response(value.data));
    await assert.rejects(download.downloadToolAsset({
      name: 'fixture', url: 'https://github.com/yt-dlp/yt-dlp/releases/download/test/fixture',
      size: value.size, sha256: checksum(Buffer.from('abc')), version: 'test',
    }, path.join(root, 'download'), signal()), value.expected);
  });
}

test('FFmpeg extraction targets only the exact executable in supported official archives', () => {
  for (const build of ['linux64', 'linuxarm64', 'win32', 'win64', 'winarm64']) {
    const windows = build.startsWith('win');
    const root = `ffmpeg-master-latest-${build}-gpl`;
    assert.equal(download.ffmpegArchiveEntry(`${root}${windows ? '.zip' : '.tar.xz'}`),
      `${root}/bin/ffmpeg${windows ? '.exe' : ''}`);
  }
  for (const name of [
    '../ffmpeg-master-latest-linux64-gpl.tar.xz',
    'unsafe/ffmpeg-master-latest-win64-gpl.zip',
    'ffmpeg-master-latest-win64-gpl-shared.zip',
    'ffmpeg-master-latest-linux64-gpl.zip',
    'ffmpeg-master-latest-win64-gpl.tar.xz',
    'ffmpeg-master-latest-linux64-gpl.tar.xz\n',
    'other.tar.xz',
  ]) {
    assert.throws(() => download.ffmpegArchiveEntry(name), /distribuição oficial suportada/);
  }
});

test('tool release metadata must match the exact official asset and provide a checksum', async t => {
  const asset = { name: 'yt-dlp_linux', size: 3,
    browser_download_url: 'https://attacker.example.test/yt-dlp_linux', digest: `sha256:${'a'.repeat(64)}` };
  t.mock.method(global, 'fetch', async () => new Response(JSON.stringify({
    tag_name: 'fixture', draft: false, prerelease: false, assets: [asset],
  })));
  await assert.rejects(download.findToolAsset('yt-dlp/yt-dlp', 'yt-dlp_linux', signal()), /arquivo válido/);
});

test('official checksum manifests are used when the release API does not supply asset digests', async t => {
  const name = 'ffmpeg-master-latest-linux64-gpl.tar.xz';
  const prefix = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/';
  const sha256 = checksum(Buffer.from('fixture'));
  t.mock.method(global, 'fetch', async input => new Response(String(input).endsWith('checksums.sha256')
    ? `${sha256}  ${name}\n` : JSON.stringify({
      tag_name: 'latest', draft: false, prerelease: false,
      assets: [{ name, size: 7, browser_download_url: prefix + name },
        { name: 'checksums.sha256', browser_download_url: prefix + 'checksums.sha256' }],
    })));
  const asset = await download.findToolAsset('yt-dlp/FFmpeg-Builds', name, signal());
  assert.equal(asset.sha256, sha256);
  assert.equal(asset.url, prefix + name);
});

for (const change of [
  { draft: true }, { prerelease: true }, { tag_name: '../invalid' }, { assets: [] },
  { assets: [{ name: 'yt-dlp_linux', size: 351 * 1024 * 1024,
    browser_download_url: 'https://github.com/yt-dlp/yt-dlp/releases/download/fixture/yt-dlp_linux' }] },
  { assets: [{ name: 'yt-dlp_linux', size: 4,
    browser_download_url: 'https://github.com/yt-dlp/yt-dlp/releases/download/fixture/yt-dlp_linux' }] },
]) {
  test(`invalid or unverifiable tool release is rejected (${JSON.stringify(change)})`, async t => {
    t.mock.method(global, 'fetch', async () => new Response(JSON.stringify({
      tag_name: 'fixture', draft: false, prerelease: false, assets: [], ...change,
    })));
    await assert.rejects(download.findToolAsset('yt-dlp/yt-dlp', 'yt-dlp_linux', signal()),
      /release de ferramenta inválida|arquivo válido|checksum verificável/);
  });
}

test('GNU tar without xz produces a prerequisite error before downloading FFmpeg', async t => {
  const f = installation(t);
  t.mock.method(capture, 'capture', async (executable, args) => {
    if (executable === process.execPath) return 'v22.23.2';
    if (executable === 'yt-dlp') return '2026.08.19';
    if (executable === 'tar' && args[0] === '--version') return 'tar (GNU tar) 1.35';
    throw new MusicError('tools', `spawn ${executable} ENOENT`);
  });
  await assert.rejects(tools.ensureMusicTools(f.options), /tar e xz-utils/);
  assert.deepEqual(f.requests, []);
});

test('cancelling an in-flight download removes its unverified staging files', async t => {
  const f = installation(t);
  const controller = new AbortController();
  const original = global.fetch;
  t.mock.method(global, 'fetch', async (url, options) => {
    if (String(url).startsWith('https://api.github.com/')) return original(url, options);
    controller.abort(new Error('fixture cancelled download'));
    throw controller.signal.reason;
  });
  await assert.rejects(tools.ensureMusicTools({ ...f.options, signal: controller.signal }), /fixture cancelled download/);
  assert.deepEqual(fs.readdirSync(f.root), []);
});

test('macOS system installation requires explicit approval before invoking Homebrew install', async t => {
  const root = directory(t);
  const commands = [];
  t.mock.method(capture, 'capture', async (command, args) => {
    commands.push([command, args]);
    if (command === process.execPath) return 'v22.23.2';
    if (command === 'yt-dlp') return '2026.08.19';
    if (command === 'brew' && args[0] === '--version') return 'Homebrew 5';
    throw new MusicError('tools', 'FFmpeg not found');
  });
  await assert.rejects(tools.ensureMusicTools({
    directory: root, env: { PATH: '' }, platform: 'darwin', arch: 'arm64',
  }), /Autorize.*interativa/);
  assert.equal(commands.some(([command, args]) => command === 'brew' && args.includes('install')), false);
});

test('unsupported Node runtime is reported before downloads and is never silently upgraded', async t => {
  const f = installation(t);
  t.mock.method(capture, 'capture', async executable => {
    assert.equal(executable, process.execPath);
    return 'v20.19.0';
  });
  await assert.rejects(tools.ensureMusicTools(f.options), /22\+/);
  assert.deepEqual(f.requests, []);
  assert.deepEqual(fs.readdirSync(f.root), []);
  assert.deepEqual(f.extractions, []);
});

test('download progress remains bounded and never marks a short transfer as 100 percent', async t => {
  const root = directory(t);
  const progress = [];
  t.mock.method(global, 'fetch', async () => new Response('abc'));
  await assert.rejects(download.downloadToolAsset({
    name: 'fixture', url: 'https://github.com/yt-dlp/yt-dlp/releases/download/test/fixture',
    size: 4, sha256: checksum(Buffer.from('abcd')), version: 'test',
  }, path.join(root, 'download'), signal(), { onProgress: value => progress.push(value) }), /tamanho\/checksum/);
  assert.deepEqual(progress.map(value => value.receivedBytes), [0, 3, 3]);
  assert.ok(progress.every(value => value.receivedBytes < value.totalBytes));
});

test('tool download progress is reported only after full writes, including partial filesystem writes', async t => {
  const root = directory(t);
  const open = fs.promises.open;
  let writes = 0;
  t.mock.method(fs.promises, 'open', async (...args) => {
    const file = await open(...args);
    return {
      write: (buffer, offset, length) => { writes++; return file.write(buffer, offset, Math.min(1, length)); },
      sync: () => file.sync(), close: () => file.close(),
    };
  });
  const progress = [];
  t.mock.method(global, 'fetch', async () => new Response('abc'));
  const output = path.join(root, 'download');
  await download.downloadToolAsset({
    name: 'fixture', url: 'https://github.com/yt-dlp/yt-dlp/releases/download/test/fixture',
    size: 3, sha256: checksum(Buffer.from('abc')), version: 'test',
  }, output, signal(), { onProgress: value => progress.push(value) });
  assert.equal(writes, 3);
  assert.deepEqual(progress.map(value => value.receivedBytes), [0, 3, 3]);
  assert.equal(fs.readFileSync(output, 'utf8'), 'abc');
});

test('exclusive tool download staging never overwrites another file', async t => {
  const root = directory(t);
  const output = path.join(root, 'download');
  fs.writeFileSync(output, 'keep this file');
  const fetch = t.mock.method(global, 'fetch', () => assert.fail('An existing file must fail before network access.'));
  await assert.rejects(download.downloadToolAsset({
    name: 'fixture', url: 'https://github.com/yt-dlp/yt-dlp/releases/download/test/fixture',
    size: 3, sha256: checksum(Buffer.from('abc')), version: 'test',
  }, output, signal()), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(output, 'utf8'), 'keep this file');
  assert.equal(fetch.mock.callCount(), 0);
});

test('cancellation during final tool verification never publishes or executes its candidate', async t => {
  const f = installation(t);
  const controller = new AbortController();
  await assert.rejects(tools.ensureMusicTools({
    ...f.options, signal: controller.signal,
    progress: message => {
      if (message === cliT('music.verifyingDownload', { tool: checks.MUSIC_TOOL_NAMES.ytDlp })) {
        controller.abort(new Error('fixture cancelled during verification'));
      }
    },
  }), /fixture cancelled during verification/);
  assert.deepEqual(fs.readdirSync(f.root), []);
  assert.equal(f.probes.some(probe => probe.executable.includes('.install-')), false);
});

test('cancelling a stalled tool body releases its reader within the existing deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = installation(t);
  const original = global.fetch;
  let started;
  const reading = new Promise(resolve => { started = resolve; });
  let cancelled = false;
  let body;
  t.mock.method(global, 'fetch', async (url, options) => {
    if (String(url).startsWith('https://api.github.com/')) return original(url, options);
    body = new ReadableStream({
      start(controller) {
        options.signal.addEventListener('abort', () => {
          cancelled = true;
          controller.error(options.signal.reason);
        }, { once: true });
      },
    });
    return new Response(body);
  });
  const pending = tools.ensureMusicTools({
    ...f.options,
    downloadProgress: (_tool, value) => { if (value.receivedBytes === 0) started(); },
  });
  const rejection = assert.rejects(pending, /Tempo limite preparando/);
  await reading;
  t.mock.timers.tick(10 * 60_000 + 1);
  await rejection;
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
  assert.deepEqual(fs.readdirSync(f.root), []);
});

test('progress observer failure cleans unpublished staging without executing a candidate', async t => {
  const f = installation(t);
  await assert.rejects(tools.ensureMusicTools({
    ...f.options,
    downloadProgress: () => { throw new Error('fixture progress failure'); },
  }), /fixture progress failure/);
  assert.deepEqual(fs.readdirSync(f.root), []);
  assert.equal(f.probes.some(probe => probe.executable.includes('.install-')), false);
});

test('music setup stages and failures respect English CLI language selection', async t => {
  setCliLocale('en');
  t.after(() => setCliLocale('pt-BR'));
  const f = installation(t);
  await tools.ensureMusicTools(f.options);
  assert.ok(f.progress.some(message => message.startsWith('Downloading')));
  assert.ok(f.progress.some(message => message.includes('Extracting the executable')));
  assert.ok(f.progress.some(message => message.includes('SHA-256 verified')));
  assert.ok(f.progress.every(message => !/Baixando|Extraindo|Verificando|instalado/.test(message)));
  assert.throws(() => tools.mediaAssetName('ffmpeg', 'freebsd', 'x64'), /Automatic installation/);
});

for (const isTTY of [false, true]) {
  test(`music CLI wires real download bytes into separate finished progress displays (TTY=${isTTY})`, async t => {
    const f = installation(t, { platform: process.platform, arch: process.arch });
    const displays = [];
    const stages = [];
    const create = progressRenderer.createDownloadProgress;
    t.mock.method(progressRenderer, 'createDownloadProgress', label => {
      const lines = [];
      displays.push({ label, lines });
      return create(label, { isTTY, write: value => lines.push(value) }, () => 0);
    });
    t.mock.method(console, 'log', message => stages.push(message));
    const listenerCount = process.listenerCount('SIGINT');
    t.after(() => fs.rmSync(path.join(suiteHome, '.monkybot', 'tools'), { recursive: true, force: true }));
    await tools.prepareMusicToolsForCli({ env: f.env });
    assert.equal(process.listenerCount('SIGINT'), listenerCount);
    assert.equal(displays.length, 2);
    for (const [index, tool] of ['ytDlp', 'ffmpeg'].entries()) {
      const display = displays[index];
      assert.equal(display.label, cliT('music.downloadLabel', { tool: checks.MUSIC_TOOL_NAMES[tool] }));
      assert.match(display.lines.join(''), new RegExp(`100% \\(${f.binaries[tool].length} B / ${f.binaries[tool].length} B\\)`));
      assert.ok(display.lines.at(-1).endsWith('\n'));
      if (!isTTY) assert.doesNotMatch(display.lines.join(''), /[\r\u001b]/);
    }
    assert.ok(stages.includes(cliT('music.extracting')));
    assert.equal(f.extractions.length, 1);
  });
}
