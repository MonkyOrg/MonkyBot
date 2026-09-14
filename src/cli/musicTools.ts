import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import readline from 'node:readline';
import { MUSIC_TOOLS_DIR } from '../utils/paths';
import { MusicToolError, MUSIC_TOOL_NAMES, checkMusicTool, checkMusicTools } from '../music/toolChecks';
import { absoluteMusicToolPaths, managedMusicTool, musicToolPaths, MUSIC_TOOL_ENV, type MusicToolPaths } from '../music/toolPaths';
import { capture, safeDiagnostic, terminate } from '../music/process';
import { MusicError } from '../music/errors';
import { downloadToolAsset, ffmpegArchiveEntry, findToolAsset, toolDownloadError } from './musicToolDownload';
import { cliT, cliText } from './i18n';
import { createDownloadProgress, type DownloadProgress } from './progress';

export interface MusicPreparationOptions {
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  directory?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  progress?: (message: string) => void;
  downloadProgress?: (tool: 'ytDlp' | 'ffmpeg', progress: DownloadProgress) => void;
  approveSystemInstall?: (message: string, signal: AbortSignal) => Promise<boolean>;
}

export function mediaAssetName(tool: 'ytDlp' | 'ffmpeg', platform: NodeJS.Platform, arch: string): string {
  if (tool === 'ytDlp') {
    if (platform === 'win32' && arch === 'x64') return 'yt-dlp.exe';
    if (platform === 'win32' && arch === 'arm64') return 'yt-dlp_arm64.exe';
    if (platform === 'win32' && arch === 'ia32') return 'yt-dlp_x86.exe';
    if (platform === 'darwin' && ['x64', 'arm64'].includes(arch)) return 'yt-dlp_macos';
    if (platform === 'linux' && arch === 'x64') return 'yt-dlp_linux';
    if (platform === 'linux' && arch === 'arm64') return 'yt-dlp_linux_aarch64';
  } else {
    if (platform === 'win32' && arch === 'x64') return 'ffmpeg-master-latest-win64-gpl.zip';
    if (platform === 'win32' && arch === 'arm64') return 'ffmpeg-master-latest-winarm64-gpl.zip';
    if (platform === 'win32' && arch === 'ia32') return 'ffmpeg-master-latest-win32-gpl.zip';
    if (platform === 'linux' && arch === 'x64') return 'ffmpeg-master-latest-linux64-gpl.tar.xz';
    if (platform === 'linux' && arch === 'arm64') return 'ffmpeg-master-latest-linuxarm64-gpl.tar.xz';
  }
  throw new Error(cliT('music.unsupported', { tool: MUSIC_TOOL_NAMES[tool], platform, arch, variable: MUSIC_TOOL_ENV[tool] }));
}

async function extractFfmpeg(archive: string, destination: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const entry = ffmpegArchiveEntry(path.basename(archive));
  const child = spawn('tar', ['-xOf', archive, '--', entry], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let diagnostic = '';
  child.stderr.on('data', (chunk: Buffer) => { diagnostic = (diagnostic + chunk.toString()).slice(0, 4096); });
  const closed = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() :
      reject(new Error(cliT('music.extractFailed', { reason: safeDiagnostic(diagnostic || `status ${code}`) }))));
  });
  let bytes = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      bytes += chunk.length;
      done(bytes > 350 * 1024 * 1024 ? new Error(cliT('music.executableTooLarge')) : null, chunk);
    },
  });
  const output = createWriteStream(destination, { flags: 'wx', mode: 0o600 });
  const extracted = pipeline(child.stdout, limit, output, { signal });
  try {
    await Promise.all([closed, extracted]);
    if (!bytes) throw new Error(cliT('music.executableMissing'));
  } finally {
    child.stdout.destroy();
    child.stderr.destroy();
    output.destroy();
    await terminate(child);
    await Promise.allSettled([closed, extracted]);
  }
}

