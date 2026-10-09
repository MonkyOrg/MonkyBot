const assert = require('node:assert/strict');
const { test, beforeEach } = require('node:test');
const { setCliLocale } = require('../dist/i18n');
const { getManifestUrl } = require('../dist/utils/manifest');

beforeEach(() => setCliLocale('en'));

test('runtime manifest URLs are valid for hostnames, IPv4 and both IPv6 forms', () => {
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
