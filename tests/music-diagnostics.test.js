const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createMusicCommands } = require('../dist/commands/music');
const { MusicError } = require('../dist/music/errors');
const { MusicQueues } = require('../dist/music/queue');
const { YouTubeSource } = require('../dist/music/source');
const { capture, errorDiagnostic, safeDiagnostic, youtubeProviderCause } = require('../dist/music/process');
const checks = require('../dist/music/toolChecks');
const { musicDiagnoseCommand } = require('../dist/cli/commands/musicDiagnose');
const { setCliLocale } = require('../dist/cli/i18n');

const url = 'https://www.youtube.com/watch?v=abcdefghijk';
const contextualUrl = `${url}&list=RDabcdefghijk&index=3&start_radio=1`;
const secret = 'fixture-sensitive-value';
const nativeDetail = `HTTP 403 https://rr1.googlevideo.com/videoplayback?sig=${secret} token=${secret}`;
const reportedUrl = 'https://www.youtube.com/watch?v=x5A9Aa-WU5E';
const botChallenge = 'WARNING: [youtube] No title found in player responses; falling back to title from initial data. ' +
  'Other metadata may also be missing\nERROR: [youtube] x5A9Aa-WU5E: Sign in to confirm you\u2019re not a bot. ' +
  `Use --cookies-from-browser or --cookies for the authentication https://example.invalid/help?token=${secret}`;
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
  assert.equal(errorDiagnostic(new MusicError('unsupported')), 'unsupported');
});

test('native diagnostics redact complete cookie headers and provider JSON before bounding output', () => {
  const diagnostic = safeDiagnostic(`HTTP 403\nCookie: first=${secret}; session=${secret}\n` +
    `Authorization: Bearer ${secret}\nprovider returned ${JSON.stringify({ title: 'private provider field', cookies: secret, url: nativeDetail })}`);
  assert.match(diagnostic, /HTTP 403/);
  assert.match(diagnostic, /\[redacted JSON\]/);
  assert.doesNotMatch(diagnostic, /fixture-sensitive|private provider field|"title"|"cookies"|googlevideo/);
  assert.ok(diagnostic.length <= 1024);
});

test('failed extraction never includes provider metadata stdout in operator diagnostics', async () => {
  const result = await capture(process.execPath, ['-e',
    `process.stdout.write(${JSON.stringify(JSON.stringify({ title: secret, cookies: secret, url: nativeDetail }))});` +
      "process.stderr.write('HTTP 403');process.exitCode=1;",
  ], new AbortController().signal).catch(error => error);
  assert.equal(result.code, 'unavailable');
  assert.match(errorDiagnostic(result), /HTTP 403/);
  assert.doesNotMatch(errorDiagnostic(result), /fixture-sensitive|"title"|"cookies"|googlevideo/);
});

test('the explicit YouTube anti-bot error is classified without guessing from unrelated failures', () => {
  for (const diagnostic of [botChallenge, botChallenge.replace('\u2019', "'"), safeDiagnostic(botChallenge)]) {
    assert.equal(youtubeProviderCause(new MusicError('unavailable', diagnostic)), 'YOUTUBE_BOT_CHALLENGE');
  }
  for (const error of [
    undefined, new Error(botChallenge),
    new MusicError('timeout', botChallenge), new MusicError('tools', botChallenge),
    new MusicError('unavailable'),
    new MusicError('unavailable', nativeDetail),
    new MusicError('unavailable', 'HTTP Error 429: Too Many Requests'),
    new MusicError('unavailable', 'Connection refused: network is unreachable'),
    new MusicError('unavailable', 'WARNING: [youtube] No title found in player responses'),
    new MusicError('unavailable', 'ERROR: [youtube] x5A9Aa-WU5E: Sign in to confirm your age.'),
    new MusicError('unavailable', 'ERROR: [youtube] x5A9Aa-WU5E: This video is private.'),
    new MusicError('unavailable', botChallenge.replace('ERROR:', 'WARNING:')),
    new MusicError('unavailable', botChallenge.replace('ERROR: [youtube]', 'ERROR: [another-provider]')),
    new MusicError('unavailable', botChallenge.replace('x5A9Aa-WU5E:', 'malformed-id:')),
    new MusicError('unavailable', botChallenge.replace('not a bot.', 'not a botnet.')),
    new MusicError('unavailable', JSON.stringify({ message: botChallenge })),
    new MusicError('unavailable', `https://example.invalid/${encodeURIComponent(botChallenge)}`),
    new MusicError('unavailable', `token="${botChallenge}"`),
  ]) {
    assert.equal(youtubeProviderCause(error), 'UNRESOLVED');
  }
});

