import { MusicError, aborted, type MusicErrorCode } from './errors';
import { capture, safeDiagnostic } from './process';
import type { MusicTool, MusicToolPaths } from './toolPaths';

export const MUSIC_TOOL_NAMES: Record<MusicTool, string> = { node: 'Node.js', ytDlp: 'yt-dlp', ffmpeg: 'FFmpeg/libopus' };

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
  try {
    if (tool === 'node') {
      const version = (await run(paths.node, ['--version'], signal, 5000, 65536)).trim();
      const major = /^v(\d+)\./.exec(version)?.[1];
      if (!major || Number(major) < 22) throw new MusicError('runtime', `Node.js 22+ required; received ${version || 'no version'}.`);
      return version;
    }
    if (tool === 'ytDlp') {
      return (await run(paths.ytDlp, [...youtubeExtractorArgs(paths.node), '--version'], signal, 5000, 65536)).trim();
    }
    const encoders = await run(paths.ffmpeg, ['-hide_banner', '-encoders'], signal, 5000, 131072);
    if (!/\blibopus\b/.test(encoders)) throw new MusicError('tools', 'The executable does not provide the libopus encoder.');
    return 'libopus';
  } catch (error: unknown) {
    if (signal.aborted) throw new MusicError('cancelled');
    const original = error instanceof MusicError ? error : undefined;
    const code = original && ['busy', 'timeout', 'runtime', 'cancelled'].includes(original.code)
      ? original.code : tool === 'node' ? 'runtime' : 'tools';
    throw new MusicToolError(tool, paths[tool], code,
      original?.detail || (error instanceof Error ? error.message : 'The executable could not be checked.'));
  }
}

export async function checkMusicTools(
  paths: MusicToolPaths, signal: AbortSignal, run: typeof capture = capture,
): Promise<void> {
  for (const tool of ['node', 'ytDlp', 'ffmpeg'] as const) await checkMusicTool(tool, paths, signal, run);
}
