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

  // ---------------------------------------------------------------------------
  // Bundle ALL transitive dependencies into node_modules/ so the globally
  // installed package is fully self-contained. We resolve each package from
  // the monorepo workspace (file: links) or local node_modules.
  // ---------------------------------------------------------------------------

  const sdkPath = path.join(ROOT, 'node_modules', '@monky', 'bot-sdk');
  const sdkRealPath = fs.existsSync(sdkPath) ? fs.realpathSync(sdkPath) : null;
  // Detect workspace symlink: realpath differs from the node_modules location.
  const isWorkspaceLink = sdkRealPath && sdkRealPath !== sdkPath &&
    !sdkRealPath.includes(path.join('node_modules', '@monky', 'bot-sdk'));
  const monorepoRoot = isWorkspaceLink ? path.resolve(sdkRealPath, '..', '..') : null;

  // Directories where we look for modules (order matters — first match wins).
  const searchDirs = [
    path.join(ROOT, 'node_modules'),
    // In CI, bundled deps of bot-sdk live inside its own node_modules.
    sdkRealPath ? path.join(sdkRealPath, 'node_modules') : null,
    monorepoRoot ? path.join(monorepoRoot, 'node_modules') : null,
    // Scoped packages may live adjacent in the monorepo (e.g. packages/shared).
    monorepoRoot ? path.join(monorepoRoot, 'packages') : null,
  ].filter(Boolean);

  /**
   * Recursively collect every production dependency name starting from a
   * package.json. Returns a Set of package names (e.g. "ws", "@monky/shared").
   */
  function collectDeps(pkgJsonPath, visited = new Set()) {
    if (!fs.existsSync(pkgJsonPath)) return visited;
    const pkg = readJson(pkgJsonPath);
    for (const dep of Object.keys(pkg.dependencies || {})) {
      if (visited.has(dep)) continue;
      visited.add(dep);
      // Find the dependency's package.json to recurse.
      const resolved = resolvePkgDir(dep);
      if (resolved) {
        collectDeps(path.join(resolved, 'package.json'), visited);
      }
    }
    return visited;
  }

  /** Resolve a package name to its real directory on disk. */
  function resolvePkgDir(name) {
    // For scoped monorepo packages (e.g. @monky/shared), also check packages/<name>.
    const segments = name.startsWith('@') ? [name] : [name];
    // Also try the unscoped name in the monorepo packages/ dir.
    if (name.startsWith('@monky/')) {
      segments.push(name.replace('@monky/', ''));
    }
    for (const dir of searchDirs) {
      for (const seg of segments) {
        const candidate = path.join(dir, seg);
        if (fs.existsSync(candidate)) {
          return fs.realpathSync(candidate);
        }
      }
    }
    return null;
  }

  // Start from bot-sdk's package.json — this is the entry dependency.
  const allDeps = new Set(['@monky/bot-sdk']);
  if (sdkRealPath) {
    collectDeps(path.join(sdkRealPath, 'package.json'), allDeps);
  }

  console.log(`[pack] Bundling ${allDeps.size} dependencies: ${[...allDeps].join(', ')}`);

  for (const dep of allDeps) {
    const srcDir = resolvePkgDir(dep);
    if (!srcDir) {
      console.warn(`[pack] WARNING: could not find ${dep} — skipping`);
      continue;
    }

    const destDir = path.join(staging, 'node_modules', dep);
    if (fs.existsSync(destDir)) continue;
    fs.mkdirSync(destDir, { recursive: true });

    // For @monky/* packages, copy only dist + package.json (skip src, tests, node_modules).
    if (dep.startsWith('@monky/')) {
      const distDir = path.join(srcDir, 'dist');
      if (fs.existsSync(distDir)) {
        fs.cpSync(distDir, path.join(destDir, 'dist'), { recursive: true });
      }
      const pkgFile = path.join(srcDir, 'package.json');
      if (fs.existsSync(pkgFile)) {
        fs.copyFileSync(pkgFile, path.join(destDir, 'package.json'));
      }
    } else {
      // Third-party package: copy everything except nested node_modules.
      fs.cpSync(srcDir, destDir, {
        recursive: true,
        filter: (src) => {
          // Only skip node_modules directories INSIDE the package itself.
          const rel = path.relative(srcDir, src);
          return !rel.split(path.sep).includes('node_modules');
        },
      });
    }
  }

  // Build the publishable package.json.
  const depEntries = {};
  for (const dep of allDeps) depEntries[dep] = '*';
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
    dependencies: depEntries,
    bundleDependencies: [...allDeps],
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
