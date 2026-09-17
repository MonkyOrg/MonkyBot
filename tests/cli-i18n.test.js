const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const i18n = require('../dist/cli/i18n');

const modulePath = path.resolve(__dirname, '..', 'dist', 'cli', 'i18n.js');
const cliPath = path.resolve(__dirname, '..', 'dist', 'cli.js');
const runtimePath = path.resolve(__dirname, '..', 'dist', 'index.js');

function isolated(t, code, { locale, saved, preferenceText, config, status = 0 } = {}) {
  const home = fs.mkdtempSync(path.join(__dirname, '.cli-locale-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  const configDir = path.join(home, '.monkybot');
  if (saved || config || preferenceText !== undefined) {
    fs.mkdirSync(configDir);
    if (preferenceText !== undefined || saved) {
      fs.writeFileSync(path.join(configDir, 'preferences.json'), preferenceText ?? JSON.stringify({ locale: saved }));
    }
    if (config) fs.writeFileSync(path.join(configDir, 'config.json'), config);
  }
  const result = spawnSync(process.execPath, ['-e', code], {
    encoding: 'utf8', timeout: 15000,
    env: {
      ...process.env, HOME: home, USERPROFILE: home, TEMP: home, TMP: home,
      MONKY_BOT_LOCALE: '', MONKY_LANG: '', MONKYBOT_LOCALE: locale ?? '', LC_ALL: '', LC_MESSAGES: '', LANG: '', CI: '',
      NODE_OPTIONS: '', NODE_PATH: '',
    },
  });
  assert.ifError(result.error);
  assert.equal(result.status, status, result.stdout + result.stderr);
  return { home, configDir, output: result.stdout, errors: result.stderr };
}

const fakePrompt = answers => `
  const { EventEmitter } = require('node:events');
  const answers = ${JSON.stringify(answers)};
  const prompts = [];
  const interfaces = [];
  require('node:readline').createInterface = options => {
    if (options.historySize !== 0) throw new Error('Prompt history must be disabled');
    const rl = new EventEmitter();
    interfaces.push(rl);
    rl.question = (question, callback) => {
      prompts.push(question);
      if (!answers.length) throw new Error('Unexpected prompt');
      const answer = answers.shift();
      queueMicrotask(() => answer === null ? rl.emit('close') : callback(answer));
    };
    rl.close = () => rl.emit('close');
    return rl;
  };
`;

test('CLI locale normalization handles supported aliases and safely defaults', () => {
  for (const value of ['en', 'EN', ' en-US ', 'en_US', 'en_GB']) assert.equal(i18n.normalizeCliLocale(value), 'en');
  for (const value of ['pt', 'pt-BR', 'pt_PT', '', 'fr', undefined, null, {}, 'english']) {
    assert.equal(i18n.normalizeCliLocale(value), 'pt-BR');
  }
});

test('language command saves a canonical preference even without a terminal', t => {
  const result = isolated(t, `
    require('node:readline').createInterface = () => { throw new Error('Unexpected prompt'); };
    process.argv = [process.execPath, ${JSON.stringify(cliPath)}, 'language', 'en-US'];
    require(${JSON.stringify(cliPath)});
  `);
  assert.match(result.output, /Language saved: en/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(result.configDir, 'preferences.json'))), { locale: 'en' });
  assert.deepEqual(fs.readdirSync(result.configDir), ['preferences.json']);
});

test('recognized automation and TTY help/version do not trigger first-use language selection', t => {
  for (const args of [['--help'], ['--version'], ['music-check', '--unexpected']]) {
    const result = isolated(t, `
      const exits = [];
      process.exit = code => { exits.push(code); };
      Object.defineProperty(process.stdin, 'isTTY', { value: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: true });
      require('node:readline').createInterface = () => { throw new Error('Unexpected prompt'); };
      process.argv = [process.execPath, ${JSON.stringify(cliPath)}, ...${JSON.stringify(args)}];
      require(${JSON.stringify(cliPath)});
    `);
    assert.doesNotMatch(result.output + result.errors, /Unexpected prompt/);
    assert.deepEqual(fs.readdirSync(result.home), []);
  }
});

