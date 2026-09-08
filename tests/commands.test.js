const assert = require('node:assert/strict');
const { test } = require('node:test');
const { BotClient } = require('@monky/bot-sdk');
const { commands, registerAllCommands } = require('../dist/commands');
const { diceCommand } = require('../dist/commands/dice');
const { eightBallCommand } = require('../dist/commands/eightball');
const { pollCommand } = require('../dist/commands/poll');
const { coinCommand } = require('../dist/commands/coin');
const { pingCommand } = require('../dist/commands/ping');
const { helpCommand } = require('../dist/commands/help');
const { generateEcosystem } = require('../dist/cli/pm2');

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

test('all six public command names register with the current SDK', async () => {
  const bot = new BotClient({ publicKey: 'test-public-key' });
  const dispose = registerAllCommands(bot);
  try {
    assert.deepEqual(commands.map((command) => command.name), ['ping', 'dado', 'moeda', '8ball', 'enquete', 'ajuda']);
    assert.equal(pollCommand.options, undefined);
    assert.equal(eightBallCommand.options[0].required, true);
    assert.equal(bot.listenerCount('selectorUpdate'), 1);
    assert.deepEqual(diceCommand.options[0], {
      name: 'lados', description: 'Número de lados do dado (padrão: 6)',
      type: 'integer', required: false, min: 2, max: 100,
    });
  } finally {
    dispose();
    assert.equal(bot.listenerCount('selectorUpdate'), 0);
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
        assert.match(state.replies[0], /\*\*\/enquete\*\*/);
        assert.match(state.replies[0], /\/8ball <pergunta>/);
        assert.match(state.replies[0], locale === 'en' ? /Submitting the poll form publishes/ : /Ao enviar o formulário de enquete/);
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

test('already-aborted invocations are ignored by every command', async () => {
  for (const command of commands) {
    const controller = new AbortController();
    controller.abort();
    const state = context({ controller });
    await command.handler(state.ctx);
    assert.equal(state.forms.length + state.replies.length + state.published.length, 0);
  }
});

test('PM2 passes the configured bot identity in both modes', () => {
  for (const mode of ['manual', 'marketplace']) {
    const ecosystem = generateEcosystem({ mode, botDir: process.cwd(), botName: 'My MonkyBot' });
    assert.match(ecosystem, /MONKY_BOT_NAME: 'My MonkyBot'/);
  }
});
