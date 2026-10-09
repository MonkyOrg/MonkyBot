import { validateBotPublicHost, validateBotServePort } from '@monky/bot-sdk';
import { cliText } from '../i18n';

function localized<T>(validate: () => T, portuguese: string, english: string): T {
  try { return validate(); }
  catch (error: unknown) { throw new Error(cliText(portuguese, english), { cause: error }); }
}

export function getManifestUrl(publicHost: unknown, servePort: unknown): string {
  const host = localized(() => validateBotPublicHost(publicHost),
    'O host público deve ser um domínio ou IP, sem protocolo nem porta.',
    'The public host must be a hostname or IP without a scheme or port.');
  const port = localized(() => validateBotServePort(servePort),
    'A porta do manifest deve ser um inteiro entre 1 e 65535.',
    'The serve port must be an integer between 1 and 65535.');
  const urlHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `http://${urlHost}:${port}/manifest`;
}
