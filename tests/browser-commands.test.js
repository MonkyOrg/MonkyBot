const assert = require('node:assert/strict');
const { generateKeyPairSync, randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { test } = require('node:test');
const { WebSocketServer } = require('ws');
const { BotClient, BotRequestError, getCommandPresentation, MessageType, PROTOCOL_VERSION, ProtocolErrorCode } = require('@monky/bot-sdk');
const { browserCommand } = require('../dist/commands/browser');
const { botMessageText } = require('./helpers/bot-message');

function fixture(locale, createBrowserScreen) {
  const controller = new AbortController(), screens = [], replies = [];
  const ctx = {
    locale, signal: controller.signal, args: { url: 'https://private.example.test/' },
    invokerId: 'host', invokerVoiceChannelId: 'voice',
    reply: value => replies.push(botMessageText(value, locale)),
    publish: () => assert.fail('Browser invitations must not publish URLs or messages to chat'),
    createScreen: () => assert.fail('Browser must not create an HTML or iframe miniapp'),
    joinVoice: () => assert.fail('Browser sharing must not join the bot to voice audio'),
    getVoiceConnection: () => assert.fail('Browser sharing must not require a bot audio connection'),
    localExecution: () => assert.fail('Browser sharing must not request desktop capture or local tools'),
    createBrowserScreen: async input => {
      screens.push(input);
      return createBrowserScreen?.(input) ?? { kind: 'browser' };
    },
  };
  return { ctx, controller, screens, replies };
}

test('/browser has no URL argument and requires membership in a voice room', () => {
  assert.equal(browserCommand.name, 'browser');
  assert.equal(browserCommand.voiceRequirement, 'joined');
  assert.equal(browserCommand.options, undefined);
  assert.equal(browserCommand.localizations['pt-BR'].name, 'navegador');
  assert.equal(browserCommand.localizations.en.name, 'browser');
  assert.match(browserCommand.description, /Controle.*compartilhe sua imagem com a sala/);
  assert.match(browserCommand.localizations.en.description, /Host.*share its image with your voice room/);
});

test('/navegador is the Portuguese presentation and input name while /browser stays canonical and English', () => {
  const portuguese = getCommandPresentation(browserCommand, 'pt-BR');
  const english = getCommandPresentation(browserCommand, 'en');
  assert.equal(portuguese.canonicalName, 'browser');
  assert.equal(portuguese.displayName, 'navegador');
  assert.ok(portuguese.inputNames.includes('navegador'));
  assert.ok(portuguese.inputNames.includes('browser'));
  assert.equal(english.canonicalName, 'browser');
  assert.equal(english.displayName, 'browser');
  assert.ok(english.inputNames.includes('browser'));
  assert.equal(english.inputNames.includes('navegador'), false);
});

for (const locale of ['pt-BR', 'en']) {
  test(`/browser creates only a localized native invitation without URL, HTML, state or storage (${locale})`, async () => {
    const f = fixture(locale);
    await browserCommand.handler(f.ctx);
    assert.deepEqual(f.screens, [{ title: locale === 'en' ? 'Browser' : 'Navegador' }]);
    assert.equal(f.replies.length, 1);
    assert.match(f.replies[0], locale === 'en' ? /Browser miniapp created.*You control it in Monky desktop/ : /Miniapp do navegador criado.*Você controla no Monky desktop/);
    assert.match(f.replies[0], locale === 'en' ? /room watches its image once streaming is active/ : /sala assiste à imagem quando a transmissão estiver ativa/);
    assert.match(f.replies[0], locale === 'en' ? /miniapp shows the streaming status/ : /estado da transmissão aparece no miniapp/);
    assert.match(f.replies[0], locale === 'en' ? /Only this browser is captured, not your desktop/ : /Só esse navegador é capturado, não seu desktop/);
    assert.doesNotMatch(f.replies[0], /individual|independent|Streaming started|live now|Transmissão iniciada|no ar/);
    assert.doesNotMatch(f.replies[0], /private\.example/);
  });

  test(`/browser reports creation failures privately rather than claiming navigation succeeded (${locale})`, async t => {
    const logged = t.mock.method(console, 'error', () => {});
    const f = fixture(locale, async () => { throw new Error('Connection failed'); });
    await browserCommand.handler(f.ctx);
    assert.equal(f.replies.length, 1);
    assert.match(f.replies[0], locale === 'en' ? /Could not create.*voice room.*permission/ : /Não foi possível criar.*sala de voz.*permissão/);
    assert.doesNotMatch(f.replies[0], locale === 'en' ? /Browser miniapp created/ : /Miniapp do navegador criado/);
    assert.equal(logged.mock.calls.length, 1);
    assert.match(logged.mock.calls[0].arguments.join(' '), /\[browser\].*Connection failed/);
  });

  test(`/browser explains that a server without browser sharing needs updating (${locale})`, async t => {
    const logged = t.mock.method(console, 'error', () => {});
    const f = fixture(locale, async () => {
      throw new BotRequestError('Server did not negotiate miniapp-browser-broadcast', ProtocolErrorCode.FEATURE_REQUIRES_UPDATE);
    });
    await browserCommand.handler(f.ctx);
    assert.equal(f.replies.length, 1);
    assert.match(f.replies[0], locale === 'en' ? /Update the Monky server.*shared browser miniapps/ : /Atualize o servidor Monky.*navegador compartilhado/);
    assert.doesNotMatch(f.replies[0], locale === 'en' ? /Browser miniapp created/ : /Miniapp do navegador criado/);
    assert.equal(logged.mock.calls.length, 1);
  });

  test(`/browser explains desktop-only hosting without excluding web viewers (${locale})`, async t => {
    const logged = t.mock.method(console, 'error', () => {});
    const f = fixture(locale, async () => {
      throw new BotRequestError('The invoking session cannot host a browser on the web',
        ProtocolErrorCode.MINIAPP_BROWSER_DESKTOP_REQUIRED);
    });
    await browserCommand.handler(f.ctx);
    assert.equal(f.replies.length, 1);
    assert.match(f.replies[0], locale === 'en' ? /Use Monky desktop.*control and stream.*On the web.*watch/ : /Use o Monky desktop.*controlar e transmitir.*Na web.*assistir/);
    assert.doesNotMatch(f.replies[0], /miniapp.*criado|miniapp created|Update the Monky server|Atualize o servidor/);
    assert.equal(logged.mock.calls.length, 1);
  });
}

test('/browser waits for miniapp creation without claiming a live stream from its acknowledgement', async () => {
  let confirm;
  const acknowledgement = new Promise(resolve => { confirm = resolve; });
  const f = fixture('en', () => acknowledgement);
  const creating = browserCommand.handler(f.ctx);
  assert.deepEqual(f.replies, []);
  confirm({ kind: 'browser' });
  await creating;
  assert.equal(f.replies.length, 1);
  assert.match(f.replies[0], /once streaming is active/);
  assert.doesNotMatch(f.replies[0], /Streaming started|live now/);
});

test('/browser does not create an invitation for an already cancelled invocation', async () => {
  const f = fixture('en');
  f.controller.abort();
  await browserCommand.handler(f.ctx);
  assert.deepEqual(f.screens, []);
  assert.deepEqual(f.replies, []);
});

test('/browser does not send a success reply after cancellation while creation is in flight', async () => {
  const f = fixture('en', async () => {
    f.controller.abort();
    return { kind: 'browser' };
  });
  await browserCommand.handler(f.ctx);
  assert.equal(f.screens.length, 1);
  assert.deepEqual(f.replies, []);
});

test('/browser does not report an expected cancellation as a creation failure', async t => {
  const logged = t.mock.method(console, 'error', () => {});
  const f = fixture('en', async () => {
    f.controller.abort();
    throw f.controller.signal.reason;
  });
  await browserCommand.handler(f.ctx);
  assert.deepEqual(f.replies, []);
  assert.equal(logged.mock.calls.length, 0);
});

test('/browser keeps cleanup failures visible even after the invocation was cancelled', async t => {
  const logged = t.mock.method(console, 'error', () => {});
  const f = fixture('en', async () => {
    f.controller.abort();
    throw new Error('Could not close the cancelled browser invitation');
  });
  await browserCommand.handler(f.ctx);
  assert.deepEqual(f.replies, []);
  assert.equal(logged.mock.calls.length, 1);
  assert.match(logged.mock.calls[0].arguments.join(' '), /Could not close the cancelled browser invitation/);
});

async function runtime(t, { features = ['miniapp-browser', 'miniapp-browser-broadcast'], voiceChannelId = 'voice', creationError } = {}) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  t.after(() => new Promise(resolve => {
    for (const socket of server.clients) socket.terminate();
    server.close(resolve);
  }));
  await once(server, 'listening', { signal: t.signal });
  const messages = [], errors = [];
  let peer;
  server.on('connection', socket => {
    peer = socket;
    socket.on('message', bytes => {
      const message = JSON.parse(bytes.toString());
      messages.push(message);
      if (message.type === MessageType.AUTH_CONNECT) {
        socket.send(JSON.stringify({ type: MessageType.AUTH_SUCCESS, payload: {
          server: { protocol: { version: PROTOCOL_VERSION, minimumVersion: 24, features } },
        } }));
      } else if (message.type === MessageType.BOT_UPDATE_PROFILE) {
        socket.send(JSON.stringify({ type: MessageType.BOT_PROFILE_UPDATED, requestId: message.requestId, payload: {} }));
      } else if (message.type === MessageType.BOT_VOICE_CONTEXT) {
        socket.send(JSON.stringify({ type: MessageType.BOT_VOICE_CONTEXT_RESULT, requestId: message.requestId,
          payload: { invocationId: message.payload.invocationId, voiceChannelId } }));
      } else if (message.type === MessageType.BOT_SCREEN_CREATE && creationError) {
        socket.send(JSON.stringify({ type: MessageType.SERVER_ERROR, requestId: message.requestId,
          payload: { code: creationError, message: 'The invoking session cannot host this browser.' } }));
      }
      server.emit(message.type, message);
    });
  });
  const publicKey = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
  const bot = new BotClient({ publicKey, requestedCapabilities: ['commands', 'miniapps'] });
  bot.command(browserCommand);
  bot.on('error', error => errors.push(error));
  t.after(() => bot.close());
  const registered = once(server, MessageType.COMMAND_REGISTER, { signal: t.signal });
  const connected = once(bot, 'connected', { signal: t.signal });
  bot.connect({ serverUrl: `ws://127.0.0.1:${server.address().port}`, token: 'f'.repeat(64) });
  await connected;
  await registered;
  const hostSessionId = randomUUID();
  const invoke = locale => {
    const invocationId = randomUUID();
    peer.send(JSON.stringify({ type: MessageType.COMMAND_INVOKE, payload: {
      invocationId, botId: 'bot', commandName: 'browser', channelId: 'text', options: {}, locale,
      invokerId: 'host', invokerSessionId: hostSessionId, invokerNickname: 'Host',
      invokerVoiceChannelId: 'stale-voice',
    } }));
    return invocationId;
  };
  return { server, messages, errors, invoke,
    acknowledge: request => peer.send(JSON.stringify({
      type: MessageType.BOT_SCREEN_SNAPSHOT, requestId: request.requestId, payload: {
        id: randomUUID(), instanceId: randomUUID(), botId: 'bot',
        channelId: request.payload.channelId, title: request.payload.title, kind: 'browser', html: '', state: null,
        creatorUserId: 'host', hostSessionId, broadcastSource: null, revision: 0, createdAt: Date.now(),
      },
    })),
  };
}

