const assert = require('node:assert/strict');
const { test, beforeEach } = require('node:test');
const { setCliLocale } = require('../dist/cli/i18n');

beforeEach(() => setCliLocale('en'));
const { BotClient } = require('@monky/bot-sdk');
const { EventEmitter } = require('node:events');
const { registerMusicCommands } = require('../dist/commands/music');
const { IncompleteAudioError, YouTubeSource } = require('../dist/music/source');
const { SourceRecoveryError } = require('../dist/music/errors');
const {
  MUSIC_IDLE_SETTING, defaultMusicIdleSeconds, musicSettingsDefinition, musicIdleMilliseconds,
} = require('../dist/music/settings');

const tick = () => new Promise(resolve => setImmediate(resolve));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function gate() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}
async function until(predicate) {
  for (let i = 0; i < 200 && !predicate(); i++) await tick();
  assert.ok(predicate(), 'The expected music event did not arrive.');
}

function registered(t, { frames = 1, open } = {}) {
  t.mock.method(YouTubeSource.prototype, 'check', async () => {});
  t.mock.method(YouTubeSource.prototype, 'resolve', async () => ({
    id: 'abcdefghijk', title: 'An authorized original recording', duration: 20,
    url: 'https://www.youtube.com/watch?v=abcdefghijk', audioUrl: '',
  }));
  t.mock.method(YouTubeSource.prototype, 'open', open ?? (async (_track, signal) => ({
    frames: (async function* () {
      for (let i = 0; i < frames && !signal.aborted; i++) yield Uint8Array.of(248, 255, 254);
    })(),
    close: async () => {},
  })));
  const commands = new Map(), settings = new Map(), connections = new Map(), chats = [], writes = [];
  let declaration;
  const bot = Object.assign(new EventEmitter(), {
    settings: definition => { declaration = definition; },
    getServerSettings: serverId => settings.get(serverId),
    onSettingsChanged: listener => {
      bot.on('settingsChanged', listener);
      return () => bot.off('settingsChanged', listener);
    },
    command: command => commands.set(command.name, command),
    sendMessage: async (serverId, channelId, content) => { chats.push({ serverId, channelId, content }); },
    getVoiceConnection: serverId => connections.get(serverId),
    joinVoice: async (serverId, channelId) => {
      const connection = { channelId, humanParticipantCount: 1, writeOpus: async packet => { writes.push(packet); } };
      connections.set(serverId, connection);
      return connection;
    },
    leaveVoice: async serverId => { connections.delete(serverId); },
  });
  const dispose = registerMusicCommands(bot);
  t.after(dispose);
  const configure = (serverId, seconds) => {
    const snapshot = { schemaRevision: 1, revision: 1, values: { [MUSIC_IDLE_SETTING]: seconds } };
    settings.set(serverId, snapshot);
    bot.emit('settingsChanged', snapshot, { serverId });
  };
  const play = async (serverId = 'a', locale = 'en') => {
    if (!settings.has(serverId)) configure(serverId, 60);
    const controller = new AbortController(), replies = [];
    await commands.get('play').handler({
      serverId, channelId: `text-${serverId}`, locale, invocationId: `play-${serverId}`,
      args: { busca: 'https://youtu.be/abcdefghijk' }, signal: controller.signal,
      getVoiceChannel: async () => 'voice', reply: value => replies.push(value),
    });
    return { controller, replies };
  };
  const control = async name => {
    const replies = [];
    await commands.get(name).handler({
      serverId: 'a', channelId: 'text-a', locale: 'en', invocationId: name, args: {},
      signal: new AbortController().signal, getVoiceChannel: async () => 'voice', reply: value => replies.push(value),
    });
    return replies;
  };
  const loseVoice = reason => {
    connections.delete('a');
    bot.emit('voiceDisconnected', { serverId: 'a', channelId: 'voice', reason });
  };
  return { bot, play, control, loseVoice, configure, connections, chats, writes, declaration, settings };
}

