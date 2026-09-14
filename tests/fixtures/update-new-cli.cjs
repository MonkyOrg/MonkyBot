const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const state = JSON.parse(fs.readFileSync(process.env.FIXTURE_UPDATER_SCENARIO, 'utf8'));
assert.equal(process.env.HOME, state.home);
assert.equal(process.env.USERPROFILE, state.home);
assert.equal(process.env.PM2_HOME, state.pm2Home);
const record = (event, detail = {}) => fs.appendFileSync(state.trace, `${JSON.stringify({
  event, pid: process.pid, role: 'new', ...detail,
})}\n`);
record('new-cli', {
  version: require('../package.json').version, entry: __filename, args: process.argv.slice(2),
  cwd: process.cwd(), home: process.env.HOME, pm2Home: process.env.PM2_HOME,
  locale: process.env.MONKY_BOT_LOCALE ?? process.env.MONKYBOT_LOCALE, legacyLocale: process.env.MONKYBOT_LOCALE,
});
assert.deepEqual(process.argv.slice(2), ['restart']);
global.fetch = async () => { throw new Error('Unexpected network request in new CLI fixture'); };
require('node:https').get = () => { throw new Error('Unexpected HTTPS request in new CLI fixture'); };
const pm2 = require('./cli/pm2');
const processes = require('./cli/process');
const music = require('./cli/musicTools');
const port = require('./cli/manifestPort');
pm2.findBotProcess = () => state.managed;
pm2.ensurePm2 = () => record('ensure-pm2');
const writeEcosystem = pm2.writeEcosystem;
pm2.writeEcosystem = (...args) => {
  record('ecosystem', { host: args[1], tools: args[2] });
  return writeEcosystem(...args);
};
processes.runSync = (command, args) => {
  assert.equal(command, 'pm2', 'No real npm or PM2 command may run from the child fixture.');
  record('pm2', { args });
  if (args[0] === 'stop') assert.equal(args[1], '31', 'Only the owned numeric PM2 ID may be stopped.');
  return { status: state.failPm2Action === args[0] ? 1 : 0 };
};
music.prepareMusicToolsForCli = async ({ env }) => {
  const overrides = Object.fromEntries(['MONKY_MUSIC_NODE', 'MONKY_MUSIC_YTDLP', 'MONKY_MUSIC_FFMPEG']
    .filter(key => env[key] !== undefined).map(key => [key, env[key]]));
  record('prepare', { overrides });
  if (state.prepareFailure) throw new Error('fixture new preparation failed');
  return {
    node: env.MONKY_MUSIC_NODE ?? process.execPath,
    ytDlp: env.MONKY_MUSIC_YTDLP ?? path.join(state.home, 'tools', 'fixture-ytdlp'),
    ffmpeg: env.MONKY_MUSIC_FFMPEG ?? path.join(state.home, 'tools', 'fixture-ffmpeg'),
  };
};
const probe = port.assertManifestPortAvailable;
port.assertManifestPortAvailable = async (number, host) => {
  record('probe', { port: number, host });
  return probe(number, host);
};
if (state.childFailure) {
  console.error('fixture installed CLI failed');
  process.exitCode = state.childFailure;
} else {
  require('./cli/commands/lifecycle').restartCommand([]).catch(error => {
    record('restart-error', { message: error.message });
    console.error(error.message);
    process.exitCode = 1;
  });
}
