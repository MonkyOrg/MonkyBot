import { createPublicKey } from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { setTimeout as delay } from 'timers/promises';
import { BOT_CAPABILITIES, LIMITS, type BotManifest } from '@monky/bot-sdk';
import { BotConfig } from './config';
import { DEFAULT_MANIFEST_PORT } from './manifestPort';
import { cliText } from './i18n';
import { DEFAULT_BOT_NAME } from '../profile';
import { getManifestUrl, MANIFEST_PUBLIC_KEY_HEADER } from '../utils/manifest';

const REQUEST_TIMEOUT_MS = 1500;
const STARTUP_TIMEOUT_MS = 10000;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;

export class ManifestReadinessError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message);
    this.name = 'ManifestReadinessError';
  }
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error &&
    typeof error.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(error.code) ? error.code : 'UNKNOWN';
}

function publicIdentity(botDir: string): string {
  const file = path.join(botDir, '.keys', 'public.hex');
  let key: string;
  try {
    key = fs.readFileSync(file, 'utf8').trim();
  } catch (error: unknown) {
    const code = errorCode(error);
    throw new ManifestReadinessError(cliText(
      `Não foi possível ler a identidade pública em ${file} (${code}).`,
      `Could not read the public identity at ${file} (${code}).`), code === 'ENOENT');
  }
  try {
    if (!/^[a-f0-9]{88}$/i.test(key) ||
        createPublicKey({ key: Buffer.from(key, 'hex'), format: 'der', type: 'spki' }).asymmetricKeyType !== 'ed25519') {
      throw new Error('Invalid public identity');
    }
  } catch {
    throw new ManifestReadinessError(cliText(
      `A identidade pública em ${file} não é uma chave Ed25519 válida. As chaves não foram alteradas.`,
      `The public identity at ${file} is not a valid Ed25519 key. No keys were changed.`));
  }
  return key.toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}

// BotManifest is public SDK API; its schema is not exported by the SDK.
function isManifest(value: unknown): value is BotManifest {
  if (!isRecord(value) ||
      !Object.keys(value).every((key) =>
        ['name', 'description', 'icon', 'commands', 'registrationUrl', 'requestedCapabilities'].includes(key)) ||
      !text(value.name, LIMITS.MIN_NICKNAME_LENGTH, LIMITS.MAX_NICKNAME_LENGTH) ||
      value.name !== value.name.trim() ||
      !text(value.registrationUrl, 1, 2048) ||
      (value.description !== undefined && !text(value.description, 0, 500)) ||
      (value.icon !== undefined && !text(value.icon, 1, Math.ceil(LIMITS.MAX_AVATAR_SIZE * 4 / 3) + 256)) ||
      !Array.isArray(value.requestedCapabilities) ||
      !value.requestedCapabilities.every((capability: unknown) => BOT_CAPABILITIES.some((known) => known === capability)) ||
      new Set(value.requestedCapabilities).size !== value.requestedCapabilities.length) return false;
  if (value.commands === undefined) return true;
  return Array.isArray(value.commands) && value.commands.length <= LIMITS.MAX_COMMANDS_PER_BOT &&
    (!value.commands.length || value.requestedCapabilities.includes('commands')) &&
    value.commands.every((command: unknown) => isRecord(command) &&
      Object.keys(command).every((key) => key === 'name' || key === 'description') &&
      typeof command.name === 'string' && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(command.name) &&
      text(command.description, 1, 100) && command.description.trim().length > 0);
}

function localHost(bindHost: string): string {
  const host = bindHost.startsWith('[') && bindHost.endsWith(']') ? bindHost.slice(1, -1) : bindHost;
  if (host === '0.0.0.0') return '127.0.0.1';
  if (host.includes(':') && new URL(`http://[${host}]`).hostname === '[::]') return '::1';
  return host;
}

