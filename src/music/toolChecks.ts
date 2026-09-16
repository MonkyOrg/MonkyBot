import { checkMediaTool, checkMediaTools, MEDIA_TOOL_NAMES } from '@monky/bot-sdk/dist/localRuntime';
import { capture } from './process';
import type { MusicTool, MusicToolPaths } from './toolPaths';

export { MediaToolError as MusicToolError, youtubeExtractorArgs } from '@monky/bot-sdk/dist/localRuntime';
export const MUSIC_TOOL_NAMES = MEDIA_TOOL_NAMES;

export function checkMusicTool(
  tool: MusicTool, paths: MusicToolPaths, signal: AbortSignal, run: typeof capture = capture,
): Promise<string> {
  return checkMediaTool(tool, paths, signal, run);
}

export function checkMusicTools(
  paths: MusicToolPaths, signal: AbortSignal, run: typeof capture = capture,
): Promise<void> {
  return checkMediaTools(paths, signal, run);
}
