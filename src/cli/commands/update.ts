import fs from 'fs';
import path from 'path';
import { ANSI, color, PM2_PROCESS_NAME } from '../constants';
import { readConfig } from '../config';
import {
  requirePm2,
  isPm2Available,
  isBotRunning,
  findBotProcess,
  ensurePm2,
  writeEcosystem,
  getEcosystemPath,
} from '../pm2';
import { runSync } from '../process';

const GITHUB_REPO = 'MonkyOrg/MonkyBot';
const RELEASES_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=20`;
const LATEST_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

// ── Version helpers ──────────────────────────────────────────────────

function readPackagedVersion(): string {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'package.json'),
    path.resolve(__dirname, '..', '..', '..', 'package.json'),
  ];
  for (const pkg of candidates) {
    if (!fs.existsSync(pkg)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(pkg, 'utf8'));
      if (parsed.version && parsed.version !== '0.0.0') return parsed.version;
    } catch {}
  }
  return '0.0.0';
}

interface Semver {
  major: number;
  minor: number;
  patch: number;
}

function parseSemver(v: string): Semver {
  const clean = String(v || '').replace(/^v/, '').split('-')[0];
  const [major = 0, minor = 0, patch = 0] = clean.split('.').map((n) => parseInt(n, 10) || 0);
  return { major, minor, patch };
}

function compareVersions(local: string, remote: string): number {
  const a = parseSemver(local);
  const b = parseSemver(remote);
  if (a.major !== b.major) return b.major - a.major;
  if (a.minor !== b.minor) return b.minor - a.minor;
  if (a.patch !== b.patch) return b.patch - a.patch;
  return 0;
}

// ── GitHub API ───────────────────────────────────────────────────────

interface ReleaseInfo {
  version: string;
  tgzUrl: string;
  htmlUrl: string;
}

async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  try {
    const https = await import('https');
    return new Promise((resolve) => {
      const req = https.get(
        LATEST_URL,
        { headers: { 'User-Agent': 'monkybot-cli', Accept: 'application/vnd.github.v3+json' } },
        (res) => {
          if (res.statusCode !== 200) { resolve(null); return; }
          let data = '';
          res.on('data', (chunk: string) => { data += chunk; });
          res.on('end', () => {
            try {
              const release = JSON.parse(data);
              const version = (release.tag_name || '').replace(/^v/, '');
              const asset = (release.assets || []).find(
                (a: { name?: string }) => a.name?.includes('monky-bot') && a.name?.endsWith('.tgz')
              );
              if (!asset) { resolve(null); return; }
              resolve({
                version,
                tgzUrl: asset.browser_download_url,
                htmlUrl: release.html_url || '',
              });
            } catch { resolve(null); }
          });
        }
      );
      req.on('error', () => resolve(null));
      req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    });
  } catch { return null; }
}

// ── Update command ───────────────────────────────────────────────────

export async function updateCommand(args: string[]): Promise<void> {
  const checkOnly = args.includes('--check');
  const assumeYes = args.includes('--yes') || args.includes('-y');

  const local = readPackagedVersion();
  console.log(color(`Versão local: ${local}`, ANSI.dim));
  console.log(color('Verificando atualizações...', ANSI.dim));

  const latest = await fetchLatestRelease();
  if (!latest) {
    console.log(color('⚠️  Não foi possível verificar atualizações.', ANSI.yellow));
    console.log(color('Verifique sua conexão ou acesse:', ANSI.dim));
    console.log(`https://github.com/${GITHUB_REPO}/releases`);
    return;
  }

  const hasUpdate = compareVersions(local, latest.version) > 0;

  if (hasUpdate) {
    console.log(color(`🆕 Nova versão disponível: ${latest.version}`, ANSI.green));
    if (latest.htmlUrl) console.log(`   ${latest.htmlUrl}`);
  } else {
    console.log(color('✅ Você já está na versão mais recente.', ANSI.green));
  }

  if (checkOnly) return;

  if (!hasUpdate && !assumeYes) {
    const shouldForce = await promptYesNo('Reinstalar a versão atual?', false);
    if (!shouldForce) return;
  }

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
    console.log(color('❌ Falha ao instalar a atualização.', ANSI.red));
    return;
  }

  console.log();
  console.log(color(`✅ Monky Bot atualizado para ${latest.version}!`, ANSI.green));

  // Restart if running
  if (isPm2Available() && isBotRunning()) {
    if (assumeYes || (await promptYesNo('Reiniciar o bot para aplicar?', true))) {
      const config = readConfig();
      if (config) {
        const ecosystemPath = writeEcosystem(config);
        runSync('pm2', ['startOrRestart', ecosystemPath], { stdio: 'inherit' });
        runSync('pm2', ['save'], { stdio: 'ignore' });
        console.log(color('🔄 Bot reiniciado.', ANSI.green));
      }
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

function generateUpdaterScript(cliEntry: string, schedule: string): string {
  return `// Monky Bot auto-updater — gerado por "monkybot autoupdate on"
const { spawnSync } = require('child_process');

const CLI = ${JSON.stringify(cliEntry)};
const SCHEDULE = ${JSON.stringify(schedule)};

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
    spawnSync(process.execPath, [CLI, 'update', '--yes'], { stdio: 'inherit' });
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
    ensurePm2();

    const schedule = args[1] || '04:00'; // Default: 4am daily
    const cliEntry = getCliEntryPath();
    const scriptPath = getAutoUpdateScriptPath();

    // Write updater script
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
    fs.writeFileSync(scriptPath, generateUpdaterScript(cliEntry, schedule), 'utf8');

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
    console.log(`   Script: ${scriptPath}`);
    console.log(color('Para desativar: monkybot autoupdate off', ANSI.dim));
    return;
  }

  console.log(color(`Subcomando desconhecido: ${action}`, ANSI.red));
  console.log('Uso: monkybot autoupdate [on [HH:MM] | off | status]');
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
