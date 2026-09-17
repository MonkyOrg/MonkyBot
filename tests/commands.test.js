const assert = require('node:assert/strict');
const { test } = require('node:test');
const { BotClient } = require('@monky/bot-sdk');
const { commands, registerAllCommands, requestedCapabilities } = require('../dist/commands');
const { diceCommand } = require('../dist/commands/dice');
const { eightBallCommand } = require('../dist/commands/eightball');
const { pollCommand } = require('../dist/commands/poll');
const { coinCommand } = require('../dist/commands/coin');
const { pingCommand } = require('../dist/commands/ping');
const { helpCommand } = require('../dist/commands/help');
const { generateEcosystem } = require('../dist/cli/pm2');
const { setCliLocale, normalizeCliLocale } = require('../dist/cli/i18n');
const sdk = require('@monky/bot-sdk');

const presentations = [
  ['ping', 'ping', 'ping'], ['dado', 'dado', 'dice'], ['moeda', 'moeda', 'coin'],
  ['8ball', 'bola-magica', '8ball'], ['enquete', 'enquete', 'poll'], ['ajuda', 'ajuda', 'help'],
  ['play', 'tocar', 'play'], ['queue', 'fila', 'queue'], ['nowplaying', 'tocando', 'nowplaying'],
  ['pause', 'pausar', 'pause'], ['resume', 'retomar', 'resume'], ['skip', 'pular', 'skip'],
  ['stop', 'parar', 'stop'], ['leave', 'sair', 'leave'], ['remove', 'remover', 'remove'],
  ['clear', 'limpar', 'clear'], ['jogo-da-velha', 'jogo-da-velha', 'tic-tac-toe'],
];

test('production declares only the capabilities its commands use', () => {
  assert.deepEqual(requestedCapabilities, [
    'commands', 'send_messages', 'publish_voice', 'local_execution', 'selectors', 'miniapps',
  ]);
});

test('all 17 official definitions declare the expected presentation names and retain translated option text', () => {
  assert.equal(commands.length, 17);
  assert.deepEqual(commands.map(command => command.name), presentations.map(([canonical]) => canonical));
  for (const command of commands) {
    const text = command.localizations.en;
    const [, ptName, enName] = presentations.find(([canonical]) => canonical === command.name);
    assert.ok(text.description.trim() && text.description.length <= 100, command.name);
    assert.notEqual(text.description, command.description, command.name);
    assert.equal(text.name, enName);
    assert.equal(command.localizations['pt-BR'].name, ptName);
    assert.equal(command.localizations['pt-BR'].description, undefined, 'Portuguese names reuse base descriptions');
    assert.deepEqual(Object.keys(text.options ?? {}).sort(), (command.options ?? []).map(option => option.name).sort());
    for (const option of command.options ?? []) {
      const field = text.options[option.name];
      assert.ok(field.label && field.label.length <= 100);
      assert.ok(field.description && field.description.length <= 100);
      assert.equal(field.name, undefined, 'Argument keys stay canonical');
    }
  }
});

test('localized schemas survive SDK registration and canonical language normalization', async () => {
  assert.equal(typeof sdk.localizeCommand, 'function');
  assert.equal(typeof sdk.getCommandPresentation, 'function');
  const definitionsBefore = JSON.stringify(commands);
  const bot = new BotClient({ publicKey: 'test-public-key', requestedCapabilities });
  const dispose = registerAllCommands(bot);
  try {
    for (const command of commands) {
      const registered = bot.commands.get(command.name);
      assert.deepEqual(registered.localizations, command.localizations);
      const original = structuredClone({ name: registered.name, localizations: registered.localizations, options: registered.options });
      const [, ptName, enName] = presentations.find(([canonical]) => canonical === command.name);
      for (const [locale, expectedName] of [['pt-BR', ptName], ['en', enName], ['pt-BR', ptName]]) {
        const localized = sdk.localizeCommand(registered, locale);
        const presentation = sdk.getCommandPresentation(registered, locale);
        assert.equal(localized.name, command.name);
        assert.equal(localized.description, locale === 'en' ? command.localizations.en.description : command.description);
        assert.equal(presentation.canonicalName, command.name);
        assert.equal(presentation.displayName, expectedName);
        assert.ok(presentation.inputNames.includes(command.name));
        assert.ok(presentation.inputNames.includes(expectedName));
        assert.equal(new Set(presentation.inputNames).size, presentation.inputNames.length);
        assert.deepEqual((localized.options ?? []).map(option => option.name), (command.options ?? []).map(option => option.name));
        assert.deepEqual((localized.options ?? []).map(option => option.choices?.map(choice => choice.value)),
          (command.options ?? []).map(option => option.choices?.map(choice => choice.value)));
        for (const option of localized.options ?? []) {
          if (locale === 'en') assert.equal(option.label, command.localizations.en.options[option.name].label);
        }
      }
      assert.deepEqual({ name: registered.name, localizations: registered.localizations, options: registered.options }, original);
    }
    assert.ok(sdk.getCommandPresentation(bot.commands.get('8ball'), 'pt-BR').inputNames.includes('bola-magica'));
    assert.equal(sdk.getCommandPresentation(bot.commands.get('8ball'), 'en').inputNames.includes('bola-magica'), false);
    assert.equal(JSON.stringify(commands), definitionsBefore);
    for (const locale of ['pt', 'pt-BR', 'pt_PT', 'en', 'en-US', 'EN_us', 'en-GB', undefined]) {
      assert.equal(normalizeCliLocale(locale), sdk.resolveBotLocale(locale));
    }
  } finally { await dispose(); await bot.close(); }
});

