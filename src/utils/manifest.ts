import type { IncomingMessage, Server, ServerResponse } from 'http';
import { validateCliPublicHost as validateBotPublicHost, validateCliServePort as validateBotServePort } from '../cli/config';
import { cliText } from '../cli/i18n';

export const MANIFEST_PUBLIC_KEY_HEADER = 'x-monky-bot-public-key';

export function identifyManifest(server: Server, publicKey: string): void {
  if (!/^[a-f0-9]{88}$/i.test(publicKey)) {
    throw new Error(cliText('A identidade pública do manifest é inválida.', 'The manifest public identity is invalid.'));
  }
  // The SDK's strict JSON manifest has no identity field. Keep its contract unchanged.
  const identify = (request: IncomingMessage, response: ServerResponse): void => {
    if (request.method === 'GET' && request.url === '/manifest') {
      response.setHeader(MANIFEST_PUBLIC_KEY_HEADER, publicKey);
    }
  };
  server.prependListener('request', identify);
  server.once('close', () => server.off('request', identify));
}

export function getManifestUrl(publicHost: unknown, servePort: unknown): string {
  const host = validateBotPublicHost(publicHost);
  const port = validateBotServePort(servePort);
  const urlHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `http://${urlHost}:${port}/manifest`;
}
