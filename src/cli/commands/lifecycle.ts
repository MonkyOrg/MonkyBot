import fs from 'fs';
import path from 'path';
import { ANSI, color, CONFIG_FILE } from '../constants';
import {
  BotConfig, readConfig, writeConfig, getBotEntryPath,
  validateCliPublicHost as validateBotPublicHost, validateCliServePort as validateBotServePort,
} from '../config';
import {
  ensurePm2,
  requirePm2,
  findBotProcess,
  writeEcosystem,
  Pm2Process,
} from '../pm2';
import { runSync } from '../process';
import { assertManifestPortAvailable, DEFAULT_MANIFEST_PORT, getManifestBindHost } from '../manifestPort';
import { ManifestReadinessError, verifyManifest, waitForManifest } from '../manifestReadiness';
import { DEFAULT_BOT_NAME } from '../../profile';
import { getManifestUrl } from '../../utils/manifest';
import { cliText, languageCommand } from '../i18n';

function loadConfigOrDie() {
  const config = readConfig();
  if (!config) {
    console.log(color(cliText('❌ Nenhuma configuração encontrada.', '❌ No configuration found.'), ANSI.red));
    console.log(cliText(`   Execute ${color('monkybot setup', ANSI.cyan)} primeiro.`,
      `   Run ${color('monkybot setup', ANSI.cyan)} first.`));
    process.exit(1);
  }
  return config;
}

