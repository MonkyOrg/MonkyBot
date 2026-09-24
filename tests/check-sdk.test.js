const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const { checkSdk } = require('../scripts/check-sdk');
const protocolVersion = require('../package.json').monky.protocolVersion;

test('the installed SDK matches the bot protocol and required runtime APIs', () => {
  assert.equal(protocolVersion, 25);
  assert.equal(require('@monky/bot-sdk/package.json').version, '27.0.7-beta');
  assert.equal(checkSdk(), protocolVersion);
});

function sdkFixture(t, { version = protocolVersion, missing } = {}) {
  const root = path.resolve(__dirname, '..', 'release', `sdk-test-${randomUUID()}`);
  const sdk = path.join(root, 'node_modules', '@monky', 'bot-sdk');
  fs.mkdirSync(sdk, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ monky: { protocolVersion } }));
  fs.writeFileSync(path.join(sdk, 'package.json'), JSON.stringify({ main: 'index.js' }));
  const methods = ['close', 'createSelector', 'listSelectors', 'updateSelector', 'closeSelector', 'finalizeSelector',
    'joinVoice', 'getVoiceConnection', 'leaveVoice', 'createScreen', 'updateScreen', 'closeScreen', 'listScreens', 'localExecution']
    .filter((name) => name !== missing).map((name) => `${name}() {}`).join('\n');
  const registrations = missing === 'registeredServerCount' ? '' : 'get registeredServerCount() { return 0; }';
  const commandPresentation = missing === 'getCommandPresentation' ? '' : 'exports.getCommandPresentation = () => ({});';
  const localErrors = ['LocalExecutionError', 'LocalExecutionRpcError'].filter(name => name !== missing)
    .map(name => `exports.${name} = class extends Error {};`).join('\n');
  fs.writeFileSync(path.join(sdk, 'index.js'),
    `exports.PROTOCOL_VERSION = ${version}; exports.BotClient = class { ${methods}\n${registrations} }; ${commandPresentation}\n${localErrors}`);
  return root;
}

test('SDK compatibility requires matching protocol, selectors, voice, local execution, screens and command localization', (t) => {
  assert.equal(checkSdk(sdkFixture(t)), protocolVersion);
  assert.throws(() => checkSdk(sdkFixture(t, { version: protocolVersion - 1 })), /requires the bot-sdk/);
  for (const missing of ['close', 'registeredServerCount', 'createSelector', 'listSelectors', 'updateSelector', 'closeSelector', 'finalizeSelector',
    'joinVoice', 'getVoiceConnection', 'leaveVoice', 'createScreen', 'updateScreen', 'closeScreen', 'listScreens',
    'getCommandPresentation', 'localExecution', 'LocalExecutionError', 'LocalExecutionRpcError']) {
    assert.throws(() => checkSdk(sdkFixture(t, { missing })), /durable selectors/, missing);
  }
});