function context({ args = {}, locale = 'pt-BR', controller = new AbortController() } = {}) {
  const replies = [];
  const published = [];
  const forms = [];
  return {
    replies, published, forms, controller,
    ctx: {
      invocationId: 'invocation', commandName: 'test', channelId: 'channel',
      invokerId: 'caller', invokerNickname: 'Tester', serverId: 'server',
      locale, args, signal: controller.signal,
      reply: (content) => replies.push(content),
      replyEphemeral: (content) => replies.push(content),
      publish: (content) => published.push(content),
      prompt: async (form) => { forms.push(form); return null; },
      createSelector: async () => assert.fail('Unexpected public selector'),
    },
  };
}

test('all public command names register with the current SDK and dispose listeners', async () => {
  const bot = new BotClient({ publicKey: 'test-public-key', requestedCapabilities });
  const dispose = registerAllCommands(bot);
  try {
    assert.deepEqual(commands.map((command) => command.name), ['ping', 'dado', 'moeda', '8ball', 'enquete', 'ajuda',
      'play', 'queue', 'nowplaying', 'pause', 'resume', 'skip', 'stop', 'leave', 'remove', 'clear', 'jogo-da-velha']);
    assert.equal(commands.find(command => command.name === 'play').options[0].autocomplete, true);
    assert.equal(commands.find(command => command.name === 'jogo-da-velha').voiceRequirement, 'joined');
    assert.equal(pollCommand.options, undefined);
    assert.equal(eightBallCommand.options[0].required, true);
    assert.equal(bot.listenerCount('selectorUpdate'), 1);
    assert.deepEqual(diceCommand.options[0], {
      name: 'lados', description: 'Número de lados do dado (padrão: 6)',
      type: 'integer', required: false, min: 2, max: 100,
    });
  } finally {
    await dispose();
    assert.equal(bot.listenerCount('selectorUpdate'), 0);
    assert.equal(bot.listenerCount('voiceDisconnected'), 0);
    assert.equal(bot.listenerCount('voiceParticipantsChanged'), 0);
    assert.equal(bot.listenerCount('screenAction'), 0);
    await bot.close();
  }
});

