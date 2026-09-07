import fs from 'fs';
import path from 'path';
import { CONFIG_DIR, CONFIG_FILE } from './constants';

export interface BotConfig {
  /** Modo: 'manual' (um servidor) ou 'marketplace' (serve manifest). */
  mode: 'manual' | 'marketplace';

  // ── Modo manual ──
  serverUrl?: string;
  botToken?: string;

  // ── Modo marketplace ──
  servePort?: number;
  publicHost?: string;
  botName?: string;

  /** Diretório de trabalho do bot (onde ficam as chaves .keys/ e dados). */
  botDir: string;
}

export function configExists(): boolean {
  return fs.existsSync(CONFIG_FILE);
}

export function readConfig(): BotConfig | null {
  if (!fs.existsSync(CONFIG_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return null;
  }
}

export function writeConfig(config: BotConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

export function deleteConfig(): void {
  if (fs.existsSync(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE);
}

/**
 * Returns the path to the bot entry script (dist/index.js).
 *
 * When installed globally via tgz, the compiled code lives inside the
 * npm package itself (next to cli.js). When running from a git clone,
 * it's in the botDir's dist/ folder. We check both locations.
 */
export function getBotEntryPath(botDir: string): string {
  // 1. Package-relative: dist/index.js next to dist/cli.js (global install)
  const packageEntry = path.resolve(__dirname, '..', 'index.js');
  if (fs.existsSync(packageEntry)) return packageEntry;

  // 2. botDir-relative: for git clone setups
  return path.join(botDir, 'dist', 'index.js');
}
