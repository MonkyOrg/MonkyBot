import fs from 'fs';
import path from 'path';
import {
  LIMITS, validateBotName, validateBotToken, validateBotPublicHost, validateBotServerUrl, validateBotServePort,
} from '@monky/bot-sdk';
import { CONFIG_DIR, CONFIG_FILE } from './constants';
import { cliText } from './i18n';

export interface BotConfig {
  /** Modo: 'manual' (um servidor) ou 'marketplace' (serve manifest). */
  mode: 'manual' | 'marketplace';

  /** Nome sincronizado com o perfil do bot em ambos os modos. */
  botName?: string;

  // ── Modo manual ──
  serverUrl?: string;
  botToken?: string;

  // ── Modo marketplace ──
  servePort?: number;
  publicHost?: string;

  /** Diretório de trabalho do bot (onde ficam as chaves .keys/ e dados). */
  botDir: string;
}

function localizedValidation<T>(validate: () => T, portuguese: string, english: string): T {
  try { return validate(); }
  catch (error: unknown) { throw new Error(cliText(portuguese, english), { cause: error }); }
}

export function validateCliBotName(value: unknown): string {
  return localizedValidation(() => validateBotName(value),
    `O nome do bot deve conter de ${LIMITS.MIN_NICKNAME_LENGTH} a ${LIMITS.MAX_NICKNAME_LENGTH} caracteres, sem espaços nas pontas.`,
    `The bot name must contain ${LIMITS.MIN_NICKNAME_LENGTH}–${LIMITS.MAX_NICKNAME_LENGTH} characters, without surrounding whitespace.`);
}

export function validateCliBotToken(value: unknown): string {
  return localizedValidation(() => validateBotToken(value),
    'O token do bot é obrigatório: até 2048 caracteres, sem espaços nas pontas.',
    'A bot token is required: up to 2048 characters, without surrounding whitespace.');
}

export function validateCliServerUrl(value: unknown): string {
  return localizedValidation(() => validateBotServerUrl(value),
    'A URL do servidor deve usar ws:// ou wss://, sem credenciais embutidas.',
    'The server URL must use ws:// or wss://, without embedded credentials.');
}

export function validateCliPublicHost(value: unknown): string {
  return localizedValidation(() => validateBotPublicHost(value),
    'O host público deve ser um domínio ou IP, sem protocolo nem porta.',
    'The public host must be a hostname or IP without a scheme or port.');
}

export function validateCliServePort(value: unknown): number {
  return localizedValidation(() => validateBotServePort(value),
    'A porta do manifest deve ser um inteiro entre 1 e 65535.',
    'The serve port must be an integer between 1 and 65535.');
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
