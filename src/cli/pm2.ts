import fs from 'fs';
import path from 'path';
import { spawnSync } from 'node:child_process';
import { ANSI, color, CONFIG_DIR, PM2_PROCESS_NAME } from './constants';
import { runSync } from './process';
import { BotConfig, getBotEntryPath } from './config';
import { DEFAULT_MANIFEST_PORT, getManifestBindHost } from './manifestPort';

export interface Pm2Process {
  name?: string;
  pm_id?: number;
  pid?: number;
  monit?: { memory?: number; cpu?: number };
  pm2_env?: {
    status?: string;
    pm_uptime?: number;
    restart_time?: number;
    pm_cwd?: string;
    pm_exec_path?: string;
    MONKY_SERVE_HOST?: string;
    env?: { MONKY_SERVE_HOST?: string };
  };
}

export function isPm2Available(): boolean {
  // Falhar ao executar pm2 não prova ausência; consulte apenas a localização do comando.
  const command = process.platform === 'win32' ? 'where.exe' : 'sh';
  const args = process.platform === 'win32' ? ['pm2'] : ['-c', 'command -v pm2'];
  const message = 'Não foi possível verificar se o pm2 está instalado.';
  let result: ReturnType<typeof spawnSync>;
  try {
    result = spawnSync(command, args, { stdio: 'ignore', windowsHide: true });
  } catch {
    throw new Error(message);
  }
  if (result.error || (result.status !== 0 && result.status !== 1)) {
    throw new Error(message);
  }
  return result.status === 0;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPm2Process(value: unknown): value is Pm2Process {
  if (!isRecord(value) || typeof value.name !== 'string' || !value.name ||
      typeof value.pm_id !== 'number' || !Number.isInteger(value.pm_id) || value.pm_id < 0 ||
      typeof value.pid !== 'number' || !Number.isInteger(value.pid) || value.pid < 0) return false;
  const env = value.pm2_env;
  const monit = value.monit;
  return isRecord(env) &&
    typeof env.status === 'string' && env.status.length > 0 &&
    typeof env.pm_exec_path === 'string' && env.pm_exec_path.length > 0 &&
    (env.pm_cwd === undefined || typeof env.pm_cwd === 'string') &&
    (env.MONKY_SERVE_HOST === undefined || typeof env.MONKY_SERVE_HOST === 'string') &&
    (env.env === undefined || (isRecord(env.env) &&
      (env.env.MONKY_SERVE_HOST === undefined || typeof env.env.MONKY_SERVE_HOST === 'string'))) &&
    [env.pm_uptime, env.restart_time].every((field) =>
      field === undefined || (typeof field === 'number' && Number.isFinite(field))) &&
    (monit === undefined || (isRecord(monit) && [monit.memory, monit.cpu].every((field) =>
      field === undefined || (typeof field === 'number' && Number.isFinite(field)))));
}

export function listPm2Processes(): Pm2Process[] {
  if (!isPm2Available()) return [];
  let result: ReturnType<typeof runSync>;
  try {
    result = runSync('pm2', ['jlist'], { encoding: 'utf8' });
  } catch {
    throw new Error('Falha ao consultar os processos do pm2 (jlist).');
  }
  if (result.error || result.status !== 0) {
    throw new Error(`Falha ao consultar os processos do pm2 (jlist, status ${result.status ?? 'indisponível'}).`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error('A resposta do pm2 (jlist) contém JSON inválido.');
  }
  if (!Array.isArray(parsed) || !parsed.every(isPm2Process)) {
    throw new Error('A resposta do pm2 (jlist) tem estrutura inválida.');
  }
  return parsed;
}

export function findBotProcess(): Pm2Process | null {
  const matches = listPm2Processes().filter((p) => p.name === PM2_PROCESS_NAME);
  if (matches.length > 1) {
    throw new Error(`Há mais de um processo pm2 chamado ${PM2_PROCESS_NAME}; não é seguro escolher um deles. Nenhum processo foi alterado.`);
  }
  return matches[0] ?? null;
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

export function generateEcosystem(config: BotConfig, manifestHost = getManifestBindHost()): string {
  const entryPath = forSingleQuotes(getBotEntryPath(config.botDir));
  const cwd = forSingleQuotes(config.botDir);

  const env: Record<string, string> = {
    NODE_ENV: 'production',
    MONKY_SERVE: String(config.mode === 'marketplace'),
  };
  if (config.botName) env.MONKY_BOT_NAME = config.botName;
  if (config.mode === 'manual') {
    if (config.serverUrl) env.MONKY_SERVER_URL = config.serverUrl;
    if (config.botToken) env.MONKY_BOT_TOKEN = config.botToken;
  } else {
    env.MONKY_SERVE_PORT = String(config.servePort ?? DEFAULT_MANIFEST_PORT);
    env.MONKY_SERVE_HOST = manifestHost;
    if (config.publicHost) env.MONKY_SERVE_PUBLIC_HOST = config.publicHost;
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

export function writeEcosystem(config: BotConfig, manifestHost = getManifestBindHost()): string {
  // Ensure botDir exists (it's the cwd for the process — .keys/ go there)
  try {
    fs.mkdirSync(config.botDir, { recursive: true });
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EACCES') {
      throw new Error(
        `Sem permissão para criar "${config.botDir}".\n` +
        `Escolha um diretório dentro do seu home, ex:\n` +
        `  monkybot config set botDir ~/.monkybot\n` +
        `Ou execute: monkybot setup`
      );
    }
    throw err;
  }
  // Ecosystem lives in ~/.monkybot/, not botDir
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const ecosystemPath = getEcosystemPath();
  fs.writeFileSync(ecosystemPath, generateEcosystem(config, manifestHost), 'utf8');
  return ecosystemPath;
}
