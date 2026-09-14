const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createMusicCommands } = require('../dist/commands/music');
const { MusicQueues } = require('../dist/music/queue');
const { MusicError } = require('../dist/music/errors');
const { getCommandPresentation, localizeCommand } = require('@monky/bot-sdk');

const video = { id: 'abcdefghijk', title: 'Authorized original', url: 'https://www.youtube.com/watch?v=abcdefghijk', duration: 20 };
const request = (locale, query = 'original', signal = new AbortController().signal) => ({
  locale, query, optionName: 'busca', args: {}, serverId: 'server', signal,
});

test('localized music presentation preserves handler IDs, wire options and voice requirements', () => {
  const portuguese = {
    play: 'tocar', queue: 'fila', nowplaying: 'tocando', pause: 'pausar', resume: 'retomar',
    skip: 'pular', stop: 'parar', leave: 'sair', remove: 'remover', clear: 'limpar',
  };
  const commands = createMusicCommands({}, {});
  assert.deepEqual(commands.map(command => command.name), Object.keys(portuguese));
  for (const command of commands) {
    const original = JSON.stringify(command);
    const pt = getCommandPresentation(command, 'pt-BR');
    const en = getCommandPresentation(command, 'en');
    assert.equal(pt.canonicalName, command.name);
    assert.equal(pt.displayName, portuguese[command.name]);
    assert.ok(pt.inputNames.includes(command.name) && pt.inputNames.includes(portuguese[command.name]));
    assert.equal(en.displayName, command.name);
    for (const locale of ['pt-BR', 'en']) {
      const localized = localizeCommand(command, locale);
      assert.equal(localized.name, command.name);
      assert.equal(localized.voiceRequirement, 'same-bot-channel');
      assert.deepEqual((localized.options ?? []).map(option => option.name), (command.options ?? []).map(option => option.name));
    }
    assert.equal(JSON.stringify(command), original);
  }
});

function context(locale, args = {}) {
  const replies = [], choices = [];
  const ctx = {
    replies, choices, serverId: 'server', channelId: 'text', invokerId: 'user', invokerSessionId: 'session', invocationId: 'invocation',
    invokerVoiceChannelId: 'voice', locale, args, signal: new AbortController().signal,
    getVoiceChannel: async () => ctx.invokerVoiceChannelId,
    reply: content => replies.push(content),
    choose: async choice => { choices.push(choice); return null; },
  };
  return ctx;
}
for (const locale of ['en', 'pt-BR']) {
  test(`play autocomplete and private preview never enqueue before selection (${locale})`, async () => {
    const enqueued = [], previews = [];
    const bytes = Uint8Array.of(0, 255, 128, 200);
    const source = {
      check: async () => {}, search: async () => [video],
      preview: async (url, signal) => { previews.push({ url, signal }); return bytes; },
    };
    const queues = { assertControl: () => {}, enqueue: async (...args) => { enqueued.push(args); return video; } };
    const commands = createMusicCommands(queues, source);
    assert.ok(commands.every(command => command.voiceRequirement === 'same-bot-channel'));
    assert.equal(commands.some(command => command.name === 'query'), false);
    const command = commands.find(command => command.name === 'play');
    assert.equal(command.options[0].autocomplete, true);
    const lookup = request(locale);
    const choices = await command.autocomplete(lookup);
    assert.equal(enqueued.length, 0);
    assert.equal(previews.length, 0);
    assert.equal(choices[0].value, video.url);
    assert.equal(choices[0].audio.resourceId, video.url);
    assert.equal(choices[0].audio.durationMs, 10_000);
    assert.match(choices[0].description, locale === 'en' ? /Private/ : /privada/);
    const result = await command.audioPreview({ ...lookup, resourceId: choices[0].audio.resourceId });
    assert.deepEqual(result, { bytes, mimeType: 'audio/ogg' });
    assert.deepEqual(previews, [{ url: video.url, signal: lookup.signal }]);
    assert.equal(enqueued.length, 0);
    const ctx = context(locale, { busca: choices[0].value });
    await command.handler(ctx);
    assert.equal(enqueued.length, 1);
    assert.equal(enqueued[0][1], video.url);
    assert.deepEqual(ctx.choices, []);
    assert.match(ctx.replies[0], locale === 'en' ? /Added to queue/ : /Adicionado à fila/);
    assert.doesNotMatch(ctx.replies[0], /first audio is sent|primeiro áudio/);
  });
  test(`missing tools never search, enqueue or claim playback (${locale})`, async () => {
    const source = {
      check: async () => { throw new MusicError('tools'); },
      search: () => assert.fail('search without tools'), resolve: () => assert.fail('resolve without tools'),
    };
    const queues = new MusicQueues(source, { getVoiceConnection: () => undefined, leaveVoice: async () => {} }, async () => {});
    try {
      const command = createMusicCommands(queues, source).find(command => command.name === 'play');
      await assert.rejects(command.autocomplete(request(locale)), /yt-dlp.*FFmpeg/);
      const ctx = context(locale, { busca: video.url });
      await command.handler(ctx);
      assert.match(ctx.replies[0], /yt-dlp.*FFmpeg/);
      assert.doesNotMatch(ctx.replies[0], /Added|Adicionado|Now playing|Tocando/);
      assert.equal(queues.snapshot('server').current, null);
    } finally { await queues.dispose(); }
  });
}

