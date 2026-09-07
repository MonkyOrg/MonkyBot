import fs from 'fs';
import path from 'path';
import { ANSI, color, CONFIG_DIR, PM2_PROCESS_NAME } from './constants';
import { commandSucceeds, runSync } from './process';
import { BotConfig, getBotEntryPath } from './config';

export interface Pm2Process {
  name?: string;
  pid?: number;
  monit?: { memory?: number; cpu?: number };
  pm2_env?: {
    status?: string;
    pm_uptime?: number;
    restart_time?: number;
    pm_cwd?: string;
  };
}

export function isPm2Available(): boolean {
  return commandSucceeds('pm2', ['--version']);
}

export function ensurePm2(): void {
  if (!isPm2Available()) {
    console.log(color('⚙️  pm2 não encontrado. Instalando...', ANSI.yellow));
    const result = runSync('npm', ['install', '-g', 'pm2'], { stdio: 'inherit' });
    if (result.error || result.status !== 0) {
      throw new Error('Falha ao instalar pm2. Execute manualmente: npm install -g pm2');
    }
  }
}

export function requirePm2(action: string): boolean {
  if (isPm2Available()) return true;
  console.log(color(`pm2 não encontrado — necessário para ${action}.`, ANSI.yellow));
  console.log(color('Instale com: npm install -g pm2', ANSI.dim));
  return false;
}

export function listPm2Processes(): Pm2Process[] {
  if (!isPm2Available()) return [];
  try {
    const result = runSync('pm2', ['jlist'], { encoding: 'utf8' });
    if (result.status !== 0) return [];
    const parsed = JSON.parse(result.stdout);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function findBotProcess(): Pm2Process | null {
  return listPm2Processes().find((p) => p.name === PM2_PROCESS_NAME) ?? null;
}

export function isBotRunning(): boolean {
  return findBotProcess()?.pm2_env?.status === 'online';
}

export function isBotRegistered(): boolean {
  return findBotProcess() !== null;
}

export function deleteBotProcess(): void {
  runSync('pm2', ['delete', PM2_PROCESS_NAME], { stdio: 'ignore' });
}

export function getEcosystemPath(): string {
  return path.join(CONFIG_DIR, 'ecosystem.config.cjs');
}

function forSingleQuotes(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function generateEcosystem(config: BotConfig): string {
  const entryPath = forSingleQuotes(getBotEntryPath(config.botDir));
  const cwd = forSingleQuotes(config.botDir);

  const env: Record<string, string> = { NODE_ENV: 'production' };
  if (config.mode === 'manual') {
    if (config.serverUrl) env.MONKY_SERVER_URL = config.serverUrl;
    if (config.botToken) env.MONKY_BOT_TOKEN = config.botToken;
  } else {
    env.MONKY_SERVE = 'true';
    if (config.servePort) env.MONKY_SERVE_PORT = String(config.servePort);
    if (config.publicHost) env.MONKY_SERVE_PUBLIC_HOST = config.publicHost;
    if (config.botName) env.MONKY_BOT_NAME = config.botName;
  }

  const envLines = Object.entries(env)
    .map(([k, v]) => `      ${k}: '${forSingleQuotes(v)}'`)
    .join(',\n');

  return `module.exports = {
  apps: [{
    name: '${PM2_PROCESS_NAME}',
    script: '${entryPath}',
    cwd: '${cwd}',
    autorestart: true,
    watch: false,
    max_memory_restart: '256M',
    env: {
${envLines}
    }
  }]
};
`;
}

export function writeEcosystem(config: BotConfig): string {
  // Ensure botDir exists (it's the cwd for the process — .keys/ go there)
  fs.mkdirSync(config.botDir, { recursive: true });
  // Ecosystem lives in ~/.monkybot/, not botDir
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const ecosystemPath = getEcosystemPath();
  fs.writeFileSync(ecosystemPath, generateEcosystem(config), 'utf8');
  return ecosystemPath;
}
