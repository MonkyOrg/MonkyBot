import {
  ChildProcess,
  SpawnOptions,
  SpawnSyncOptions,
  SpawnSyncReturns,
  spawn,
  spawnSync,
} from 'child_process';

const isWindows = process.platform === 'win32';

function quoteWindowsArg(value: string): string {
  return /[\s"&|<>^()]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function buildWindowsCommand(command: string, args: string[]): string {
  return [command, ...args].map(quoteWindowsArg).join(' ');
}

export function runSync(
  command: string,
  args: string[] = [],
  options: SpawnSyncOptions = {}
): SpawnSyncReturns<string> {
  const result = isWindows
    ? spawnSync(buildWindowsCommand(command, args), [], { ...options, shell: true })
    : spawnSync(command, args, { ...options, shell: false });
  return result as SpawnSyncReturns<string>;
}

export function runAsync(command: string, args: string[] = [], options: SpawnOptions = {}): ChildProcess {
  return isWindows
    ? spawn(buildWindowsCommand(command, args), [], { ...options, shell: true })
    : spawn(command, args, { ...options, shell: false });
}

export function commandSucceeds(command: string, args: string[] = []): boolean {
  try {
    const result = runSync(command, args, { stdio: 'ignore' });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}
