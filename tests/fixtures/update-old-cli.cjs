const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const state = JSON.parse(fs.readFileSync(process.env.FIXTURE_UPDATER_SCENARIO, 'utf8'));
assert.equal(process.env.HOME, state.home);
assert.equal(process.env.USERPROFILE, state.home);
assert.equal(process.env.PM2_HOME, state.pm2Home);
const record = (event, detail = {}) => fs.appendFileSync(state.trace, `${JSON.stringify({
  event, pid: process.pid, role: 'old', ...detail,
})}\n`);
require('node:https').get = () => { throw new Error('Unexpected network request in old CLI fixture'); };
const releases = require('./cli/updateReleases');
const lifecycle = require('./cli/commands/lifecycle');
const music = require('./music/process');
const pm2 = require('./cli/pm2');
const updates = require('./cli/commands/update');
if (state.operatorLocale) require('./cli/i18n').setCliLocale(state.operatorLocale);
const data = Buffer.from('synthetic npm tarball');
lifecycle.restartBot = async () => {
  record('old-restart');
  throw new Error('OLD 30 second tar listing timeout sentinel');
};
music.capture = async () => {
  record('old-prepare');
  throw new Error('OLD host media process sentinel');
};
pm2.isPm2Available = () => state.pm2Available;
pm2.isBotRunning = () => state.running;
releases.fetchLatestRelease = async includeBeta => {
  record('release', { includeBeta });
  return {
    version: state.version,
    tgzUrl: `https://github.com/MonkyOrg/MonkyBot/releases/download/v${state.version}/monky-bot-${state.version}.tgz`,
    htmlUrl: '', size: data.length, sha256: createHash('sha256').update(data).digest('hex'),
  };
};
global.fetch = async (input, options) => {
  assert.equal(String(input),
    `https://github.com/MonkyOrg/MonkyBot/releases/download/v${state.version}/monky-bot-${state.version}.tgz`);
  assert.equal(options.redirect, 'manual');
  assert.equal(options.headers.Authorization, undefined);
  record('download');
  return new Response(data, { headers: { 'content-length': String(data.length) } });
};
require('node:readline').createInterface = () => {
  const rl = new EventEmitter();
  rl.question = (question, answer) => {
    record('prompt', { question });
    const value = state.answers?.shift();
    queueMicrotask(() => value === undefined ? rl.close() : answer(value));
  };
  rl.close = () => rl.emit('close');
  return rl;
};
record('old-start', { version: require('../package.json').version, entry: __filename, cwd: process.cwd() });
updates.updateCommand(state.args).catch(error => {
  record('update-error', { message: error.message });
  console.error(error.message);
  process.exitCode = 1;
});