for (const locale of ['pt-BR', 'en']) {
  test(`dice accepts typed integers and defaults without coercion (${locale})`, () => {
    for (const sides of [undefined, 2, 20, 100]) {
      const state = context({ locale, args: sides === undefined ? {} : { lados: sides } });
      diceCommand.handler(state.ctx);
      assert.equal(state.replies.length, 1);
      const result = state.replies[0].match(/d(\d+)\.\.\. \*\*(\d+)\*\*/);
      assert.ok(result);
      assert.equal(Number(result[1]), sides ?? 6);
      assert.ok(Number(result[2]) >= 1 && Number(result[2]) <= (sides ?? 6));
      assert.equal(state.published.length, 0);
      assert.match(state.replies[0], locale === 'en' ? /Rolling/ : /Rolando/);
    }
    for (const sides of ['20', '20abc', true, false, 1, 101, 2.5, NaN, Infinity]) {
      const state = context({ locale, args: { lados: sides } });
      diceCommand.handler(state.ctx);
      assert.match(state.replies[0], locale === 'en' ? /whole number/ : /número inteiro/);
      assert.equal(state.published.length, 0);
    }
  });

  test(`coin, ping, and help are localized and private (${locale})`, () => {
    for (const command of [coinCommand, pingCommand, helpCommand]) {
      const state = context({ locale });
      command.handler(state.ctx);
      assert.equal(state.replies.length, 1);
      assert.equal(state.published.length, 0);
      if (command === coinCommand) assert.match(state.replies[0], locale === 'en' ? /Heads|Tails/ : /Cara|Coroa/);
      if (command === pingCommand) assert.match(state.replies[0], locale === 'en' ? /is online/ : /está online/);
      if (command === helpCommand) {
        assert.match(state.replies[0], locale === 'en' ? /Replies are private/ : /respostas são privadas/);
        assert.ok(state.replies[0].includes(`**/${sdk.getCommandPresentation(pollCommand, locale).displayName}**`));
        assert.match(state.replies[0], locale === 'en' ? /\/8ball <question>/ : /\/bola-magica <pergunta>/);
        assert.match(state.replies[0], locale === 'en' ? /\/dice \[sides\]/ : /\/dado \[lados\]/);
        assert.match(state.replies[0], locale === 'en' ? /\/play <search>/ : /\/tocar <busca>/);
        assert.match(state.replies[0], locale === 'en' ? /\/remove <position>/ : /\/remover <posição>/);
        assert.match(state.replies[0], locale === 'en' ? /Submitting the poll form publishes/ : /Ao enviar o formulário de enquete/);
        assert.match(state.replies[0], locale === 'en' ? /Music requires voice membership/ : /Música exige estar em voz/);
        assert.match(state.replies[0], locale === 'en' ? /invitation on the stage/ : /convite no palco/);
        assert.ok(state.replies[0].length <= 2000);
      }
    }
  });

  test(`8ball requires a complete question and defends empty or invalid arguments (${locale})`, async () => {
    const question = locale === 'en' ? 'Will we ship the full feature today?' : 'Vamos lançar a funcionalidade completa hoje?';
    const inline = context({ locale, args: { pergunta: question } });
    await eightBallCommand.handler(inline.ctx);
    assert.ok(inline.replies[0].includes(question));
    assert.equal(inline.forms.length, 0);
    assert.equal(inline.published.length, 0);

    for (const invalid of [undefined, null, '', ' ', true, 2, 'x'.repeat(201)]) {
      const state = context({ locale, args: { pergunta: invalid } });
      await eightBallCommand.handler(state.ctx);
      assert.match(state.replies[0], /200/);
      assert.equal(state.forms.length, 0);
      assert.equal(state.published.length, 0);
    }
  });
}

test('already-aborted invocations are ignored by basic commands', async () => {
  for (const command of [pingCommand, diceCommand, coinCommand, eightBallCommand, pollCommand, helpCommand]) {
    const controller = new AbortController();
    controller.abort();
    const state = context({ controller });
    await command.handler(state.ctx);
    assert.equal(state.forms.length + state.replies.length + state.published.length, 0);
  }
});

test('per-user command language is independent of the operator CLI language', () => {
  try {
    for (const [operator, user, pattern] of [['pt-BR', 'en', /is online/], ['en', 'pt-BR', /está online/]]) {
      setCliLocale(operator);
      const state = context({ locale: user });
      pingCommand.handler(state.ctx);
      assert.match(state.replies[0], pattern);
      assert.equal(state.published.length, 0);
    }
    const legacy = context({ locale: 'en-US' });
    pingCommand.handler(legacy.ctx);
    assert.match(legacy.replies[0], /is online/);
  } finally { setCliLocale('pt-BR'); }
});

test('private help matches every registered display name without changing another user locale', async () => {
  const bot = new BotClient({ publicKey: 'test-public-key', requestedCapabilities });
  const dispose = registerAllCommands(bot);
  const original = JSON.stringify(commands);
  try {
    for (const [operator, user] of [['en', 'pt-BR'], ['pt-BR', 'en'], ['en', 'pt-BR']]) {
      setCliLocale(operator);
      const state = context({ locale: user });
      helpCommand.handler(state.ctx);
      assert.equal(state.published.length, 0);
      assert.equal(state.replies.length, 1);
      assert.ok(state.replies[0].length < 2000);
      for (const registered of bot.commands.values()) {
        const { displayName } = sdk.getCommandPresentation(registered, user);
        assert.match(state.replies[0], new RegExp(`/${displayName}(?![a-z0-9-])`));
        assert.ok(state.replies[0].includes(sdk.localizeCommand(registered, user).description));
        if (registered.name !== displayName) {
          assert.doesNotMatch(state.replies[0], new RegExp(`/${registered.name}(?![a-z0-9-])`));
        }
      }
    }
    assert.equal(JSON.stringify(commands), original);
  } finally {
    setCliLocale('pt-BR');
    await dispose();
    await bot.close();
  }
});

test('PM2 passes the configured bot identity in both modes', () => {
  for (const mode of ['manual', 'marketplace']) {
    const ecosystem = generateEcosystem({ mode, botDir: process.cwd(), botName: 'My MonkyBot' });
    assert.match(ecosystem, /MONKY_BOT_NAME: 'My MonkyBot'/);
  }
});
