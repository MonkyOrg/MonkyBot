const assert = require('node:assert/strict');
const path = require('node:path');
const readline = require('node:readline');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');

const { setupCommand } = require('../dist/cli/commands/setup');
const config = require('../dist/cli/config');
const { CONFIG_DIR } = require('../dist/cli/constants');
const { DEFAULT_BOT_NAME } = require('../dist/profile');

function captureLogs(t) {
  const lines = [];
  t.mock.method(console, 'log', (...args) => lines.push(args.join(' ')));
  return lines;
}

function interactiveAnswers(t, answers) {
  const pending = [...answers];
  const questions = [];
  t.mock.method(readline, 'createInterface', (options) => {
    assert.equal(options.historySize, 0, 'The readline history must not retain the token.');
    const rl = new EventEmitter();
    rl.question = (question, callback) => {
      assert.ok(pending.length, `Unexpected prompt: ${question}`);
      questions.push(question);
      options.output.write(question);
      const answer = pending.shift();
      queueMicrotask(() => {
        if (answer === null) {
          rl.emit('close');
          return;
        }
        options.output.write(answer);
        callback(answer);
      });
    };
    rl.close = () => rl.emit('close');
    rl.on = rl.addListener.bind(rl);
    rl.off = rl.removeListener.bind(rl);
    return rl;
  });
  t.after(() => assert.deepEqual(pending, [], 'All expected setup answers must be consumed.'));
  return questions;
}

function mockConfig(t, initialConfig = null) {
  let current = initialConfig === null ? null : JSON.parse(JSON.stringify(initialConfig));
  t.mock.method(config, 'readConfig', () => current);
  t.mock.method(config, 'writeConfig', (next) => {
    current = JSON.parse(JSON.stringify(next));
  });
  return { get current() { return current; } };
}

test('setup defaults to the recommended URL installation for fresh configs', async (t) => {
  const state = mockConfig(t);
  const questions = interactiveAnswers(t, ['', '', '7781', 'bot.example.test', '']);
  const lines = captureLogs(t);
  const write = t.mock.method(process.stdout, 'write', () => true);

  try {
    await setupCommand();
  } finally {
    write.mock.restore();
  }

  assert.deepEqual(state.current, {
    mode: 'marketplace',
    botDir: CONFIG_DIR,
    servePort: 7781,
    publicHost: 'bot.example.test',
    botName: DEFAULT_BOT_NAME,
  });
  assert.equal(questions[0], 'Modo [1]: ');
  assert.equal(questions.some((question) => /Token do bot|URL do servidor/.test(question)), false);
  assert.match(lines.join('\n'), /1\. Instalação por URL — recomendado/);
  assert.match(lines.join('\n'), /2\. Conexão manual por token — avançado/);
});

test('setup reprompts invalid mode choices and only reveals the advanced manual flow when selected', async (t) => {
  const state = mockConfig(t);
  const token = 'manual-secret-token';
  const questions = interactiveAnswers(t, ['3', '2', '', '192.0.2.15:3000', token, 'Meu MonkyBot']);
  const lines = captureLogs(t);
  const terminal = [];
  const write = t.mock.method(process.stdout, 'write', (chunk) => {
    terminal.push(String(chunk));
    return true;
  });

  try {
    await setupCommand();
  } finally {
    write.mock.restore();
  }

  assert.equal(questions.filter((question) => question === 'Modo [1]: ').length, 2);
  assert.match(questions[3], /URL do servidor/);
  assert.match(questions[4], /Token do bot/);
  assert.deepEqual(state.current, {
    mode: 'manual',
    botDir: CONFIG_DIR,
    serverUrl: 'ws://192.0.2.15:3000/',
    botToken: token,
    botName: 'Meu MonkyBot',
  });
  assert.match(lines.join('\n'), /Na seção Avançado, gere um vínculo\/token/);
  assert.doesNotMatch(lines.join('\n'), /Clique "Criar", dê um nome ao bot/);
  assert.equal(lines.join('\n').includes(token), false);
  assert.equal(terminal.join('').includes(token), false);
});

test('setup preserves existing manual mode, working directory, name and hidden token by default', async (t) => {
  const existing = {
    mode: 'manual',
    botDir: path.join(CONFIG_DIR, 'runtime'),
    serverUrl: 'wss://existing.example.test/',
    botToken: 'existing-manual-token',
    botName: 'Existing MonkyBot',
  };
  const state = mockConfig(t, existing);
  const questions = interactiveAnswers(t, ['', '', '', '', '']);
  const lines = captureLogs(t);
  const terminal = [];
  const write = t.mock.method(process.stdout, 'write', (chunk) => {
    terminal.push(String(chunk));
    return true;
  });

  try {
    await setupCommand();
  } finally {
    write.mock.restore();
  }

  assert.equal(questions[0], 'Modo [2]: ');
  assert.deepEqual(state.current, existing);
  assert.equal(lines.join('\n').includes(existing.botToken), false);
  assert.equal(terminal.join('').includes(existing.botToken), false);
});

test('setup preserves existing URL installation settings by default', async (t) => {
  const existing = {
    mode: 'marketplace',
    botDir: path.join(CONFIG_DIR, 'url-runtime'),
    servePort: 8899,
    publicHost: 'bot.example.test',
    botName: 'URL MonkyBot',
  };
  const state = mockConfig(t, existing);
  const questions = interactiveAnswers(t, ['', '', '', '', '']);
  captureLogs(t);
  const write = t.mock.method(process.stdout, 'write', () => true);

  try {
    await setupCommand();
  } finally {
    write.mock.restore();
  }

  assert.equal(questions[0], 'Modo [1]: ');
  assert.deepEqual(state.current, existing);
});

test('setup reuses SDK validation and reprompts invalid URL, token and identity without saving them', async (t) => {
  const state = mockConfig(t);
  const questions = interactiveAnswers(t, [
    '2', '', 'https://invalid.example.test', '192.0.2.15:3000',
    '', 'synthetic-token', 'x', 'x'.repeat(33), 'Valid Bot',
  ]);
  captureLogs(t);
  const errors = t.mock.method(console, 'error', () => {});
  const write = t.mock.method(process.stdout, 'write', () => true);

  try {
    await setupCommand();
  } finally {
    write.mock.restore();
  }

  assert.equal(questions.filter((question) => question.startsWith('URL do servidor')).length, 2);
  assert.equal(questions.filter((question) => question.startsWith('Token do bot')).length, 2);
  assert.equal(questions.filter((question) => question.startsWith('Nome do bot')).length, 3);
  assert.equal(errors.mock.calls.length, 4);
  assert.equal(config.writeConfig.mock.calls.length, 1);
  assert.deepEqual(state.current, {
    mode: 'manual',
    botDir: CONFIG_DIR,
    serverUrl: 'ws://192.0.2.15:3000/',
    botToken: 'synthetic-token',
    botName: 'Valid Bot',
  });
});

test('setup refuses an unsupported saved mode instead of silently converting it to URL installation', async (t) => {
  const existing = {
    mode: 'unsupported',
    botDir: path.join(CONFIG_DIR, 'runtime'),
    botName: 'Existing Bot',
  };
  const state = mockConfig(t, existing);
  const createInterface = t.mock.method(readline, 'createInterface', () => {
    assert.fail('Invalid saved configuration must fail before prompting.');
  });

  await assert.rejects(() => setupCommand(), /modo inválido/);
  assert.equal(createInterface.mock.calls.length, 0);
  assert.equal(config.writeConfig.mock.calls.length, 0);
  assert.deepEqual(state.current, existing);
});
