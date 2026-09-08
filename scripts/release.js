const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const {
  latestReleaseTag, compareVersionTags, nextBetaVersion, promotionVersion,
} = require('./release-version');
const { promoteFile } = require('./promote-package');

const ROOT = path.resolve(__dirname, '..');
const DIRECTORY = path.join(ROOT, 'release');
const PLAN = path.join(DIRECTORY, 'release-plan.json');

function command(executable, args) {
  return execFileSync(executable, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();
}

function repositoryName(value) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value || '')) throw new Error('Invalid GitHub repository.');
  return value;
}

function releasesFor(repository) {
  const pages = JSON.parse(command('gh', ['api', '--paginate', '--slurp', `repos/${repository}/releases?per_page=100`]));
  if (!Array.isArray(pages) || !pages.every(Array.isArray)) throw new Error('Invalid release metadata response.');
  return pages.flat();
}

function validatePromotion(tag, source, releases, repository) {
  const version = promotionVersion(tag);
  repositoryName(repository);
  if (!source || source.tag_name !== tag || source.draft !== false || source.prerelease !== true ||
      typeof source.published_at !== 'string' || !Number.isFinite(Date.parse(source.published_at))) {
    throw new Error('Promotion requires a published, non-draft prerelease matching promote_tag.');
  }
  const latestStable = latestReleaseTag(releases, true);
  if (latestStable && compareVersionTags(`v${version}`, latestStable) <= 0) {
    throw new Error(`Promotion would replace an equal or newer stable release (${latestStable}).`);
  }
  if (releases.some((release) => release.tag_name === `v${version}`)) {
    throw new Error('The stable release already exists, possibly as a draft.');
  }
  const filename = `monky-bot-${tag.slice(1)}.tgz`;
  const assets = source.assets?.filter((asset) => asset.name === filename) || [];
  if (assets.length !== 1 || assets[0].state !== 'uploaded' || !(assets[0].size > 0) ||
      !Number.isSafeInteger(assets[0].id) || assets[0].id <= 0 ||
      assets[0].browser_download_url !== `https://github.com/${repository}/releases/download/${tag}/${filename}`) {
    throw new Error('Expected exactly one uploaded beta tarball from this release.');
  }
  const asset = assets[0];
  if (asset.digest != null && !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) {
    throw new Error('Unsupported or invalid release asset digest.');
  }
  return { version, asset };
}

function verifyDownloadedAsset(buffer, asset) {
  if (buffer.length !== asset.size) throw new Error('Downloaded beta asset size mismatch.');
  const digest = `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
  if (asset.digest && digest !== asset.digest) throw new Error('Downloaded beta asset digest mismatch.');
}

function releaseNotes(plan) {
  const tag = `v${plan.version}`;
  const url = `https://github.com/${plan.repository}/releases/download/${tag}/monky-bot-${plan.version}.tgz`;
  const introduction = plan.promotion
    ? `Promovido de [${plan.sourceTag}](https://github.com/${plan.repository}/releases/tag/${plan.sourceTag}). Apenas a versão raiz do pacote mudou; código, SDK e dependências são os mesmos da beta validada.`
    : 'Beta de desenvolvimento. A versão do SDK não altera o canal de publicação do bot.';
  return [
    `## 🤖 Monky Bot ${tag}`, '', introduction, '', '### Instalação desta versão', '',
    '```bash', `npm install -g "${url}"`, '```', '',
    'Para atualizar uma instalação existente, mantenha o mesmo botDir e a pasta .keys; não refaça o setup:',
    '', '```bash', 'monkybot restart', '```', '',
    'Somente na primeira instalação:', '',
    '```bash', 'monkybot setup', 'monkybot start', '```', '',
    `Código-fonte: \`${plan.target}\``, '', '### Mudanças', '', plan.changes || 'Sem mudanças adicionais.', '',
  ].join('\n');
}

