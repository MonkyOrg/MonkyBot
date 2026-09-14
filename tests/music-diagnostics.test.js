const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createMusicCommands } = require('../dist/commands/music');
const { MusicError } = require('../dist/music/errors');
const { MusicQueues } = require('../dist/music/queue');
const { YouTubeSource } = require('../dist/music/source');
const { capture, errorDiagnostic } = require('../dist/music/process');
const checks = require('../dist/music/toolChecks');
const { musicDiagnoseCommand } = require('../dist/cli/commands/musicDiagnose');
const { setCliLocale } = require('../dist/cli/i18n');

const url = 'https://www.youtube.com/watch?v=abcdefghijk';
const secret = 'fixture-sensitive-value';
const nativeDetail = `HTTP 403 https://rr1.googlevideo.com/videoplayback?sig=${secret} token=${secret}`;
const metadata = {
  id: 'abcdefghijk', title: 'Original public video', duration: 60, availability: 'public',
  is_live: false, was_live: false, live_status: 'not_live', age_limit: 0,
  url: 'https://rr1.googlevideo.com/videoplayback?sig=fixture-only',
};

for (const locale of ['pt-BR', 'en']) {
  test(`resolution failure retains redacted operator detail while chat stays localized (${locale})`, async t => {
    setCliLocale(locale);
    const logs = [];
    t.mock.method(console, 'error', (...args) => logs.push(args.join(' ')));
    const source = {
      check: async () => {},
      resolve: async () => { throw new MusicError('unavailable', nativeDetail); },
    };
    const queues = new MusicQueues(source, { getVoiceConnection: () => undefined, leaveVoice: async () => {} }, async () => {});
    t.after(() => queues.dispose());
    const replies = [];
    await createMusicCommands(queues, source).find(command => command.name === 'play').handler({
      serverId: 'fixture-server', channelId: 'text', locale, invocationId: 'fixture-invocation',
      signal: new AbortController().signal, args: { busca: url },
      getVoiceChannel: async () => 'voice', reply: value => replies.push(value),
    });
    assert.equal(replies.length, 1);
    assert.match(replies[0], locale === 'en' ? /Could not load public audio/ : /Não foi possível carregar o áudio público/);
    assert.doesNotMatch(replies[0], /403|googlevideo|fixture-sensitive|timeout|tempo limite/);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /command=play, stage=execute/);
    assert.match(logs[0], /unavailable.*HTTP 403/);
    assert.doesNotMatch(logs[0], /googlevideo|fixture-sensitive|sig=/);
    assert.equal(queues.snapshot('fixture-server').current, null);
  });

  test(`autocomplete and preview retain native causes without exposing them in localized messages (${locale})`, async () => {
    const failure = new MusicError('unavailable', nativeDetail);
    const source = {
      check: async () => {},
      search: async () => { throw failure; },
      preview: async () => { throw failure; },
    };
    const command = createMusicCommands({}, source).find(item => item.name === 'play');
    for (const call of [
      () => command.autocomplete({ optionName: 'busca', query: 'original', locale, signal: new AbortController().signal }),
      () => command.audioPreview({ optionName: 'busca', resourceId: url, locale, signal: new AbortController().signal }),
    ]) {
      await assert.rejects(call(), error => {
        assert.equal(error.cause, failure);
        assert.match(error.message, locale === 'en' ? /Could not load public audio/ : /Não foi possível carregar/);
        assert.doesNotMatch(error.message, /403|googlevideo|fixture-sensitive/);
        assert.match(errorDiagnostic(error), /HTTP 403/);
        assert.doesNotMatch(errorDiagnostic(error), /googlevideo|fixture-sensitive/);
        return true;
      });
    }
  });
}

test('operator diagnostics retain causes, redact secrets and terminate cyclic chains', () => {
  const failure = new MusicError('unavailable', nativeDetail);
  const outer = new Error('Localized public message', { cause: failure });
  failure.cause = outer;
  const result = errorDiagnostic(outer);
  assert.match(result, /Localized public message.*unavailable.*HTTP 403/);
  assert.doesNotMatch(result, /googlevideo|fixture-sensitive/);
  assert.ok(result.length <= 1024);
});

test('output limit errors retain the explicit bound and sanitized native stderr', async () => {
  const result = await capture(process.execPath, ['-e',
    `process.stderr.write(${JSON.stringify(nativeDetail)});setTimeout(()=>process.stdout.write('x'.repeat(4096)),20);`,
  ], new AbortController().signal, 5000, 1024).catch(error => error);
  assert.equal(result.code, 'unavailable');
  assert.match(result.detail, /exceeded 1024 bytes.*HTTP 403/);
  assert.doesNotMatch(result.detail, /googlevideo|fixture-sensitive/);
});

