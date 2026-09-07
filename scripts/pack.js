/**
 * Build a self-contained npm tarball, preserving the dependency tree actually
 * resolved by each requesting package, including workspace symlinks.
 *
 * Usage: node scripts/pack.js [version] [--out <dir>]
 */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { runNpm } = require('./npm');
const { checkSdk } = require('./check-sdk');

const ROOT = path.resolve(__dirname, '..');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
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

function productionDependencies(pkg) {
  const dependencies = new Map();
  for (const name of Object.keys(pkg.peerDependencies || {})) {
    dependencies.set(name, pkg.peerDependenciesMeta?.[name]?.optional === true);
  }
  for (const name of Object.keys(pkg.dependencies || {})) dependencies.set(name, false);
  for (const name of Object.keys(pkg.optionalDependencies || {})) dependencies.set(name, true);
  return dependencies;
}

function lookupPaths(requester, name) {
  return createRequire(path.join(requester, 'package.json')).resolve.paths(name) || [];
}

function resolvePackage(requester, name) {
  // resolve.paths follows Node's lookup order without requiring packages to
  // export their package.json. realpath makes workspace dependencies resolve
  // from their own workspace, not from the bot's node_modules.
  for (const directory of lookupPaths(requester, name)) {
    const candidate = path.join(directory, name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate);
  }
  return null;
}

function bundleDependencies(sourceRoot, destinationRoot) {
  const placed = new Map();
  let packageCount = 0;

  function copyDependency(name, requesterSource, requesterDestination, optional, ancestors) {
    const source = resolvePackage(requesterSource, name);
    if (!source) {
      if (optional) return null;
      throw new Error(`Missing required dependency "${name}", requested by ${requesterSource}`);
    }
    const pkg = readJson(path.join(source, 'package.json'));
    if (typeof pkg.name !== 'string' || typeof pkg.version !== 'string' || !pkg.version) {
      throw new Error(`Invalid package metadata: ${path.join(source, 'package.json')}`);
    }
    const spec = name === pkg.name ? pkg.version : `npm:${pkg.name}@${pkg.version}`;

    for (const directory of lookupPaths(requesterDestination, name)) {
      const existing = placed.get(path.join(directory, name));
      if (existing !== undefined) {
        if (existing === source) return spec;
        break;
      }
    }
    if (ancestors.includes(source)) {
      throw new Error(`Cannot preserve a shadowed dependency cycle involving "${name}" at ${source}`);
    }

    const destination = path.join(requesterDestination, 'node_modules', name);
    fs.mkdirSync(destination, { recursive: true });
    if (pkg.name.startsWith('@monky/')) {
      requiredFile(path.join(source, 'dist', 'index.js'));
      fs.cpSync(path.join(source, 'dist'), path.join(destination, 'dist'), { recursive: true });
      for (const filename of ['LICENSE', 'LICENSE.md', 'README.md']) {
        const file = path.join(source, filename);
        if (fs.existsSync(file)) fs.copyFileSync(file, path.join(destination, filename));
      }
    } else {
      fs.cpSync(source, destination, {
        recursive: true,
        filter: (file) => {
          const parts = path.relative(source, file).split(path.sep);
          return !parts.includes('node_modules') && !parts.includes('.git');
        },
      });
      if (!pkg.exports) {
        try {
          createRequire(path.join(requesterSource, 'package.json')).resolve(source);
        } catch {
          throw new Error(`Missing runtime entry for "${name}" at ${source}`);
        }
      }
    }

    placed.set(destination, source);
    packageCount++;
    const dependencies = {};
    for (const [dependency, isOptional] of productionDependencies(pkg)) {
      const childSpec = copyDependency(dependency, source, destination, isOptional, [...ancestors, source]);
      if (childSpec !== null) dependencies[dependency] = childSpec;
    }
    // The release has already resolved all peers/optional modules. Do not let
    // npm fetch a different tree (or follow file: workspace paths) on install.
    const bundled = { ...pkg, dependencies, bundleDependencies: Object.keys(dependencies) };
    delete bundled.bundledDependencies;
    delete bundled.devDependencies;
    delete bundled.peerDependencies;
    delete bundled.peerDependenciesMeta;
    delete bundled.optionalDependencies;
    writeJson(path.join(destination, 'package.json'), bundled);
    return spec;
  }

  const dependencies = {};
  const rootPackage = readJson(path.join(sourceRoot, 'package.json'));
  for (const [name, optional] of productionDependencies(rootPackage)) {
    const spec = copyDependency(name, fs.realpathSync(sourceRoot), destinationRoot, optional, []);
    if (spec !== null) dependencies[name] = spec;
  }
  return { dependencies, packageCount };
}

function pack({ version, out = path.join(ROOT, 'release'), root = ROOT } = {}) {
  const pkg = readJson(path.join(root, 'package.json'));
  version = version || process.env.MONKY_BOT_VERSION || pkg.version;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid release version: ${version}`);
  }
  checkSdk(root);
  for (const filename of ['index.js', 'cli.js']) requiredFile(path.join(root, 'dist', filename));
  requiredFile(path.join(root, 'assets', 'monky-logo.png'));

  const staging = path.join(root, 'release', 'bot-pack');
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });

  try {
    fs.cpSync(path.join(root, 'dist'), path.join(staging, 'dist'), { recursive: true });
    fs.cpSync(path.join(root, 'assets'), path.join(staging, 'assets'), { recursive: true });
    for (const filename of ['.env.example', 'README.md', 'README.en.md']) {
      const source = path.join(root, filename);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(staging, filename));
    }

    const { dependencies, packageCount } = bundleDependencies(root, staging);
    const publishPkg = {
      name: pkg.name,
      version,
      description: pkg.description,
      license: pkg.license,
      repository: { type: 'git', url: 'https://github.com/MonkyOrg/MonkyBot.git' },
      homepage: 'https://github.com/MonkyOrg/MonkyBot#readme',
      main: 'dist/index.js',
      bin: { monkybot: './dist/cli.js' },
      engines: { node: '>=18' },
      monky: pkg.monky,
      dependencies,
      bundleDependencies: Object.keys(dependencies),
    };
    writeJson(path.join(staging, 'package.json'), publishPkg);

    fs.mkdirSync(out, { recursive: true });
    const result = JSON.parse(runNpm(['pack', '--json', '--ignore-scripts'], { cwd: staging }));
    const packed = result[0]?.filename;
    if (typeof packed !== 'string' || path.basename(packed) !== packed) {
      throw new Error('npm pack did not return a tarball filename.');
    }
    const finalPath = path.join(out, `monky-bot-${version}.tgz`);
    fs.copyFileSync(path.join(staging, packed), finalPath);
    console.log(`[pack] ${packageCount} bundled packages; ${finalPath}`);
    return finalPath;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

if (require.main === module) {
  try {
    pack(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = { bundleDependencies, pack, parseArgs };
