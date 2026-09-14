export interface DownloadProgress {
  receivedBytes: number;
  totalBytes?: number;
  done?: boolean;
}

export interface DownloadCallbacks {
  onProgress?: (progress: DownloadProgress) => void;
  onVerify?: () => void;
}

interface ProgressOutput {
  isTTY?: boolean;
  write(message: string): unknown;
}

function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

export function downloadProgressLine(label: string, progress: DownloadProgress, bar = false): string {
  const { receivedBytes, totalBytes } = progress;
  if (!Number.isSafeInteger(receivedBytes) || receivedBytes < 0 ||
      (totalBytes !== undefined && (!Number.isSafeInteger(totalBytes) || totalBytes <= 0 || receivedBytes > totalBytes))) {
    throw new RangeError('Invalid download byte counts');
  }
  if (totalBytes === undefined) return `${label}: ${bytes(receivedBytes)}`;
  const percent = Math.floor((receivedBytes / totalBytes) * 100);
  const filled = Math.floor(percent / 5);
  const meter = bar ? `[${'='.repeat(filled)}${'-'.repeat(20 - filled)}] ` : '';
  return `${label}: ${meter}${percent}% (${bytes(receivedBytes)} / ${bytes(totalBytes)})`;
}

export function createDownloadProgress(
  label: string,
  output: ProgressOutput = process.stdout,
  now: () => number = Date.now,
): { update(progress: DownloadProgress): void; finish(): void } {
  let lastTime = -Infinity;
  let lastLine: string | undefined;
  let openLine = false;
  return {
    update(progress) {
      const line = downloadProgressLine(label, progress, output.isTTY);
      const time = now();
      const complete = progress.done || progress.receivedBytes === progress.totalBytes;
      if (line === lastLine || (!complete && time - lastTime < (output.isTTY ? 100 : 5000))) return;
      output.write(output.isTTY ? `\r\u001b[2K${line}` : `${line}\n`);
      openLine = Boolean(output.isTTY);
      lastLine = line;
      lastTime = time;
    },
    finish() {
      if (openLine) output.write('\n');
      openLine = false;
    },
  };
}