test('public resolution keeps all restrictions and does not download, bypass, or log metadata', async () => {
  const calls = [];
  const source = new YouTubeSource('fixture-ytdlp', 'fixture-ffmpeg', async (exe, args, signal) => {
    calls.push({ exe, args });
    assert.equal(signal.aborted, false);
    return JSON.stringify(metadata);
  }, 'fixture-node');
  const track = await source.resolve(url, new AbortController().signal);
  assert.equal(track.url, url);
  assert.equal(track.audioUrl, metadata.url);
  assert.equal(calls.length, 1);
  const args = calls[0].args;
  for (const flag of ['--skip-download', '--no-playlist', '--ignore-config', '--no-cache-dir',
    '--no-plugin-dirs', '--no-js-runtimes', '--no-remote-components']) assert.ok(args.includes(flag));
  assert.equal(args[args.indexOf('--js-runtimes') + 1], 'node:fixture-node');
  assert.equal(args[args.indexOf('--format') + 1], 'bestaudio[protocol=https]');
  assert.equal(args.some(arg => /cookies|password|proxy|remote-components\s+ejs/.test(arg)), false);
  assert.deepEqual(args.slice(-2), ['--', url]);
});

test('invalid or disallowed metadata fails with safe detail rather than a raw JSON exception', async () => {
  for (const [body, code, detail] of [
    [`{"url":"${nativeDetail}`, 'unavailable', /invalid metadata JSON/],
    [JSON.stringify({ ...metadata, url: 'https://untrusted.example/audio?token=fixture-sensitive-value' }), 'unavailable', /authorized HTTPS/],
    [JSON.stringify({ ...metadata, url: undefined }), 'unavailable', /did not return an audio URL/],
    [JSON.stringify({ ...metadata, age_limit: 18 }), 'unsupported', /policy/],
    [JSON.stringify({ ...metadata, availability: 'private' }), 'unsupported', /policy/],
    [JSON.stringify({ ...metadata, duration: 3601 }), 'unsupported', /policy/],
    [JSON.stringify({ ...metadata, live_status: 'is_live' }), 'unsupported', /policy/],
  ]) {
    const source = new YouTubeSource('fixture-ytdlp', 'fixture-ffmpeg', async () => body, 'fixture-node');
    await assert.rejects(source.resolve(url, new AbortController().signal), error => {
      assert.equal(error.code, code);
      assert.match(error.detail, detail);
      assert.doesNotMatch(error.detail, /fixture-sensitive|rr1\.googlevideo|https?:\/\//);
      return true;
    });
  }
});

test('metadata-only diagnosis requires an explicit eligible URL before running any tool', async t => {
  t.mock.method(checks, 'checkMusicTool', () => assert.fail('Invalid input cannot start tools'));
  for (const args of [[], ['--url'], ['--url', url, '--extra'], ['--url', 'https://127.0.0.1/'],
    ['--url', `${url}&list=playlist`], ['--url', 'search text']]) {
    await assert.rejects(musicDiagnoseCommand(args));
  }
});

test('metadata-only diagnosis validates versions and metadata but never opens or previews media', async t => {
  const output = [];
  t.mock.method(console, 'log', (...args) => output.push(args.join(' ')));
  const checked = [];
  t.mock.method(checks, 'checkMusicTool', async tool => { checked.push(tool); return tool === 'node' ? 'v22.0.0' : 'fixture-version'; });
  t.mock.method(YouTubeSource.prototype, 'resolve', async (value, signal) => {
    assert.equal(value, url);
    assert.equal(signal.aborted, false);
    return { id: metadata.id, title: metadata.title, duration: 60, url, audioUrl: metadata.url };
  });
  t.mock.method(YouTubeSource.prototype, 'preview', () => assert.fail('Implicit preview'));
  t.mock.method(YouTubeSource.prototype, 'open', () => assert.fail('Implicit playback'));
  t.mock.method(global, 'fetch', () => assert.fail('Implicit installation'));
  const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
  await musicDiagnoseCommand(['--url', url]);
  assert.deepEqual(checked, ['node', 'ytDlp', 'ffmpeg']);
  assert.match(output.join('\n'), /stage=resolve result=accepted durationSeconds=60/);
  assert.doesNotMatch(output.join('\n'), /googlevideo|fixture-only|Original public video|"availability"/);
  assert.deepEqual([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')], before);
});

test('failed metadata diagnosis reports unresolved provider cause and preserves safe stderr', async t => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(checks, 'checkMusicTool', async () => 'fixture-version');
  t.mock.method(YouTubeSource.prototype, 'resolve', async () => { throw new MusicError('unavailable', nativeDetail); });
  await assert.rejects(musicDiagnoseCommand(['--url', url]), error => {
    assert.equal(error.cause.code, 'unavailable');
    assert.match(error.message, /stage=resolve, providerCause=UNRESOLVED/);
    assert.match(errorDiagnostic(error), /HTTP 403/);
    assert.doesNotMatch(errorDiagnostic(error), /googlevideo|fixture-sensitive/);
    return true;
  });
});

test('metadata diagnosis has an overall bound and removes cancellation listeners', async t => {
  t.mock.method(console, 'log', () => {});
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(checks, 'checkMusicTool', async (_tool, _paths, signal) =>
    new Promise((_, reject) => signal.addEventListener('abort', () => reject(new MusicError('cancelled')), { once: true })));
  const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
  const pending = musicDiagnoseCommand(['--url', url]);
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(45_000);
  await assert.rejects(pending, error => {
    assert.equal(error.cause.code, 'timeout');
    assert.match(error.message, /providerCause=UNRESOLVED/);
    return true;
  });
  assert.deepEqual([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')], before);
});
