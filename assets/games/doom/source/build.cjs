// Rebuild the bundled GPL engine with Emscripten 4.0.15. No game data is compiled in.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const archive = path.join(__dirname, 'engine.tar.gz');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if (hash(archive) !== 'a69bbda1a706ac48f1249fd9d51c16a2f0557e61df3330a5a7f1e0e539d2f5b7') {
  throw new Error('The pinned VectorDoom source archive has changed.');
}
if (!process.env.EMSDK) throw new Error('Activate Emscripten 4.0.15 before rebuilding the engine.');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'monky-doom-build-'));
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}).`);
}
try {
  run('tar', ['-xf', archive, '-C', temporary], __dirname);
  const source = path.join(temporary, 'DOOM-1c006ebc71b75126755158e3f2a392e9a27833b1');
  fs.writeFileSync(path.join(source, 'config.h'), `
#define PACKAGE_NAME "Monky Doom"
#define PACKAGE_TARNAME "monky-doom"
#define PACKAGE_VERSION "1"
#define PACKAGE_STRING "Monky Doom 1"
#define PACKAGE_BUGREPORT "https://github.com/MonkyOrg/Monky/issues"
#define PACKAGE_COPYRIGHT "Copyright (C) id Software and Chocolate Doom contributors"
#define PACKAGE_LICENSE "GNU General Public License, version 2 or later"
#define PROGRAM_PREFIX "monky-"
#define HAVE_DECL_STRCASECMP 1
#define HAVE_DECL_STRNCASECMP 1
#define HAVE_DIRENT_H 1
`);
  const sources = [];
  for (const folder of ['src', path.join('src', 'doom'), 'textscreen', 'opl', 'pcsound']) {
    const makefile = fs.readFileSync(path.join(source, folder, 'Makefile.am'), 'utf8');
    const sections = [...makefile.matchAll(/^(?:COMMON_SOURCE_FILES|GAME_SOURCE_FILES|DEHACKED_SOURCE_FILES|lib\w+_a_SOURCES)\s*=\s*([\s\S]*?)(?=\n[ \t]*\r?\n|(?![\s\S]))/gm)];
    if (!sections.length) throw new Error(`No engine source list in ${folder}.`);
    for (const section of sections) {
      for (const match of section[1].matchAll(/\b[\w]+\.c\b/g)) sources.push(path.join(folder, match[0]));
    }
  }
  if (sources.length < 100) throw new Error('Incomplete engine source list.');
  fs.copyFileSync(path.join(__dirname, 'monky.c'), path.join(source, 'monky.c'));
  const loop = path.join(source, 'src', 'd_loop.c');
  const originalLoop = fs.readFileSync(loop, 'utf8');
  if (!originalLoop.includes('instanceUID = rand() % 0xfffe;')) throw new Error('Engine UID integration changed.');
  fs.writeFileSync(loop, originalLoop.replace('instanceUID = rand() % 0xfffe;',
    'instanceUID = EM_ASM_INT({ return globalThis._monkyUID; });'));
  const serverFile = path.join(source, 'src', 'net_server.c');
  const serverSource = fs.readFileSync(serverFile, 'utf8');
  const lateStart = serverSource.indexOf('static void NET_SV_HandleLateJoin(');
  const lateEnd = serverSource.indexOf('// parse a SYN', lateStart);
  if (lateStart < 0 || lateEnd < 0) throw new Error('Engine late-join integration changed.');
  let lateJoin = serverSource.slice(lateStart, lateEnd);
  const replace = (text, before, after) => {
    if (!text.includes(before) || text.indexOf(before) !== text.lastIndexOf(before)) throw new Error(`Engine integration changed: ${before}`);
    return text.replace(before, after);
  };
  lateJoin = replace(lateJoin, 'i < (unsigned int)max_players;', '!new_client->drone && i < (unsigned int)max_players;');
  lateJoin = replace(lateJoin, 'if (slot < 0)', 'if (slot < 0 && !new_client->drone)');
  lateJoin = replace(lateJoin, 'sv_players[slot] = new_client;', 'if (slot >= 0) sv_players[slot] = new_client;');
  lateJoin = replace(lateJoin, '    new_client->drone = false;\n', '');
  lateJoin = replace(lateJoin, '    // Broadcast PLAYER_JOINED', '    if (new_client->drone) return;\n\n    // Broadcast PLAYER_JOINED');
  fs.writeFileSync(serverFile, serverSource.slice(0, lateStart) + lateJoin + serverSource.slice(lateEnd));
  const clientFile = path.join(source, 'src', 'net_client.c');
  let clientSource = fs.readFileSync(clientFile, 'utf8');
  clientSource = replace(clientSource,
    '    net_client_connected = true;\n    net_client_received_wait_data = false;',
    '    client_state = CLIENT_STATE_WAITING_LAUNCH;\n    drone = data->drone;\n    net_client_connected = true;\n    net_client_received_wait_data = false;');
  clientSource = replace(clientSource, '        client_state = CLIENT_STATE_WAITING_LAUNCH;\n        drone = data->drone;\n', '');
  fs.writeFileSync(clientFile, clientSource);
  const lobbyFile = path.join(source, 'src', 'net_gui.c');
  fs.writeFileSync(lobbyFile, replace(fs.readFileSync(lobbyFile, 'utf8'),
    'nodes = net_client_wait_data.num_players + net_client_wait_data.num_drones;',
    'nodes = net_client_wait_data.num_players;'));
  // Snapshot-driven spectators still need a local clock, but must never send inputs.
  fs.writeFileSync(loop, replace(fs.readFileSync(loop, 'utf8'),
    '    if (drone) {\n        // In drone mode, do not generate any ticcmds.\n\n        return false;\n    }',
    '    if (drone) {\n        if (maketic - gameticdiv > 8) return false;\n        ++maketic;\n        return true;\n    }'));
  const oplFile = path.join(source, 'opl', 'opl.c');
  const oplSource = fs.readFileSync(oplFile, 'utf8');
  // Audio callbacks share the browser thread; a native condition wait starves them.
  fs.writeFileSync(oplFile, '#include <emscripten.h>\n' + replace(oplSource,
    '        SDL_CondWait(delay_data.cond, delay_data.mutex);', '        emscripten_sleep(1);'));
  const compiler = path.join(process.env.EMSDK, 'upstream', 'emscripten', 'emcc.py');
  run(process.env.EMSDK_PYTHON || 'python3', [compiler,
    ...new Set(sources), 'monky.c', ...['.', 'src', 'textscreen', 'opl', 'pcsound'].map(folder => `-I${folder}`),
    // Preserve Doom's enum boolean (including -1 sentinels) before Emscripten includes stdbool.
    '-std=gnu11', '-include', 'doomtype.h',
    process.argv.includes('--debug') ? '-O0' : '-O2', '-Wno-error=incompatible-function-pointer-types', '-Wno-error=implicit-function-declaration',
    ...(process.argv.includes('--debug') ? ['-g3', '-fsanitize=address', '-sASSERTIONS=2', '-sSTACK_OVERFLOW_CHECK=2'] : []),
    '-sUSE_SDL=2', '-sUSE_SDL_MIXER=2', '-sUSE_SDL_NET=2', '-sASYNCIFY=1',
    '-sALLOW_MEMORY_GROWTH=1', '-sINITIAL_MEMORY=67108864', '-sMAXIMUM_MEMORY=268435456',
    '-sSTACK_SIZE=1048576', '-sFORCE_FILESYSTEM=1', '-sINVOKE_RUN=0', '-sEXIT_RUNTIME=1',
    '-sMODULARIZE=1', '-sEXPORT_NAME=createMonkyDoom', '-sENVIRONMENT=web',
    '-sEXPORTED_FUNCTIONS=["_main","_inject_key_event","_inject_mouse_motion","_monky_players","_monky_player","_monky_x","_monky_y","_monky_tics","_monky_stop"]',
    '-sEXPORTED_RUNTIME_METHODS=["FS","callMain","ccall"]',
    '-o', path.join(root, 'engine.js'),
  ], source);
  fs.copyFileSync(path.join(source, 'COPYING.md'), path.join(root, 'COPYING-engine.txt'));
  fs.copyFileSync(path.join(source, 'AUTHORS.md'), path.join(root, 'AUTHORS-engine.txt'));
  const emscripten = path.join(process.env.EMSDK, 'upstream', 'emscripten');
  const ports = path.join(emscripten, 'cache', 'ports');
  fs.mkdirSync(path.join(__dirname, 'ports'), { recursive: true });
  fs.mkdirSync(path.join(root, 'licenses'), { recursive: true });
  for (const [archiveName, name, license] of [
    ['sdl2.32.8.zip', 'SDL2-2.32.8', 'sdl2/SDL-release-2.32.8/LICENSE.txt'],
    ['sdl2_mixer.8.0.zip', 'SDL2_mixer-2.8.0', 'sdl2_mixer/SDL_mixer-release-2.8.0/LICENSE.txt'],
    ['sdl2_net.zip', 'SDL2_net-version_2', 'sdl2_net/SDL2_net-version_2/COPYING.txt'],
    ['ogg.3.5.zip', 'ogg-1.3.5', 'ogg/libogg-1.3.5/COPYING'],
    ['vorbis.3.7.zip', 'vorbis-1.3.7', 'vorbis/libvorbis-1.3.7/COPYING'],
  ]) {
    fs.copyFileSync(path.join(ports, archiveName), path.join(__dirname, 'ports', name + '.zip'));
    fs.copyFileSync(path.join(ports, ...license.split('/')), path.join(root, 'licenses', name + '.txt'));
  }
  for (const [filename, name] of [
    ['LICENSE', 'Emscripten'],
    ['system/lib/libc/musl/COPYRIGHT', 'musl'],
    ['system/lib/compiler-rt/LICENSE.TXT', 'compiler-rt'],
    ['system/lib/libcxx/LICENSE.TXT', 'libcxx'],
    ['system/lib/libcxxabi/LICENSE.TXT', 'libcxxabi'],
  ]) fs.copyFileSync(path.join(emscripten, ...filename.split('/')), path.join(root, 'licenses', name + '.txt'));
  fs.copyFileSync(path.join(ports, 'sdl2', 'SDL-release-2.32.8', 'src', 'video', 'yuv2rgb', 'LICENSE'),
    path.join(root, 'licenses', 'yuv2rgb.txt'));
  const included = ['engine.js', 'engine.wasm', 'source/engine.tar.gz', 'source/build.cjs', 'source/monky.c',
    ...fs.readdirSync(path.join(__dirname, 'ports')).map(file => `source/ports/${file}`),
    ...fs.readdirSync(path.join(root, 'licenses')).map(file => `licenses/${file}`)];
  fs.writeFileSync(path.join(root, 'engine-build.json'), JSON.stringify({
    source: 'https://github.com/VectorPrivacy/DOOM',
    commit: '1c006ebc71b75126755158e3f2a392e9a27833b1',
    compiler: 'Emscripten 4.0.15',
    debug: process.argv.includes('--debug'),
    files: Object.fromEntries(included.map(file => [file, hash(path.join(root, file))])),
  }, null, 2) + '\n');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
