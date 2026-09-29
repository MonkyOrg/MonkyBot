/* SPDX-License-Identifier: GPL-2.0-or-later
 * Read-only engine telemetry for the real multiplayer smoke test.
 */
#include "doom/doomstat.h"
#include "doom/p_local.h"
#include "d_loop.h"
#include <emscripten.h>
#include <SDL.h>

_Static_assert(sizeof(boolean) == sizeof(int), "All engine units must preserve Doom's enum boolean ABI.");
int monky_players(void) {
    int count = 0;
    for (int i = 0; i < MAXPLAYERS; i++) count += playeringame[i] ? 1 : 0;
    return count;
}
int monky_player(void) { return consoleplayer; }
int monky_x(void) { return players[consoleplayer].mo ? players[consoleplayer].mo->x : 0; }
int monky_y(void) { return players[consoleplayer].mo ? players[consoleplayer].mo->y : 0; }
int monky_tics(void) { return gametic; }
void monky_stop(void) {
    emscripten_cancel_main_loop();
    SDL_Quit();
    emscripten_force_exit(0);
}