test('canonical SDK environment override takes precedence without rewriting the saved preference', t => {
  const result = isolated(t, `
    process.env.MONKY_BOT_LOCALE = 'en-US';
    require('node:readline').createInterface = () => { throw new Error('Unexpected prompt'); };
    const i18n = require(${JSON.stringify(modulePath)});
    i18n.initializeCliLanguage({ interactive: true }).then(() => console.log(i18n.getCliLocale()));
  `, { saved: 'pt-BR', locale: 'pt-BR' });
  assert.equal(result.output.trim(), 'en');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(result.configDir, 'preferences.json'))), { locale: 'pt-BR' });
});

test('MONKY_LANG follows SDK precedence and never persists an environment override', t => {
  for (const [canonical, expected] of [['', 'en'], ['pt-BR', 'pt-BR']]) {
    const result = isolated(t, `
      process.env.MONKY_LANG = 'en-GB';
      process.env.MONKY_BOT_LOCALE = ${JSON.stringify(canonical)};
      require('node:readline').createInterface = () => { throw new Error('Unexpected prompt'); };
      const i18n = require(${JSON.stringify(modulePath)});
      i18n.initializeCliLanguage({ interactive: true }).then(() => console.log(i18n.getCliLocale()));
    `, { saved: 'pt-BR' });
    assert.equal(result.output.trim(), expected);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(result.configDir, 'preferences.json'))), { locale: 'pt-BR' });
  }
});

test('invalid preferences warn once without leaking contents, prompting or silently overwriting the file', t => {
  for (const [preferenceText, system, expected] of [
    ['{"locale":"fixture-secret', '', /preferência de idioma válida/],
    ['{"locale":"fr","unused":"fixture-secret"}', 'en_US.UTF-8', /valid language preference/],
    ['x'.repeat(1025), '', /preferência de idioma válida/],
  ]) {
    const result = isolated(t, `
      process.env.LANG = ${JSON.stringify(system)};
      require('node:readline').createInterface = () => { throw new Error('Unexpected prompt'); };
      const i18n = require(${JSON.stringify(modulePath)});
      (async () => {
        await i18n.initializeCliLanguage({ interactive: true });
        console.log(i18n.getCliLocale(), i18n.getCliLocale());
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `, { preferenceText });
    assert.match(result.errors, expected);
    assert.equal(result.errors.trim().split('\n').length, 1);
    assert.doesNotMatch(result.errors, /fixture-secret|Unexpected prompt/);
    assert.equal(fs.readFileSync(path.join(result.configDir, 'preferences.json'), 'utf8'), preferenceText);
    assert.deepEqual(fs.readdirSync(result.configDir), ['preferences.json']);
  }
});

test('invalid preference never blocks help, and version does not inspect it', t => {
  for (const args of [['--help'], ['--version']]) {
    const result = isolated(t, `
      require('node:readline').createInterface = () => { throw new Error('Unexpected prompt'); };
      process.argv = [process.execPath, ${JSON.stringify(cliPath)}, ...${JSON.stringify(args)}];
      require(${JSON.stringify(cliPath)});
    `, { preferenceText: '{"locale":"fixture-secret' });
    assert.match(result.output, args[0] === '--help' ? /COMANDOS/ : /^monkybot /);
    if (args[0] === '--help') assert.match(result.errors, /preferência de idioma válida/);
    else assert.equal(result.errors, '');
    assert.equal(fs.readFileSync(path.join(result.configDir, 'preferences.json'), 'utf8'), '{"locale":"fixture-secret');
  }
});

test('CI language queries never prompt even when both streams are TTY', t => {
  const result = isolated(t, `
    process.env.CI = '1';
    Object.defineProperty(process.stdin, 'isTTY', { value: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true });
    require('node:readline').createInterface = () => { throw new Error('Unexpected prompt'); };
    process.argv = [process.execPath, ${JSON.stringify(cliPath)}, 'language'];
    require(${JSON.stringify(cliPath)});
  `);
  assert.doesNotMatch(result.output + result.errors, /Unexpected prompt/);
  assert.deepEqual(fs.readdirSync(result.home), []);
});

