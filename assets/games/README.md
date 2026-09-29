# Bundled game runtime and corresponding source

The Monky game UI/service are part of MonkyBot. The separately loaded DOOM
engine is **GPL-2.0-or-later**, not MIT. Freedoom data uses its own permissive
license. No commercial DOOM or Contra data is included.

| Component | Source and version | License |
| --- | --- | --- |
| VectorDoom / Chocolate Doom | [VectorPrivacy/DOOM](https://github.com/VectorPrivacy/DOOM), commit `1c006ebc71b75126755158e3f2a392e9a27833b1` | `doom/COPYING-engine.txt` |
| Freedoom Phase 1 | [0.13.0](https://github.com/freedoom/freedoom/releases/tag/v0.13.0) | `doom/COPYING-freedoom.txt` and `doom/CREDITS*.txt` |
| jsnes | npm `jsnes@2.1.0`, installed/bundled with the bot | Apache-2.0, `node_modules/jsnes/LICENSE` |
| SDL2 / SDL_mixer / SDL_net | Emscripten ports 2.32.8 / 2.8.0 / version_2 | `doom/licenses/SDL*.txt` |
| libogg / libvorbis | 1.3.5 / 1.3.7 | `doom/licenses/ogg-1.3.5.txt`, `vorbis-1.3.7.txt` |
| Emscripten and system runtime | Emscripten 4.0.15 | `doom/licenses/` |

The original engine archive, local integration/build code and complete linked
port archives are included in `doom/source`. SHA-256 values are recorded in
`doom/engine-build.json`. Git attributes preserve these artifacts byte-for-byte
on every platform; do not normalize their line endings. `source/engine.tar.gz` must match
`a69bbda1a706ac48f1249fd9d51c16a2f0557e61df3330a5a7f1e0e539d2f5b7`.
The official Freedoom release ZIP was verified against its published checksum:
`3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59`.

Activate an isolated Emscripten **4.0.15** SDK, then run:

```text
node assets/games/doom/source/build.cjs
```

The script checks the original archive, extracts into a temporary directory,
applies explicit source changes, compiles the WASM/JS and copies source/license
artifacts. Emscripten obtains its pinned ports on the first build; their original
archives are also shipped in `source/ports`. `--debug` enables AddressSanitizer
and symbols for investigation; production packaging rejects a debug build.
Emscripten compiler/runtime source is available from
https://github.com/emscripten-core/emscripten/tree/4.0.15.

Local engine changes: a consistent Doom enum-boolean ABI across all compilation
units; authenticated peer IDs supplied by the Monky game transport; corrected
late-joining drone slots and client handshake ordering; explicit engine shutdown;
cooperative browser-thread waits for OPL music initialization; a bounded spectator
clock without player inputs; startup counts actual players, not spectator nodes;
read-only multiplayer
telemetry used by the real-browser test. Those changes
are applied by `build.cjs`; `monky.c` is GPL-2.0-or-later.

Run `npm run test:games:browser` with `MONKY_GAMES_ELECTRON` pointing to an
installed Monky checkout's Electron executable. The test runs two real Doom
players and a late spectator, then independently exercises both NES controllers
and spectator input replay with an original homebrew test ROM chosen only by the
host. It covers waiting/join UI, automatic authenticated ROM delivery, localized
in-game controls, host-only DOOM/NES restart/lobby actions, exact NES CPU-state
restoration from committed inputs, ROM replacement and late entry,
as well as mouse capture/release, audio and edge-to-edge canvas layout.
NES ROMs are held only in session memory and sent only to authenticated viewers;
they are not written to disk or available from a public HTTP endpoint. Host exit
or session removal releases the ROM. Restart/lobby actions advance the round so
in-flight inputs cannot affect the new game. The DOOM relay adds a round header
outside the native packet; the previous native runtime and audio context are
retired before restarting. DOOM lobby return discards progress. NES lobby return
retains the committed input replay; resume reconstructs the same state on every
client before the host emits new frames. Starting over or replacing the ROM
clears that replay. The test does not download or test a commercial Contra ROM.
