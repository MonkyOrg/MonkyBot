import fs from 'fs';
import path from 'path';
import { ANSI, color as terminalColor, CONFIG_DIR } from '../constants';
import { readConfig } from '../config';
import {
  requirePm2,
  isPm2Available,
  isBotRunning,
  ensurePm2,
} from '../pm2';
import { runSync } from '../process';
import { compareVersions, fetchLatestRelease, parseVersion } from '../updateReleases';
import { cliT, cliText, getCliLocale } from '../i18n';
import { createDownloadProgress } from '../progress';
import { downloadUpdate } from '../updateDownload';
import { installUpdate, installedCliEntry, resolveNpmInstallation, restartInstalledCli } from '../updateInstallation';

function color(message: string, style: string): string {
  return process.stdout.isTTY ? terminalColor(message, style) : message;
}

// ── Version helpers ──────────────────────────────────────────────────

function readPackagedVersion(): string {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'package.json'),
    path.resolve(__dirname, '..', '..', '..', 'package.json'),
  ];
  for (const pkg of candidates) {
    if (!fs.existsSync(pkg)) continue;
    const parsed: unknown = JSON.parse(fs.readFileSync(pkg, 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && 'version' in parsed &&
        typeof parsed.version === 'string' && parseVersion(parsed.version)) return parsed.version;
    throw new Error(cliT('update.invalidVersion', { path: pkg }));
  }
  throw new Error(cliT('update.versionMissing'));
}

// ── Update command ───────────────────────────────────────────────────

