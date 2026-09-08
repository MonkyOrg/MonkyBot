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

function context({ args = {}, locale = 'pt-BR', answers = [], controller = new AbortController() } = {}) {
  const replies = [];
  const published = [];
  const forms = [];
  return {
    replies, published, forms, controller,
    ctx: {
      invocationId: 'invocation',
      commandName: 'test',
      channelId: 'channel',
      invokerId: 'caller',
      invokerNickname: 'Tester',
      serverId: 'server',
      locale, args, signal: controller.signal,
      reply: (content) => replies.push(content),
      replyEphemeral: (content) => replies.push(content),
      publish: (content) => published.push(content),
      prompt: async (form) => {
        forms.push(form);
        const answer = answers[forms.length - 1];
        return typeof answer === 'function' ? answer(form) : answer ?? null;
      },
    },
  };
}

test('all six public command names register with the current SDK', async () => {
  const bot = new BotClient({ publicKey: 'test-public-key' });
  try {
    registerAllCommands(bot);
    assert.deepEqual(commands.map((command) => command.name), ['ping', 'dado', 'moeda', '8ball', 'enquete', 'ajuda']);
    assert.equal(pollCommand.options, undefined);
    assert.deepEqual(diceCommand.options[0], {
      name: 'lados',
      description: 'Número de lados do dado (padrão: 6)',
      type: 'integer',
      required: false,
      min: 2,
      max: 100,
    });
  } finally {
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
        assert.doesNotMatch(state.replies[0], /<pergunta> \[opções\]/);
      }
    }
  });

  test(`8ball keeps complete questions and supports a private form (${locale})`, async () => {
    const question = locale === 'en' ? 'Will we ship the full feature today?' : 'Vamos lançar a funcionalidade completa hoje?';
    const inline = context({ locale, args: { pergunta: question } });
    await eightBallCommand.handler(inline.ctx);
    assert.ok(inline.replies[0].includes(question));
    assert.equal(inline.forms.length, 0);
    assert.equal(inline.published.length, 0);

    const guided = context({ locale, answers: [{ pergunta: question }] });
    await eightBallCommand.handler(guided.ctx);
    assert.equal(guided.forms.length, 1);
    assert.equal(guided.forms[0].fields[0].maxLength, 200);
    assert.equal(guided.forms[0].fields[0].label, locale === 'en' ? 'Your question' : 'Sua pergunta');
    assert.ok(guided.replies[0].includes(question));
    assert.equal(guided.published.length, 0);

    for (const invalid of [true, 2, ' ', 'x'.repeat(201)]) {
      const state = context({ locale, args: { pergunta: invalid } });
      await eightBallCommand.handler(state.ctx);
      assert.match(state.replies[0], /200/);
      assert.equal(state.published.length, 0);
    }
  });

  test(`poll defaults to private and uses independent list fields (${locale})`, async () => {
    const state = context({ locale, answers: [
      { pergunta: 'Which lunch?', opcoes: ['Rice, beans', 'Pasta'] },
      { acao: 'confirm' },
    ] });
    await pollCommand.handler(state.ctx);
    assert.equal(state.forms.length, 2);
    assert.equal(state.forms[0].title, locale === 'en' ? 'Create a poll' : 'Criar enquete');
    const options = state.forms[0].fields.find((field) => field.name === 'opcoes');
    assert.equal(options.type, 'string-list');
    assert.equal(options.minItems, 2);
    assert.equal(options.maxItems, 10);
    assert.equal(options.maxLength, 80);
    assert.equal(state.forms[0].fields.find((field) => field.name === 'visibilidade').defaultValue, 'private');
    assert.equal(state.replies.length, 2);
    assert.equal(state.published.length, 0);
    assert.match(state.replies[1], /1️⃣ Rice, beans\n2️⃣ Pasta/);
    assert.doesNotMatch(state.replies[1], /Reaja|React/);
  });

  test(`poll only publishes after explicit visibility choice and confirmation (${locale})`, async () => {
    const state = context({ locale, answers: [
      { pergunta: 'Ship?', opcoes: ['Yes', 'No'], visibilidade: 'public' },
      () => {
        assert.equal(state.published.length, 0);
        return { acao: 'confirm' };
      },
    ] });
    await pollCommand.handler(state.ctx);
    assert.equal(state.replies.length, 1, 'The preview stays private.');
    assert.equal(state.published.length, 1);
    assert.match(state.published[0], /Ship\?/);
    assert.match(state.forms[1].description, locale === 'en' ? /publish this poll/ : /publicará esta enquete/);
  });
}

