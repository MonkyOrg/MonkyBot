const path = require('node:path');
const { createRequire } = require('node:module');

function checkSdk(root = path.resolve(__dirname, '..')) {
  const fromBot = createRequire(path.join(root, 'package.json'));
  const expected = fromBot('./package.json').monky.protocolVersion;
  const sdk = fromBot('@monky/bot-sdk');
  const hasPersistentRegistrations =
    typeof Object.getOwnPropertyDescriptor(sdk.BotClient?.prototype ?? {}, 'registeredServerCount')?.get === 'function';
  const hasSelectors = ['createSelector', 'listSelectors', 'updateSelector', 'closeSelector', 'finalizeSelector']
    .every((method) => typeof sdk.BotClient?.prototype[method] === 'function');
  const hasVoiceAndScreens = ['joinVoice', 'getVoiceConnection', 'leaveVoice', 'createScreen', 'updateScreen', 'closeScreen', 'listScreens']
    .every((method) => typeof sdk.BotClient?.prototype[method] === 'function');
  const hasLocalExecution = typeof sdk.BotClient?.prototype.localExecution === 'function' &&
    typeof sdk.LocalExecutionError === 'function' && typeof sdk.LocalExecutionRpcError === 'function';
  if (sdk.PROTOCOL_VERSION !== expected || typeof sdk.BotClient?.prototype.close !== 'function' ||
      !hasPersistentRegistrations || !hasSelectors || !hasVoiceAndScreens || !hasLocalExecution ||
      typeof sdk.getCommandPresentation !== 'function') {
    throw new Error(
      `MonkyBot requires the bot-sdk for Monky protocol ${expected}; found ${sdk.PROTOCOL_VERSION ?? 'unknown'}. ` +
      'The SDK must also support persistent marketplace registrations, durable selectors, voice, screens, concrete local execution and localized command names. ' +
      'Use the matching Monky release (or build the matching local shared and bot-sdk workspaces).'
    );
  }
  return expected;
}

if (require.main === module) {
  try {
    console.log(`[sdk] Compatible with Monky protocol ${checkSdk()}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = { checkSdk };
