import fs from 'fs';
import { ANSI, color, CONFIG_FILE } from '../constants';
import { readConfig, writeConfig, getBotEntryPath } from '../config';
import {
  ensurePm2,
  requirePm2,
  findBotProcess,
  isBotRunning,
  writeEcosystem,
  deleteBotProcess,
} from '../pm2';
import { runSync } from '../process';
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

export function startCommand(): void {
  const config = loadConfigOrDie();
  const manifestUrl = config.mode === 'marketplace'
    ? getManifestUrl(config.publicHost, config.servePort)
    : undefined;
  ensurePm2();
  ensureBotBuilt(config.botDir);

  const proc = findBotProcess();
  if (proc?.pm2_env?.status === 'online' && proc.pid) {
    console.log(color(`⚠️  Bot já está rodando (PID ${proc.pid}).`, ANSI.yellow));
    console.log(color('Use monkybot restart para reiniciar.', ANSI.dim));
    return;
  }

  const ecosystemPath = writeEcosystem(config);
  const result = runSync('pm2', ['startOrRestart', ecosystemPath], { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error('Falha ao iniciar o bot via pm2.');
  }

  runSync('pm2', ['save'], { stdio: 'ignore' });

  console.log();
  console.log(color('✅ Monky Bot iniciado!', ANSI.green));
  console.log(`   Modo: ${config.mode}`);
  if (config.mode === 'manual') {
    console.log(`   Servidor: ${config.serverUrl}`);
  } else {
    console.log(`   Manifest: ${manifestUrl}`);
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
  if (!isBotRunning()) {
    console.log(color('⚠️  Bot não está rodando.', ANSI.yellow));
    return;
  }

  const result = runSync('pm2', ['stop', 'monkybot'], { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error('Falha ao parar o bot.');
  }

  console.log(color('🛑 Monky Bot parado.', ANSI.green));
}

export function restartCommand(args: string[]): void {
  const config = loadConfigOrDie();
  ensurePm2();
  ensureBotBuilt(config.botDir);

  const fresh = args.includes('--fresh');

  if (fresh) {
    deleteBotProcess();
  }

  const ecosystemPath = writeEcosystem(config);
  const result = runSync('pm2', ['startOrRestart', ecosystemPath], { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error('Falha ao reiniciar o bot.');
  }

  runSync('pm2', ['save'], { stdio: 'ignore' });

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

export function configCommand(args: string[]): void {
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

    if (key === 'servePort') {
      (config as unknown as Record<string, unknown>)[key] = parseInt(value, 10);
    } else {
      (config as unknown as Record<string, unknown>)[key] = value;
    }

    writeConfig(config);
    console.log(color(`✅ ${key} = ${value}`, ANSI.green));
    console.log(color('Reinicie o bot para aplicar: monkybot restart', ANSI.dim));
    return;
  }

  console.log(color(`Subcomando desconhecido: ${args[0]}`, ANSI.red));
  console.log('Uso: monkybot config [show | set <chave> <valor>]');
}