export async function verifyManifest(
  config: BotConfig, bindHost: string, timeoutMs = REQUEST_TIMEOUT_MS
): Promise<string> {
  const url = getManifestUrl(config.publicHost, config.servePort ?? DEFAULT_MANIFEST_PORT);
  const key = publicIdentity(config.botDir);
  const host = localHost(bindHost);
  const port = config.servePort ?? DEFAULT_MANIFEST_PORT;
  const endpoint = `${host}:${port}`;
  const failure = (ptBR: string, en: string, retryable = false): ManifestReadinessError =>
    new ManifestReadinessError(cliText(`Manifest local em ${endpoint}: ${ptBR}`, `Local manifest at ${endpoint}: ${en}`), retryable);

  await new Promise<void>((resolve, reject) => {
    let request: http.ClientRequest | undefined;
    let response: http.IncomingMessage | undefined;
    let finished = false;
    const finish = (error?: ManifestReadinessError): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      response?.destroy();
      request?.destroy();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => finish(failure(
      'tempo limite de resposta excedido.', 'response timed out.', true)), timeoutMs);
    try {
      request = http.get({
        hostname: host, port, path: '/manifest', agent: false,
        headers: { Accept: 'application/json' }, maxHeaderSize: 16 * 1024,
      }, (incoming) => {
        response = incoming;
        incoming.on('error', () => finish(failure('resposta interrompida.', 'response interrupted.', true)));
        incoming.on('aborted', () => finish(failure('resposta interrompida.', 'response interrupted.', true)));
        if (incoming.statusCode !== 200) {
          finish(failure(`resposta HTTP ${incoming.statusCode ?? 'inválida'}.`,
            `HTTP ${incoming.statusCode ?? 'invalid'} response.`, incoming.statusCode === 503));
          return;
        }
        if (incoming.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
          finish(failure('o serviço não retornou um manifest JSON.', 'the service did not return a JSON manifest.'));
          return;
        }
        const servedKey = incoming.headers[MANIFEST_PUBLIC_KEY_HEADER];
        if (typeof servedKey !== 'string' || servedKey.toLowerCase() !== key) {
          finish(failure('a identidade pública do serviço não corresponde a este bot.',
            'the service public identity does not match this bot.'));
          return;
        }
        const tooLarge = (): ManifestReadinessError =>
          failure('a resposta excede o limite de 8 MiB.', 'the response exceeds the 8 MiB limit.');
        if (Number(incoming.headers['content-length']) > MAX_MANIFEST_BYTES) {
          finish(tooLarge());
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        incoming.on('data', (chunk: Buffer) => {
          if (finished) return;
          size += chunk.length;
          if (size > MAX_MANIFEST_BYTES) finish(tooLarge());
          else chunks.push(chunk);
        });
        incoming.on('end', () => {
          if (finished) return;
          let manifest: unknown;
          try {
            manifest = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            finish(failure('a resposta contém JSON inválido.', 'the response contains invalid JSON.'));
            return;
          }
          if (!isManifest(manifest)) {
            finish(failure('o JSON não atende ao contrato do manifest do SDK.',
              'the JSON does not satisfy the SDK manifest contract.'));
            return;
          }
          if (manifest.name !== (config.botName || DEFAULT_BOT_NAME)) {
            finish(failure('o nome do bot não corresponde à configuração atual.',
              'the bot name does not match the current configuration.'));
            return;
          }
          let registrationUrl: string;
          try {
            registrationUrl = new URL(manifest.registrationUrl).href;
          } catch {
            finish(failure('a URL de registro é inválida.', 'the registration URL is invalid.'));
            return;
          }
          if (registrationUrl !== new URL('register', url).href) {
            finish(failure('a URL de registro não corresponde ao host e à porta configurados.',
              'the registration URL does not match the configured host and port.'));
            return;
          }
          finish();
        });
      });
      request.on('error', (error: Error) => finish(failure(
        `não foi possível acessar o serviço (${errorCode(error)}).`,
        `could not reach the service (${errorCode(error)}).`, true)));
    } catch {
      finish(failure('não foi possível consultar o endereço de escuta.', 'could not query the listening address.'));
    }
  });
  return url;
}

export async function waitForManifest(
  config: BotConfig, bindHost: string, timeoutMs = STARTUP_TIMEOUT_MS
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      return await verifyManifest(config, bindHost, Math.max(1, Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now())));
    } catch (error: unknown) {
      if (!(error instanceof ManifestReadinessError) || !error.retryable) throw error;
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new ManifestReadinessError(cliText(
          `O manifest não ficou pronto localmente no prazo. Consulte monkybot logs. ${error.message}`,
          `The manifest did not become locally ready in time. Check monkybot logs. ${error.message}`));
      }
      await delay(Math.min(200, remaining));
    }
  }
}