test('editing a poll preserves values, supports multiple rounds, and can revoke publishing', async () => {
  const first = { pergunta: 'First?', opcoes: ['One', 'Two'], visibilidade: 'public' };
  const second = { pergunta: 'Second?', opcoes: ['Three', 'Four', 'Five'], visibilidade: 'private' };
  const state = context({ answers: [
    first, { acao: 'edit' },
    (form) => {
      assert.equal(form.fields[0].defaultValue, first.pergunta);
      assert.deepEqual(form.fields[1].defaultValue, first.opcoes);
      assert.equal(form.fields[2].defaultValue, first.visibilidade);
      return second;
    },
    { acao: 'edit' },
    (form) => {
      assert.equal(form.fields[0].defaultValue, second.pergunta);
      assert.deepEqual(form.fields[1].defaultValue, second.opcoes);
      assert.equal(form.fields[2].defaultValue, second.visibilidade);
      return { ...second, pergunta: 'Final?' };
    },
    { acao: 'confirm' },
  ] });
  await pollCommand.handler(state.ctx);
  assert.equal(state.forms.length, 6);
  assert.equal(state.published.length, 0);
  assert.match(state.replies.at(-1), /Final\?/);
});

test('cancelled or aborted prompts never produce a final result', async () => {
  for (const answers of [
    [null],
    [{ pergunta: 'Cancel?', opcoes: ['Yes', 'No'], visibilidade: 'public' }, null],
  ]) {
    const state = context({ answers });
    await pollCommand.handler(state.ctx);
    assert.equal(state.published.length, 0);
    assert.equal(state.replies.length, answers.length - 1);
  }
  for (const command of [pollCommand, eightBallCommand]) {
    const controller = new AbortController();
    const state = context({ controller, answers: [() => {
      controller.abort();
      return { pergunta: 'Aborted?', opcoes: ['Yes', 'No'], visibilidade: 'public' };
    }] });
    await command.handler(state.ctx);
    assert.equal(state.replies.length, 0);
    assert.equal(state.published.length, 0);
  }
  const cancelledBall = context({ answers: [null] });
  await eightBallCommand.handler(cancelledBall.ctx);
  assert.equal(cancelledBall.replies.length, 0);
});

test('already-aborted invocations are ignored by every command', async () => {
  for (const command of commands) {
    const controller = new AbortController();
    controller.abort();
    const state = context({ controller });
    await command.handler(state.ctx);
    assert.equal(state.forms.length + state.replies.length + state.published.length, 0);
  }
});

test('invalid poll values cannot publish or enter confirmation', async () => {
  for (const values of [
    { pergunta: 1, opcoes: ['Yes', 'No'] },
    { pergunta: 'Question?', opcoes: 'Yes,No' },
    { pergunta: 'Question?', opcoes: [' Yes ', 'yes'] },
    { pergunta: 'Question?', opcoes: ['Only one'] },
    { pergunta: 'Question?', opcoes: ['Yes', 'No'], visibilidade: true },
    { pergunta: 'Question?', opcoes: Array.from({ length: 11 }, (_, i) => String(i)) },
    { pergunta: 'Question?', opcoes: ['x'.repeat(81), 'No'] },
  ]) {
    const state = context({ answers: [values, null] });
    await pollCommand.handler(state.ctx);
    assert.equal(state.forms.length, 2);
    assert.equal(state.forms[1].title, 'Criar enquete');
    assert.equal(state.published.length, 0);
    assert.match(state.replies[0], /Revise/);
  }
});

test('PM2 passes the configured bot identity in both modes', () => {
  for (const mode of ['manual', 'marketplace']) {
    const ecosystem = generateEcosystem({ mode, botDir: process.cwd(), botName: 'My MonkyBot' });
    assert.match(ecosystem, /MONKY_BOT_NAME: 'My MonkyBot'/);
  }
});