test('pasted YouTube links resolve one suggestion without text search or eager audio generation', async () => {
  const source = {
    check: async () => {},
    resolve: async url => { assert.equal(url, video.url); return video; },
    search: () => assert.fail('A link is not a search query'),
    preview: () => assert.fail('No preview was requested'),
  };
  const command = createMusicCommands({}, source).find(command => command.name === 'play');
  const choices = await command.autocomplete(request('en', 'https://youtu.be/abcdefghijk?t=2'));
  assert.equal(choices.length, 1);
  assert.equal(choices[0].value, video.url);
  assert.equal(choices[0].audio.resourceId, video.url);
});

test('unselected search text cannot execute or auto-pick a song', async () => {
  const queues = { assertControl: () => {}, enqueue: () => assert.fail('No choice was selected') };
  const ctx = context('en', { busca: 'original' });
  await createMusicCommands(queues, {}).find(command => command.name === 'play').handler(ctx);
  assert.match(ctx.replies[0], /Select a video from the suggestions/);
  assert.deepEqual(ctx.choices, []);
});

test('room is re-read on execution and every music command rejects callers outside voice', async () => {
  const queues = new MusicQueues({}, { getVoiceConnection: () => undefined }, async () => {});
  const source = { check: async () => {}, search: async () => [video] };
  const commands = createMusicCommands(queues, source);
  const command = commands.find(command => command.name === 'play');
  const choices = await command.autocomplete(request('en'));
  const ctx = context('en', { busca: choices[0].value });
  ctx.getVoiceChannel = async () => null;
  await command.handler(ctx);
  assert.match(ctx.replies[0], /Join a voice room/);
  assert.doesNotMatch(ctx.replies[0], /bot[’']s/);
  for (const name of ['pause', 'resume', 'skip', 'stop', 'leave', 'remove', 'clear', 'queue', 'nowplaying']) {
    ctx.replies.length = 0;
    await commands.find(command => command.name === name).handler(ctx);
    assert.match(ctx.replies[0], /voice room/);
  }
  ctx.getVoiceChannel = async () => 'voice';
  for (const name of ['queue', 'nowplaying']) {
    ctx.replies.length = 0;
    await commands.find(command => command.name === name).handler(ctx);
    assert.match(ctx.replies[0], /Nothing is playing/);
  }
  await queues.dispose();
});

test('all music controls and read-only commands explain when the bot is already in another room', async () => {
  const voice = { getVoiceConnection: () => ({ channelId: 'other-voice' }), leaveVoice: async () => {} };
  const queues = new MusicQueues({}, voice, async () => {});
  try {
    for (const locale of ['en', 'pt-BR']) {
      for (const command of createMusicCommands(queues, {})) {
        const ctx = context(locale, { busca: video.url });
        await command.handler(ctx);
        assert.match(ctx.replies[0], locale === 'en' ? /already using another voice room/ : /usando outra sala de voz/);
      }
    }
  } finally { await queues.dispose(); }
});

test('autocomplete and previews honour cancellation and reject unsupported resource IDs', async () => {
  const controller = new AbortController();
  let finishSearch;
  const source = {
    check: async () => {},
    search: async (_query, signal) => {
      assert.equal(signal, controller.signal);
      return new Promise(resolve => { finishSearch = resolve; });
    },
    preview: () => assert.fail('Cancelled or forged preview must not reach the source'),
  };
  const command = createMusicCommands({}, source).find(command => command.name === 'play');
  const pending = command.autocomplete(request('en', 'original', controller.signal));
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  finishSearch([video]);
  assert.deepEqual(await pending, []);
  assert.deepEqual(await command.autocomplete(request('en', 'original', controller.signal)), []);
  await assert.rejects(command.audioPreview({
    ...request('en', '', controller.signal), resourceId: video.url,
  }), /cancelled/);
  await assert.rejects(command.audioPreview({ ...request('en'), resourceId: 'http://127.0.0.1/private' }), /Only public/);
  await assert.rejects(command.audioPreview({ ...request('en'), optionName: 'other', resourceId: video.url }), /Enter a name/);
});

test('a cancelled provider result cannot become a playable preview', async () => {
  const controller = new AbortController();
  const source = { preview: async () => { controller.abort(); return Uint8Array.of(1); } };
  const command = createMusicCommands({}, source).find(command => command.name === 'play');
  await assert.rejects(command.audioPreview({
    ...request('en', '', controller.signal), resourceId: video.url,
  }), /cancelled/);
});
test('all aborted music invocations are inert', async () => {
  for (const command of createMusicCommands({}, {})) {
    const ctx = context('en');
    const controller = new AbortController();
    controller.abort();
    ctx.signal = controller.signal;
    await command.handler(ctx);
    assert.deepEqual(ctx.replies, []);
  }
});

test('a full 50-track queue preserves complete titles across bounded reply cards', async () => {
  const queues = { assertControl: () => {}, snapshot: () => ({
    current: { title: 'x'.repeat(150), duration: 3600 }, started: true, paused: false, elapsedMs: 3_000_000,
    upcoming: Array.from({ length: 50 }, () => ({ title: 'y'.repeat(150), pending: false })),
  }) };
  for (const locale of ['en', 'pt-BR']) {
    const ctx = context(locale);
    await createMusicCommands(queues, {}).find(command => command.name === 'queue').handler(ctx);
    assert.ok(ctx.replies.length > 1);
    assert.ok(ctx.replies.every(reply => reply.length <= 2000));
    const output = ctx.replies.join('\n');
    assert.match(output, /50\. /);
    assert.equal(output.match(/y{150}/g).length, 50);
    assert.doesNotMatch(output, /…/);
  }
});

test('ordinary queues retain one card with full song names, not a 30-character abbreviation', async () => {
  const titles = [
    'An original song with a much longer descriptive title and its complete artist name',
    'A second original recording with an extended live performance description',
    'A third original composition with a subtitle that must remain fully visible',
  ];
  const queues = { assertControl: () => {}, snapshot: () => ({
    current: null, started: false, paused: false, elapsedMs: 0,
    upcoming: titles.map(title => ({ title, pending: false })),
  }) };
  const ctx = context('en');
  await createMusicCommands(queues, {}).find(command => command.name === 'queue').handler(ctx);
  assert.equal(ctx.replies.length, 1);
  for (const title of titles) assert.ok(ctx.replies[0].includes(title));
});

test('stop during initial direct-link prerequisite validation cannot start a stale track', async () => {
  let release;
  const checking = new Promise(resolve => { release = resolve; });
  const source = {
    check: () => checking,
    resolve: async (url, signal) => {
      if (signal.aborted) throw new MusicError('cancelled');
      assert.fail('Stopped track must not resolve');
    },
    open: () => assert.fail('Stopped track must not open'),
  };
  const voice = { getVoiceConnection: () => undefined, leaveVoice: async () => {} };
  const queues = new MusicQueues(source, voice, async () => {});
  const commands = createMusicCommands(queues, source);
  const ctx = context('en', { busca: 'https://youtu.be/abcdefghijk' });
  const play = commands.find(command => command.name === 'play').handler(ctx);
  await new Promise(resolve => setImmediate(resolve));
  await commands.find(command => command.name === 'stop').handler(context('en'));
  release();
  await play;
  assert.match(ctx.replies[0], /cancelled/);
  assert.equal(queues.snapshot('server').current, null);
  await queues.dispose();
});

test('mutations require getVoiceChannel and never fall back to the invocation snapshot', async () => {
  const queues = { assertControl: () => assert.fail('No authorization query succeeded'), control: () => assert.fail('Unsafe mutation') };
  const ctx = context('en');
  delete ctx.getVoiceChannel;
  await createMusicCommands(queues, {}).find(command => command.name === 'stop').handler(ctx);
  assert.equal(ctx.replies.length, 1);
});

test('direct-link acceptance revalidates through the server after resolution, ignoring stale snapshot', async () => {
  let calls = 0;
  const source = {
    check: async () => {},
    resolve: async () => ({ id: 'abcdefghijk', title: 'Original', url: 'url', audioUrl: '', duration: 1 }),
    open: () => assert.fail('Caller left before queue acceptance'),
  };
  const voice = { getVoiceConnection: () => undefined, leaveVoice: async () => {} };
  const queues = new MusicQueues(source, voice, async () => {});
  const ctx = context('en', { busca: 'https://youtu.be/abcdefghijk' });
  ctx.invokerVoiceChannelId = 'stale-snapshot';
  ctx.getVoiceChannel = async () => ++calls < 2 ? 'fresh-room' : null;
  await createMusicCommands(queues, source).find(command => command.name === 'play').handler(ctx);
  assert.equal(calls, 2);
  assert.match(ctx.replies[0], /voice room/);
  assert.equal(queues.snapshot('server').current, null);
  await queues.dispose();
});

test('the initial voice join uses the queried current room, never the invocation snapshot', async () => {
  let joined;
  let connection;
  const source = {
    check: async () => {},
    resolve: async () => ({ id: 'abcdefghijk', title: 'Original', url: 'url', audioUrl: '', duration: 1 }),
    open: async () => ({ frames: (async function* () { yield Uint8Array.of(248, 255, 254); })(), close: async () => {} }),
  };
  const voice = {
    getVoiceConnection: () => connection,
    joinVoice: async (serverId, channelId, options) => {
      joined = channelId;
      assert.deepEqual(options, { invocationId: 'invocation' });
      return connection = { channelId, humanParticipantCount: 1, writeOpus: async () => {} };
    },
    leaveVoice: async () => { connection = undefined; },
  };
  const queues = new MusicQueues(source, voice, async () => {});
  const ctx = context('en', { busca: 'https://youtu.be/abcdefghijk' });
  ctx.invokerVoiceChannelId = 'old-room';
  ctx.getVoiceChannel = async () => 'current-room';
  await createMusicCommands(queues, source).find(command => command.name === 'play').handler(ctx);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(joined, 'current-room');
  await queues.dispose();
});
