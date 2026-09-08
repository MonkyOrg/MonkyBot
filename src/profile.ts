import fs from 'fs';
import path from 'path';

export const DEFAULT_BOT_NAME = 'MonkyBot';

export function loadBotAvatar(): string {
  const logo = fs.readFileSync(path.resolve(__dirname, '..', 'assets', 'monky-logo.png'));
  return `data:image/png;base64,${logo.toString('base64')}`;
}
