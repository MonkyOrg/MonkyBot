import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cliT } from './i18n';
import { GITHUB_REPO, parseVersion, type ReleaseInfo } from './updateReleases';
import type { DownloadCallbacks } from './progress';

const MAX_DOWNLOAD = 350 * 1024 * 1024;
const HOSTS = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);

function approvedUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || !HOSTS.has(url.hostname)) {
    throw new Error(cliT('update.downloadOrigin'));
  }
  return url;
}

async function openResponse(value: string, signal: AbortSignal, redirects = 0): Promise<Response> {
  if (redirects > 5) throw new Error(cliT('update.downloadRedirects'));
  signal.throwIfAborted();
  const url = approvedUrl(value);
  const response = await fetch(url, {
    signal, redirect: 'manual',
    headers: { 'User-Agent': 'monkybot-cli', Accept: 'application/octet-stream', 'Accept-Encoding': 'identity' },
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    await response.body?.cancel();
    const location = response.headers.get('location');
    if (!location) throw new Error(cliT('update.downloadRedirectMissing'));
    return openResponse(new URL(location, url).href, signal, redirects + 1);
  }
  if (response.status !== 200 || !response.body) {
    await response.body?.cancel();
    throw new Error(cliT('update.downloadFailed', { status: response.status }));
  }
  return response;
}

export async function downloadUpdate(
  asset: ReleaseInfo, destination: string, signal: AbortSignal, callbacks: DownloadCallbacks = {},
): Promise<void> {
  const name = `monky-bot-${asset.version}.tgz`;
  if (!parseVersion(asset.version) || ![asset.version, `v${asset.version}`].some(tag =>
    asset.tgzUrl === `https://github.com/${GITHUB_REPO}/releases/download/${tag}/${name}`)) {
    throw new Error(cliT('update.downloadOrigin'));
  }
  if ((asset.size !== undefined && (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_DOWNLOAD)) ||
      (asset.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(asset.sha256))) {
    throw new Error(cliT('update.downloadMetadataInvalid'));
  }
  signal.throwIfAborted();
  const output = await fs.open(destination, 'wx', 0o600);
  try {
    const response = await openResponse(asset.tgzUrl, signal);
    if (!response.body) throw new Error(cliT('update.downloadEmpty'));
    const reader = response.body.getReader();
    const cancel = (): void => { void reader.cancel(signal.reason).catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    let receivedBytes = 0;
    let totalBytes = asset.size;
    const digest = createHash('sha256');
    try {
      const length = response.headers.get('content-length');
      const encoding = response.headers.get('content-encoding');
      if (encoding && encoding !== 'identity') throw new Error(cliT('update.downloadMetadataInvalid'));
      if (length !== null) {
        const size = Number(length);
        if (!/^[1-9]\d*$/.test(length) || !Number.isSafeInteger(size) || size > MAX_DOWNLOAD) {
          throw new Error(cliT('update.downloadSize'));
        }
        if (totalBytes !== undefined && size !== totalBytes) throw new Error(cliT('update.downloadMismatch'));
        totalBytes ??= size;
      }
      callbacks.onProgress?.({ receivedBytes, totalBytes });
      while (true) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        signal.throwIfAborted();
        if (chunk.done) break;
        receivedBytes += chunk.value.byteLength;
        if (receivedBytes > (totalBytes ?? MAX_DOWNLOAD)) throw new Error(cliT('update.downloadSize'));
        digest.update(chunk.value);
        let offset = 0;
        while (offset < chunk.value.byteLength) {
          signal.throwIfAborted();
          const written = await output.write(chunk.value, offset, chunk.value.byteLength - offset);
          if (!written.bytesWritten) throw new Error(cliT('update.downloadWriteFailed'));
          offset += written.bytesWritten;
        }
        callbacks.onProgress?.({ receivedBytes, totalBytes });
      }
    } finally {
      signal.removeEventListener('abort', cancel);
      try { await reader.cancel(); } finally { reader.releaseLock(); }
    }
    signal.throwIfAborted();
    callbacks.onProgress?.({ receivedBytes, totalBytes, done: true });
    signal.throwIfAborted();
    callbacks.onVerify?.();
    signal.throwIfAborted();
    if (!receivedBytes || (totalBytes !== undefined && receivedBytes !== totalBytes) ||
        (asset.sha256 !== undefined && digest.digest('hex') !== asset.sha256)) {
      throw new Error(cliT('update.downloadMismatch'));
    }
    await output.sync();
  } finally {
    await output.close();
  }
  signal.throwIfAborted();
}
