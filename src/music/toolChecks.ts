import { MusicError, aborted, type MusicErrorCode } from './errors';
import { capture, safeDiagnostic } from './process';
import type { MusicTool, MusicToolPaths } from './toolPaths';

export const MUSIC_TOOL_NAMES: Record<MusicTool, string> = { node: 'Node.js', ytDlp: 'yt-dlp', ffmpeg: 'FFmpeg/libopus' };

// Standalone yt-dlp unpacks on startup; native cold starts can exceed five seconds on busy hosts.
const CHECK_TIMEOUT_MS: Readonly<Record<MusicTool, number>> = { node: 5000, ytDlp: 30_000, ffmpeg: 15_000 };

export class MusicToolError extends MusicError {
  constructor(
    readonly tool: MusicTool, readonly executable: string, code: MusicErrorCode, detail: string,
  ) {
    super(code, `${MUSIC_TOOL_NAMES[tool]}: ${safeDiagnostic(detail)}`);
    this.name = 'MusicToolError';
  }
}

export function youtubeExtractorArgs(node: string): string[] {
  return [
    '--ignore-config', '--no-cache-dir', '--no-plugin-dirs',
    '--no-js-runtimes', '--js-runtimes', `node:${node}`, '--no-remote-components',
  ];
}

export async function checkMusicTool(
  tool: MusicTool, paths: MusicToolPaths, signal: AbortSignal, run: typeof capture = capture,
): Promise<string> {
  aborted(signal);
  const timeoutMs = CHECK_TIMEOUT_MS[tool];
  try {
    if (tool === 'node') {
      const version = (await run(paths.node, ['--version'], signal, timeoutMs, 65536)).trim();
      const major = version.length <= 128 ? /^v(\d+)\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.exec(version)?.[1] : undefined;
      if (!major) throw new MusicError('runtime', 'The executable did not return a valid Node.js version.');
      if (Number(major) < 22) throw new MusicError('runtime', `Node.js 22+ required; received ${version}.`);
      return version;
    }
    if (tool === 'ytDlp') {
      const version = (await run(paths.ytDlp, [...youtubeExtractorArgs(paths.node), '--version'], signal, timeoutMs, 65536)).trim();
      if (version.length > 128 || !/^\d{4}\.\d{2}\.\d{2}(?:[.+-][0-9A-Za-z.-]+)?$/.test(version)) {
        throw new MusicError('tools', 'The executable did not return a valid yt-dlp version.');
      }
      return version;
    }
    const encoders = await run(paths.ffmpeg, ['-hide_banner', '-encoders'], signal, timeoutMs, 131072);
    if (!/^\s*A[A-Z.]{5}\s+libopus(?:\s|$)/m.test(encoders)) {
      throw new MusicError('tools', 'The executable does not provide the libopus encoder.');
    }
    return 'libopus';
  } catch (error: unknown) {
    if (signal.aborted) throw new MusicError('cancelled');
    const original = error instanceof MusicError ? error : undefined;
    const code = original && ['busy', 'timeout', 'runtime', 'cancelled'].includes(original.code)
      ? original.code : tool === 'node' ? 'runtime' : 'tools';
    throw new MusicToolError(tool, paths[tool], code, original?.detail ||
      (code === 'timeout' ? `The executable check timed out (process limit: ${timeoutMs} ms).`
        : error instanceof Error ? error.message : 'The executable could not be checked.'));
  }
}

export async function checkMusicTools(
  paths: MusicToolPaths, signal: AbortSignal, run: typeof capture = capture,
): Promise<void> {
  for (const tool of ['node', 'ytDlp', 'ffmpeg'] as const) await checkMusicTool(tool, paths, signal, run);
}
