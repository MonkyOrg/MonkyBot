const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const readline = require('node:readline');
const { randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');

const { setupCommand } = require('../dist/cli/commands/setup');
const config = require('../dist/cli/config');
const constants = require('../dist/cli/constants');
const { CONFIG_DIR } = constants;
const manifestPort = require('../dist/cli/manifestPort');
const { DEFAULT_BOT_NAME } = require('../dist/profile');
const { setBindHost, listen, freePort } = require('./helpers/manifest-port');

function captureLogs(t) {
  const lines = [];
  t.mock.method(console, 'log', (...args) => lines.push(args.join(' ')));
  return lines;
}

function interactiveAnswers(t, answers, terminal = []) {
  const pending = [...answers];
  const questions = [];
  const failures = [];
  t.mock.method(readline, 'createInterface', (options) => {
    assert.equal(options.historySize, 0, 'The readline history must not retain the token.');
    const rl = new EventEmitter();
    const writeOutput = (chunk) => {
      // The test runner also uses stdout between awaits, so only intercept synchronous terminal writes.
      const write = t.mock.method(process.stdout, 'write', (value) => {
        terminal.push(String(value));
        return true;
      });
      try {
        options.output.write(chunk);
      } finally {
        write.mock.restore();
      }
    };
    rl.question = (question, callback) => {
      assert.ok(pending.length, `Unexpected prompt: ${question}`);
      questions.push(question);
      writeOutput(question);
      const next = pending.shift();
      queueMicrotask(() => {
        Promise.resolve().then(() => typeof next === 'function' ? next(rl) : next).then((answer) => {
          if (answer === null) {
            rl.emit('close');
            return;
          }
          writeOutput(answer);
          callback(answer);
        }).catch((error) => {
          failures.push(error);
          rl.emit('close');
        });
      });
    };
    rl.close = () => rl.emit('close');
    rl.on = rl.addListener.bind(rl);
    rl.off = rl.removeListener.bind(rl);
    t.after(() => {
      assert.equal(rl.listenerCount('close'), 0);
      assert.equal(rl.listenerCount('SIGINT'), 0);
    });
    return rl;
  });
  t.after(() => assert.deepEqual(pending, [], 'All expected setup answers must be consumed.'));
  t.after(() => assert.deepEqual(failures, []));
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
  setBindHost(t);
  const port = await freePort(t);
  const state = mockConfig(t);
  const questions = interactiveAnswers(t, ['', '', String(port), 'bot.example.test', '']);
  const lines = captureLogs(t);

  await setupCommand();

  assert.deepEqual(state.current, {
    mode: 'marketplace',
    botDir: CONFIG_DIR,
    servePort: port,
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
  const terminal = [];
  const questions = interactiveAnswers(t, ['3', '2', '', '192.0.2.15:3000', token, 'Meu MonkyBot'], terminal);
  const lines = captureLogs(t);

  await setupCommand();

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
  const terminal = [];
  const questions = interactiveAnswers(t, ['', '', '', '', ''], terminal);
  const lines = captureLogs(t);

  await setupCommand();

  assert.equal(questions[0], 'Modo [2]: ');
  assert.deepEqual(state.current, existing);
  assert.equal(lines.join('\n').includes(existing.botToken), false);
  assert.equal(terminal.join('').includes(existing.botToken), false);
});

test('setup preserves existing URL installation settings by default', async (t) => {
  setBindHost(t);
  const existing = {
    mode: 'marketplace',
    botDir: path.join(CONFIG_DIR, 'url-runtime'),
    servePort: await freePort(t),
    publicHost: 'bot.example.test',
    botName: 'URL MonkyBot',
  };
  const state = mockConfig(t, existing);
  const questions = interactiveAnswers(t, ['', '', '', '', '']);
  captureLogs(t);

  await setupCommand();

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

  await setupCommand();

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

test('setup retries only the occupied port and does not read or mix another bot manifest', async (t) => {
  setBindHost(t);
  let requests = 0;
  const otherBot = await listen(t, http.createServer((_request, response) => {
    requests++;
    response.end(JSON.stringify({ name: 'Other Bot' }));
  }));
  const occupied = otherBot.address().port;
  const available = await freePort(t);
  const state = mockConfig(t);
  const questions = interactiveAnswers(t, ['', '', String(occupied), String(available), '127.0.0.1', 'MonkyBot']);
  const errors = t.mock.method(console, 'error', () => {});
  captureLogs(t);
  await setupCommand();
  assert.equal(questions.filter((question) => question.startsWith('Porta do manifest')).length, 2);
  assert.equal(questions.filter((question) => question.startsWith('Modo')).length, 1);
  assert.equal(questions.filter((question) => question.startsWith('Host público')).length, 1);
  assert.equal(state.current.servePort, available);
  assert.equal(state.current.botName, 'MonkyBot');
  assert.equal(config.writeConfig.mock.callCount(), 1);
  assert.match(errors.mock.calls[0].arguments[0], /já está em uso por um bot ou outro serviço/);
  assert.equal(requests, 0, 'A manifest response must not be used to infer port ownership.');
  const ownBot = await listen(t, http.createServer((_request, response) => {
    response.end(JSON.stringify({ name: state.current.botName }));
  }), state.current.servePort);
  async function identity(port) {
    return new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/manifest`, { agent: false }, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.on('error', reject);
        response.on('end', () => resolve(JSON.parse(body)));
      }).on('error', reject);
    });
  }
  assert.deepEqual(await identity(ownBot.address().port), { name: 'MonkyBot' });
  assert.deepEqual(await identity(occupied), { name: 'Other Bot' });
  assert.equal(otherBot.listening, true);
});

for (const name of ['MonkyBot', 'Another Bot']) {
  test(`setup does not assume ownership from an old config or the manifest name (${name})`, async (t) => {
    setBindHost(t);
    let requests = 0;
    const service = await listen(t, http.createServer((_request, response) => {
      requests++;
      response.end(JSON.stringify({ name }));
    }));
    const port = service.address().port;
    const existing = {
      mode: 'marketplace', botDir: CONFIG_DIR, servePort: port,
      publicHost: '127.0.0.1', botName: 'MonkyBot',
    };
    const state = mockConfig(t, existing);
    interactiveAnswers(t, ['', '', '', null]);
    const errors = t.mock.method(console, 'error', () => {});
    captureLogs(t);
    await assert.rejects(setupCommand(), /Setup cancelado/);
    assert.deepEqual(state.current, existing);
    assert.equal(config.writeConfig.mock.callCount(), 0);
    assert.match(errors.mock.calls[0].arguments[0], /monkybot stop antes de continuar/);
    assert.equal(requests, 0);
    assert.equal(service.listening, true);
  });
}

test('setup rechecks before saving and retains all other answers if the port is taken later', async (t) => {
  setBindHost(t);
  const initialPort = await freePort(t);
  let replacement;
  const state = mockConfig(t);
  const questions = interactiveAnswers(t, [
    '', '', String(initialPort), 'bot.example.test',
    async () => {
      await listen(t, undefined, initialPort);
      replacement = await freePort(t);
      return 'Chosen Bot';
    },
    () => String(replacement),
  ]);
  captureLogs(t);
  const errors = t.mock.method(console, 'error', () => {});
  await setupCommand();
  assert.equal(state.current.servePort, replacement);
  assert.equal(state.current.publicHost, 'bot.example.test');
  assert.equal(state.current.botName, 'Chosen Bot');
  assert.equal(questions.filter((question) => question.startsWith('Nome do bot')).length, 1);
  assert.equal(questions.filter((question) => question.startsWith('Host público')).length, 1);
  assert.equal(questions.filter((question) => question.startsWith('Porta do manifest')).length, 2);
  assert.equal(errors.mock.callCount(), 1);
  assert.equal(config.writeConfig.mock.callCount(), 1);
  await listen(t, undefined, replacement);
});

function savedIdentity(t) {
  const dir = path.join(__dirname, `.manifest-state-${randomUUID()}`);
  fs.mkdirSync(path.join(dir, '.keys'), { recursive: true });
  const configFile = path.join(dir, 'config.json');
  const keysFile = path.join(dir, '.keys', 'identity.json');
  const initial = {
    mode: 'manual', botDir: dir, serverUrl: 'ws://127.0.0.1:3000/',
    botToken: 'synthetic-preserved-token', botName: 'Existing Bot',
  };
  const configBytes = `${JSON.stringify(initial, null, 4)}\n`;
  const keysBytes = '{"synthetic-test-identity":"preserved"}\n';
  fs.writeFileSync(configFile, configBytes);
  fs.writeFileSync(keysFile, keysBytes);
  const previousFile = constants.CONFIG_FILE;
  const previousDir = constants.CONFIG_DIR;
  constants.CONFIG_FILE = configFile;
  constants.CONFIG_DIR = dir;
  t.after(() => {
    constants.CONFIG_FILE = previousFile;
    constants.CONFIG_DIR = previousDir;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return () => {
    assert.equal(fs.readFileSync(configFile, 'utf8'), configBytes);
    assert.equal(fs.readFileSync(keysFile, 'utf8'), keysBytes);
  };
}

test('cancelling after a collision leaves the saved config and keys byte-for-byte unchanged', async (t) => {
  setBindHost(t);
  const unchanged = savedIdentity(t);
  const service = await listen(t);
  interactiveAnswers(t, ['1', '', String(service.address().port), null]);
  captureLogs(t);
  t.mock.method(console, 'error', () => {});
  await assert.rejects(setupCommand(), /Setup cancelado/);
  unchanged();
  assert.equal(service.listening, true);
});

test('setup aborts if readline closes during the async port check before the next prompt', { timeout: 5000 }, async (t) => {
  setBindHost(t);
  const unchanged = savedIdentity(t);
  const port = await freePort(t);
  let rl;
  const questions = interactiveAnswers(t, ['1', '', (current) => {
    rl = current;
    return String(port);
  }]);
  const check = manifestPort.assertManifestPortAvailable;
  const probe = t.mock.method(manifestPort, 'assertManifestPortAvailable', async (candidate) => {
    await check(candidate);
    rl.emit('SIGINT');
  });
  const lines = captureLogs(t);
  await assert.rejects(setupCommand(), /Setup cancelado/);
  unchanged();
  assert.equal(probe.mock.callCount(), 1);
  assert.equal(questions.length, 3);
  assert.equal(questions.some((question) => /Host público|Nome do bot/.test(question)), false);
  assert.doesNotMatch(lines.join('\n'), /Configuração salva/);
  await listen(t, undefined, port);
});

test('cancelling during the final async check cannot persist config or touch keys', async (t) => {
  setBindHost(t);
  const unchanged = savedIdentity(t);
  const port = await freePort(t);
  let rl;
  interactiveAnswers(t, ['1', '', String(port), 'bot.example.test', (current) => {
    rl = current;
    return 'New Bot';
  }]);
  const check = manifestPort.assertManifestPortAvailable;
  let checks = 0;
  t.mock.method(manifestPort, 'assertManifestPortAvailable', async (candidate) => {
    await check(candidate);
    if (++checks === 2) rl.emit('close');
  });
  captureLogs(t);
  await assert.rejects(setupCommand(), /Setup cancelado/);
  unchanged();
  assert.equal(checks, 2);
  await listen(t, undefined, port);
});

test('manual setup never probes a manifest port', async (t) => {
  mockConfig(t);
  interactiveAnswers(t, ['2', '', '', 'synthetic-token', '']);
  t.mock.method(manifestPort, 'assertManifestPortAvailable', () => assert.fail('Manual mode must not probe.'));
  captureLogs(t);
  await setupCommand();
});
