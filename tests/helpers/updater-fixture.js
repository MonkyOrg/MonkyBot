const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const repository = path.resolve(__dirname, '..', '..');
const fixtures = path.join(__dirname, '..', 'fixtures');

function packageDirectory(prefix) {
  return process.platform === 'win32'
    ? path.join(prefix, 'node_modules', '@monky', 'bot')
    : path.join(prefix, 'lib', 'node_modules', '@monky', 'bot');
}

function updaterFixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(repository, 'tests', '.updater-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const prefix = path.join(root, "global %MONKY_ARG_CANARY% & (installed)'");
  const installed = packageDirectory(prefix);
  const old = options.replaceInPlace ? installed : path.join(root, 'old checkout');
  const template = path.join(root, 'new package');
  const home = path.join(root, 'isolated home');
  const botDir = path.join(home, "persistent bot's identity");
  const cwd = path.join(root, "operator's working & directory");
  const npmDirectory = path.join(root, 'npm & CLI');
  for (const directory of [old, template, path.join(home, '.monkybot'), botDir, cwd, npmDirectory]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  for (const directory of [old, template]) {
    fs.cpSync(path.join(repository, 'dist'), path.join(directory, 'dist'), { recursive: true });
  }
  const oldVersion = options.local ?? '6.0.3-beta';
  const version = options.remote ?? '6.0.4-beta';
  fs.writeFileSync(path.join(old, 'package.json'), JSON.stringify({
    name: '@monky/bot', version: oldVersion, bin: { monkybot: './dist/cli.js' },
  }));
  fs.writeFileSync(path.join(template, 'package.json'), JSON.stringify({
    name: '@monky/bot', version, bin: { monkybot: './dist/cli.js' },
  }));
  fs.copyFileSync(path.join(fixtures, 'update-old-cli.cjs'), path.join(old, 'dist', 'cli.js'));
  fs.copyFileSync(path.join(fixtures, 'update-new-cli.cjs'), path.join(template, 'dist', 'cli.js'));
  const npmEntry = path.join(npmDirectory, 'npm-cli.js');
  fs.copyFileSync(path.join(fixtures, 'update-npm.cjs'), npmEntry);
  const config = {
    mode: 'marketplace', botDir, servePort: options.port ?? 7780,
    publicHost: 'bot.example.test', botName: 'Fixture bot',
    ...options.config,
  };
  const configFile = path.join(home, '.monkybot', 'config.json');
  if (!options.missingConfig) fs.writeFileSync(configFile, JSON.stringify(config));
  const identity = path.join(botDir, '.keys', 'identity.json');
  fs.mkdirSync(path.dirname(identity));
  fs.writeFileSync(identity, 'synthetic identity: must remain unchanged');
  const state = {
    root, home, prefix, installed, old, template, cwd, botDir, version, oldVersion,
    trace: path.join(root, 'trace.jsonl'),
    pm2Home: path.join(home, 'private pm2'),
    running: true, pm2Available: true,
    args: ['--beta', '--yes'],
    managed: {
      name: 'monkybot', pm_id: 31, pid: 12345,
      pm2_env: { status: 'online', pm_exec_path: path.join(installed, 'dist', 'index.js') },
    },
    ...options.scenario,
  };
  const scenario = path.join(root, 'scenario.json');
  fs.writeFileSync(scenario, JSON.stringify(state));
  const env = {
    HOME: home, USERPROFILE: home, PM2_HOME: state.pm2Home,
    APPDATA: path.join(home, 'appdata'), LOCALAPPDATA: path.join(home, 'localappdata'),
    TEMP: path.join(root, 'scratch'), TMP: path.join(root, 'scratch'),
    PATH: path.join(root, 'empty path'),
    npm_execpath: npmEntry, npm_config_userconfig: path.join(home, 'npmrc'),
    npm_config_globalconfig: path.join(home, 'global npmrc'), npm_config_cache: path.join(home, 'npm cache'),
    NODE_OPTIONS: '', NODE_PATH: '', MONKY_BOT_LOCALE: 'pt-BR', MONKYBOT_LOCALE: 'pt-BR',
    MONKY_ARG_CANARY: 'SHOULD NOT EXPAND',
    FIXTURE_UPDATER_SCENARIO: scenario,
    ...options.env,
  };
  for (const key of ['SystemRoot', 'WINDIR', 'ComSpec']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  const trace = () => fs.existsSync(state.trace)
    ? fs.readFileSync(state.trace, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    : [];
  async function run() {
    fs.writeFileSync(scenario, JSON.stringify(state));
    const child = spawn(process.execPath, [path.join(old, 'dist', 'cli.js')], {
      cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', value => { stdout += value; });
    child.stderr.on('data', value => { stderr += value; });
    const timeout = setTimeout(() => child.kill(), 30_000);
    try {
      const status = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => {
          if (signal) reject(new Error(`Fixture killed (${signal}): ${stdout}\n${stderr}`));
          else resolve(code);
        });
      });
      const calls = trace();
      assert.equal(calls.some(call => call.event === 'old-restart' || call.event === 'old-prepare'), false,
        'The old in-memory lifecycle/music preparation must never run after installation.');
      assert.equal(fs.readFileSync(identity, 'utf8'), 'synthetic identity: must remain unchanged');
      if (!options.missingConfig) assert.deepEqual(JSON.parse(fs.readFileSync(configFile, 'utf8')), config);
      assert.equal(fs.readdirSync(path.join(home, '.monkybot')).some(name => name.startsWith('.update-')), false);
      return { status, stdout, stderr, calls };
    } finally {
      clearTimeout(timeout);
    }
  }
  return { run, root, state, config, configFile, scenario, env, trace, installed, home, old, prefix };
}

module.exports = { updaterFixture, packageDirectory };
