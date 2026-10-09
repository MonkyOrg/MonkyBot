const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const i18n = require('../dist/i18n');

const modulePath = path.resolve(__dirname, '..', 'dist', 'i18n.js');
const runtimePath = path.resolve(__dirname, '..', 'dist', 'index.js');

function isolated(t, code, { env = {}, preferenceText, status = 0 } = {}) {
  const home = fs.mkdtempSync(path.join(__dirname, '.runtime-locale-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  const configDir = path.join(home, '.monkybot');
  if (preferenceText !== undefined) {
    fs.mkdirSync(configDir);
    fs.writeFileSync(path.join(configDir, 'preferences.json'), preferenceText);
  }
  const result = spawnSync(process.execPath, ['-e', code], {
    encoding: 'utf8', timeout: 15000,
    env: {
      ...process.env, HOME: home, USERPROFILE: home, TEMP: home, TMP: home,
      MONKY_BOT_LOCALE: '', MONKY_LANG: '', MONKYBOT_LOCALE: '', LC_ALL: '', LC_MESSAGES: '', LANG: '', CI: '',
      MONKY_BOT_PUBLIC_KEY: '', MONKY_BOT_REGISTRATION_FILE: '',
      NODE_OPTIONS: '', NODE_PATH: '', ...env,
    },
  });
  assert.ifError(result.error);
  assert.equal(result.status, status, result.stdout + result.stderr);
  return { home, configDir, output: result.stdout, errors: result.stderr };
}

const localeOf = `console.log(require(${JSON.stringify(modulePath)}).getCliLocale());`;

test('runtime locale normalization handles supported aliases and safely defaults', () => {
  for (const value of ['en', 'EN', ' en-US ', 'en_US', 'en_GB']) assert.equal(i18n.normalizeCliLocale(value), 'en');
  for (const value of ['pt', 'pt-BR', 'pt_PT', '', 'fr', undefined, null, {}, 'english']) {
    assert.equal(i18n.normalizeCliLocale(value), 'pt-BR');
  }
});

test('the SDK runner language wins over the saved CLI preference, which wins over the system', t => {
  for (const [env, preferenceText, expected] of [
    [{ MONKY_BOT_LOCALE: 'en-US' }, '{"locale":"pt-BR"}', 'en'],
    [{ MONKY_LANG: 'en-GB' }, '{"locale":"pt-BR"}', 'en'],
    [{ MONKY_BOT_LOCALE: 'pt-BR', MONKY_LANG: 'en' }, undefined, 'pt-BR'],
    [{ MONKYBOT_LOCALE: 'en' }, undefined, 'en'],
    [{ LANG: 'pt_BR.UTF-8' }, '{"locale":"en"}', 'en'],
    [{ LANG: 'en_US.UTF-8' }, undefined, 'en'],
    [{}, undefined, 'pt-BR'],
  ]) {
    const result = isolated(t, localeOf, { env, preferenceText });
    assert.equal(result.output.trim(), expected, JSON.stringify(env));
  }
});

test('unreadable or invalid preferences fall back silently without being rewritten', t => {
  for (const preferenceText of ['{"locale":"fixture-secret', '{"locale":"fr"}', 'x'.repeat(1025)]) {
    const result = isolated(t, localeOf, { env: { LANG: 'en_US.UTF-8' }, preferenceText });
    assert.equal(result.output.trim(), 'en');
    assert.equal(result.errors, '');
    assert.equal(fs.readFileSync(path.join(result.configDir, 'preferences.json'), 'utf8'), preferenceText);
  }
});

for (const locale of ['pt-BR', 'en']) {
  test(`runtime event logging preserves sanitized nested diagnostics without keys or networking (${locale})`, t => {
    const result = isolated(t, `
      const { EventEmitter } = require('node:events');
      const sdk = require('@monky/bot-sdk');
      const { MusicError } = require('./dist/music/errors');
      require('./dist/utils/keys').loadOrGenerateKeys = () => { throw new Error('The runner key must be used'); };
      require('./dist/profile').loadBotAvatar = () => '';
      require('./dist/commands').registerAllCommands = () => async () => {};
      class FixtureBot extends EventEmitter {
        serverCount = 1;
        registeredServerCount = 0;
        constructor(options) {
          super();
          if (options.publicKey !== process.env.MONKY_BOT_PUBLIC_KEY) throw new Error('Unexpected identity');
          if (options.registrationFile !== process.env.MONKY_BOT_REGISTRATION_FILE) throw new Error('Unexpected registrations');
          process.nextTick(() => this.emit('error', new Error('Public message', {
            cause: new MusicError('unavailable',
              'HTTP 403 https://rr1.googlevideo.com/videoplayback?sig=fixture-secret token=fixture-secret'),
          }), { serverId: 'fixture-server' }));
        }
        async serve() { return Object.assign(new EventEmitter(), { address: () => ({ port: 7780 }) }); }
        async close() {}
      }
      sdk.BotClient = FixtureBot;
      global.fetch = () => { throw new Error('Unexpected network request'); };
      require(${JSON.stringify(runtimePath)});
    `, {
      env: {
        MONKY_BOT_LOCALE: locale, MONKY_SERVE: 'true', MONKY_SERVE_PORT: '7780',
        MONKY_SERVE_PUBLIC_HOST: 'bot.example.test',
        MONKY_BOT_PUBLIC_KEY: `302a300506032b6570032100${'11'.repeat(32)}`,
        MONKY_BOT_REGISTRATION_FILE: path.join(__dirname, 'fixture-registrations.json'),
      },
    });
    assert.match(result.errors, locale === 'en' ? /Link error fixture-server/ : /Erro no vínculo fixture-server/);
    assert.match(result.errors, /unavailable.*HTTP 403/);
    assert.doesNotMatch(result.errors, /googlevideo|fixture-secret|videoplayback|Unexpected/);
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

test('an invalid runner identity fails before creating keys or listening', t => {
  for (const key of ['not-hex', `302a300506032b6570032100${'11'.repeat(31)}`, 'ab'.repeat(44)]) {
    const result = isolated(t, `
      require('./dist/utils/keys').loadOrGenerateKeys = () => { throw new Error('Unexpected key generation'); };
      require('@monky/bot-sdk').BotClient = class { constructor() { throw new Error('Unexpected client'); } };
      require(${JSON.stringify(runtimePath)});
    `, { status: 1, env: { MONKY_BOT_LOCALE: 'en', MONKY_BOT_PUBLIC_KEY: key } });
    assert.match(result.errors, /MONKY_BOT_PUBLIC_KEY must be a DER\/SPKI Ed25519 public key/);
    assert.doesNotMatch(result.errors, /Unexpected/);
  }
});