for (const locale of ['pt-BR', 'en']) {
  test(`/browser uses the real SDK to create the native miniapp without bot audio or a live-stream claim (${locale})`, { timeout: 5000 }, async t => {
    const f = await runtime(t);
    const creation = once(f.server, MessageType.BOT_SCREEN_CREATE, { signal: t.signal });
    const response = once(f.server, MessageType.COMMAND_RESPONSE, { signal: t.signal });
    const finished = once(f.server, MessageType.COMMAND_FINISH, { signal: t.signal });
    const invocationId = f.invoke(locale);
    const [request] = await creation;
    assert.equal(request.payload.channelId, 'voice', 'Creation uses the current authoritative voice context.');
    assert.equal(request.payload.invocationId, invocationId);
    assert.equal(request.payload.kind, 'browser');
    assert.equal(request.payload.title, locale === 'en' ? 'Browser' : 'Navegador');
    assert.equal(request.payload.html, '');
    assert.equal(request.payload.state, null);
    assert.ok(Object.keys(request.payload).every(key => [
      'id', 'channelId', 'title', 'invocationId', 'kind', 'html', 'state',
    ].includes(key)), 'The SDK sends no URL, login, cookie, capture setting or caller-selected host.');
    assert.equal(f.messages.some(message => message.type === MessageType.COMMAND_RESPONSE), false);
    f.acknowledge(request);
    const [reply] = await response;
    await finished;
    assert.equal(reply.payload.ephemeral, true);
    assert.equal(reply.payload.invocationId, invocationId);
    const text = botMessageText({ content: reply.payload.content, localizations: reply.payload.localizations }, locale);
    assert.match(text, locale === 'en' ? /once streaming is active/ : /quando a transmissão estiver ativa/);
    assert.doesNotMatch(text, /Streaming started|live now|Transmissão iniciada|no ar/);
    assert.equal(f.messages.some(message => /^BOT_VOICE_/.test(message.type) &&
      message.type !== MessageType.BOT_VOICE_CONTEXT), false, 'The bot never joins or publishes voice audio.');
    assert.deepEqual(f.errors, []);
  });
}