test('first interactive use asks once, persists language, and never rewrites the bot profile', t => {
  const config = '{"mode":"manual","botToken":"fixture-token","botDir":"fixture-dir"}\n';
  const result = isolated(t, `${fakePrompt(['invalid', '2'])}
    const i18n = require(${JSON.stringify(modulePath)});
    (async () => {
      await i18n.initializeCliLanguage({ interactive: true });
      await i18n.initializeCliLanguage({ interactive: true });
      console.log(JSON.stringify({
        locale: i18n.getCliLocale(), text: i18n.cliText('Olá', 'Hello'),
        prompts: prompts.length, answers: answers.length,
        listeners: interfaces.map(rl => rl.listenerCount('close')),
      }));
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `, { config });
  assert.deepEqual(JSON.parse(result.output), {
    locale: 'en', text: 'Hello', prompts: 2, answers: 0, listeners: [0],
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(result.configDir, 'preferences.json'))), { locale: 'en' });
  assert.equal(fs.readFileSync(path.join(result.configDir, 'config.json'), 'utf8'), config);
  assert.deepEqual(fs.readdirSync(result.configDir).sort(), ['config.json', 'preferences.json']);
});

test('the actual CLI asks on first interactive use and applies the selected language immediately', t => {
  const result = isolated(t, `${fakePrompt(['2'])}
    Object.defineProperty(process.stdin, 'isTTY', { value: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true });
    global.fetch = () => { throw new Error('Unexpected network request'); };
    process.argv = [process.execPath, ${JSON.stringify(cliPath)}, 'config'];
    require(${JSON.stringify(cliPath)});
  `);
  assert.match(result.output, /No configuration found/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(result.configDir, 'preferences.json'))), { locale: 'en' });
  assert.deepEqual(fs.readdirSync(result.configDir), ['preferences.json']);
});

for (const locale of ['pt-BR', 'en']) {
  test(`runtime event logging preserves sanitized nested diagnostics without keys or networking (${locale})`, t => {
    const result = isolated(t, `
      const { EventEmitter } = require('node:events');
      const sdk = require('@monky/bot-sdk');
      const { MusicError } = require('./dist/music/errors');
      require('./dist/utils/keys').loadOrGenerateKeys = () => ({
        publicKeyHex: '302a300506032b6570032100' + '11'.repeat(32), privateKeyPem: '',
      });
      require('./dist/profile').loadBotAvatar = () => '';
      require('./dist/commands').registerAllCommands = () => async () => {};
      class FixtureBot extends EventEmitter {
        serverCount = 1;
        registeredServerCount = 0;
        constructor() {
          super();
          process.nextTick(() => this.emit('error', new Error('Public message', {
            cause: new MusicError('unavailable',
              'HTTP 403 https://rr1.googlevideo.com/videoplayback?sig=fixture-secret token=fixture-secret'),
          }), { serverId: 'fixture-server' }));
        }
        async serve() { return Object.assign(new EventEmitter(), { address: () => ({ port: 7780 }) }); }
        async close() {}
      }
      sdk.BotClient = FixtureBot;
      process.env.MONKY_SERVE = 'true';
      process.env.MONKY_SERVE_PORT = '7780';
      process.env.MONKY_SERVE_PUBLIC_HOST = 'bot.example.test';
      global.fetch = () => { throw new Error('Unexpected network request'); };
      require(${JSON.stringify(runtimePath)});
    `, { locale });
    assert.match(result.errors, locale === 'en' ? /Link error fixture-server/ : /Erro no vínculo fixture-server/);
    assert.match(result.errors, /unavailable.*HTTP 403/);
    assert.doesNotMatch(result.errors, /googlevideo|fixture-secret|videoplayback/);
    assert.deepEqual(fs.readdirSync(result.home), []);
  });
}

test('fatal bootstrap logging also redacts the original error cause rather than dumping the Error object', t => {
  const result = isolated(t, `
    const { MusicError } = require('./dist/music/errors');
    require('./dist/utils/keys').loadOrGenerateKeys = () => {
      throw new Error('Fixture bootstrap failure', {
        cause: new MusicError('unavailable', 'HTTP 403 https://rr1.googlevideo.com/videoplayback?sig=fixture-secret'),
      });
    };
    require(${JSON.stringify(runtimePath)});
  `, { status: 1 });
  assert.match(result.errors, /Fatal: Fixture bootstrap failure.*unavailable.*HTTP 403/);
  assert.doesNotMatch(result.errors, /googlevideo|fixture-secret|videoplayback/);
  assert.deepEqual(fs.readdirSync(result.home), []);
});