test('music idle is a valid shared bot setting with localized labels and bounded defaults', async () => {
  const bot = new BotClient({ publicKey: 'fixture' });
  try {
    const definition = musicSettingsDefinition(60);
    assert.doesNotThrow(() => bot.settings(definition));
    const field = definition.server.fields[0];
    assert.equal(field.name, MUSIC_IDLE_SETTING);
    assert.equal(field.type, 'integer');
    assert.equal(field.defaultValue, 60);
    assert.equal(field.min, 1);
    assert.equal(field.max, 600);
    assert.equal(definition.localizations['pt-BR'].server.fields[MUSIC_IDLE_SETTING].label,
      'Tempo de inatividade (segundos)');
  } finally {
    await bot.close();
  }
});

test('runtime idle uses validated server values instead of silently falling back to host defaults', () => {
  for (const seconds of [1, 60, 120, 600]) {
    assert.equal(musicIdleMilliseconds({
      schemaRevision: 1, revision: 2, values: { [MUSIC_IDLE_SETTING]: seconds },
    }), seconds * 1000);
  }
  for (const value of [undefined, '60', false, 0, -1, 601, NaN, 1.5]) {
    assert.throws(() => musicIdleMilliseconds({
      schemaRevision: 1, revision: 2, values: { [MUSIC_IDLE_SETTING]: value },
    }), { code: 'settings' });
  }
  assert.throws(() => musicIdleMilliseconds(undefined), { code: 'settings' });
  assert.equal(defaultMusicIdleSeconds('60'), 60);
});

test('registered music announces the end in persistent chat before its configured departure', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = registered(t);
  f.configure('a', 2);
  const { controller, replies } = await f.play();
  controller.abort();
  await until(() => f.chats.some(message => /Queue finished/.test(message.content)));
  assert.match(replies[0], /Added to queue/);
  assert.ok(f.connections.has('a'));
  assert.equal(f.chats.filter(message => /Queue finished/.test(message.content)).length, 1);
  assert.ok(f.chats.every(message => message.serverId === 'a' && message.channelId === 'text-a'));
  t.mock.timers.tick(1999);
  await tick();
  assert.ok(f.connections.has('a'));
  t.mock.timers.tick(1);
  await tick();
  assert.equal(f.connections.has('a'), false);
});

test('a final background source failure reports a real stop, not normal completion, without leaking diagnostics', async t => {
  let reject, opened = false;
  const failure = new Promise((_resolve, fail) => { reject = fail; });
  const f = registered(t, { open: () => { opened = true; return failure; } });
  const { controller } = await f.play('a', 'pt-BR');
  await until(() => opened);
  controller.abort();
  reject(new Error('https://private.example.test/media?secret=token'));
  await until(() => f.chats.some(message => /A reprodução parou/.test(message.content)));
  const error = f.chats.find(message => /A reprodução parou/.test(message.content));
  assert.ok(error.content.includes('An authorized original recording'));
  assert.doesNotMatch(error.content, /private\.example|secret|token/);
  assert.equal(f.chats.some(message => /Fim da fila/.test(message.content)), false);
});

test('healthy playback keeps generic SDK and recovered peer errors in local diagnostics only', async t => {
  const logs = t.mock.method(console, 'error', () => {});
  const f = registered(t, { frames: 1000 });
  await f.play();
  await until(() => f.chats.some(message => /Now playing/.test(message.content)));
  const connection = f.connections.get('a'), before = f.writes.length;
  const error = new Error('Retired peer failed at https://private.example.test/?token=secret');
  f.bot.emit('error', error, { serverId: 'a' });
  f.bot.emit('error', error, { serverId: 'a' });
  f.bot.emit('connected', { serverId: 'a' });
  await wait(70);
  assert.ok(f.writes.length > before);
  assert.equal(f.connections.get('a'), connection);
  assert.equal(f.chats.length, 1);
  assert.equal(logs.mock.callCount(), 1);
  assert.match(logs.mock.calls[0].arguments[0], /Runtime diagnostic.*Retired peer failed/);
  assert.doesNotMatch(logs.mock.calls[0].arguments[0], /private\.example|secret/);
});