for (const features of [[], ['miniapp-browser']]) {
  test(`/browser rejects missing broadcast negotiation through the real SDK (${features.join(',') || 'none'})`, { timeout: 5000 }, async t => {
    const logged = t.mock.method(console, 'error', () => {});
    const f = await runtime(t, { features });
    const response = once(f.server, MessageType.COMMAND_RESPONSE, { signal: t.signal });
    const finished = once(f.server, MessageType.COMMAND_FINISH, { signal: t.signal });
    f.invoke('en');
    const [reply] = await response;
    await finished;
    assert.match(botMessageText({ content: reply.payload.content, localizations: reply.payload.localizations }, 'en'), /Update the Monky server/);
    assert.equal(reply.payload.ephemeral, true);
    assert.equal(f.messages.some(message => message.type === MessageType.BOT_SCREEN_CREATE), false);
    assert.equal(logged.mock.calls.length, 1);
    assert.deepEqual(f.errors, []);
  });
}

for (const locale of ['pt-BR', 'en']) {
  test(`/browser reports server refusal of a web host through the real SDK (${locale})`, { timeout: 5000 }, async t => {
    const logged = t.mock.method(console, 'error', () => {});
    const f = await runtime(t, { creationError: ProtocolErrorCode.MINIAPP_BROWSER_DESKTOP_REQUIRED });
    const response = once(f.server, MessageType.COMMAND_RESPONSE, { signal: t.signal });
    const finished = once(f.server, MessageType.COMMAND_FINISH, { signal: t.signal });
    f.invoke(locale);
    const [reply] = await response;
    await finished;
    const text = botMessageText({ content: reply.payload.content, localizations: reply.payload.localizations }, locale);
    assert.match(text, locale === 'en' ? /Use Monky desktop.*On the web.*watch/ : /Use o Monky desktop.*Na web.*assistir/);
    assert.equal(reply.payload.ephemeral, true);
    assert.equal(f.messages.filter(message => message.type === MessageType.BOT_SCREEN_CREATE).length, 1);
    assert.equal(logged.mock.calls.length, 1);
    assert.deepEqual(f.errors, []);
  });
}

test('/browser rejects a caller who has left voice without joining bot audio or creating a miniapp', { timeout: 5000 }, async t => {
  const logged = t.mock.method(console, 'error', () => {});
  const f = await runtime(t, { voiceChannelId: null });
  const response = once(f.server, MessageType.COMMAND_RESPONSE, { signal: t.signal });
  const finished = once(f.server, MessageType.COMMAND_FINISH, { signal: t.signal });
  f.invoke('en');
  const [reply] = await response;
  await finished;
  assert.match(botMessageText({ content: reply.payload.content, localizations: reply.payload.localizations }, 'en'), /Could not create.*voice room access/);
  assert.equal(reply.payload.ephemeral, true);
  assert.equal(f.messages.some(message => message.type === MessageType.BOT_SCREEN_CREATE), false);
  assert.equal(f.messages.some(message => /^BOT_VOICE_/.test(message.type) &&
    message.type !== MessageType.BOT_VOICE_CONTEXT), false);
  assert.equal(logged.mock.calls.length, 1);
  assert.deepEqual(f.errors, []);
});