test('native challenge diagnostics retain evidence but omit unsupported authentication instructions', async () => {
  const failure = await capture(process.execPath, ['-e',
    `process.stderr.write(${JSON.stringify(botChallenge)});process.exitCode=1;`,
  ], new AbortController().signal).catch(error => error);
  assert.equal(failure.code, 'unavailable');
  assert.equal(youtubeProviderCause(failure), 'YOUTUBE_BOT_CHALLENGE');
  const diagnostic = errorDiagnostic(failure);
  assert.match(diagnostic, /ERROR: \[youtube\] x5A9Aa-WU5E: Sign in to confirm/);
  assert.match(diagnostic, /\[authentication guidance omitted\]/);
  assert.doesNotMatch(diagnostic, /--cookies|fixture-sensitive|https?:\/\//);
  assert.ok(diagnostic.length <= 1024);
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
  const track = await source.resolve(contextualUrl, new AbortController().signal);
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

test('play execution, autocomplete and private preview use the same single-video normalizer', async () => {
  const enqueued = [];
  const resolved = [];
  const previews = [];
  const bytes = Uint8Array.of(1, 2, 3);
  const track = { id: metadata.id, title: metadata.title, duration: 60, url, audioUrl: metadata.url };
  const source = {
    check: async () => {},
    search: () => assert.fail('Playlist context must not become a search.'),
    resolve: async value => { resolved.push(value); return track; },
    preview: async value => { previews.push(value); return bytes; },
  };
  const queues = {
    assertControl: () => {},
    enqueue: async (_caller, value) => { enqueued.push(value); return track; },
  };
  const command = createMusicCommands(queues, source).find(item => item.name === 'play');
  const signal = new AbortController().signal;
  const replies = [];
  await command.handler({
    serverId: 'fixture-server', channelId: 'text', invocationId: 'fixture-invocation', locale: 'en',
    signal, args: { busca: contextualUrl }, getVoiceChannel: async () => 'voice', reply: message => replies.push(message),
  });
  const choices = await command.autocomplete({ optionName: 'busca', query: contextualUrl, locale: 'en', signal });
  const preview = await command.audioPreview({ optionName: 'busca', resourceId: contextualUrl, locale: 'en', signal });
  assert.deepEqual(enqueued, [url]);
  assert.deepEqual(resolved, [url]);
  assert.deepEqual(previews, [url]);
  assert.equal(choices.length, 1);
  assert.equal(choices[0].value, url);
  assert.equal(choices[0].audio.resourceId, url);
  assert.deepEqual(preview.bytes, bytes);
  assert.match(replies[0], /Added to queue/);
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
    [JSON.stringify({ ...metadata, id: '12345678901' }), 'unsupported', /did not match/],
  ]) {
    const source = new YouTubeSource('fixture-ytdlp', 'fixture-ffmpeg', async () => body, 'fixture-node');
    await assert.rejects(source.resolve(contextualUrl, new AbortController().signal), error => {
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
    ['--url', 'https://www.youtube.com/playlist?list=playlist'], ['--url', 'https://www.youtube.com/watch?list=playlist'],
    ['--url', 'search text']]) {
    await assert.rejects(musicDiagnoseCommand(args));
  }
});

for (const locale of ['pt-BR', 'en']) {
  test(`invalid metadata diagnosis returns localized guidance instead of duplicate error codes (${locale})`, async t => {
    setCliLocale(locale);
    t.mock.method(checks, 'checkMusicTool', () => assert.fail('Invalid input cannot start tools'));
    t.mock.method(global, 'fetch', () => assert.fail('Invalid input cannot start network requests'));
    await assert.rejects(musicDiagnoseCommand(['--url', `https://www.youtube.com/playlist?list=${secret}`]), error => {
      assert.equal(error.cause.code, 'unsupported');
      assert.match(error.message, locale === 'en' ? /Only public individual YouTube videos/ : /Apenas vídeos individuais públicos do YouTube/);
      assert.doesNotMatch(errorDiagnostic(error), /unsupported: unsupported|fixture-sensitive|https?:\/\//);
      assert.ok(errorDiagnostic(error).length <= 1024);
      return true;
    });
  });
}

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
  await musicDiagnoseCommand(['--url', contextualUrl]);
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
    assert.match(error.message, /Could not load public audio|Não foi possível carregar o áudio público/);
    assert.match(errorDiagnostic(error), /HTTP 403/);
    assert.doesNotMatch(errorDiagnostic(error), /googlevideo|fixture-sensitive/);
    return true;
  });
});

