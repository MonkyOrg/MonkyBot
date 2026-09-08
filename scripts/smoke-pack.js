const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { createRequire } = require('node:module');
const { runNpm } = require('./npm');

const ROOT = path.resolve(__dirname, '..');

function waitForManifest(child, logs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`Bot startup timed out.\n${logs.output}`)), 15000);
    const onData = () => {
      const match = logs.output.match(/http:\/\/127\.0\.0\.1:\d+\/manifest/);
      if (match) finish(null, match[0]);
    };
    const onExit = (code) => finish(new Error(`Bot exited before serving its manifest (${code}).\n${logs.output}`));
    const onError = (error) => finish(error);
    function finish(error, url) {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.off('exit', onExit);
      child.off('error', onError);
      if (error) reject(error);
      else resolve(url);
    }
    child.stdout.on('data', onData);
    child.once('exit', onExit);
    child.once('error', onError);
  });
}

async function stopChild(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

async function smokePack(tarball) {
  const artifact = path.resolve(tarball);
  assert.ok(fs.statSync(artifact).isFile(), 'A packed tarball is required.');
  const workspace = path.join(ROOT, 'release', `smoke-${randomUUID()}`);
  const install = path.join(workspace, 'install');
  const runtime = path.join(workspace, 'runtime');
  let child;
  let server;
  fs.mkdirSync(runtime, { recursive: true });

  try {
    runNpm([
      'install', '--prefix', install, '--cache', path.join(workspace, 'cache'),
      '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--no-update-notifier', artifact,
    ], { cwd: workspace, timeout: 120000 });

    const modules = path.join(install, 'node_modules');
    const bot = path.join(modules, '@monky', 'bot');
    const pkg = JSON.parse(fs.readFileSync(path.join(bot, 'package.json'), 'utf8'));
    const env = {
      ...process.env,
      NODE_OPTIONS: '',
      NODE_PATH: '',
      MONKYBOT_SMOKE_MODULES: modules,
      MONKY_SERVE: 'true',
      MONKY_SERVE_HOST: '127.0.0.1',
      MONKY_SERVE_PORT: '0',
      MONKY_SERVE_PUBLIC_HOST: '127.0.0.1',
      MONKY_BOT_NAME: 'MonkyBot',
      MONKY_SERVER_URL: '',
      MONKY_BOT_TOKEN: '',
    };
    const guard = ['--no-global-search-paths', '--require', path.join(__dirname, 'isolated-runtime.cjs')];
    const cli = spawnSync(process.execPath, [...guard, path.join(bot, 'dist', 'cli.js'), '--version'], {
      cwd: runtime, env, encoding: 'utf8', timeout: 15000,
    });
    if (cli.error) throw cli.error;
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(cli.stdout.trim(), `monkybot ${pkg.version}`);

    const forbidden = spawnSync(process.execPath, [
      ...guard, '-e', `require(${JSON.stringify(path.join(ROOT, 'package.json'))})`,
    ], { cwd: runtime, env, encoding: 'utf8', timeout: 15000 });
    assert.notEqual(forbidden.status, 0, 'Repository fallback must not be available.');
    assert.match(forbidden.stderr, /Module escaped isolated installation/);

    const protocol = spawnSync(process.execPath, [
      ...guard, '-e', `if (require('@monky/bot-sdk').PROTOCOL_VERSION !== ${pkg.monky.protocolVersion}) process.exit(1)`,
    ], { cwd: bot, env, encoding: 'utf8', timeout: 15000 });
    if (protocol.error) throw protocol.error;
    assert.equal(protocol.status, 0, `Packaged SDK protocol mismatch.\n${protocol.stderr}`);

    const start = async () => {
      child = spawn(process.execPath, [...guard, path.join(bot, 'dist', 'index.js')], {
        cwd: runtime, env, stdio: ['ignore', 'pipe', 'pipe'],
      });
      const logs = { output: '' };
      child.stdout.on('data', (chunk) => { logs.output += chunk.toString(); });
      child.stderr.on('data', (chunk) => { logs.output += chunk.toString(); });
      return { url: await waitForManifest(child, logs), logs };
    };
    const { url, logs } = await start();
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200, logs.output);
    const manifest = await response.json();
    const expectedLogo = fs.readFileSync(path.join(ROOT, 'assets', 'monky-logo.png')).toString('base64');
    assert.equal(manifest.name, 'MonkyBot');
    assert.equal(manifest.icon, `data:image/png;base64,${expectedLogo}`);
    assert.equal(manifest.registrationUrl, url.replace('/manifest', '/register'));
    assert.deepEqual(manifest.commands.map((command) => command.name).sort(),
      ['8ball', 'ajuda', 'dado', 'enquete', 'moeda', 'ping']);
    assert.equal(child.exitCode, null, 'Packaged runtime must still be running.');

    const fromBot = createRequire(path.join(bot, 'package.json'));
    const fromSdk = createRequire(fromBot.resolve('@monky/bot-sdk'));
    const { WebSocketServer } = fromSdk('ws');
    const { MessageType } = fromBot('@monky/bot-sdk');
    const token = 'f'.repeat(64);
    const serverId = randomUUID();
    let publicKey;
    let protocolError;
    const commandLists = [];
    server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await once(server, 'listening');
    server.on('connection', (ws) => {
      ws.on('message', (data) => {
        let message;
        try {
          message = JSON.parse(data.toString());
        } catch (error) {
          protocolError = error;
          ws.close();
          return;
        }
        if (message.type === MessageType.AUTH_CONNECT) {
          publicKey ??= message.payload?.publicKey;
          if (message.payload?.protocolVersion !== pkg.monky.protocolVersion ||
              message.payload?.botToken !== token || !publicKey || message.payload.publicKey !== publicKey) {
            protocolError = new Error('The packaged bot did not restore the same protocol, token and identity.');
            ws.close();
            return;
          }
          ws.send(JSON.stringify({ type: MessageType.AUTH_SUCCESS, payload: {} }));
        } else if (message.type === MessageType.BOT_UPDATE_PROFILE) {
          ws.send(JSON.stringify({ type: MessageType.BOT_PROFILE_UPDATED, requestId: message.requestId, payload: {} }));
        } else if (message.type === MessageType.COMMAND_REGISTER) {
          commandLists.push(message.payload?.commands);
        }
      });
    });
    const waitForCommands = async (count) => {
      const deadline = Date.now() + 10000;
      while (commandLists.length < count && !protocolError && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (protocolError) throw protocolError;
      assert.equal(commandLists.length, count, 'The packaged bot must restore its commands after a process restart.');
      assert.deepEqual(commandLists[count - 1].map((command) => command.name).sort(),
        ['8ball', 'ajuda', 'dado', 'enquete', 'moeda', 'ping']);
    };
    const registration = {
      serverId, serverName: 'Package smoke server',
      serverUrl: `ws://127.0.0.1:${server.address().port}`, token,
    };
    const registered = await fetch(manifest.registrationUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registration), signal: AbortSignal.timeout(10000),
    });
    assert.equal(registered.status, 200, logs.output);
    const file = path.join(runtime, '.keys', 'registrations.json');
    const saved = fs.readFileSync(file, 'utf8');
    assert.deepEqual(JSON.parse(saved).registrations, [registration]);
    await waitForCommands(1);
    await stopChild(child);
    await start();
    await waitForCommands(2);
    assert.equal(fs.readFileSync(file, 'utf8'), saved);
    console.log(`[smoke] Offline install, isolated SDK protocol ${pkg.monky.protocolVersion}, CLI ${pkg.version}, official avatar, and persistent marketplace process restart passed.`);
  } finally {
    await stopChild(child);
    if (server) {
      for (const ws of server.clients) ws.terminate();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    fs.rmSync(workspace, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

if (require.main === module) {
  const tarball = process.argv[2];
  if (!tarball) {
    console.error('Usage: node scripts/smoke-pack.js <tarball>');
    process.exitCode = 1;
  } else {
    smokePack(tarball).catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  }
}

module.exports = { smokePack };
