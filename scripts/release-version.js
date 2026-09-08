// Mirrors Monky's chronological, per-commit versioning, including squash bodies.
const COMMIT_TYPES = 'feat|feature|minor|fix|bugfix|perf|refactor|style|docs|chore|test|build|ci|revert|major';
const SQUASH_ENTRY = new RegExp(`^\\s*[*-]\\s+(${COMMIT_TYPES})(\\([^)]*\\))?(!)?:`, 'i');

function parseVersionTag(tag) {
  if (typeof tag !== 'string') return null;
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-beta(?:\.?(\d+))?)?$/.exec(tag);
  if (!match) return null;
  const numbers = match.slice(1, 4).map(Number);
  if (!numbers.every(Number.isSafeInteger)) return null;
  const beta = match[5] === undefined ? 0 : Number(match[5]);
  if (!Number.isSafeInteger(beta)) return null;
  return { numbers, prerelease: match[4] !== undefined, beta };
}

function compareVersionTags(a, b) {
  const left = parseVersionTag(a);
  const right = parseVersionTag(b);
  if (!left || !right) throw new Error('Cannot compare invalid release tags.');
  for (let index = 0; index < 3; index++) {
    if (left.numbers[index] !== right.numbers[index]) return left.numbers[index] - right.numbers[index];
  }
  if (left.prerelease !== right.prerelease) return left.prerelease ? -1 : 1;
  return left.beta - right.beta;
}

function latestReleaseTag(releases, stableOnly = false) {
  return releases
    .filter((release) => release.draft === false && release.published_at &&
      parseVersionTag(release.tag_name) &&
      (!stableOnly || (release.prerelease === false && !parseVersionTag(release.tag_name).prerelease)))
    .map((release) => release.tag_name)
    .sort(compareVersionTags).at(-1) || null;
}

function collectBumps(messages) {
  return messages.flatMap((message) => {
    if (typeof message !== 'string' || !message.trim()) return [];
    const lines = message.trim().split('\n');
    const starts = lines.flatMap((line, index) => SQUASH_ENTRY.test(line) ? [index] : []);
    const entries = starts.length
      ? starts.map((start, index) => lines.slice(start, starts[index + 1] ?? lines.length).join('\n'))
      : [message];
    return entries.map((entry) => {
      const header = entry.trim().split('\n')[0].replace(/^\s*[*-]\s+/, '');
      if (/BREAKING[ -]CHANGE:/i.test(entry) ||
          /^[a-zA-Z0-9_-]+(\([^)]*\))?!:/.test(header) ||
          /^major(\([^)]*\))?:/i.test(header)) return 'major';
      return /^(feat|feature|minor)(\([^)]*\))?:/i.test(header) ? 'minor' : 'patch';
    });
  });
}

function nextBetaVersion(baseline, messages) {
  const parsed = parseVersionTag(baseline);
  if (!parsed) throw new Error(`Invalid baseline version: ${baseline}`);
  const numbers = [...parsed.numbers];
  const bumps = collectBumps(messages);
  for (const bump of bumps.length ? bumps : ['patch']) {
    const index = { major: 0, minor: 1, patch: 2 }[bump];
    numbers[index]++;
    if (!Number.isSafeInteger(numbers[index])) throw new Error('Release version overflow.');
    for (let reset = index + 1; reset < 3; reset++) numbers[reset] = 0;
  }
  return `${numbers.join('.')}-beta`;
}

function promotionVersion(tag) {
  const parsed = parseVersionTag(tag);
  if (!tag?.startsWith('v') || !parsed?.prerelease) {
    throw new Error('promote_tag must be a beta release tag such as v1.8.0-beta.');
  }
  return parsed.numbers.join('.');
}

module.exports = { parseVersionTag, compareVersionTags, latestReleaseTag, collectBumps, nextBetaVersion, promotionVersion };
