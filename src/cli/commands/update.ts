import fs from 'fs';
import path from 'path';
import { ANSI, color } from '../constants';
import { readConfig } from '../config';
import {
  requirePm2,
  isPm2Available,
  isBotRunning,
  ensurePm2,
} from '../pm2';
import { runSync } from '../process';
import { compareVersions, fetchLatestRelease, parseVersion } from '../updateReleases';
import { restartBot } from './lifecycle';

// ── Version helpers ──────────────────────────────────────────────────

function readPackagedVersion(): string {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'package.json'),
    path.resolve(__dirname, '..', '..', '..', 'package.json'),
  ];
  for (const pkg of candidates) {
    if (!fs.existsSync(pkg)) continue;
    const parsed: unknown = JSON.parse(fs.readFileSync(pkg, 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && 'version' in parsed &&
        typeof parsed.version === 'string' && parseVersion(parsed.version)) return parsed.version;
    throw new Error(`Versão inválida no pacote: ${pkg}`);
  }
  throw new Error('Não foi possível determinar a versão instalada.');
}

// ── Update command ───────────────────────────────────────────────────

export async function updateCommand(args: string[]): Promise<void> {
  const invalid = args.find((arg) => !['--check', '--yes', '-y', '--beta'].includes(arg));
  if (invalid) throw new Error(`Opção desconhecida: ${invalid}`);
  const checkOnly = args.includes('--check');
  const assumeYes = args.includes('--yes') || args.includes('-y');
  const includeBeta = args.includes('--beta');

  const local = readPackagedVersion();
  console.log(color(`Versão local: ${local}`, ANSI.dim));
  console.log(color(`Verificando atualizações (${includeBeta ? 'beta' : 'stable'})...`, ANSI.dim));

  const latest = await fetchLatestRelease(includeBeta);
  if (!latest) {
    console.log(color('Nenhuma release instalável disponível neste canal.', ANSI.yellow));
    return;
  }

  const comparison = compareVersions(latest.version, local);
  const hasUpdate = comparison > 0;

  if (hasUpdate) {
    console.log(color(`🆕 Nova versão disponível: ${latest.version}`, ANSI.green));
    if (latest.htmlUrl) console.log(`   ${latest.htmlUrl}`);
  } else if (comparison < 0) {
    console.log(color(`A versão ${latest.version} deste canal é anterior à instalada. Downgrade bloqueado.`, ANSI.yellow));
  } else {
    console.log(color('✅ Você já está na versão mais recente.', ANSI.green));
  }

  if (checkOnly || !hasUpdate) return;

  if (hasUpdate && !assumeYes) {
    const accepted = await promptYesNo(`Atualizar para ${latest.version}?`, true);
    if (!accepted) {
      console.log(color('Atualização cancelada.', ANSI.yellow));
      return;
    }
  }

  // Perform update
  console.log();
  console.log(color('📦 Atualizando Monky Bot...', ANSI.bold));
  console.log(color(latest.tgzUrl, ANSI.cyan));
  console.log();

  const installResult = runSync('npm', ['install', '-g', latest.tgzUrl], { stdio: 'inherit' });
  if (installResult.status !== 0) {
    throw new Error('Falha ao instalar a atualização.', { cause: installResult.error });
  }

  console.log();
  console.log(color(`✅ Monky Bot atualizado para ${latest.version}!`, ANSI.green));

  // Restart if running
  if (isPm2Available() && isBotRunning()) {
    if (assumeYes || (await promptYesNo('Reiniciar o bot para aplicar?', true))) {
      const config = readConfig();
      if (!config) throw new Error('Pacote atualizado, mas não foi possível ler a configuração para reiniciar.');
      try {
        await restartBot(config);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Pacote atualizado, mas o reinício do bot falhou: ${message}`, { cause: error });
      }
      console.log(color('🔄 Bot reiniciado.', ANSI.green));
    }
  }
}

// ── Auto-update ──────────────────────────────────────────────────────

function getAutoUpdateScriptPath(): string {
  const config = readConfig();
  const dir = config?.botDir || require('os').homedir();
  return path.join(dir, '.monkybot-updater.cjs');
}

function getCliEntryPath(): string {
  return path.resolve(__dirname, '..', '..', 'cli.js');
}

const UPDATER_PM2_NAME = 'monkybot-updater';

export function isAutoUpdateEnabled(): boolean {
  if (!isPm2Available()) return false;
  const procs = runSync('pm2', ['jlist'], { encoding: 'utf8' });
  if (procs.status !== 0) return false;
  try {
    const list = JSON.parse(procs.stdout);
    return Array.isArray(list) && list.some((p: { name?: string }) => p.name === UPDATER_PM2_NAME);
  } catch { return false; }
}

export function generateUpdaterScript(cliEntry: string, schedule: string, includeBeta = false): string {
  return `// Monky Bot auto-updater — gerado por "monkybot autoupdate on"
const { spawnSync } = require('child_process');
const fs = require('fs');
const { parseVersion } = require(${JSON.stringify(path.join(path.dirname(cliEntry), 'cli', 'updateReleases.js'))});

const CLI = ${JSON.stringify(cliEntry)};
const PACKAGE_FILE = ${JSON.stringify(path.resolve(path.dirname(cliEntry), '..', 'package.json'))};
const SCHEDULE = ${JSON.stringify(schedule)};
const INCLUDE_BETA = ${JSON.stringify(includeBeta)};

function getMsUntilNextRun() {
  const parts = SCHEDULE.split(':').map(Number);
  const h = isNaN(parts[0]) ? 4 : parts[0];
  const m = isNaN(parts[1]) ? 0 : parts[1];
  const now = new Date();
  const next = new Date(now);
  next.setHours(h, m, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

function check() {
  console.log('[' + new Date().toISOString() + '] [monkybot-updater] Verificando atualizações...');
  try {
    const version = parseVersion(JSON.parse(fs.readFileSync(PACKAGE_FILE, 'utf8')).version);
    if (!version) throw new Error('Versão instalada inválida.');
    const beta = INCLUDE_BETA || version.beta !== null;
    console.log('[monkybot-updater] Canal: ' + (beta ? 'beta' : 'stable'));
    const args = [CLI, 'update', '--yes'];
    if (beta) args.push('--beta');
    const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Atualização falhou (status ' + result.status + ').');
  } catch (err) {
    console.error('[monkybot-updater] Erro:', err);
  }
  schedule();
}

function schedule() {
  const ms = getMsUntilNextRun();
  const next = new Date(Date.now() + ms);
  console.log('[monkybot-updater] Próxima verificação:', next.toLocaleString());
  setTimeout(check, ms);
}

console.log('[monkybot-updater] Daemon iniciado (horário: ' + SCHEDULE + ').');
schedule();
`;
}

export async function autoUpdateCommand(args: string[]): Promise<void> {
  const action = args[0]; // 'on', 'off', 'status'
  if (action !== 'on' && args.length > 1) throw new Error('Opções extras não são aceitas neste subcomando.');

  if (!action || action === 'status') {
    const enabled = isAutoUpdateEnabled();
    console.log(`Auto-update: ${enabled ? color('ativado', ANSI.green) : color('desativado', ANSI.yellow)}`);
    if (enabled) {
      console.log(color('Para desativar: monkybot autoupdate off', ANSI.dim));
    } else {
      console.log(color('Para ativar: monkybot autoupdate on [HH:MM]', ANSI.dim));
    }
    return;
  }

  if (action === 'off') {
    if (!requirePm2('desativar auto-update')) return;
    runSync('pm2', ['delete', UPDATER_PM2_NAME], { stdio: 'ignore' });
    runSync('pm2', ['save'], { stdio: 'ignore' });

    // Clean up script
    const scriptPath = getAutoUpdateScriptPath();
    if (fs.existsSync(scriptPath)) {
      try { fs.unlinkSync(scriptPath); } catch {}
    }

    console.log(color('✅ Auto-update desativado.', ANSI.green));
    return;
  }

  if (action === 'on') {
    const options = args.slice(1).filter((arg) => arg !== '--beta');
    const schedule = options[0] || '04:00';
    if (options.length > 1 || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(schedule)) {
      throw new Error('Uso: monkybot autoupdate on [HH:MM] [--beta] (horário entre 00:00 e 23:59).');
    }
    const includeBeta = args.includes('--beta');
    ensurePm2();
    const cliEntry = getCliEntryPath();
    const scriptPath = getAutoUpdateScriptPath();

    // Write updater script
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
    fs.writeFileSync(scriptPath, generateUpdaterScript(cliEntry, schedule, includeBeta), 'utf8');

    // Remove existing and start fresh
    runSync('pm2', ['delete', UPDATER_PM2_NAME], { stdio: 'ignore' });
    const result = runSync('pm2', ['start', scriptPath, '--name', UPDATER_PM2_NAME], { stdio: 'inherit' });
    if (result.status !== 0) {
      throw new Error('Falha ao iniciar o daemon de auto-update.');
    }
    runSync('pm2', ['save'], { stdio: 'ignore' });

    console.log();
    console.log(color('✅ Auto-update ativado!', ANSI.green));
    console.log(`   Horário: ${schedule} (diariamente)`);
    console.log(`   Canal: ${includeBeta ? 'beta' : 'acompanha a versão instalada'}`);
    console.log(`   Script: ${scriptPath}`);
    console.log(color('Para desativar: monkybot autoupdate off', ANSI.dim));
    return;
  }

  throw new Error(`Subcomando desconhecido: ${action}. Uso: monkybot autoupdate [on [HH:MM] [--beta] | off | status]`);
}

// ── Helpers ──────────────────────────────────────────────────────────

function promptYesNo(question: string, defaultYes: boolean): Promise<boolean> {
  const hint = defaultYes ? '[S/n]' : '[s/N]';
  return new Promise((resolve) => {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} ${hint} `, (answer: string) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      if (!trimmed) { resolve(defaultYes); return; }
      resolve(trimmed === 's' || trimmed === 'y' || trimmed === 'sim' || trimmed === 'yes');
    });
  });
}
