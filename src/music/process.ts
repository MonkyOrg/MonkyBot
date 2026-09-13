import { spawn, type ChildProcess } from 'node:child_process';
import { MusicError, aborted } from './errors';

let activeCaptures = 0;
const waitingCaptures: (() => void)[] = [];
const terminations = new WeakMap<ChildProcess, Promise<void>>();

export interface CaptureOptions {
  readonly rejectStderr?: boolean;
}

export function safeDiagnostic(value: string): string {
  return value
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/gi, '[redacted key]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted URL]')
    .replace(/\b(authorization)\s*[:=]\s*(?:Bearer|Basic)\s+[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\b(token|password|passwd|cookie|authorization|api[_-]?key|ice-pwd)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1=[redacted]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 1024);
}

function captureSlot(signal: AbortSignal): Promise<() => void> {
  aborted(signal);
  if (waitingCaptures.length >= 64) return Promise.reject(new MusicError('busy'));
  return new Promise((resolve, reject) => {
    const release = (): void => {
      activeCaptures--;
      waitingCaptures.shift()?.();
    };
    const clear = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      const index = waitingCaptures.indexOf(start);
      if (index !== -1) waitingCaptures.splice(index, 1);
    };
    const fail = (code: 'cancelled' | 'timeout'): void => { clear(); reject(new MusicError(code)); };
    const cancel = (): void => fail('cancelled');
    const timer = setTimeout(() => fail('timeout'), 30_000);
    const start = (): void => {
      clear();
      activeCaptures++;
      resolve(release);
    };
    signal.addEventListener('abort', cancel, { once: true });
    if (activeCaptures < 4) start();
    else waitingCaptures.push(start);
  });
}

export function terminate(child: ChildProcess): Promise<void> {
  const existing = terminations.get(child);
  if (existing) return existing;
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return Promise.resolve();
  const closing = new Promise<void>((resolve) => {
    const kill = (signal: NodeJS.Signals): void => {
      if (process.platform === 'win32') {
        const killer = spawn(`${process.env.SystemRoot || 'C:\\Windows'}\\System32\\taskkill.exe`,
          ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
        killer.once('error', () => { child.kill(signal); });
        killer.once('exit', (code) => { if (code !== 0) child.kill(signal); });
      } else {
        try { process.kill(-child.pid!, signal); }
        catch { child.kill(signal); }
      }
    };
    const timer = setTimeout(() => kill('SIGKILL'), 1000);
    child.once('close', () => { clearTimeout(timer); resolve(); });
    kill('SIGTERM');
  });
  terminations.set(child, closing);
  return closing;
}

export async function capture(executable: string, args: string[], signal: AbortSignal, timeoutMs = 30_000, limit = 1024 * 1024): Promise<string> {
  return (await captureBytes(executable, args, signal, timeoutMs, limit)).toString('utf8');
}

export async function captureBytes(executable: string, args: string[], signal: AbortSignal, timeoutMs = 30_000, limit = 1024 * 1024, options: CaptureOptions = {}): Promise<Buffer> {
  const release = await captureSlot(signal);
  try { return await runCapture(executable, args, signal, timeoutMs, limit, options); }
  finally { release(); }
}

function runCapture(executable: string, args: string[], signal: AbortSignal, timeoutMs: number, limit: number, options: CaptureOptions): Promise<Buffer> {
  aborted(signal);
  return new Promise((resolve, reject) => {
    // Keep ownership of the process group, including yt-dlp's Node challenge child.
    const child = spawn(executable, args, {
      shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let diagnostic = '';
    let hasDiagnostic = false;
    let failure: MusicError | undefined;
    const fail = (error: MusicError): void => {
      failure ??= error;
      void terminate(child);
    };
    const cancel = (): void => fail(new MusicError('cancelled'));
    const timer = setTimeout(() => fail(new MusicError('timeout')), timeoutMs);
    signal.addEventListener('abort', cancel, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > limit) fail(new MusicError('unavailable'));
      else if (!failure) chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      const text = chunk.toString('utf8');
      hasDiagnostic ||= !!text.trim();
      // Keep URL/key prefixes: a tail-only buffer can expose their unrecognizable secrets.
      diagnostic = (diagnostic + text).slice(0, 4096);
      if (bytes > limit) fail(new MusicError('unavailable'));
    });
    child.once('error', () => { failure = new MusicError('tools'); });
    child.once('close', (code) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      if (failure || code !== 0 || (options.rejectStderr && hasDiagnostic)) reject(failure ?? new MusicError('unavailable',
        safeDiagnostic(diagnostic.trim() || (code === 0 ? 'Media process reported error output.' : `Media process exited with code ${code}.`))));
      else resolve(Buffer.concat(chunks));
    });
    if (signal.aborted) cancel();
  });
}

export function bounded<T>(promise: Promise<T>, signal: AbortSignal, timeoutMs: number): Promise<T> {
  return waitFor(promise, signal, timeoutMs);
}

export function cancellable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return waitFor(promise, signal);
}

function waitFor<T>(promise: Promise<T>, signal: AbortSignal, timeoutMs?: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = (): void => finish({ ok: false, error: new MusicError('cancelled') });
    const timer = timeoutMs === undefined ? undefined
      : setTimeout(() => finish({ ok: false, error: new MusicError('timeout') }), timeoutMs);
    let settled = false;
    const finish = (result: { ok: true; value: T } | { ok: false; error: unknown }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      if (result.ok) resolve(result.value);
      else reject(result.error);
    };
    signal.addEventListener('abort', cancel, { once: true });
    promise.then((value) => finish({ ok: true, value }), (error: unknown) => finish({ ok: false, error }));
    if (signal.aborted) cancel();
  });
}
