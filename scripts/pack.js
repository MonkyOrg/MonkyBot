/**
 * Build the self-contained MonkyBot release with the SDK packager, which
 * generates the `monkybot` command (the SDK's reusable runtime CLI) and bundles
 * the production dependency tree. This script only adds MonkyBot's own checks.
 *
 * Usage: node scripts/pack.js [version] [--out <dir>]
 */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const { checkSdk } = require('./check-sdk');

const ROOT = path.resolve(__dirname, '..');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function parseArgs(argv) {
  const args = { version: undefined, out: path.join(ROOT, 'release') };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--out') {
      if (!argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error('--out requires a directory.');
      args.out = path.resolve(argv[++index]);
    } else if (!args.version && !arg.startsWith('--')) {
      args.version = arg.replace(/^v/, '');
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function requiredFile(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile() || fs.statSync(file).size === 0) {
    throw new Error(`Missing or empty required file: ${file}`);
  }
}

function verifyAssets(root) {
  requiredFile(path.join(root, 'assets', 'monky-logo.png'));
  requiredFile(path.join(root, 'assets', 'games', 'app.js'));
  const doom = path.join(root, 'assets', 'games', 'doom');
  const engine = readJson(path.join(doom, 'engine-build.json'));
  if (engine.debug !== false || !engine.files?.['source/engine.tar.gz'] ||
      !engine.files?.['licenses/Emscripten.txt'] || !engine.files?.['source/ports/SDL2-2.32.8.zip']) {
    throw new Error('Game engine build/source/license metadata is incomplete or a debug build.');
  }
  for (const [filename, expected] of Object.entries(engine.files)) {
    const file = path.resolve(doom, filename);
    if (!file.startsWith(doom + path.sep)) throw new Error('Invalid engine artifact path.');
    requiredFile(file);
    if (createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== expected) throw new Error(`Game artifact changed: ${filename}`);
  }
  for (const filename of ['freedoom1.wad', 'COPYING-engine.txt', 'COPYING-freedoom.txt', 'CREDITS-freedoom.txt']) requiredFile(path.join(doom, filename));
}

function pack({ version, out = path.join(ROOT, 'release'), root = ROOT } = {}) {
  const pkg = readJson(path.join(root, 'package.json'));
  version = version || process.env.MONKY_BOT_VERSION || pkg.version;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid release version: ${version}`);
  }
  checkSdk(root);
  verifyAssets(root);
  if (pkg.monkyBot?.cliName !== 'monkybot' || pkg.monkyBot?.releases?.assetName !== 'monky-bot-{version}.tgz') {
    throw new Error('package.json must keep the monkybot command and the monky-bot-{version}.tgz release asset.');
  }

  // Compile from scratch so outputs of removed modules (such as the former CLI) never ship.
  fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  const { buildBotPackage } = createRequire(path.join(root, 'package.json'))('@monky/bot-sdk');
  const result = buildBotPackage({ root, version, out });
  if (result.cliName !== 'monkybot' || path.basename(result.file) !== `monky-bot-${version}.tgz`) {
    throw new Error(`Unexpected package output: ${result.file}`);
  }
  console.log(`[pack] CLI ${result.cliName}; protocol ${result.protocolVersion}; ${result.packageCount} bundled packages; ${result.file}`);
  return result.file;
}

if (require.main === module) {
  try {
    pack(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = { pack, parseArgs };