test('a skipped failed track stays silent until a replacement actually writes audio', async t => {
  const logs = t.mock.method(console, 'error', () => {});
  const failed = gate(), nextFrame = gate();
  let opened = 0;
  const f = registered(t, { open: async () => {
    const current = ++opened;
    return {
      frames: (async function* () {
        if (current === 1) {
          yield Uint8Array.of(248, 255, 254);
          await failed.promise;
          throw new IncompleteAudioError(20000, 1000);
        }
        await nextFrame.promise;
        yield Uint8Array.of(248, 255, 254);
      })(),
      close: async () => {},
    };
  } });
  t.after(() => { failed.release(); nextFrame.release(); });
  await f.play();
  await until(() => f.chats.length === 1);
  await f.play();
  failed.release();
  await until(() => opened === 2);
  assert.equal(f.chats.length, 1, 'Metadata/roster presence alone is not evidence that the replacement can play.');
  nextFrame.release();
  await until(() => f.chats.some(message => /Queue finished/.test(message.content)));
  assert.equal(f.chats.filter(message => /Now playing/.test(message.content)).length, 2);
  assert.equal(f.chats.some(message => /stopped|failed|incomplete/i.test(message.content)), false);
  assert.equal(logs.mock.callCount(), 1);
  assert.match(logs.mock.calls[0].arguments[0], /Playback failed.*advancedMs=20/);
});

for (const locale of ['en', 'pt-BR']) {
  test(`recovery budget: exhausted recovery is announced once even with a viable next track (${locale})`, async t => {
    t.mock.method(console, 'error', () => {});
    const failed = gate();
    let opened = 0;
    const f = registered(t, { open: async () => {
      const current = ++opened;
      return {
        frames: (async function* () {
          yield Uint8Array.of(248, 255, 254);
          if (current === 1) { await failed.promise; throw new SourceRecoveryError(); }
        })(),
        close: async () => {},
      };
    } });
    t.after(failed.release);
    await f.play('a', locale);
    await until(() => f.chats.length === 1);
    await f.play('a', locale);
    failed.release();
    await until(() => f.chats.some(message => /Queue finished|Fim da fila/.test(message.content)));
    const errors = f.chats.filter(message => /Could not resume|Falha ao retomar/.test(message.content));
    assert.equal(errors.length, 1);
    assert.match(errors[0].content, /5/);
    assert.match(errors[0].content, /removed from the queue|removida da fila/);
    assert.equal(f.chats.filter(message => /Now playing|Tocando:/.test(message.content)).length, 2);
    assert.equal(f.chats.some(message => /Playback stopped|A reprodução parou/.test(message.content)), false);
  });
}

test('recovery budget: an exhausted last track is reported once without a misleading normal ending', async t => {
  t.mock.method(console, 'error', () => {});
  const f = registered(t, { open: async () => ({
    frames: (async function* () { throw new SourceRecoveryError(); })(),
    close: async () => {},
  }) });
  await f.play();
  await until(() => f.chats.some(message => /Could not resume/.test(message.content)));
  await tick();
  assert.equal(f.chats.length, 1);
  assert.equal(f.chats.some(message => /Queue finished|Playback stopped/.test(message.content)), false);
});

test('several failed queued tracks produce one stopping error and never a success-shaped queue end', async t => {
  const logs = t.mock.method(console, 'error', () => {});
  const failed = gate();
  let opened = 0;
  const f = registered(t, { open: async () => {
    const current = ++opened;
    return {
      frames: (async function* () {
        if (current === 1) { yield Uint8Array.of(248, 255, 254); await failed.promise; }
        throw new Error('Private source failure https://private.example.test/?token=secret');
      })(),
      close: async () => {},
    };
  } });
  t.after(failed.release);
  await f.play();
  await until(() => f.chats.length === 1);
  await f.play();
  failed.release();
  await until(() => f.chats.some(message => /Playback stopped/.test(message.content)));
  assert.equal(opened, 2);
  assert.equal(logs.mock.callCount(), 2);
  assert.equal(f.chats.filter(message => /Playback stopped/.test(message.content)).length, 1);
  assert.equal(f.chats.some(message => /Queue finished|Skipping failed/.test(message.content)), false);
  assert.ok(f.chats.every(message => !/private\.example|secret/.test(message.content)));
});