export async function updateCommand(args: string[]): Promise<void> {
  const invalid = args.find((arg) => !['--check', '--yes', '-y', '--beta'].includes(arg));
  if (invalid) throw new Error(cliT('update.unknownOption', { option: invalid }));
  const checkOnly = args.includes('--check');
  const assumeYes = args.includes('--yes') || args.includes('-y');
  const includeBeta = args.includes('--beta');

  const local = readPackagedVersion();
  console.log(color(cliT('update.localVersion', { version: local }), ANSI.dim));
  console.log(color(cliT('update.checking', { channel: includeBeta ? 'beta' : 'stable' }), ANSI.dim));

  const latest = await fetchLatestRelease(includeBeta);
  if (!latest) {
    console.log(color(cliT('update.noRelease'), ANSI.yellow));
    return;
  }

  const comparison = compareVersions(latest.version, local);
  const hasUpdate = comparison > 0;

  if (hasUpdate) {
    console.log(color(cliT('update.available', { version: latest.version }), ANSI.green));
    if (latest.htmlUrl) console.log(`   ${latest.htmlUrl}`);
  } else if (comparison < 0) {
    console.log(color(cliT('update.downgradeBlocked', { version: latest.version }), ANSI.yellow));
  } else {
    console.log(color(cliT('update.current'), ANSI.green));
  }

  if (checkOnly || !hasUpdate) return;

  if (hasUpdate && !assumeYes) {
    const accepted = await promptYesNo(cliT('update.confirm', { version: latest.version }), true);
    if (!accepted) {
      console.log(color(cliT('update.cancelled'), ANSI.yellow));
      return;
    }
  }

  console.log();
  console.log(color(cliT('update.starting'), ANSI.bold));
  console.log(color(latest.tgzUrl, ANSI.cyan));
  console.log();

  const installation = resolveNpmInstallation();
  await fs.promises.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const staging = await fs.promises.mkdtemp(path.join(CONFIG_DIR, '.update-'));
  try {
    const archive = path.join(staging, `monky-bot-${latest.version}.tgz`);
    const controller = new AbortController();
    const cancel = (): void => controller.abort(new Error(cliT('update.cancelledSignal')));
    const timeout = setTimeout(() => controller.abort(new Error(cliT('update.downloadTimeout'))), 10 * 60_000);
    const progress = createDownloadProgress(cliT('update.downloading', { version: latest.version }));
    process.once('SIGINT', cancel);
    try {
      await downloadUpdate(latest, archive, controller.signal, {
        onProgress: progress.update,
        onVerify: () => {
          progress.finish();
          console.log(cliT('update.verifyingDownload'));
        },
      });
      controller.signal.throwIfAborted();
    } finally {
      progress.finish();
      clearTimeout(timeout);
      process.off('SIGINT', cancel);
    }
    console.log(cliT('update.installing'));
    await installUpdate(installation, archive);
  } finally {
    await fs.promises.rm(staging, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }

  let entry: string;
  try {
    entry = installedCliEntry(installation.prefix, latest.version);
  } catch (error: unknown) {
    throw new Error(cliT('update.installVerificationFailed', {
      reason: error instanceof Error ? error.message : String(error),
    }), { cause: error });
  }

  console.log();
  console.log(color(cliT('update.installed', { version: latest.version }), ANSI.green));

  try {
    if (!isPm2Available() || !isBotRunning()) return;
    if (!assumeYes && !await promptYesNo(cliT('update.confirmRestart'), true)) return;
    if (!readConfig()) throw new Error(cliT('update.restartConfigMissing'));
    console.log(cliT('update.restartStarting'));
    // npm has replaced files on disk, not the modules already loaded in this process.
    await restartInstalledCli(entry);
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(cliT('update.restartFailed', { reason }), { cause: error });
  }
  console.log(color(cliT('update.restarted'), ANSI.green));
}

// ── Auto-update ──────────────────────────────────────────────────────

function getAutoUpdateScriptPath(): string {
  const config = readConfig();
  const dir = config?.botDir || require('os').homedir();
  return path.join(dir, '.monkybot-updater.cjs');
}

function getCliEntryPath(): string {
  return path.resolve(__dirname, '..', '..', 'cli.js');
}

const UPDATER_PM2_NAME = 'monkybot-updater';

export function isAutoUpdateEnabled(): boolean {
  if (!isPm2Available()) return false;
  const procs = runSync('pm2', ['jlist'], { encoding: 'utf8' });
  if (procs.status !== 0) return false;
  try {
    const list = JSON.parse(procs.stdout);
    return Array.isArray(list) && list.some((p: { name?: string }) => p.name === UPDATER_PM2_NAME);
  } catch { return false; }
}

export function generateUpdaterScript(cliEntry: string, schedule: string, includeBeta = false): string {
  return `// Monky Bot auto-updater — gerado por "monkybot autoupdate on"
const { spawnSync } = require('child_process');
const fs = require('fs');
const { parseVersion } = require(${JSON.stringify(path.join(path.dirname(cliEntry), 'cli', 'updateReleases.js'))});
const { cliT } = require(${JSON.stringify(path.join(path.dirname(cliEntry), 'cli', 'i18n.js'))});

const CLI = ${JSON.stringify(cliEntry)};
const PACKAGE_FILE = ${JSON.stringify(path.resolve(path.dirname(cliEntry), '..', 'package.json'))};
const SCHEDULE = ${JSON.stringify(schedule)};
const INCLUDE_BETA = ${JSON.stringify(includeBeta)};

function getMsUntilNextRun() {
  const parts = SCHEDULE.split(':').map(Number);
  const h = isNaN(parts[0]) ? 4 : parts[0];
  const m = isNaN(parts[1]) ? 0 : parts[1];
  const now = new Date();
  const next = new Date(now);
  next.setHours(h, m, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

function check() {
  console.log('[' + new Date().toISOString() + '] [monkybot-updater] ' + cliT('auto.checking'));
  try {
    const version = parseVersion(JSON.parse(fs.readFileSync(PACKAGE_FILE, 'utf8')).version);
    if (!version) throw new Error(cliT('auto.invalidVersion'));
    const beta = INCLUDE_BETA;
    console.log('[monkybot-updater] ' + cliT('auto.channel', { channel: beta ? 'beta' : 'stable' }));
    const args = [CLI, 'update', '--yes'];
    if (beta) args.push('--beta');
    const result = spawnSync(process.execPath, args, { stdio: 'inherit', shell: false, windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(cliT('auto.updateFailed', { status: result.status }));
  } catch (err) {
    console.error('[monkybot-updater] ' + cliT('auto.error'), err);
  }
  schedule();
}

function schedule() {
  const ms = getMsUntilNextRun();
  const next = new Date(Date.now() + ms);
  console.log('[monkybot-updater] ' + cliT('auto.nextCheck'), next.toLocaleString());
  setTimeout(check, ms);
}

console.log('[monkybot-updater] ' + cliT('auto.daemonStarted', { schedule: SCHEDULE }));
schedule();
`;
}

export async function autoUpdateCommand(args: string[]): Promise<void> {
  const action = args[0]; // 'on', 'off', 'status'
  if (action !== 'on' && args.length > 1) throw new Error(cliT('auto.extraOptions'));

  if (!action || action === 'status') {
    const enabled = isAutoUpdateEnabled();
    console.log(`Auto-update: ${enabled ? color(cliT('auto.enabled'), ANSI.green) : color(cliT('auto.disabled'), ANSI.yellow)}`);
    if (enabled) {
      console.log(color(cliT('auto.disableHint'), ANSI.dim));
    } else {
      console.log(color(cliT('auto.enableHint'), ANSI.dim));
    }
    return;
  }

  if (action === 'off') {
    if (!requirePm2(cliT('auto.disableAction'))) return;
    runSync('pm2', ['delete', UPDATER_PM2_NAME], { stdio: 'ignore' });
    runSync('pm2', ['save'], { stdio: 'ignore' });

    // Clean up script
    const scriptPath = getAutoUpdateScriptPath();
    if (fs.existsSync(scriptPath)) {
      try { fs.unlinkSync(scriptPath); } catch {}
    }

    console.log(color(cliT('auto.stopped'), ANSI.green));
    return;
  }

  if (action === 'on') {
    const options = args.slice(1).filter((arg) => arg !== '--beta');
    const schedule = options[0] || '04:00';
    if (options.length > 1 || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(schedule)) {
      throw new Error(cliT('auto.usage'));
    }
    const includeBeta = args.includes('--beta');
    ensurePm2();
    const cliEntry = getCliEntryPath();
    const scriptPath = getAutoUpdateScriptPath();

    // Write updater script
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
    fs.writeFileSync(scriptPath, generateUpdaterScript(cliEntry, schedule, includeBeta), 'utf8');

    // Remove existing and start fresh
    runSync('pm2', ['delete', UPDATER_PM2_NAME], { stdio: 'ignore' });
    const locale = getCliLocale();
    const result = runSync('pm2', ['start', scriptPath, '--name', UPDATER_PM2_NAME], {
      stdio: 'inherit',
      env: { ...process.env, MONKY_BOT_LOCALE: locale, MONKYBOT_LOCALE: locale },
    });
    if (result.status !== 0) {
      throw new Error(cliT('auto.startFailed'));
    }
    runSync('pm2', ['save'], { stdio: 'ignore' });

    console.log();
    console.log(color(cliT('auto.started'), ANSI.green));
    console.log(`   ${cliT('auto.schedule', { schedule })}`);
    console.log(`   ${cliT('auto.channel', { channel: includeBeta ? 'beta' : cliT('auto.followInstalled') })}`);
    console.log(`   Script: ${scriptPath}`);
    console.log(color(cliT('auto.disableHint'), ANSI.dim));
    return;
  }

  throw new Error(cliT('auto.unknownAction', { action }));
}

// ── Helpers ──────────────────────────────────────────────────────────

function promptYesNo(question: string, defaultYes: boolean): Promise<boolean> {
  const hint = defaultYes ? cliText('[S/n]', '[Y/n]') : cliText('[s/N]', '[y/N]');
  return new Promise((resolve) => {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let answered = false;
    rl.once('close', () => { if (!answered) resolve(false); });
    rl.question(`${question} ${hint} `, (answer: string) => {
      answered = true;
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      if (!trimmed) { resolve(defaultYes); return; }
      resolve(trimmed === 's' || trimmed === 'y' || trimmed === 'sim' || trimmed === 'yes');
    });
  });
}
