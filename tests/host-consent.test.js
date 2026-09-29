const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
const { test } = require('node:test');
const { assertHostConsent, hostConsentFor, hasHostConsent, reviewHostConsent } = require('../dist/cli/hostConsent');
const { setCliLocale } = require('../dist/cli/i18n');
const { generateEcosystem } = require('../dist/cli/pm2');

test('operator consent is versioned and bound to the actual working directory', () => {
  const directory = path.resolve(__dirname, 'consent-fixture');
  const consent = hostConsentFor(directory);
  assert.equal(hasHostConsent(consent, directory), true);
  if (process.platform === 'win32') assert.equal(hasHostConsent(consent, directory.toUpperCase()), true);
  assert.doesNotThrow(() => assertHostConsent(directory, consent, {}));
  for (const invalid of [undefined, null, true, {}, { ...consent, version: 0 },
    { ...consent, version: 2 }, { ...consent, botDir: '.' }]) {
    assert.equal(hasHostConsent(invalid, directory), false);
    assert.throws(() => assertHostConsent(directory, invalid, {}));
  }
  assert.throws(() => assertHostConsent(path.join(directory, 'other'), consent, {}));
  for (const value of ['', 'true', 'yes', '0', '2', '1 ']) {
    assert.throws(() => assertHostConsent(directory, consent, { MONKY_HOST_CONSENT: value }));
  }
  assert.doesNotThrow(() => assertHostConsent(directory, undefined, { MONKY_HOST_CONSENT: '1' }));
});

for (const locale of ['pt-BR', 'en']) {
  test(`host review describes actual accesses and requires an explicit yes (${locale})`, async t => {
    setCliLocale(locale);
    const output = [];
    t.mock.method(console, 'log', text => output.push(text));
    for (const value of ['', 'no', 'maybe', '1']) {
      await assert.rejects(reviewHostConsent(__dirname, async question => {
        assert.match(question, locale === 'en' ? /\[y\/N\]/ : /\[s\/N\]/);
        return value;
      }));
    }
    for (const value of ['yes', 'Y', 'sim', ' S ']) {
      assert.deepEqual(await reviewHostConsent(__dirname, async () => value), hostConsentFor(__dirname));
    }
    const text = output.join('\n');
    assert.match(text, /\.keys/);
    assert.match(text, /PM2/);
    assert.match(text, locale === 'en' ? /does not create a sandbox/ : /não cria uma sandbox/);
    assert.match(text, locale === 'en' ? /server administrator still decides/ : /administrador de servidor continua decidindo/);
  });
}

test('PM2 only forwards explicitly provided automated consent, never manufacturing it from saved configuration', t => {
  const previous = process.env.MONKY_HOST_CONSENT;
  t.after(() => {
    if (previous === undefined) delete process.env.MONKY_HOST_CONSENT;
    else process.env.MONKY_HOST_CONSENT = previous;
  });
  const config = { mode: 'marketplace', botDir: __dirname, hostConsent: hostConsentFor(__dirname) };
  const environment = () => {
    const context = { module: { exports: {} } };
    vm.runInNewContext(generateEcosystem(config), context);
    return context.module.exports.apps[0].env;
  };
  delete process.env.MONKY_HOST_CONSENT;
  assert.equal(environment().MONKY_HOST_CONSENT, undefined);
  process.env.MONKY_HOST_CONSENT = '1';
  assert.equal(environment().MONKY_HOST_CONSENT, '1');
  process.env.MONKY_HOST_CONSENT = '0';
  assert.equal(environment().MONKY_HOST_CONSENT, '0');
});

test('direct startup without consent exits before creating identity or starting the manifest', t => {
  const directory = fs.mkdtempSync(path.join(__dirname, '.host-consent-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  const env = {
    ...process.env, HOME: directory, USERPROFILE: directory, TEMP: directory, TMP: directory,
    NODE_OPTIONS: '', NODE_PATH: '', MONKY_BOT_LOCALE: 'en', MONKY_SERVE: 'true', MONKY_SERVE_PORT: '0',
    MONKY_SERVE_HOST: '127.0.0.1', MONKY_SERVE_PUBLIC_HOST: 'localhost',
    MONKY_BOT_TOKEN: '', MONKY_SERVER_URL: '',
  };
  delete env.MONKY_HOST_CONSENT;
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '..', 'dist', 'index.js')], {
    cwd: directory, encoding: 'utf8', timeout: 15000, env,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Operator consent is required/);
  assert.doesNotMatch(result.stdout, /Manifest:/);
  assert.deepEqual(fs.readdirSync(directory), []);
});