test('manual stop cancels an unproven replacement without resurrecting the earlier skipped error', async t => {
  t.mock.method(console, 'error', () => {});
  const failed = gate(), nextFrame = gate();
  let opened = 0;
  const f = registered(t, { open: async () => {
    const current = ++opened;
    return {
      frames: (async function* () {
        if (current === 1) {
          yield Uint8Array.of(248, 255, 254);
          await failed.promise;
          throw new Error('Earlier failed track.');
        }
        await nextFrame.promise;
        yield Uint8Array.of(248, 255, 254);
      })(),
      close: async () => { if (current === 2) nextFrame.release(); },
    };
  } });
  t.after(() => { failed.release(); nextFrame.release(); });
  await f.play();
  await until(() => f.chats.length === 1);
  await f.play();
  failed.release();
  await until(() => opened === 2);
  await f.control('stop');
  await tick();
  assert.equal(f.chats.length, 1, 'A deliberate stop is not an automatic playback failure or normal EOF.');
});

test('confirmed transport loss stops playback once, independently of an earlier generic SDK error', async t => {
  t.mock.method(console, 'error', () => {});
  const f = registered(t, { frames: 1000 });
  await f.play();
  await until(() => f.chats.some(message => /Now playing/.test(message.content)));
  f.bot.emit('error', new Error('ICE temporarily disconnected.'), { serverId: 'a' });
  assert.equal(f.chats.length, 1);
  f.loseVoice('transport_failed');
  f.loseVoice('transport_failed');
  await until(() => f.chats.some(message => /Playback stopped/.test(message.content)));
  await tick();
  const count = f.writes.length;
  await wait(40);
  assert.equal(f.writes.length, count);
  assert.equal(f.connections.has('a'), false);
  assert.equal(f.chats.filter(message => /Playback stopped/.test(message.content)).length, 1);
  assert.equal(f.chats.some(message => /Queue finished/.test(message.content)), false);
});

test('a retired voice callback cannot stop a newer healthy SDK connection', async t => {
  const f = registered(t, { frames: 1000 });
  await f.play();
  await until(() => f.chats.some(message => /Now playing/.test(message.content)));
  const connection = f.connections.get('a'), before = f.writes.length;
  f.bot.emit('voiceDisconnected', { serverId: 'a', channelId: 'voice', reason: 'transport_failed' });
  await wait(50);
  assert.equal(f.connections.get('a'), connection);
  assert.ok(f.writes.length > before);
  assert.equal(f.chats.length, 1);
});

test('server reconnection reports interrupted playback once without claiming the old queue resumed', async t => {
  const f = registered(t, { frames: 1000 });
  await f.play();
  await until(() => f.chats.some(message => /Now playing/.test(message.content)));
  f.bot.emit('disconnected', { serverId: 'a' });
  await until(() => !f.connections.has('a'));
  f.bot.emit('connected', { serverId: 'a' });
  await until(() => f.chats.some(message => /queue was not resumed/.test(message.content)));
  await tick();
  f.bot.emit('connected', { serverId: 'a' });
  await tick();
  assert.equal(f.chats.filter(message => /queue was not resumed/.test(message.content)).length, 1);
});

