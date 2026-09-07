import path from 'path';
import os from 'os';

export const APP_NAME = 'monkybot';
export const PM2_PROCESS_NAME = 'monkybot';

export const CONFIG_DIR = path.join(os.homedir(), '.monkybot');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export const ANSI = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
};

export function color(text: string, code: string): string {
  return `${code}${text}${ANSI.reset}`;
}