function releaseArguments(plan, notes) {
  const tag = `v${plan.version}`;
  const flags = plan.promotion ? ['--latest=true'] : ['--prerelease', '--latest=false'];
  return [
    'release', 'create', tag, '--repo', plan.repository, '--target', plan.target,
    '--title', `Monky Bot ${tag}`, '--notes-file', notes, ...flags,
    path.join(DIRECTORY, `monky-bot-${plan.version}.tgz`),
  ];
}

function prepare() {
  const repository = repositoryName(process.env.GITHUB_REPOSITORY);
  const sourceTag = process.env.PROMOTE_TAG || '';
  if (sourceTag) promotionVersion(sourceTag); // Validate input before using it in any API/ref argument.
  const releases = releasesFor(repository);
  fs.mkdirSync(DIRECTORY, { recursive: true });
  let plan;
  if (sourceTag) {
    const source = releases.find((release) => release.tag_name === sourceTag);
    const { version, asset } = validatePromotion(sourceTag, source, releases, repository);
    const target = command('git', ['rev-parse', '--verify', `refs/tags/${sourceTag}^{commit}`]);
    if (!/^[a-f0-9]{40}$/.test(target)) throw new Error('Cannot resolve the beta source commit.');
    // Asset IDs are immutable: do not resolve a possibly replaced filename again.
    const buffer = execFileSync('gh', [
      'api', `repos/${repository}/releases/assets/${asset.id}`, '--header', 'Accept: application/octet-stream',
    ], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
    verifyDownloadedAsset(buffer, asset);
    const downloaded = path.join(DIRECTORY, asset.name);
    fs.writeFileSync(downloaded, buffer, { flag: 'wx' });
    promoteFile(downloaded, path.join(DIRECTORY, `monky-bot-${version}.tgz`), sourceTag);
    plan = { repository, version, promotion: true, sourceTag, sourceAssetId: asset.id, target, changes: source.body || '' };
  } else {
    const baseline = latestReleaseTag(releases);
    const target = command('git', ['rev-parse', 'HEAD']);
    if (baseline) command('git', ['merge-base', '--is-ancestor', `refs/tags/${baseline}^{commit}`, target]);
    const range = baseline ? `${baseline}..${target}` : target;
    const messages = command('git', ['log', '--reverse', '--format=%B%x00', range, '--']).split('\0');
    const initial = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    const version = nextBetaVersion(baseline || initial, messages);
    const changes = command('git', ['log', '--reverse', '--format=- %s', range, '--']);
    plan = { repository, version, promotion: false, target, changes };
  }
  fs.writeFileSync(PLAN, JSON.stringify(plan, null, 2) + '\n');
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${plan.version}\npromotion=${plan.promotion}\n`);
  }
  console.log(`Prepared v${plan.version} from ${plan.target}`);
}

function publish() {
  const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
  const releases = releasesFor(plan.repository);
  if (plan.promotion) {
    const { asset } = validatePromotion(plan.sourceTag, releases.find((release) => release.tag_name === plan.sourceTag), releases, plan.repository);
    if (asset.id !== plan.sourceAssetId) throw new Error('Beta source asset changed during promotion.');
    const target = command('git', ['rev-parse', '--verify', `refs/tags/${plan.sourceTag}^{commit}`]);
    if (target !== plan.target) throw new Error('Beta source tag changed during promotion.');
  }
  const tag = `v${plan.version}`;
  if (releases.some((release) => release.tag_name === tag)) throw new Error(`Release ${tag} already exists.`);
  if (command('git', ['tag', '--list', tag])) throw new Error(`Tag ${tag} already exists without a published release.`);
  const notes = path.join(DIRECTORY, 'release-notes.txt');
  fs.writeFileSync(notes, releaseNotes(plan));
  command('gh', releaseArguments(plan, notes));
}

if (require.main === module) {
  try {
    if (process.argv[2] === 'prepare') prepare();
    else if (process.argv[2] === 'publish') publish();
    else throw new Error('Usage: node scripts/release.js prepare|publish');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = { repositoryName, validatePromotion, verifyDownloadedAsset, releaseNotes, releaseArguments };
