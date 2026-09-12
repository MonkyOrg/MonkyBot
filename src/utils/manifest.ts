import { validateBotPublicHost, validateBotServePort } from '@monky/bot-sdk';

export function getManifestUrl(publicHost: unknown, servePort: unknown): string {
  const host = validateBotPublicHost(publicHost);
  const port = validateBotServePort(servePort);
  const urlHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `http://${urlHost}:${port}/manifest`;
}
