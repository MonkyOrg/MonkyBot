const assert = require('node:assert/strict');
const { test } = require('node:test');
const { getManifestUrl } = require('../dist/utils/manifest');
const { startCommand } = require('../dist/cli/commands/lifecycle');
const config = require('../dist/cli/config');
const pm2 = require('../dist/cli/pm2');

test('runtime and CLI share valid manifest URLs for hostnames, IPv4 and both IPv6 forms', () => {
  for (const [host, expectedHost] of [
    ['bot.example.test', 'bot.example.test'],
    ['192.0.2.15', '192.0.2.15'],
    ['2001:db8::15', '[2001:db8::15]'],
    ['[2001:db8::15]', '[2001:db8::15]'],
    ['::1', '[::1]'],
  ]) {
    const url = getManifestUrl(host, 7780);
    assert.equal(url, `http://${expectedHost}:7780/manifest`);
    assert.equal(new URL(url).hostname, expectedHost);
  }
});

test('manifest URLs reject missing or malformed endpoints rather than inventing a public host', () => {
  for (const host of [undefined, '', 'http://bot.example.test', 'bot.example.test:7780', 'user@bot.example.test']) {
    assert.throws(() => getManifestUrl(host, 7780), /public host/i);
  }
  for (const port of [undefined, 0, -1, 65536, 'not-a-port']) {
    assert.throws(() => getManifestUrl('bot.example.test', port), /serve port/i);
  }
});

test('marketplace startup validates the advertised endpoint before touching pm2', (t) => {
  t.mock.method(config, 'readConfig', () => ({
    mode: 'marketplace',
    botDir: process.cwd(),
    servePort: 7780,
  }));
  const ensurePm2 = t.mock.method(pm2, 'ensurePm2', () => {
    assert.fail('Invalid configuration must not start or install pm2.');
  });
  assert.throws(() => startCommand(), /public host/i);
  assert.equal(ensurePm2.mock.calls.length, 0);
});
