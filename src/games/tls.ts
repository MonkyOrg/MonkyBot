import { X509Certificate, createPrivateKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createBotTls } from '@monky/bot-sdk';
import type { TlsMaterial } from './service';

export interface TlsSource {
  load: () => TlsMaterial;
  /** Host the certificate was issued for, when known (the machine's public IP). */
  host?: string;
}

/** Manual PEM files (`MONKY_GAMES_TLS_CERT` / `MONKY_GAMES_TLS_KEY`). */
export function fileTlsSource(certFile: string, keyFile: string): TlsSource {
  const load = (): TlsMaterial => {
    const cert = readFileSync(certFile, 'utf8');
    const key = readFileSync(keyFile, 'utf8');
    if (!new X509Certificate(cert).checkPrivateKey(createPrivateKey(key))) throw new Error('The TLS certificate does not match its private key.');
    return { cert, key };
  };
  load();
  return { load };
}

/**
 * Certificate shared on this machine by `monkybot tls enable` (or the Monky server's `monky tls enable`).
 * The SDK renews it and follows renewals made by other processes; `load` always returns the current one.
 */
export function sharedTlsSource(): TlsSource | undefined {
  const log = (message: string, meta?: unknown): void => console.warn(`[games] ${message}`, meta ?? '');
  const botTls = createBotTls({ log: { info: () => {}, warn: log, error: log } });
  botTls.start();
  const status = botTls.status();
  if (!status.enabled || !botTls.material()) return undefined;
  return {
    host: status.ip ?? undefined,
    load: () => {
      const material = botTls.material();
      if (!material) throw new Error('The shared TLS certificate is no longer available.');
      return material;
    },
  };
}

export function tlsSourceFromEnv(env: NodeJS.ProcessEnv): TlsSource | undefined {
  if (env.MONKY_GAMES_TLS_CERT && env.MONKY_GAMES_TLS_KEY) return fileTlsSource(env.MONKY_GAMES_TLS_CERT, env.MONKY_GAMES_TLS_KEY);
  return sharedTlsSource();
}
