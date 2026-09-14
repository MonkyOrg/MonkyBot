import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { safeDiagnostic } from '../music/process';
import { MusicError } from '../music/errors';
import { cliT } from './i18n';
import type { DownloadCallbacks } from './progress';

export type ToolRepository = 'yt-dlp/yt-dlp' | 'yt-dlp/FFmpeg-Builds';
export interface ToolAsset {
  name: string;
  url: string;
  size: number;
  sha256: string;
  version: string;
}

const MAX_DOWNLOAD = 350 * 1024 * 1024;
const HOSTS = new Set(['api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);

function approvedUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || !HOSTS.has(url.hostname)) {
    throw new Error(cliT('music.downloadOrigin'));
  }
  return url;
}

async function openResponse(value: string, signal: AbortSignal, redirects = 0): Promise<Response> {
  if (redirects > 5) throw new Error(cliT('music.downloadRedirects'));
  signal.throwIfAborted();
  const url = approvedUrl(value);
  const response = await fetch(url, {
    signal, redirect: 'manual',
    headers: { 'User-Agent': 'monkybot-music-setup', Accept: 'application/vnd.github+json' },
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    await response.body?.cancel();
    const location = response.headers.get('location');
    if (!location) throw new Error(cliT('music.downloadRedirectMissing'));
    return openResponse(new URL(location, url).href, signal, redirects + 1);
  }
  if (response.status !== 200 || !response.body) {
    await response.body?.cancel();
    throw new Error(cliT('music.downloadHttp', { status: response.status }));
  }
  return response;
}

async function readText(url: string, signal: AbortSignal, limit = 2 * 1024 * 1024): Promise<string> {
  const response = await openResponse(url, signal);
  if (!response.body) throw new Error(cliT('music.responseEmpty'));
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > limit) throw new Error(cliT('music.responseTooLarge'));
      chunks.push(Buffer.from(next.value));
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    try { await reader.cancel(); } finally { reader.releaseLock(); }
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function findToolAsset(repository: ToolRepository, name: string, signal: AbortSignal): Promise<ToolAsset> {
  const text = await readText(`https://api.github.com/repos/${repository}/releases/latest`, signal);
  const release: unknown = JSON.parse(text);
  if (!record(release) || release.draft !== false || release.prerelease !== false ||
      typeof release.tag_name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(release.tag_name) ||
      !Array.isArray(release.assets)) throw new Error(cliT('music.releaseInvalid'));
  const version = release.tag_name;
  const prefix = `https://github.com/${repository}/releases/download/${version}/`;
  const matches = release.assets.filter((asset: unknown) => record(asset) && asset.name === name);
  const asset: unknown = matches[0];
  if (matches.length !== 1 || !record(asset) || asset.browser_download_url !== `${prefix}${name}` ||
      typeof asset.size !== 'number' || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_DOWNLOAD) {
    throw new Error(cliT('music.assetInvalid', { name }));
  }
  let sha256 = typeof asset.digest === 'string' && /^sha256:[a-f0-9]{64}$/.test(asset.digest)
    ? asset.digest.slice(7) : undefined;
  if (!sha256) {
    const checksumName = repository === 'yt-dlp/yt-dlp' ? 'SHA2-256SUMS' : 'checksums.sha256';
    const checksums = release.assets.filter((entry: unknown) => record(entry) &&
      entry.name === checksumName && entry.browser_download_url === `${prefix}${checksumName}`);
    if (checksums.length !== 1) throw new Error(cliT('music.checksumMissing'));
    const manifest = await readText(`${prefix}${checksumName}`, signal, 1024 * 1024);
    const digests = manifest.split(/\r?\n/).map((line) => /^([a-f0-9]{64})\s+\*?(.+)$/.exec(line))
      .filter((entry) => entry?.[2] === name);
    if (digests.length !== 1 || !digests[0]) throw new Error(cliT('music.checksumAmbiguous', { name }));
    sha256 = digests[0][1];
  }
  return { name, url: `${prefix}${name}`, size: asset.size, sha256, version };
}

export async function downloadToolAsset(
  asset: ToolAsset, destination: string, signal: AbortSignal, callbacks: DownloadCallbacks = {},
): Promise<void> {
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_DOWNLOAD || !/^[a-f0-9]{64}$/.test(asset.sha256)) {
    throw new Error(cliT('music.metadataInvalid'));
  }
  signal.throwIfAborted();
  const output = await fs.open(destination, 'wx', 0o600);
  const digest = createHash('sha256');
  let bytes = 0;
  try {
    const response = await openResponse(asset.url, signal);
    if (!response.body) throw new Error(cliT('music.downloadEmpty'));
    const reader = response.body.getReader();
    const cancel = (): void => { void reader.cancel(signal.reason).catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      callbacks.onProgress?.({ receivedBytes: 0, totalBytes: asset.size });
      while (true) {
        signal.throwIfAborted();
        const next = await reader.read();
        signal.throwIfAborted();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > asset.size) throw new Error(cliT('music.downloadTooLarge'));
        digest.update(next.value);
        let offset = 0;
        while (offset < next.value.byteLength) {
          signal.throwIfAborted();
          const written = await output.write(next.value, offset, next.value.byteLength - offset);
          if (!written.bytesWritten) throw new Error(cliT('music.downloadWriteFailed'));
          offset += written.bytesWritten;
        }
        callbacks.onProgress?.({ receivedBytes: bytes, totalBytes: asset.size });
      }
    } finally {
      signal.removeEventListener('abort', cancel);
      try { await reader.cancel(); } finally { reader.releaseLock(); }
    }
    signal.throwIfAborted();
    callbacks.onProgress?.({ receivedBytes: bytes, totalBytes: asset.size, done: true });
    signal.throwIfAborted();
    callbacks.onVerify?.();
    signal.throwIfAborted();
    if (bytes !== asset.size || digest.digest('hex') !== asset.sha256) {
      throw new Error(cliT('music.downloadMismatch'));
    }
    await output.sync();
  } finally {
    await output.close();
  }
  signal.throwIfAborted();
}

export function ffmpegArchiveEntry(archiveName: string): string {
  // Official builds use the asset basename as their root directory. Listing an
  // xz archive first would decompress it twice and impose a separate timeout.
  const linux = /^(ffmpeg-master-latest-linux(?:64|arm64)-gpl)\.tar\.xz$/.exec(archiveName);
  if (linux && linux[0] === archiveName) return `${linux[1]}/bin/ffmpeg`;
  const windows = /^(ffmpeg-master-latest-win(?:32|64|arm64)-gpl)\.zip$/.exec(archiveName);
  if (windows && windows[0] === archiveName) return `${windows[1]}/bin/ffmpeg.exe`;
  throw new Error(cliT('music.archiveUnsupported'));
}

export function toolDownloadError(error: unknown): Error {
  return new Error(cliT('music.failed', { reason: safeDiagnostic(
    error instanceof MusicError ? error.detail || error.message : error instanceof Error ? error.message : String(error),
  ) }), { cause: error });
}
