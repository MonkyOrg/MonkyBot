import {
  ManagedToolDownloadError,
  downloadManagedToolAsset,
  findManagedToolAsset,
  managedFfmpegArchiveEntry,
  type ManagedToolAsset,
} from '@monky/bot-sdk';
import { safeDiagnostic } from '../music/process';
import { MusicError, musicError } from '../music/errors';
import { cliT, getCliLocale } from './i18n';
import type { DownloadCallbacks } from './progress';

export type ToolRepository = 'yt-dlp/yt-dlp' | 'yt-dlp/FFmpeg-Builds';
export type ToolAsset = ManagedToolAsset;

function localizedDownloadError(error: unknown): never {
  if (error instanceof ManagedToolDownloadError) {
    throw new Error(cliT(`music.${error.code}`, error.parameters), { cause: error });
  }
  throw error;
}

export async function findToolAsset(repository: ToolRepository, name: string, signal: AbortSignal): Promise<ToolAsset> {
  try {
    return await findManagedToolAsset(repository, name, signal);
  } catch (error) {
    return localizedDownloadError(error);
  }
}

export async function downloadToolAsset(
  asset: ToolAsset, destination: string, signal: AbortSignal, callbacks: DownloadCallbacks = {},
): Promise<void> {
  try {
    await downloadManagedToolAsset(asset, destination, signal, callbacks);
  } catch (error) {
    localizedDownloadError(error);
  }
}

export function ffmpegArchiveEntry(archiveName: string): string {
  try {
    return managedFfmpegArchiveEntry(archiveName);
  } catch (error) {
    return localizedDownloadError(error);
  }
}

export function toolDownloadError(error: unknown): Error {
  return new Error(cliT('music.failed', { reason: safeDiagnostic(
    error instanceof MusicError ? `${musicError(error, getCliLocale())}${error.detail ? ` ${error.detail}` : ''}`
      : error instanceof Error ? error.message : String(error),
  ) }), { cause: error });
}