async function installMacFfmpeg(options: MusicPreparationOptions, directory: string, signal: AbortSignal): Promise<string> {
  try {
    await capture('brew', ['--version'], signal, 5000, 65536);
  } catch (error: unknown) {
    if (!(error instanceof MusicError) || error.code !== 'tools') throw error;
    throw new Error(cliT('music.brewRequired'), { cause: error });
  }
  if (!options.approveSystemInstall || !await options.approveSystemInstall(
    cliT('music.brewConfirm'), signal,
  )) throw new Error(cliT('music.brewDeclined'));
  options.progress?.(cliT('music.brewInstalling'));
  await capture('brew', ['install', 'ffmpeg'], signal, 10 * 60_000, 2 * 1024 * 1024);
  const prefix = (await capture('brew', ['--prefix', 'ffmpeg'], signal, 5000, 65536)).trim();
  if (!path.isAbsolute(prefix) || /[\r\n\0]/.test(prefix)) throw new Error(cliT('music.brewPrefixInvalid'));
  const executable = path.join(prefix, 'bin', 'ffmpeg');
  await checkMusicTool('ffmpeg', { ...musicToolPaths(options.env, directory, 'darwin'), ffmpeg: executable }, signal);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const staging = await fs.mkdtemp(path.join(directory, '.install-'));
  const target = managedMusicTool('ffmpeg', directory, 'darwin');
  try {
    const link = path.join(staging, 'ffmpeg');
    await fs.symlink(executable, link);
    signal.throwIfAborted();
    await fs.rename(link, target);
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
  return target;
}

async function installTool(
  tool: 'ytDlp' | 'ffmpeg', paths: MusicToolPaths, options: MusicPreparationOptions,
  directory: string, platform: NodeJS.Platform, signal: AbortSignal,
): Promise<string> {
  if (tool === 'ffmpeg' && platform === 'darwin') return installMacFfmpeg(options, directory, signal);
  const name = mediaAssetName(tool, platform, options.arch ?? process.arch);
  if (platform === 'linux' && process.platform === 'linux') {
    const report = process.report.getReport();
    if (!('header' in report) || typeof report.header !== 'object' || !report.header ||
        !('glibcVersionRuntime' in report.header) || typeof report.header.glibcVersionRuntime !== 'string') {
      throw new Error(cliT('music.glibcRequired', { tool: MUSIC_TOOL_NAMES[tool], variable: MUSIC_TOOL_ENV[tool] }));
    }
  }
  if (tool === 'ffmpeg') {
    try {
      const tar = await capture('tar', ['--version'], signal, 5000, 65536);
      if (platform === 'linux' && tar.includes('GNU tar')) await capture('xz', ['--version'], signal, 5000, 65536);
    } catch (error: unknown) {
      if (!(error instanceof MusicError) || error.code !== 'tools') throw error;
      throw new Error(cliT('music.tarRequired', { reason: safeDiagnostic(error.detail ?? error.message) }), { cause: error });
    }
  }
  options.progress?.(cliT('music.downloading', { tool: MUSIC_TOOL_NAMES[tool] }));
  const repository = tool === 'ytDlp' ? 'yt-dlp/yt-dlp' : 'yt-dlp/FFmpeg-Builds';
  const asset = await findToolAsset(repository, name, signal);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const staging = await fs.mkdtemp(path.join(directory, '.install-'));
  try {
    const target = managedMusicTool(tool, directory, platform);
    const download = path.join(staging, tool === 'ytDlp' ? path.basename(target) : asset.name);
    await downloadToolAsset(asset, download, signal, {
      onProgress: (progress) => options.downloadProgress?.(tool, progress),
      onVerify: () => options.progress?.(cliT('music.verifyingDownload', { tool: MUSIC_TOOL_NAMES[tool] })),
    });
    const candidate = tool === 'ytDlp' ? download : path.join(staging, path.basename(target));
    if (tool === 'ffmpeg') {
      options.progress?.(cliT('music.extracting'));
      await extractFfmpeg(download, candidate, signal);
    }
    await fs.chmod(candidate, 0o755);
    options.progress?.(cliT('music.verifyingExecutable', { tool: MUSIC_TOOL_NAMES[tool] }));
    await checkMusicTool(tool, { ...paths, [tool]: candidate }, signal);
    signal.throwIfAborted();
    await fs.rename(candidate, target);
    options.progress?.(cliT('music.installed', { tool: MUSIC_TOOL_NAMES[tool], version: asset.version }));
    return target;
  } finally {
    await fs.rm(staging, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

export async function ensureMusicTools(options: MusicPreparationOptions = {}): Promise<MusicToolPaths> {
  const directory = options.directory ?? MUSIC_TOOLS_DIR;
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const paths = absoluteMusicToolPaths(musicToolPaths(env, directory, platform), env, platform);
  const controller = new AbortController();
  const cancel = (): void => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const timeout = setTimeout(() => controller.abort(new Error(cliT('music.timeout'))), 10 * 60_000);
  try {
    await checkMusicTool('node', paths, controller.signal);
    for (const tool of ['ytDlp', 'ffmpeg'] as const) {
      try {
        await checkMusicTool(tool, paths, controller.signal);
        options.progress?.(cliT('music.available', { tool: MUSIC_TOOL_NAMES[tool] }));
      } catch (error: unknown) {
        if (!(error instanceof MusicToolError) || error.code !== 'tools') throw error;
        if (env[MUSIC_TOOL_ENV[tool]]) {
          throw new Error(cliT('music.overrideInvalid', { reason: error.detail ?? error.message, variable: MUSIC_TOOL_ENV[tool] }));
        }
        paths[tool] = await installTool(tool, paths, options, directory, platform, controller.signal);
      }
    }
    await checkMusicTools(paths, controller.signal);
    return paths;
  } catch (error: unknown) {
    throw toolDownloadError(controller.signal.aborted ? controller.signal.reason : error);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', cancel);
  }
}

export async function checkMusicToolsCommand(): Promise<void> {
  const paths = musicToolPaths();
  let failed = false;
  const controller = new AbortController();
  for (const tool of ['node', 'ytDlp', 'ffmpeg'] as const) {
    try {
      const version = await checkMusicTool(tool, paths, controller.signal);
      console.log(`OK ${MUSIC_TOOL_NAMES[tool]}: ${paths[tool]} (${version})`);
    } catch (error: unknown) {
      failed = true;
      console.error(error instanceof MusicToolError ? error.detail : safeDiagnostic(String(error)));
    }
  }
  if (failed) throw new Error(cliT('music.unavailable'));
  console.log(cliT('music.ready'));
}

function approveSystemInstall(message: string, signal: AbortSignal): Promise<boolean> {
  if (!process.stdin.isTTY) return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, historySize: 0 });
    let answered = false;
    const cancel = (): void => { rl.close(); };
    signal.addEventListener('abort', cancel, { once: true });
    rl.once('close', () => {
      signal.removeEventListener('abort', cancel);
      if (!answered) reject(new Error(cliT('music.cancelled')));
    });
    rl.question(`${message} ${cliText('[s/N]', '[y/N]')}: `, (answer) => {
      answered = true;
      rl.close();
      resolve(/^(?:s|sim|y|yes)$/i.test(answer.trim()));
    });
    if (signal.aborted) cancel();
  });
}

export async function prepareMusicToolsForCli(options: {
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  approveSystemInstall?: (message: string, signal: AbortSignal) => Promise<boolean>;
} = {}): Promise<MusicToolPaths> {
  const controller = new AbortController();
  const stop = (): void => controller.abort(new Error(cliT('music.cancelled')));
  const cancel = (): void => controller.abort(options.signal?.reason);
  process.once('SIGINT', stop);
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  let download: ReturnType<typeof createDownloadProgress> | undefined;
  try {
    return await ensureMusicTools({
      signal: controller.signal,
      env: options.env,
      progress: (message) => {
        download?.finish();
        download = undefined;
        console.log(message);
      },
      downloadProgress: (tool, progress) => {
        download ??= createDownloadProgress(cliT('music.downloadLabel', { tool: MUSIC_TOOL_NAMES[tool] }));
        download.update(progress);
      },
      approveSystemInstall: options.approveSystemInstall ?? approveSystemInstall,
    });
  } finally {
    download?.finish();
    process.off('SIGINT', stop);
    options.signal?.removeEventListener('abort', cancel);
  }
}
