const path = require('node:path');
const { createRequire } = require('node:module');

function checkSdk(root = path.resolve(__dirname, '..')) {
  const fromBot = createRequire(path.join(root, 'package.json'));
  const expected = fromBot('./package.json').monky.protocolVersion;
  const sdk = fromBot('@monky/bot-sdk');
  const hasPersistentRegistrations =
    typeof Object.getOwnPropertyDescriptor(sdk.BotClient?.prototype ?? {}, 'registeredServerCount')?.get === 'function';
  const hasLiveActions = ['createLiveAction', 'listLiveActions', 'updateLiveAction', 'closeLiveAction', 'onLiveActionSubmission']
    .every((method) => typeof sdk.BotClient?.prototype[method] === 'function');
  const hasPersistentMessages = typeof sdk.BotClient?.prototype.sendMessage === 'function';
  const hasVoiceAndScreens = ['joinVoice', 'getVoiceConnection', 'leaveVoice', 'createScreen', 'updateScreen', 'closeScreen', 'listScreens']
    .every((method) => typeof sdk.BotClient?.prototype[method] === 'function');
  const hasLocalExecution = typeof sdk.BotClient?.prototype.localExecution === 'function' &&
    typeof sdk.LocalExecutionError === 'function' && typeof sdk.LocalExecutionRpcError === 'function';
  // The packaged `monkybot` command is the SDK's reusable CLI; the games listener answers its probes.
  const hasRuntimeCli = ['runBotCli', 'buildBotPackage', 'handleReachabilityProbe']
    .every((name) => typeof sdk[name] === 'function');
  if (sdk.PROTOCOL_VERSION !== expected || typeof sdk.BotClient?.prototype.close !== 'function' ||
      !hasPersistentRegistrations || !hasLiveActions || !hasPersistentMessages ||
      !hasVoiceAndScreens || !hasLocalExecution || !hasRuntimeCli ||
      typeof sdk.getCommandPresentation !== 'function') {
    throw new Error(
      `MonkyBot requires the bot-sdk for Monky protocol ${expected}; found ${sdk.PROTOCOL_VERSION ?? 'unknown'}. ` +
      'The SDK must also support persistent marketplace registrations, native live actions, persistent channel messages, voice, screens, concrete local execution, localized command names, ' +
      'the reusable runtime CLI with declared requirements and reachability probes. ' +
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
