/**
 * Builds a self-contained tarball of MonkyBot so it can be installed
 * globally via npm from a GitHub release, without cloning the repo.
 *
 * The tarball includes the compiled dist/, the bot-sdk dependency
 * (which itself bundles @monky/shared), and a package.json with
 * the `bin` entry so `monkybot` becomes a global CLI command.
 *
 * Usage: node scripts/pack.js [version] [--out <dir>]
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function parseArgs(argv) {
  const args = { version: null, out: path.join(ROOT, 'release') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') {
      args.out = path.resolve(argv[++i]);
    } else if (!args.version) {
      args.version = argv[i].replace(/^v/, '');
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const pkg = readJson(path.join(ROOT, 'package.json'));
  const version = args.version || process.env.MONKY_BOT_VERSION || pkg.version;

  const dist = path.join(ROOT, 'dist');
  if (!fs.existsSync(dist)) {
    throw new Error(`Missing build output: ${dist}. Run "npm run build" first.`);
  }

  const staging = path.join(ROOT, 'release', 'bot-pack');
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });

  // Copy compiled output.
  fs.cpSync(dist, path.join(staging, 'dist'), { recursive: true });

  // Copy .env.example so users have a reference.
  const envExample = path.join(ROOT, '.env.example');
  if (fs.existsSync(envExample)) {
    fs.copyFileSync(envExample, path.join(staging, '.env.example'));
  }

  // Bundle @monky/bot-sdk from node_modules (it already includes @monky/shared).
  // On dev machines this is a symlink to the workspace — dereference it.
  const sdkSrc = path.join(ROOT, 'node_modules', '@monky', 'bot-sdk');
  if (fs.existsSync(sdkSrc)) {
    const realSdkSrc = fs.realpathSync(sdkSrc);
    const sdkDest = path.join(staging, 'node_modules', '@monky', 'bot-sdk');
    fs.mkdirSync(sdkDest, { recursive: true });
    // Copy dist + package.json only (skip node_modules, src, etc.)
    const sdkDist = path.join(realSdkSrc, 'dist');
    if (fs.existsSync(sdkDist)) {
      fs.cpSync(sdkDist, path.join(sdkDest, 'dist'), { recursive: true });
    }
    const sdkPkg = path.join(realSdkSrc, 'package.json');
    if (fs.existsSync(sdkPkg)) {
      fs.copyFileSync(sdkPkg, path.join(sdkDest, 'package.json'));
    }
  }

  // Bundle @monky/shared — may be in bot-sdk's node_modules or resolved via workspace.
  const sharedCandidates = [
    path.join(ROOT, 'node_modules', '@monky', 'shared'),
    path.join(ROOT, 'node_modules', '@monky', 'bot-sdk', 'node_modules', '@monky', 'shared'),
  ];
  // In workspace setups, shared lives adjacent to bot-sdk in the monorepo.
  if (fs.existsSync(sdkSrc)) {
    const realSdk = fs.realpathSync(sdkSrc);
    sharedCandidates.push(path.resolve(realSdk, '..', 'shared'));
  }
  for (const candidate of sharedCandidates) {
    if (!fs.existsSync(candidate)) continue;
    const realSharedSrc = fs.realpathSync(candidate);
    const sharedDest = path.join(staging, 'node_modules', '@monky', 'shared');
    if (fs.existsSync(sharedDest)) break; // already copied
    fs.mkdirSync(sharedDest, { recursive: true });
    const sharedDist = path.join(realSharedSrc, 'dist');
    if (fs.existsSync(sharedDist)) {
      fs.cpSync(sharedDist, path.join(sharedDest, 'dist'), { recursive: true });
    }
    const sharedPkgFile = path.join(realSharedSrc, 'package.json');
    if (fs.existsSync(sharedPkgFile)) {
      fs.copyFileSync(sharedPkgFile, path.join(sharedDest, 'package.json'));
    }
    break;
  }

  // Build the publishable package.json.
  const publishPkg = {
    name: '@monky/bot',
    version,
    description: 'Monky Bot — the official universal reference bot for Monky',
    license: 'MIT',
    repository: { type: 'git', url: 'https://github.com/MonkyOrg/MonkyBot.git' },
    homepage: 'https://github.com/MonkyOrg/MonkyBot#readme',
    main: 'dist/index.js',
    bin: { monkybot: './dist/cli.js' },
    engines: { node: '>=18' },
    dependencies: {
      '@monky/bot-sdk': '*',
      '@monky/shared': '*',
    },
    bundleDependencies: ['@monky/bot-sdk', '@monky/shared'],
  };

  fs.writeFileSync(
    path.join(staging, 'package.json'),
    JSON.stringify(publishPkg, null, 2) + '\n'
  );

  // README.
  const readme = path.join(ROOT, 'README.md');
  if (fs.existsSync(readme)) {
    fs.copyFileSync(readme, path.join(staging, 'README.md'));
  }

  fs.mkdirSync(args.out, { recursive: true });
  const packed = execSync('npm pack', { cwd: staging, encoding: 'utf8' })
    .trim()
    .split('\n')
    .pop()
    .trim();

  const finalName = `monky-bot-${version}.tgz`;
  const finalPath = path.join(args.out, finalName);
  fs.rmSync(finalPath, { force: true });
  fs.copyFileSync(path.join(staging, packed), finalPath);
  fs.rmSync(path.join(staging, packed), { force: true });

  console.log(`[pack] ${finalPath}`);
  return finalPath;
}

main();