for (const locale of ['pt-BR', 'en']) {
  test(`metadata diagnosis identifies the affected-host challenge with precise localized guidance (${locale})`, async t => {
    setCliLocale(locale);
    const logs = [];
    const checked = [];
    t.mock.method(console, 'log', (...args) => logs.push(args.join(' ')));
    t.mock.method(checks, 'checkMusicTool', async tool => {
      checked.push(tool);
      return tool === 'node' ? 'v24.20.0' : tool === 'ytDlp' ? '2026.08.19' : 'libopus';
    });
    const failure = new MusicError('unavailable', botChallenge);
    const resolve = t.mock.method(YouTubeSource.prototype, 'resolve', async value => {
      assert.equal(value, reportedUrl);
      throw failure;
    });
    t.mock.method(YouTubeSource.prototype, 'preview', () => assert.fail('Challenge cannot trigger a preview'));
    t.mock.method(YouTubeSource.prototype, 'open', () => assert.fail('Challenge cannot trigger playback'));
    t.mock.method(global, 'fetch', () => assert.fail('Challenge cannot trigger provisioning or bypass requests'));
    const before = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
    await assert.rejects(musicDiagnoseCommand(['--url', reportedUrl]), error => {
      assert.equal(error.cause, failure);
      assert.match(error.message, /stage=resolve, providerCause=YOUTUBE_BOT_CHALLENGE/);
      assert.match(error.message, locale === 'en' ? /application-level refusal, not evidence of a general egress block/
        : /recusa da aplicação, não evidência de bloqueio geral de saída/);
      assert.match(error.message, locale === 'en' ? /IP\/reputation criterion is unknown/ : /IP\/reputação é desconhecido/);
      assert.match(error.message, locale === 'en' ? /audio host was not tested/ : /host de áudio não foi testado/);
      assert.match(error.message, locale === 'en' ? /Authentication and bypassing this challenge are not supported/
        : /Autenticação e contorno desse desafio não são suportados/);
      const diagnostic = errorDiagnostic(error);
      assert.match(diagnostic, /Sign in to confirm/);
      assert.doesNotMatch(diagnostic, /UNRESOLVED|--cookies|--proxy|fixture-sensitive|https?:\/\/|Loading timed out|excedeu o tempo limite/);
      assert.ok(diagnostic.length <= 1024);
      return true;
    });
    assert.equal(resolve.mock.callCount(), 1, 'The challenge must remain terminal, without a silent retry.');
    assert.deepEqual(checked, ['node', 'ytDlp', 'ffmpeg']);
    assert.doesNotMatch(logs.join('\n'), /result=accepted/);
    assert.deepEqual([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')], before);
  });
}

test('a startup tool timeout is not misclassified as a provider challenge and never resolves metadata', async t => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(checks, 'checkMusicTool', async tool => {
    if (tool === 'ytDlp') throw new checks.MusicToolError('ytDlp', 'fixture-tool', 'timeout', 'Media process exceeded 30000 ms.');
    return 'v24.20.0';
  });
  t.mock.method(YouTubeSource.prototype, 'resolve', () => assert.fail('A failed startup probe cannot contact the provider'));
  await assert.rejects(musicDiagnoseCommand(['--url', reportedUrl]), error => {
    assert.equal(error.cause.code, 'timeout');
    assert.match(error.message, /stage=ytDlp, providerCause=UNRESOLVED/);
    assert.doesNotMatch(error.message, /YOUTUBE_BOT_CHALLENGE|anti-bot/);
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
