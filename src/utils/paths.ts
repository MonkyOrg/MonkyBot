import os from 'node:os';
import path from 'node:path';

export const BOT_CONFIG_DIR = path.join(os.homedir(), '.monkybot');
export const MUSIC_TOOLS_DIR = path.join(BOT_CONFIG_DIR, 'tools');
