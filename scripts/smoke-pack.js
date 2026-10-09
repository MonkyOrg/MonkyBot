const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { createRequire } = require('node:module');
const { runNpm } = require('./npm');

const ROOT = path.resolve(__dirname, '..');
const COMMANDS = ['8ball', 'ajuda', 'clear', 'dado', 'doom', 'jogo-da-velha', 'leave', 'lembrete', 'moeda', 'nes',
  'nowplaying', 'pause', 'ping', 'play', 'queue', 'remove', 'resume', 'skip', 'sorteio', 'stop'];

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

async function exercisePackagedVoice() {
  const assert = require('node:assert/strict');
  const { createRequire } = require('node:module');
  const fromSdk = createRequire(require.resolve('@monky/bot-sdk'));
  const { OpusPeer, opusCodec } = fromSdk('./voice/OpusPeer');
  const { RTCPeerConnection } = fromSdk('werift');
  const failures = [];
  const sender = new OpusPeer([], error => failures.push(error));
  const receiver = new RTCPeerConnection({
    codecs: { audio: [opusCodec()] }, iceServers: [], bundlePolicy: 'max-bundle',
  });
  const packets = [];
  receiver.onTrack.subscribe(track => track.onReceiveRtp.subscribe(packet => packets.push(packet.payload)));
  try {
    await sender.pc.setLocalDescription(await sender.pc.createOffer());
    assert.match(sender.pc.localDescription.sdp, /a=fingerprint:sha-256/i);
    await receiver.setRemoteDescription(sender.pc.localDescription);
    await receiver.setLocalDescription(await receiver.createAnswer());
    await sender.pc.setRemoteDescription(receiver.localDescription);
    await sender.ready;
    const silence = Uint8Array.from([0xf8, 0xff, 0xfe]);
    await sender.write(silence);
    const deadline = Date.now() + 5000;
    while (!packets.length && !failures.length && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.deepEqual(failures, []);
    assert.equal(sender.isReady, true);
    assert.equal(receiver.connectionState, 'connected');
    assert.deepEqual(packets, [Buffer.from(silence)]);
  } finally {
    await Promise.all([sender.close(), receiver.close()]);
  }
}

async function freePort() {
  const server = require('node:net').createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
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
    // Cold Windows installs of the bundled WebRTC tree can exceed two minutes.
    runNpm([
      'install', '--prefix', install, '--cache', path.join(workspace, 'cache'),
      '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--no-update-notifier', artifact,
    ], { cwd: workspace, timeout: 300000 });

    const modules = path.join(install, 'node_modules');
    const bot = path.join(modules, '@monky', 'bot');
    const pkg = JSON.parse(fs.readFileSync(path.join(bot, 'package.json'), 'utf8'));
    assert.deepEqual(pkg.bin, { monkybot: './monky-cli.cjs' }, 'monkybot must be the SDK-generated runtime CLI.');
    assert.equal(pkg.monkyBot.cliName, 'monkybot');
    assert.deepEqual(pkg.monkyBot.requirements.ports.map((port) => [port.id, port.protocol, port.defaultPort, port.when]),
      [['games', 'tcp', 7781, 'on-demand']]);
    for (const retired of ['cli.js', 'cli', path.join('cli', 'musicTools.js')]) {
      assert.equal(fs.existsSync(path.join(bot, 'dist', retired)), false,
        `The former standalone CLI must not remain in the installed package: dist/${retired}`);
    }
    const sdkRoot = path.join(bot, 'node_modules', '@monky', 'bot-sdk');
    const runner = path.join(sdkRoot, 'dist', 'cli', 'runner.js');
    assert.ok(fs.statSync(runner).isFile(), 'The packaged SDK runner is required by PM2.');

    const cliHome = path.join(workspace, 'cli-home');
    const profile = path.join(cliHome, '.monkybot');
    const env = {
      ...process.env,
      HOME: runtime,
      USERPROFILE: runtime,
      NODE_OPTIONS: '',
      NODE_PATH: '',
      MONKYBOT_SMOKE_MODULES: modules,
      MONKY_BOT_CLI_HOME: cliHome,
      CI: '1',
    };
    for (const name of ['MONKY_BOT_LOCALE', 'MONKY_LANG', 'MONKY_HOST_CONSENT', 'MONKY_SERVE', 'MONKY_SERVE_PORT',
      'MONKY_SERVE_HOST', 'MONKY_SERVE_PUBLIC_HOST', 'MONKY_SERVER_URL', 'MONKY_BOT_TOKEN', 'MONKY_BOT_PUBLIC_KEY',
      'MONKY_BOT_NAME', 'MONKY_BOT_REGISTRATION_FILE', 'MONKY_GAMES_PORT', 'MONKY_GAMES_HOST', 'MONKY_GAMES_PUBLIC_URL',
      'LANG', 'LC_ALL', 'LC_MESSAGES', 'LANGUAGE']) delete env[name];
    const guard = ['--no-global-search-paths', '--require', path.join(__dirname, 'isolated-runtime.cjs')];
    const cli = (args, expectedStatus = 0) => {
      const result = spawnSync(process.execPath, [...guard, path.join(bot, 'monky-cli.cjs'), ...args], {
        cwd: runtime, env, encoding: 'utf8', timeout: 30000,
      });
      if (result.error) throw result.error;
      assert.equal(result.status, expectedStatus, result.stdout + result.stderr);
      return result.stdout + result.stderr;
    };

    assert.equal(cli(['--version']).trim(), `monkybot ${pkg.version}`);
    const requirements = cli(['requirements', '--locale', 'en-US']);
    assert.match(requirements, /games: TCP 7781 \(allow through the firewall\/router; on demand\)/);
    assert.match(requirements, /MONKY_GAMES_PUBLIC_URL/);
    assert.equal(fs.existsSync(profile), false, 'requirements must not create a profile.');

    for (const [tag, locale] of [['en-US', 'en'], ['pt-BR', 'pt-BR']]) {
      cli(['config', 'language', tag]);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(profile, 'preferences.json'), 'utf8')), { locale });
      assert.deepEqual(fs.readdirSync(profile), ['preferences.json'],
        'Changing language before setup must not create a connection, identity or credentials.');
    }

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

    const voice = spawnSync(process.execPath, [
      ...guard, '-e', `(${exercisePackagedVoice.toString()})().catch(error => { console.error(error.stack); process.exitCode = 1; });`,
    ], { cwd: bot, env, encoding: 'utf8', timeout: 40000 });
    if (voice.error) throw voice.error;
    assert.equal(voice.status, 0, `Packaged P2P voice failed.\n${voice.stderr}`);

    // Configure through the packaged CLI: the runtime only starts after the host consent.
    const servePort = await freePort();
    const setup = cli(['setup', '--non-interactive', '--mode', 'marketplace', '--public-host', '127.0.0.1',
      '--serve-port', String(servePort), '--name', 'MonkyBot', '--locale', 'en-US']);
    const fingerprint = /consent --accept ([a-f0-9]{12})/.exec(setup)?.[1];
    assert.ok(fingerprint, setup);
    assert.match(cli(['start', '--foreground', '--locale', 'en-US'], 1), /has not been confirmed yet/);
    cli(['consent', '--accept', fingerprint, '--locale', 'en-US']);
    const keysFile = spawnSync(process.execPath, [
      ...guard, '-e', `console.log(require(${JSON.stringify(path.join(sdkRoot, 'dist', 'cli', 'keys.js'))}).loadOrCreateBotKeys(${JSON.stringify(profile)}).publicKeyHex)`,
    ], { cwd: runtime, env, encoding: 'utf8', timeout: 15000 });
    assert.equal(keysFile.status, 0, keysFile.stderr);
    const profileKey = keysFile.stdout.trim();

    // PM2 and start --foreground launch the packaged SDK runner with these variables.
    const start = async () => {
      child = spawn(process.execPath, [...guard, runner], {
        cwd: profile, stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...env, MONKY_BOT_LOCALE: 'en', MONKY_SERVE_HOST: '127.0.0.1',
          MONKY_BOT_CLI_CONFIG_FILE: path.join(profile, 'config.json'),
          MONKY_BOT_CLI_ENTRY: path.join(bot, 'dist', 'index.js'),
          MONKY_BOT_CLI_PACKAGE_ROOT: bot,
        },
      });
      const logs = { output: '' };
      child.stdout.on('data', (chunk) => { logs.output += chunk.toString(); });
      child.stderr.on('data', (chunk) => { logs.output += chunk.toString(); });
      return { url: await waitForManifest(child, logs), logs };
    };
    const { url, logs } = await start();
    assert.equal(url, `http://127.0.0.1:${servePort}/manifest`);
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200, logs.output);
    assert.equal(response.headers.get('x-monky-bot-public-key'), profileKey);
    const manifest = await response.json();
    const expectedLogo = fs.readFileSync(path.join(ROOT, 'assets', 'monky-logo.png')).toString('base64');
    assert.equal(manifest.name, 'MonkyBot');
    assert.equal(manifest.icon, `data:image/png;base64,${expectedLogo}`);
    assert.equal(manifest.registrationUrl, url.replace('/manifest', '/register'));
    assert.deepEqual(manifest.commands.map((command) => command.name).sort(),
      COMMANDS);
    assert.deepEqual(manifest.requestedCapabilities, [
      'commands', 'send_messages', 'publish_voice', 'local_execution', 'miniapps', 'live_actions',
    ]);
    assert.equal(child.exitCode, null, 'Packaged runtime must still be running.');
    assert.equal(fs.existsSync(path.join(runtime, '.keys')), false, 'The runner must use the profile identity.');

    const fromBot = createRequire(path.join(bot, 'package.json'));
    const fromSdk = createRequire(fromBot.resolve('@monky/bot-sdk'));
    const { WebSocketServer } = fromSdk('ws');
    const { MessageType } = fromBot('@monky/bot-sdk');
    const token = 'f'.repeat(64);
    const serverId = randomUUID();
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
          if (message.payload?.protocolVersion !== pkg.monky.protocolVersion ||
              message.payload?.botToken !== token || message.payload?.publicKey !== profileKey) {
            protocolError = new Error('The packaged bot did not restore the same protocol, token and profile identity.');
            ws.close();
            return;
          }
          ws.send(JSON.stringify({ type: MessageType.AUTH_SUCCESS, payload: {} }));
        } else if (message.type === MessageType.BOT_UPDATE_PROFILE) {
          ws.send(JSON.stringify({ type: MessageType.BOT_PROFILE_UPDATED, requestId: message.requestId, payload: {} }));
        } else if (message.type === MessageType.COMMAND_REGISTER) {
          if (JSON.stringify(message.payload?.requestedCapabilities) !== JSON.stringify(manifest.requestedCapabilities)) {
            protocolError = new Error('Packaged command registration must match the published capability declaration.');
            ws.close();
            return;
          }
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
        COMMANDS);
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
    const file = path.join(profile, '.keys', 'registrations.json');
    const saved = fs.readFileSync(file, 'utf8');
    assert.deepEqual(JSON.parse(saved).registrations, [registration]);
    await waitForCommands(1);
    await stopChild(child);
    await start();
    await waitForCommands(2);
    assert.equal(fs.readFileSync(file, 'utf8'), saved);
    console.log(`[smoke] Offline install, isolated SDK protocol ${pkg.monky.protocolVersion}, P2P ICE/DTLS and Opus, SDK CLI monkybot ${pkg.version} (requirements, consent), packaged runner with the profile identity, official avatar, and persistent marketplace process restart passed.`);
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
