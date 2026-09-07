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

  /** Diretório de trabalho do bot (onde estão os comandos e chaves). */
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
 * The bot must be built before starting.
 */
export function getBotEntryPath(botDir: string): string {
  return path.join(botDir, 'dist', 'index.js');
}