test('cancelled language selection does not persist a partial preference or alter configuration', t => {
  const config = '{"mode":"marketplace","servePort":7780,"publicHost":"fixture.example"}';
  const result = isolated(t, `${fakePrompt([null])}
    const i18n = require(${JSON.stringify(modulePath)});
    i18n.initializeCliLanguage({ interactive: true }).then(
      () => { throw new Error('Expected cancellation'); },
      error => console.log(JSON.stringify({ message: error.message, listeners: interfaces[0].listenerCount('close') })),
    );
  `, { config });
  assert.match(JSON.parse(result.output).message, /cancelled.*cancelada/);
  assert.equal(fs.existsSync(path.join(result.configDir, 'preferences.json')), false);
  assert.equal(fs.readFileSync(path.join(result.configDir, 'config.json'), 'utf8'), config);
});

test('saved locale is reused; an explicit environment override does not rewrite it', t => {
  for (const [saved, locale, expected] of [['en', undefined, 'en'], ['pt-BR', 'en-US', 'en']]) {
    const result = isolated(t, `
      require('node:readline').createInterface = () => { throw new Error('Unexpected prompt'); };
      const i18n = require(${JSON.stringify(modulePath)});
      i18n.initializeCliLanguage({ interactive: true }).then(() => console.log(i18n.getCliLocale()));
    `, { saved, locale });
    assert.equal(result.output.trim(), expected);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(result.configDir, 'preferences.json'))), { locale: saved });
  }
});

test('noninteractive language initialization performs no writes or prompts', t => {
  const result = isolated(t, `
    require('node:readline').createInterface = () => { throw new Error('Unexpected prompt'); };
    const i18n = require(${JSON.stringify(modulePath)});
    i18n.initializeCliLanguage().then(() => console.log(i18n.getCliLocale()));
  `);
  assert.equal(result.output.trim(), 'pt-BR');
  assert.deepEqual(fs.readdirSync(result.home), []);
});

for (const locale of ['pt-BR', 'en']) {
  test(`CLI help, version and noninteractive config remain read-only (${locale})`, t => {
    for (const args of [['--help'], ['setup', '--help'], ['--version'], ['config']]) {
      const result = isolated(t, `
        require('node:readline').createInterface = () => { throw new Error('Unexpected prompt'); };
        global.fetch = () => { throw new Error('Unexpected network request'); };
        process.argv = [process.execPath, ${JSON.stringify(cliPath)}, ...${JSON.stringify(args)}];
        require(${JSON.stringify(cliPath)});
      `, { locale });
      assert.deepEqual(fs.readdirSync(result.home), []);
      if (args.includes('--help')) {
        assert.match(result.output, locale === 'en' ? /USAGE|COMMANDS/ : /USO|COMANDOS/);
        for (const name of ['setup', 'music-check', 'music-diagnose', 'language']) assert.ok(result.output.includes(name));
        assert.match(result.output, locale === 'en' ? /automatically starts\/restarts/ : /inicia\/reinicia automaticamente/);
        assert.doesNotMatch(result.output, /2\.\s+monkybot start/);
      }
      if (args[0] === 'config') assert.match(result.output, locale === 'en' ? /No configuration/ : /Nenhuma configuração/);
      if (args[0] === '--version') assert.match(result.output, /^monkybot \d+\.\d+\.\d+/);
    }
  });
}

test('all keyed custom CLI translations exist in both locales with matching placeholders', () => {
  function files(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const file = path.join(dir, entry.name);
      return entry.isDirectory() ? files(file) : file.endsWith('.ts') ? [file] : [];
    });
  }
  const keys = new Set(files(path.join(__dirname, '..', 'src', 'cli')).flatMap(file =>
    [...fs.readFileSync(file, 'utf8').matchAll(/\bcliT\(\s*['"]([^'"]+)['"]/g)].map(match => match[1])));
  assert.ok(keys.size > 60);
  try {
    for (const key of keys) {
      i18n.setCliLocale('pt-BR');
      const pt = i18n.cliT(key);
      i18n.setCliLocale('en');
      const en = i18n.cliT(key);
      assert.ok(pt && en, key);
      assert.deepEqual([...pt.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort(),
        [...en.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort(), key);
    }
    assert.equal(i18n.cliT('update.available', { version: '6.0.4-beta' }), '🆕 New version available: 6.0.4-beta');
    assert.equal(i18n.cliText('Olá', 'Hello'), 'Hello');
  } finally { i18n.setCliLocale('pt-BR'); }
});
