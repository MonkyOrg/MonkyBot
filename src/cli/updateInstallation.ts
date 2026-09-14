import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { cliT, getCliLocale } from './i18n';
import { parseVersion } from './updateReleases';

export interface NpmCommand {
  executable: string;
  args: string[];
}

export interface NpmInstallation {
  command: NpmCommand;
  prefix: string;
}

function isFile(file: string): boolean {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

export function resolveNpmCommand(env: NodeJS.ProcessEnv = process.env, platform = process.platform): NpmCommand {
  const npmEntry = env.npm_execpath;
  if (npmEntry && path.basename(npmEntry).toLowerCase() === 'npm-cli.js') {
    const executable = env.npm_node_execpath ?? process.execPath;
    if (!path.isAbsolute(npmEntry) || !isFile(npmEntry) || !path.isAbsolute(executable) || !isFile(executable)) {
      throw new Error(cliT('update.npmMissing'));
    }
    return { executable, args: [npmEntry] };
  }
  const searchPath = Object.entries(env).find(([key]) => platform === 'win32' ? key.toLowerCase() === 'path' : key === 'PATH')?.[1];
  const directories = (searchPath ?? '').split(path.delimiter).filter(Boolean).map(item => item.replace(/^"(.*)"$/, '$1'));
  for (const directory of directories) {
    if (platform !== 'win32') {
      const executable = path.resolve(directory, 'npm');
      try {
        fs.accessSync(executable, fs.constants.X_OK);
        if (isFile(executable)) return { executable, args: [] };
      } catch {}
      continue;
    }
    const executable = path.resolve(directory, 'npm.exe');
    if (isFile(executable)) return { executable, args: [] };
    if (isFile(path.resolve(directory, 'npm.cmd'))) {
      const entry = path.resolve(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js');
      if (isFile(entry)) {
        // Match npm.cmd's runtime choice without running its shell wrapper.
        const node = [path.resolve(directory, 'node.exe'), ...directories.map(dir => path.resolve(dir, 'node.exe'))]
          .find(isFile) ?? process.execPath;
        return { executable: node, args: [entry] };
      }
      throw new Error(cliT('update.npmMissing'));
    }
  }
  throw new Error(cliT('update.npmMissing'));
}

export function resolveNpmInstallation(): NpmInstallation {
  const command = resolveNpmCommand();
  const result = spawnSync(command.executable, [...command.args, 'prefix', '-g'], {
    encoding: 'utf8', windowsHide: true, shell: false, timeout: 15_000, maxBuffer: 64 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error(cliT('update.prefixFailed'), { cause: result.error });
  const prefix = result.stdout.replace(/\r?\n$/, '');
  if (!path.isAbsolute(prefix) || /[\r\n\0]/.test(prefix)) throw new Error(cliT('update.invalidPrefix'));
  return { command, prefix };
}

function runForeground(
  executable: string, args: string[], env: NodeJS.ProcessEnv = process.env,
): Promise<{ status: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: 'inherit', shell: false, windowsHide: true, cwd: process.cwd(), env,
    });
    child.once('error', reject);
    child.once('close', (status, signal) => resolve({ status, signal }));
  });
}

export async function installUpdate(installation: NpmInstallation, archive: string): Promise<void> {
  try {
    const { command, prefix } = installation;
    const result = await runForeground(command.executable, [
      ...command.args, 'install', '-g', '--prefix', prefix, archive,
    ]);
    if (result.status !== 0) throw new Error(`npm: ${result.signal ?? result.status}`);
  } catch (error: unknown) {
    throw new Error(cliT('update.installFailed'), { cause: error });
  }
}

function inside(directory: string, file: string): boolean {
  const relative = path.relative(directory, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function installedCliEntry(prefix: string, expectedVersion: string, platform = process.platform): string {
  const packageDirectory = platform === 'win32'
    ? path.join(prefix, 'node_modules', '@monky', 'bot')
    : path.join(prefix, 'lib', 'node_modules', '@monky', 'bot');
  let metadata: unknown;
  try {
    metadata = JSON.parse(fs.readFileSync(path.join(packageDirectory, 'package.json'), 'utf8'));
  } catch (error: unknown) {
    throw new Error(cliT('update.installedPackageInvalid'), { cause: error });
  }
  if (typeof metadata !== 'object' || metadata === null || !('name' in metadata) || metadata.name !== '@monky/bot' ||
      !('version' in metadata) || typeof metadata.version !== 'string' || !parseVersion(metadata.version)) {
    throw new Error(cliT('update.installedPackageInvalid'));
  }
  if (metadata.version !== expectedVersion) {
    throw new Error(cliT('update.installedVersionMismatch', { actual: metadata.version, expected: expectedVersion }));
  }
  if (!('bin' in metadata) || typeof metadata.bin !== 'object' || metadata.bin === null ||
      !('monkybot' in metadata.bin) || typeof metadata.bin.monkybot !== 'string') {
    throw new Error(cliT('update.installedEntryInvalid'));
  }
  const bin = metadata.bin.monkybot;
  const entry = path.resolve(packageDirectory, bin);
  if (path.isAbsolute(bin) || /[\r\n\0]/.test(bin) || path.extname(bin) !== '.js' || !inside(packageDirectory, entry) || !isFile(entry)) {
    throw new Error(cliT('update.installedEntryInvalid'));
  }
  if (!inside(fs.realpathSync(packageDirectory), fs.realpathSync(entry))) {
    throw new Error(cliT('update.installedEntryInvalid'));
  }
  return entry;
}

export async function restartInstalledCli(entry: string): Promise<void> {
  const locale = getCliLocale();
  const result = await runForeground(process.execPath, [entry, 'restart'], {
    ...process.env, MONKY_BOT_LOCALE: locale, MONKYBOT_LOCALE: locale,
  });
  if (result.status !== 0) throw new Error(cliT('update.childFailed', { status: result.signal ?? result.status ?? '?' }));
}
