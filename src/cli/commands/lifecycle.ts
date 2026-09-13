import fs from 'fs';
import path from 'path';
import { validateBotPublicHost, validateBotServePort } from '@monky/bot-sdk';
import { ANSI, color, CONFIG_FILE } from '../constants';
import { BotConfig, readConfig, writeConfig, getBotEntryPath } from '../config';
import {
  ensurePm2,
  requirePm2,
  findBotProcess,
  writeEcosystem,
  Pm2Process,
} from '../pm2';
import { runSync } from '../process';
import { assertManifestPortAvailable, DEFAULT_MANIFEST_PORT, getManifestBindHost } from '../manifestPort';
import { DEFAULT_BOT_NAME } from '../../profile';
import { getManifestUrl } from '../../utils/manifest';

function loadConfigOrDie() {
  const config = readConfig();
  if (!config) {
    console.log(color('❌ Nenhuma configuração encontrada.', ANSI.red));
    console.log(`   Execute ${color('monkybot setup', ANSI.cyan)} primeiro.`);
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
      `Entrada do bot não encontrada: ${entry}\n` +
      `Se instalou via script, o bot já deveria estar compilado.\n` +
      `Tente reinstalar: curl -fsSL https://monkyorg.github.io/install-monkybot.sh | bash`
    );
  }

  console.log(color('⚠️  Bot não compilado. Compilando...', ANSI.yellow));
  const result = runSync('npm', ['run', 'build'], { cwd: botDir, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(
      `Falha ao compilar o bot. Execute manualmente: cd ${botDir} && npm run build`
    );
  }
  console.log(color('✅ Bot compilado.', ANSI.green));
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

function managedManifestHost(proc: Pm2Process | null): string {
  return getManifestBindHost(proc?.pm2_env?.MONKY_SERVE_HOST ?? proc?.pm2_env?.env?.MONKY_SERVE_HOST);
}

function managedBotProcess(config: BotConfig): (Pm2Process & { pm_id: number }) | null {
  const proc = findBotProcess();
  if (!proc) return null;
  const normalize = (file: string): string => {
    const resolved = path.resolve(file);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  if (typeof proc.pm_id !== 'number' || !Number.isInteger(proc.pm_id) || proc.pm_id < 0 ||
      !proc.pm2_env?.pm_exec_path ||
      normalize(proc.pm2_env.pm_exec_path) !== normalize(getBotEntryPath(config.botDir))) {
    throw new Error('O processo pm2 chamado monkybot não pôde ser identificado como este bot. Nenhum processo foi alterado.');
  }
  return { ...proc, pm_id: proc.pm_id };
}

export async function startCommand(): Promise<void> {
  const config = loadConfigOrDie();
  const url = manifestUrl(config);

  const proc = managedBotProcess(config);
  if (proc?.pm2_env?.status === 'online' && proc.pid) {
    console.log(color(`⚠️  Bot já está rodando (PID ${proc.pid}).`, ANSI.yellow));
    console.log(color('Use monkybot restart para reiniciar.', ANSI.dim));
    return;
  }

  const host = managedManifestHost(proc);
  await checkManifestPort(config, host);
  ensurePm2();
  ensureBotBuilt(config.botDir);

  const ecosystemPath = writeEcosystem(config, host);
  const result = runSync('pm2', ['startOrRestart', ecosystemPath], { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    throw new Error('Falha ao iniciar o bot via pm2.', { cause: result.error });
  }

  runSync('pm2', ['save'], { stdio: 'ignore' });

  console.log();
  console.log(color('✅ Monky Bot iniciado!', ANSI.green));
  console.log(`   Modo: ${config.mode}`);
  if (config.mode === 'manual') {
    console.log(`   Servidor: ${config.serverUrl}`);
  } else {
    console.log(`   Manifest: ${url}`);
  }
  console.log();
  console.log(color('Comandos úteis:', ANSI.bold));
  console.log('  monkybot status    — Ver estado do bot');
  console.log('  monkybot logs      — Exibir logs');
  console.log('  monkybot restart   — Reiniciar');
  console.log('  monkybot stop      — Parar');
}

export function stopCommand(): void {
  if (!requirePm2('parar')) return;

  const config = loadConfigOrDie();
  const proc = managedBotProcess(config);
  if (proc?.pm2_env?.status !== 'online') {
    console.log(color('⚠️  Bot não está rodando.', ANSI.yellow));
    return;
  }

  const result = runSync('pm2', ['stop', String(proc.pm_id)], { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    throw new Error('Falha ao parar o bot.', { cause: result.error });
  }

  console.log(color('🛑 Monky Bot parado.', ANSI.green));
}

export async function restartBot(config: BotConfig, fresh = false): Promise<void> {
  manifestUrl(config);
  const proc = managedBotProcess(config);
  const host = managedManifestHost(proc);

  if (proc) {
    const stopped = runSync('pm2', ['stop', String(proc.pm_id)], { stdio: 'inherit' });
    if (stopped.error || stopped.status !== 0) {
      throw new Error('Falha ao parar o bot antes do reinício. A porta não foi considerada livre.', { cause: stopped.error });
    }
  }

  await checkManifestPort(config, host);
  ensurePm2();
  ensureBotBuilt(config.botDir);

  if (fresh && proc) {
    const deleted = runSync('pm2', ['delete', String(proc.pm_id)], { stdio: 'ignore' });
    if (deleted.error || deleted.status !== 0) {
      throw new Error('Falha ao remover o processo do bot para recriá-lo.', { cause: deleted.error });
    }
  }

  const ecosystemPath = writeEcosystem(config, host);
  const result = runSync('pm2', ['startOrRestart', ecosystemPath], { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    throw new Error('Falha ao reiniciar o bot.', { cause: result.error });
  }

  const saved = runSync('pm2', ['save'], { stdio: 'ignore' });
  if (saved.error || saved.status !== 0) {
    throw new Error('Bot reiniciado, mas não foi possível salvar o estado do pm2.', { cause: saved.error });
  }
}

export async function restartCommand(args: string[]): Promise<void> {
  await restartBot(loadConfigOrDie(), args.includes('--fresh'));

  console.log();
  console.log(color('🔄 Monky Bot reiniciado!', ANSI.green));
}

export function statusCommand(): void {
  if (!requirePm2('verificar status')) return;

  const config = readConfig();
  if (!config) {
    console.log(color('❌ Nenhuma configuração encontrada.', ANSI.red));
    console.log(`   Execute ${color('monkybot setup', ANSI.cyan)} primeiro.`);
    return;
  }

  const proc = findBotProcess();

  console.log(color('🤖 Monky Bot — Status', ANSI.bold));
  console.log();

  if (!proc) {
    console.log(`  Estado: ${color('não registrado', ANSI.yellow)}`);
    console.log(`  Use ${color('monkybot start', ANSI.cyan)} para iniciar.`);
  } else {
    const status = proc.pm2_env?.status || 'unknown';
    const statusColor =
      status === 'online' ? ANSI.green : status === 'stopped' ? ANSI.yellow : ANSI.red;

    console.log(`  Estado:    ${color(status, statusColor)}`);
    if (proc.pid) console.log(`  PID:       ${proc.pid}`);

    if (proc.pm2_env?.pm_uptime) {
      const uptime = Date.now() - proc.pm2_env.pm_uptime;
      const hours = Math.floor(uptime / 3600000);
      const mins = Math.floor((uptime % 3600000) / 60000);
      console.log(`  Uptime:    ${hours}h ${mins}m`);
    }

    if (proc.monit?.memory) {
      console.log(`  Memória:   ${(proc.monit.memory / 1024 / 1024).toFixed(1)} MB`);
    }
    if (proc.monit?.cpu !== undefined) {
      console.log(`  CPU:       ${proc.monit.cpu}%`);
    }
    if (proc.pm2_env?.restart_time !== undefined) {
      console.log(`  Restarts:  ${proc.pm2_env.restart_time}`);
    }
  }

  console.log();
  console.log(color('Configuração:', ANSI.bold));
  console.log(`  Modo:      ${config.mode}`);
  console.log(`  Bot dir:   ${config.botDir}`);
  console.log(`  Bot name:  ${config.botName || DEFAULT_BOT_NAME}`);
  if (config.mode === 'manual') {
    console.log(`  Servidor:  ${config.serverUrl}`);
  } else {
    console.log(`  Porta:     ${config.servePort}`);
    console.log(`  Host:      ${config.publicHost}`);
  }
  console.log(`  Config:    ${CONFIG_FILE}`);
}

export function logsCommand(args: string[]): void {
  if (!requirePm2('ver logs')) return;

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
  const config = readConfig();

  if (args.length === 0 || args[0] === 'show') {
    if (!config) {
      console.log(color('Nenhuma configuração encontrada.', ANSI.yellow));
      console.log(`Execute ${color('monkybot setup', ANSI.cyan)} para configurar.`);
      return;
    }
    console.log(color('🤖 Configuração atual:', ANSI.bold));
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  if (args[0] === 'set') {
    if (!config) {
      console.log(color('Execute monkybot setup primeiro.', ANSI.red));
      return;
    }
    const key = args[1];
    const value = args.slice(2).join(' ');

    if (!key || !value) {
      console.log(color('Uso: monkybot config set <chave> <valor>', ANSI.yellow));
      console.log('Chaves: mode, serverUrl, botToken, servePort, publicHost, botName, botDir');
      return;
    }

    const validKeys = ['mode', 'serverUrl', 'botToken', 'servePort', 'publicHost', 'botName', 'botDir'];
    if (!validKeys.includes(key)) {
      console.log(color(`Chave desconhecida: ${key}`, ANSI.red));
      console.log(`Chaves válidas: ${validKeys.join(', ')}`);
      return;
    }

    const next = { ...config };
    switch (key) {
      case 'mode':
        if (value !== 'manual' && value !== 'marketplace') {
          throw new Error('Modo inválido. Use manual ou marketplace.');
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
    console.log(color('Reinicie o bot para aplicar: monkybot restart', ANSI.dim));
    return;
  }

  console.log(color(`Subcomando desconhecido: ${args[0]}`, ANSI.red));
  console.log('Uso: monkybot config [show | set <chave> <valor>]');
}
