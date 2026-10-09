import fs from 'node:fs';
import path from 'node:path';
import { normalizeBotLocale, resolveBotLocale, type BotLocale } from '@monky/bot-sdk';
import { BOT_CONFIG_DIR } from './utils/paths';

/** Operator language for runtime logs. Each user's command language comes from the client. */
export type CliLocale = BotLocale;

let currentLocale: CliLocale | undefined;

export function parseCliLocale(value: unknown): CliLocale | undefined {
  return normalizeBotLocale(value);
}

export function normalizeCliLocale(value: unknown): CliLocale {
  return resolveBotLocale(value);
}

function environmentLocale(): CliLocale | undefined {
  return parseCliLocale(process.env.MONKY_BOT_LOCALE) ?? parseCliLocale(process.env.MONKY_LANG) ??
    parseCliLocale(process.env.MONKYBOT_LOCALE);
}

// Direct runs (npm start/dev) reuse the language saved by the SDK CLI in ~/.monkybot.
function savedLocale(): CliLocale | undefined {
  try {
    const file = path.join(BOT_CONFIG_DIR, 'preferences.json');
    if (fs.statSync(file).size > 1024) return undefined;
    const preferences: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return typeof preferences === 'object' && preferences !== null && 'locale' in preferences
      ? parseCliLocale(preferences.locale) : undefined;
  } catch {
    return undefined;
  }
}

export function getCliLocale(): CliLocale {
  return currentLocale ??= environmentLocale() ?? savedLocale() ??
    normalizeCliLocale(process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG);
}

export function setCliLocale(locale: CliLocale): void {
  currentLocale = locale;
}

export function cliText(ptBR: string, en: string): string {
  return getCliLocale() === 'en' ? en : ptBR;
}