function ensureBotBuilt(botDir: string): void {
  const entry = getBotEntryPath(botDir);
  if (fs.existsSync(entry)) return; // already compiled or global install

  // Only attempt compilation if botDir looks like a git clone (has package.json + src/)
  const hasPackageJson = fs.existsSync(require('path').join(botDir, 'package.json'));
  const hasSrc = fs.existsSync(require('path').join(botDir, 'src'));

  if (!hasPackageJson || !hasSrc) {
    throw new Error(
      cliText(`Entrada do bot não encontrada: ${entry}\n` +
      `Se instalou via script, o bot já deveria estar compilado.\n` +
      `Tente reinstalar: curl -fsSL https://monkyorg.github.io/install-monkybot.sh | bash`,
      `Bot entry point not found: ${entry}\n` +
      `A script installation should already be compiled.\n` +
      `Try reinstalling: curl -fsSL https://monkyorg.github.io/install-monkybot.sh | bash`)
    );
  }

  console.log(color(cliText('⚠️  Bot não compilado. Compilando...', '⚠️  Bot is not compiled. Building...'), ANSI.yellow));
  const result = runSync('npm', ['run', 'build'], { cwd: botDir, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(
      cliText(`Falha ao compilar o bot. Execute manualmente: cd ${botDir} && npm run build`,
        `Bot build failed. Run manually: cd ${botDir} && npm run build`)
    );
  }
  console.log(color(cliText('✅ Bot compilado.', '✅ Bot compiled.'), ANSI.green));
}

function manifestUrl(config: BotConfig): string | undefined {
  return config.mode === 'marketplace'
    ? getManifestUrl(config.publicHost, config.servePort ?? DEFAULT_MANIFEST_PORT)
    : undefined;
}

async function checkManifestPort(config: BotConfig, host = getManifestBindHost()): Promise<void> {
  if (config.mode === 'marketplace') {
    await assertManifestPortAvailable(validateBotServePort(config.servePort ?? DEFAULT_MANIFEST_PORT), host);
  }
}

export function managedManifestHost(proc: Pm2Process | null): string {
  return getManifestBindHost(proc?.pm2_env?.MONKY_SERVE_HOST ?? proc?.pm2_env?.env?.MONKY_SERVE_HOST);
}

export function managedBotProcess(config: BotConfig): (Pm2Process & { pm_id: number }) | null {
  const proc = findBotProcess();
  if (!proc) return null;
  const normalize = (file: string): string => {
    const resolved = path.resolve(file);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  if (typeof proc.pm_id !== 'number' || !Number.isInteger(proc.pm_id) || proc.pm_id < 0 ||
      !proc.pm2_env?.pm_exec_path ||
      normalize(proc.pm2_env.pm_exec_path) !== normalize(getBotEntryPath(config.botDir))) {
    throw new Error(cliText('O processo pm2 chamado monkybot não pôde ser identificado como este bot. Nenhum processo foi alterado.',
      'The pm2 process named monkybot could not be identified as this bot. No process was changed.'));
  }
  return { ...proc, pm_id: proc.pm_id };
}

export function stopManagedBotBeforeRestart(proc: Pm2Process & { pm_id: number }): void {
  if (proc.pm2_env?.status === 'stopped') return;
  const stopped = runSync('pm2', ['stop', String(proc.pm_id)], { stdio: 'inherit' });
  if (stopped.error || stopped.status !== 0) {
    throw new Error(cliText('Falha ao parar o bot antes do reinício. A porta não foi considerada livre.',
      'Failed to stop the bot before restarting. The port was not considered available.'), { cause: stopped.error });
  }
}

async function runtimeReady(config: BotConfig, host: string, starting = true): Promise<string | undefined> {
  const url = config.mode === 'marketplace'
    ? await (starting ? waitForManifest(config, host) : verifyManifest(config, host))
    : undefined;
  const proc = managedBotProcess(config);
  if (proc?.pm2_env?.status !== 'online' || !proc.pid) {
    throw new ManifestReadinessError(cliText(
      'O pm2 não confirmou este bot online. Consulte monkybot logs; a inicialização não foi confirmada.',
      'pm2 did not confirm this bot online. Check monkybot logs; startup was not confirmed.'));
  }
  return url;
}

function printManifestReady(url: string | undefined): void {
  if (!url) return;
  console.log(`   Manifest: ${url}`);
  console.log(cliText(
    '   Manifest verificado localmente. Confirme o acesso a esta URL a partir do servidor Monky; firewall e acesso externo não foram testados.',
    '   Manifest verified locally. Confirm access to this URL from the Monky server; firewall and external reachability were not tested.'));
}

export async function startCommand(): Promise<void> {
  const config = loadConfigOrDie();
  manifestUrl(config);

  const proc = managedBotProcess(config);
  const host = managedManifestHost(proc);
  if (proc?.pm2_env?.status === 'online' && proc.pid) {
    let url: string | undefined;
    try {
      url = await runtimeReady(config, host, false);
    } catch (error: unknown) {
      if (!(error instanceof ManifestReadinessError) || config.mode !== 'marketplace') throw error;
      console.log(color(cliText(
        `⚠️  O manifest atual não está pronto. Recriando somente o processo deste bot (pm2 ID ${proc.pm_id}). ${error.message}`,
        `⚠️  The current manifest is not ready. Recreating only this bot's process (pm2 ID ${proc.pm_id}). ${error.message}`), ANSI.yellow));
      url = await restartBot(config, true);
      console.log(color(cliText('🔄 Monky Bot reiniciado com a configuração atual!',
        '🔄 Monky Bot restarted with the current configuration!'), ANSI.green));
      printManifestReady(url);
      return;
    }
    console.log(color(cliText(`⚠️  Bot já está rodando (PID ${proc.pid}).`, `⚠️  Bot is already running (PID ${proc.pid}).`), ANSI.yellow));
    console.log(color(cliText('Use monkybot restart para reiniciar.', 'Use monkybot restart to restart.'), ANSI.dim));
    printManifestReady(url);
    return;
  }

  await checkManifestPort(config, host);
  ensurePm2();
  ensureBotBuilt(config.botDir);

  await checkManifestPort(config, host);
  const ecosystemPath = writeEcosystem(config, host);
  const result = runSync('pm2', ['startOrRestart', ecosystemPath], { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    throw new Error(cliText('Falha ao iniciar o bot via pm2.', 'Failed to start the bot with pm2.'), { cause: result.error });
  }

  const url = await runtimeReady(config, host);
  const saved = runSync('pm2', ['save'], { stdio: 'ignore' });
  if (saved.error || saved.status !== 0) {
    throw new Error(cliText('Bot iniciado, mas não foi possível salvar o estado do pm2.',
      'Bot started, but pm2 state could not be saved.'), { cause: saved.error });
  }

  console.log();
  console.log(color(cliText('✅ Monky Bot iniciado!', '✅ Monky Bot started!'), ANSI.green));
  console.log(`   ${cliText('Modo', 'Mode')}: ${config.mode}`);
  if (config.mode === 'manual') {
    console.log(`   ${cliText('Servidor', 'Server')}: ${config.serverUrl}`);
  }
  printManifestReady(url);
  console.log();
  console.log(color(cliText('Comandos úteis:', 'Useful commands:'), ANSI.bold));
  console.log(cliText('  monkybot status    — Ver estado do bot', '  monkybot status    — Show bot status'));
  console.log(cliText('  monkybot logs      — Exibir logs', '  monkybot logs      — Show logs'));
  console.log(cliText('  monkybot restart   — Reiniciar', '  monkybot restart   — Restart'));
  console.log(cliText('  monkybot stop      — Parar', '  monkybot stop      — Stop'));
}

export function stopCommand(): void {
  if (!requirePm2(cliText('parar', 'stop'))) return;

  const config = loadConfigOrDie();
  const proc = managedBotProcess(config);
  if (proc?.pm2_env?.status !== 'online') {
    console.log(color(cliText('⚠️  Bot não está rodando.', '⚠️  Bot is not running.'), ANSI.yellow));
    return;
  }

  const result = runSync('pm2', ['stop', String(proc.pm_id)], { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    throw new Error(cliText('Falha ao parar o bot.', 'Failed to stop the bot.'), { cause: result.error });
  }

  console.log(color(cliText('🛑 Monky Bot parado.', '🛑 Monky Bot stopped.'), ANSI.green));
}

export async function restartBot(config: BotConfig, fresh = false): Promise<string | undefined> {
  manifestUrl(config);
  const proc = managedBotProcess(config);
  const host = managedManifestHost(proc);

  if (proc) stopManagedBotBeforeRestart(proc);

  await checkManifestPort(config, host);
  ensurePm2();
  ensureBotBuilt(config.botDir);

  if (fresh && proc) {
    const deleted = runSync('pm2', ['delete', String(proc.pm_id)], { stdio: 'ignore' });
    if (deleted.error || deleted.status !== 0) {
      throw new Error(cliText('Falha ao remover o processo do bot para recriá-lo.',
        'Failed to remove the bot process for recreation.'), { cause: deleted.error });
    }
  }

  await checkManifestPort(config, host);
  const ecosystemPath = writeEcosystem(config, host);
  const result = runSync('pm2', ['startOrRestart', ecosystemPath], { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    throw new Error(cliText('Falha ao reiniciar o bot.', 'Failed to restart the bot.'), { cause: result.error });
  }

  const url = await runtimeReady(config, host);
  const saved = runSync('pm2', ['save'], { stdio: 'ignore' });
  if (saved.error || saved.status !== 0) {
    throw new Error(cliText('Bot reiniciado, mas não foi possível salvar o estado do pm2.',
      'Bot restarted, but pm2 state could not be saved.'), { cause: saved.error });
  }
  return url;
}

export async function restartCommand(args: string[]): Promise<void> {
  const url = await restartBot(loadConfigOrDie(), args.includes('--fresh'));

  console.log();
  console.log(color(cliText('🔄 Monky Bot reiniciado!', '🔄 Monky Bot restarted!'), ANSI.green));
  printManifestReady(url);
}

export function statusCommand(): void {
  if (!requirePm2(cliText('verificar status', 'check status'))) return;

  const config = readConfig();
  if (!config) {
    console.log(color(cliText('❌ Nenhuma configuração encontrada.', '❌ No configuration found.'), ANSI.red));
    console.log(cliText(`   Execute ${color('monkybot setup', ANSI.cyan)} primeiro.`,
      `   Run ${color('monkybot setup', ANSI.cyan)} first.`));
    return;
  }

  const proc = findBotProcess();

  console.log(color('🤖 Monky Bot — Status', ANSI.bold));
  console.log();

  if (!proc) {
    console.log(`  ${cliText('Estado', 'State')}: ${color(cliText('não registrado', 'not registered'), ANSI.yellow)}`);
    console.log(cliText(`  Use ${color('monkybot start', ANSI.cyan)} para iniciar.`,
      `  Use ${color('monkybot start', ANSI.cyan)} to start.`));
  } else {
    const status = proc.pm2_env?.status || cliText('desconhecido', 'unknown');
    const statusColor =
      status === 'online' ? ANSI.green : status === 'stopped' ? ANSI.yellow : ANSI.red;

    console.log(`  ${cliText('Estado', 'State')}:    ${color(status, statusColor)}`);
    if (proc.pid) console.log(`  PID:       ${proc.pid}`);

    if (proc.pm2_env?.pm_uptime) {
      const uptime = Date.now() - proc.pm2_env.pm_uptime;
      const hours = Math.floor(uptime / 3600000);
      const mins = Math.floor((uptime % 3600000) / 60000);
      console.log(`  ${cliText('Ativo há', 'Uptime')}:    ${hours}h ${mins}m`);
    }

    if (proc.monit?.memory) {
      console.log(`  ${cliText('Memória', 'Memory')}:   ${(proc.monit.memory / 1024 / 1024).toFixed(1)} MB`);
    }
    if (proc.monit?.cpu !== undefined) {
      console.log(`  CPU:       ${proc.monit.cpu}%`);
    }
    if (proc.pm2_env?.restart_time !== undefined) {
      console.log(`  ${cliText('Reinícios', 'Restarts')}:  ${proc.pm2_env.restart_time}`);
    }
  }

  console.log();
  console.log(color(cliText('Configuração:', 'Configuration:'), ANSI.bold));
  console.log(`  ${cliText('Modo', 'Mode')}:      ${config.mode}`);
  console.log(`  ${cliText('Diretório', 'Bot dir')}:   ${config.botDir}`);
  console.log(`  ${cliText('Nome', 'Bot name')}:  ${config.botName || DEFAULT_BOT_NAME}`);
  if (config.mode === 'manual') {
    console.log(`  ${cliText('Servidor', 'Server')}:  ${config.serverUrl}`);
  } else {
    console.log(`  ${cliText('Porta', 'Port')}:     ${config.servePort}`);
    console.log(`  Host:      ${config.publicHost}`);
  }
  console.log(`  Config:    ${CONFIG_FILE}`);
}

export function logsCommand(args: string[]): void {
  if (!requirePm2(cliText('ver logs', 'view logs'))) return;

  const linesIdx = args.indexOf('--lines');
  const lines = linesIdx >= 0 && args[linesIdx + 1] ? args[linesIdx + 1] : '50';
  const noFollow = args.includes('--no-follow');

  const pm2Args = ['logs', 'monkybot', '--lines', lines];
  if (noFollow) pm2Args.push('--nostream');

  // Logs run in foreground (streamed) unless --no-follow
  const result = runSync('pm2', pm2Args, { stdio: 'inherit' });
  if (result.status !== 0 && result.status !== null) {
    // pm2 logs returns non-zero when interrupted with Ctrl+C — that's fine.
  }
}

export async function configCommand(args: string[]): Promise<void> {
  if (args[0] === 'language') {
    await languageCommand(args.slice(1));
    return;
  }
  if (!args.length && process.stdin.isTTY && process.stdout.isTTY && !process.env.CI) {
    const { configurationMenu } = await import('../menu');
    await configurationMenu();
    return;
  }
  const config = readConfig();

  if (args.length === 0 || args[0] === 'show') {
    if (!config) {
      console.log(color(cliText('Nenhuma configuração encontrada.', 'No configuration found.'), ANSI.yellow));
      console.log(cliText(`Execute ${color('monkybot setup', ANSI.cyan)} para configurar.`,
        `Run ${color('monkybot setup', ANSI.cyan)} to configure.`));
      return;
    }
    console.log(color(cliText('🤖 Configuração atual:', '🤖 Current configuration:'), ANSI.bold));
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  if (args[0] === 'set') {
    if (!config) {
      console.log(color(cliText('Execute monkybot setup primeiro.', 'Run monkybot setup first.'), ANSI.red));
      return;
    }
    const key = args[1];
    const value = args.slice(2).join(' ');

    if (!key || !value) {
      console.log(color(cliText('Uso: monkybot config set <chave> <valor>', 'Usage: monkybot config set <key> <value>'), ANSI.yellow));
      console.log(`${cliText('Chaves', 'Keys')}: mode, serverUrl, botToken, servePort, publicHost, botName, botDir`);
      return;
    }

    const validKeys = ['mode', 'serverUrl', 'botToken', 'servePort', 'publicHost', 'botName', 'botDir'];
    if (!validKeys.includes(key)) {
      console.log(color(cliText(`Chave desconhecida: ${key}`, `Unknown key: ${key}`), ANSI.red));
      console.log(`${cliText('Chaves válidas', 'Valid keys')}: ${validKeys.join(', ')}`);
      return;
    }

    const next = { ...config };
    switch (key) {
      case 'mode':
        if (value !== 'manual' && value !== 'marketplace') {
          throw new Error(cliText('Modo inválido. Use manual ou marketplace.', 'Invalid mode. Use manual or marketplace.'));
        }
        next.mode = value;
        break;
      case 'servePort':
        next.servePort = validateBotServePort(value);
        break;
      case 'publicHost':
        next.publicHost = validateBotPublicHost(value);
        break;
      case 'serverUrl':
      case 'botToken':
      case 'botName':
      case 'botDir':
        next[key] = value;
        break;
    }

    if (next.mode === 'marketplace' && ['mode', 'servePort', 'publicHost'].includes(key)) {
      manifestUrl(next);
    }
    if (next.mode === 'marketplace' &&
        (config.mode !== 'marketplace' ||
         (next.servePort ?? DEFAULT_MANIFEST_PORT) !== (config.servePort ?? DEFAULT_MANIFEST_PORT))) {
      await checkManifestPort(next);
    }
    writeConfig(next);
    console.log(color(`✅ ${key} = ${value}`, ANSI.green));
    console.log(color(cliText('Reinicie o bot para aplicar: monkybot restart', 'Restart the bot to apply: monkybot restart'), ANSI.dim));
    return;
  }

  console.log(color(cliText(`Subcomando desconhecido: ${args[0]}`, `Unknown subcommand: ${args[0]}`), ANSI.red));
  console.log(cliText('Uso: monkybot config [show | set <chave> <valor>]', 'Usage: monkybot config [show | set <key> <value>]'));
}