test('repeated reconnect events share one pending lost-playback notice', async t => {
  const f = registered(t, { frames: 1000 });
  await f.play();
  await until(() => f.chats.some(message => /Now playing/.test(message.content)));
  f.loseVoice('socket_lost');
  f.bot.emit('disconnected', { serverId: 'a' });
  const delivery = gate();
  t.after(delivery.release);
  let attempts = 0;
  const send = f.bot.sendMessage;
  t.mock.method(f.bot, 'sendMessage', async (...args) => {
    if (/queue was not resumed/.test(args[2])) { attempts++; await delivery.promise; }
    return send(...args);
  });
  f.bot.emit('connected', { serverId: 'a' });
  f.bot.emit('connected', { serverId: 'a' });
  assert.equal(attempts, 1);
  delivery.release();
  await until(() => f.chats.some(message => /queue was not resumed/.test(message.content)));
  f.bot.emit('connected', { serverId: 'a' });
  await tick();
  assert.equal(attempts, 1);
  assert.equal(f.chats.some(message => /Playback stopped|Queue finished/.test(message.content)), false);
});

test('reconnect does not claim playback is lost after real audio has already resumed', async t => {
  const f = registered(t, { frames: 1000 });
  await f.play();
  await until(() => f.chats.some(message => /Now playing/.test(message.content)));
  f.bot.emit('disconnected', { serverId: 'a' });
  await until(() => !f.connections.has('a'));
  await tick();
  await f.play();
  await until(() => f.chats.filter(message => /Now playing/.test(message.content)).length === 2);
  f.bot.emit('connected', { serverId: 'a' });
  await tick();
  assert.equal(f.chats.some(message => /queue was not resumed|Playback stopped/.test(message.content)), false);
});

for (const ending of ['normal EOF', 'manual stop']) {
  test(`reconnection after ${ending} cannot invent lost playback`, async t => {
    const f = registered(t, { frames: ending === 'normal EOF' ? 1 : 1000 });
    await f.play();
    await until(() => f.chats.some(message => /Now playing/.test(message.content)));
    if (ending === 'manual stop') await f.control('stop');
    else await until(() => f.chats.some(message => /Queue finished/.test(message.content)));
    const count = f.chats.length;
    f.bot.emit('disconnected', { serverId: 'a' });
    await until(() => !f.connections.has('a'));
    f.bot.emit('connected', { serverId: 'a' });
    await tick();
    assert.equal(f.chats.length, count);
  });
}

test('live bot settings update only the corresponding server idle timer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = registered(t);
  await f.play('a');
  await f.play('b');
  await until(() => f.chats.filter(message => /Queue finished/.test(message.content)).length === 2);
  f.configure('a', 2);
  t.mock.timers.tick(2000);
  await tick();
  assert.equal(f.connections.has('a'), false);
  assert.equal(f.connections.has('b'), true);
});

test('incomplete media is explained in chat instead of being reported as a normal song end', async t => {
  t.mock.method(console, 'error', () => {});
  const f = registered(t, { open: async () => ({
    frames: (async function* () {
      yield Uint8Array.of(248, 255, 254);
      throw new IncompleteAudioError(20_000, 1000);
    })(),
    close: async () => {},
  }) });
  await f.play('a', 'pt-BR');
  await until(() => f.chats.some(message => /\u00e1udio incompleto/.test(message.content)));
  assert.match(f.chats.find(message => /\u00e1udio incompleto/.test(message.content)).content, /0:01 de aproximadamente 0:20/);
});

test('registered persistent playback never announces retries and disconnect cancels its wait', async t => {
  let waiting = false, closed = false, release;
  const f = registered(t, { open: async (_track, signal, options) => {
    assert.deepEqual(options, { mode: 'persistent', progress: 'playback' });
    return {
      recoveryMode: 'persistent',
      frames: (async function* () {
        yield Uint8Array.of(248, 255, 254);
        waiting = true;
        await new Promise(resolve => { release = resolve; });
        assert.equal(signal.aborted, true);
      })(),
      close: async () => { closed = true; release(); },
    };
  } });
  await f.play();
  await until(() => waiting);
  assert.equal(f.chats.filter(message => /Now playing/.test(message.content)).length, 1);
  assert.equal(f.chats.some(message => /resum|recover/i.test(message.content)), false);
  f.loseVoice('left');
  await until(() => closed);
  assert.equal(f.chats.some(message => /Playback stopped|Queue finished|resum|recover/i.test(message.content)), false);
});
