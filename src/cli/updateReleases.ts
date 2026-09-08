import https from 'https';

export const GITHUB_REPO = 'MonkyOrg/MonkyBot';

interface Version {
  major: number;
  minor: number;
  patch: number;
  beta: number | null;
}

export interface ReleaseInfo {
  version: string;
  tgzUrl: string;
  htmlUrl: string;
}

export function parseVersion(value: string): Version | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-beta(?:\.?(\d+))?)?$/.exec(value);
  if (!match) return null;
  const numbers = match.slice(1, 4).map(Number);
  const beta = value.includes('-beta') ? Number(match[4] || 0) : null;
  if (!numbers.every(Number.isSafeInteger) || (beta !== null && !Number.isSafeInteger(beta))) return null;
  return { major: numbers[0], minor: numbers[1], patch: numbers[2], beta };
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error(`Versão inválida: ${!a ? left : right}`);
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  if (a.beta === b.beta) return 0;
  if (a.beta === null) return 1;
  if (b.beta === null) return -1;
  return a.beta - b.beta;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function selectRelease(data: unknown, includeBeta: boolean): ReleaseInfo | null {
  if (includeBeta ? !Array.isArray(data) : !isRecord(data)) {
    throw new Error('Resposta de releases inválida.');
  }
  const releases: unknown[] = Array.isArray(data) ? data : [data];
  let latest: ReleaseInfo | null = null;
  for (const release of releases) {
    if (!isRecord(release) || release.draft !== false || typeof release.tag_name !== 'string') continue;
    const parsed = parseVersion(release.tag_name);
    if (!parsed || release.prerelease !== (parsed.beta !== null)) continue;
    if (!includeBeta && parsed.beta !== null) continue;
    const version = release.tag_name.replace(/^v/, '');
    const name = `monky-bot-${version}.tgz`;
    const tgzUrl = `https://github.com/${GITHUB_REPO}/releases/download/${release.tag_name}/${name}`;
    // Only install the exact package for this tag, never another asset or host.
    if (!Array.isArray(release.assets) || !release.assets.some((asset: unknown) =>
      isRecord(asset) && asset.name === name && asset.browser_download_url === tgzUrl)) continue;
    if (!latest || compareVersions(version, latest.version) > 0) {
      latest = { version, tgzUrl, htmlUrl: `https://github.com/${GITHUB_REPO}/releases/tag/${release.tag_name}` };
    }
  }
  return latest;
}

export async function fetchLatestRelease(includeBeta: boolean): Promise<ReleaseInfo | null> {
  const endpoint = includeBeta ? 'releases?per_page=100' : 'releases/latest';
  const data: unknown = await new Promise((resolve, reject) => {
    const req = https.get(
      `https://api.github.com/repos/${GITHUB_REPO}/${endpoint}`,
      { headers: { 'User-Agent': 'monkybot-cli', Accept: 'application/vnd.github+json' } },
      (res) => {
        if (res.statusCode === 404 && !includeBeta) {
          res.resume();
          resolve(undefined);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`GitHub respondeu HTTP ${res.statusCode}.`));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
          if (body.length > 2_000_000) req.destroy(new Error('Resposta de releases excedeu o limite.'));
        });
        res.on('error', reject);
        res.on('aborted', () => reject(new Error('Resposta do GitHub interrompida.')));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error('GitHub retornou JSON inválido.'));
          }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error('Tempo limite ao consultar o GitHub.')));
  });
  return data === undefined ? null : selectRelease(data, includeBeta);
}
