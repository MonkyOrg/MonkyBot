import fs from 'node:fs';
import path from 'node:path';
import { MUSIC_TOOLS_DIR } from '../utils/paths';

export interface MusicToolPaths {
  node: string;
  ytDlp: string;
  ffmpeg: string;
}

export type MusicTool = keyof MusicToolPaths;

export const MUSIC_TOOL_ENV = {
  node: 'MONKY_MUSIC_NODE',
  ytDlp: 'MONKY_MUSIC_YTDLP',
  ffmpeg: 'MONKY_MUSIC_FFMPEG',
} as const satisfies Record<MusicTool, string>;

export type MusicToolEnvironment = Partial<Record<typeof MUSIC_TOOL_ENV[MusicTool], string>>;

export function managedMusicTool(tool: 'ytDlp' | 'ffmpeg', directory = MUSIC_TOOLS_DIR, platform = process.platform): string {
  return path.join(directory, `${tool === 'ytDlp' ? 'yt-dlp' : 'ffmpeg'}${platform === 'win32' ? '.exe' : ''}`);
}

export function musicToolPaths(
  env: NodeJS.ProcessEnv = process.env, directory = MUSIC_TOOLS_DIR, platform = process.platform,
): MusicToolPaths {
  const resolve = (tool: 'ytDlp' | 'ffmpeg', fallback: string): string => {
    const override = env[MUSIC_TOOL_ENV[tool]];
    if (override) return override;
    const managed = managedMusicTool(tool, directory, platform);
    return fs.existsSync(managed) ? managed : fallback;
  };
  return {
    node: env.MONKY_MUSIC_NODE || process.execPath,
    ytDlp: resolve('ytDlp', 'yt-dlp'),
    ffmpeg: resolve('ffmpeg', 'ffmpeg'),
  };
}

export function absoluteMusicToolPaths(
  paths: MusicToolPaths, env: NodeJS.ProcessEnv = process.env, platform = process.platform,
): MusicToolPaths {
  const resolve = (command: string): string => {
    if (path.isAbsolute(command)) return command;
    if (/[\\/]/.test(command)) return path.resolve(command);
    const pathKey = Object.keys(env).find((key) => platform === 'win32' ? key.toUpperCase() === 'PATH' : key === 'PATH');
    const directories = (pathKey ? env[pathKey] ?? '' : '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
    if (platform === 'win32') directories.unshift(process.cwd());
    for (const directory of directories) {
      for (const suffix of platform === 'win32' ? ['', '.exe'] : ['']) {
        const candidate = path.resolve(directory.replace(/^"(.*)"$/, '$1'), `${command}${suffix}`);
        try {
          if (!fs.statSync(candidate).isFile()) continue;
          if (platform !== 'win32') fs.accessSync(candidate, fs.constants.X_OK);
          return candidate;
        } catch (error: unknown) {
          if (!(error instanceof Error) || !('code' in error) ||
              !['ENOENT', 'ENOTDIR', 'EACCES'].includes(String(error.code))) throw error;
        }
      }
    }
    return command;
  };
  return { node: resolve(paths.node), ytDlp: resolve(paths.ytDlp), ffmpeg: resolve(paths.ffmpeg) };
}
