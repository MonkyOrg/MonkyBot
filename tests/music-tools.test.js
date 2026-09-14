const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const processes = require('node:child_process');
const { test } = require('node:test');
const { MusicError } = require('../dist/music/errors');
const checks = require('../dist/music/toolChecks');
const paths = require('../dist/music/toolPaths');
const capture = require('../dist/music/process');
const download = require('../dist/cli/musicToolDownload');
const tools = require('../dist/cli/musicTools');

const checksum = value => createHash('sha256').update(value).digest('hex');
const signal = () => new AbortController().signal;

function directory(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monky-music-tools-'));
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
      if (url === assetUrl) return new Response(binaries[tool]);
    }
    assert.fail(`Unexpected network request: ${url}`);
  });
  t.mock.method(processes, 'spawn', (command, args) => {
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
  return { root, env, requests, probes, progress,
    extractionStarted, finishExtraction: (...args) => finishExtraction(...args),
    options: { directory: root, env, platform, arch, progress: message => progress.push(message) } };
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
  await assert.rejects(checks.checkMusicTool('ffmpeg', runtime, signal(), async () => 'pcm_s16le'),
    error => error.tool === 'ffmpeg' && error.detail.includes('libopus'));
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
    assert.ok(!fs.readdirSync(f.root).some(name => name.startsWith('.install-')));
    const again = await tools.ensureMusicTools(f.options);
    assert.deepEqual(again, result);
    assert.equal(f.requests.length, 4, 'Healthy tools must not download again.');
    assert.ok(f.progress.some(message => message.includes('SHA-256')));
    const extraction = f.progress.findIndex(message => message.includes('Extraindo o executavel'));
    const verification = f.progress.findIndex(message => message.includes('Verificando FFmpeg/libopus'));
    assert.ok(extraction >= 0 && verification > extraction);
  });
}

test('checksum mismatch never executes or publishes the downloaded file', async t => {
  const f = installation(t, { invalidHash: true });
  await assert.rejects(tools.ensureMusicTools(f.options), /checksum/);
  assert.deepEqual(fs.readdirSync(f.root), []);
  assert.equal(f.probes.some(probe => probe.executable.includes('.install-')), false);
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
      failure === 'cancel' ? /fixture cancel/ : /Nao foi possivel extrair FFmpeg.*fixture extraction error/);
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
  }), /MONKY_MUSIC_YTDLP.*nao sera substituido/);
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
});

test('public tool downloads reject unapproved redirects before making another request', async t => {
  const root = directory(t);
  const request = t.mock.method(global, 'fetch', async () =>
    new Response(null, { status: 302, headers: { location: 'https://attacker.example.test/file' } }));
  await assert.rejects(download.downloadToolAsset({
    name: 'fixture', url: 'https://github.com/yt-dlp/yt-dlp/releases/download/test/fixture',
    size: 3, sha256: checksum(Buffer.from('abc')), version: 'test',
  }, path.join(root, 'download'), signal()), /origem nao autorizada/);
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
    assert.throws(() => download.ffmpegArchiveEntry(name), /distribuicao oficial suportada/);
  }
});

test('tool release metadata must match the exact official asset and provide a checksum', async t => {
  const asset = { name: 'yt-dlp_linux', size: 3,
    browser_download_url: 'https://attacker.example.test/yt-dlp_linux', digest: `sha256:${'a'.repeat(64)}` };
  t.mock.method(global, 'fetch', async () => new Response(JSON.stringify({
    tag_name: 'fixture', draft: false, prerelease: false, assets: [asset],
  })));
  await assert.rejects(download.findToolAsset('yt-dlp/yt-dlp', 'yt-dlp_linux', signal()), /arquivo valido/);
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
      /release de ferramenta invalida|arquivo valido|checksum verificavel/);
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
