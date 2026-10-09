# Monky Bot 🤖

The **official reference bot** for Monky — utility commands, fun and more.

> 📖 To create your **own** bot from scratch, see the [Bot Documentation](https://monkyorg.github.io/Monky/en/bots).

## DOOM and NES emulator

In a voice room, use **`/doom`** for DOOM/Freedoom or **`/nes`** for the NES emulator.
The commands open their miniapps directly; there is no `/games` catalog.
Open the miniapp on the stage: its creator gets player 1, one friend joins as
player 2, and everyone else can watch. DOOM files load automatically,
then the creator starts once both players are ready. NES can also start solo.
Closing a player's view interrupts play; spectators can join later.
Sessions expire after 30 minutes.

In DOOM, click the canvas to capture the mouse: move to turn and use the left
button or space to fire. `Esc` releases the cursor; click again to recapture.
During play, the game fills the miniapp area while preserving its aspect ratio.
Use Monky's existing stage fullscreen control to expand the view.
Switching windows, exiting fullscreen or ending the game releases held controls.
**Controls and options** (or `F2`) also releases the mouse and shows the DOOM
instructions. Only the host can **Restart game** or **Return to lobby**, with
confirmation and synchronized effects for players and spectators. In DOOM both
actions discard progress; starting again keeps the seats and does not require
reopening the miniapp. `Esc` remains available to release the mouse.

DOOM uses a GPL engine with bundled **Freedoom 0.13.0**: free maps, graphics and
music, different from commercial DOOM. In NES, **only the person who ran `/nes`
chooses the ROM**: an iNES file up to 4 MiB that they have permission to share.
The bot keeps it only in session memory and sends it over authenticated connections
to players and spectators, including late arrivals. The bot does not save the file
or expose a public download URL. Ending the session or leaving as host releases it.
Others see a waiting-for-host message and can already choose **Join as player 2**,
without selecting any file. A free seat can also be taken during a solo game.
Spectators start watching automatically when the host starts, with input replay
to synchronize late arrivals.

**NES controls:** arrows = D-pad, `X` = A, `Z` = B, `Enter` = Start and `Shift` =
Select. Each player uses these keys for their own controller; for co-op, select
the game's two-player mode. Instructions appear in the lobby and under
**Controls and options**, available during play or with `Esc`. The menu does not
pause the game. Only the host has **Restart ROM** and **Return to lobby**, with
confirmation and synchronized effects for everyone. In NES, returning to the
lobby preserves progress: **Resume game** restores it for players and spectators.
**Start over** requires confirmation; choosing another valid ROM also discards
the old progress. Resume works only in the current session with the same ROM;
it is not a persistent save on disk.
No commercial game is bundled with the emulator. Automated coverage uses an
original homebrew fixture. Sources, credits and rebuild instructions are in `assets/games`.

A **Monky client supporting web miniapps** is required. Older clients display
an update message. The bot serves game assets and multiplayer on port **7781**,
separate from its manifest. Set `MONKY_GAMES_PUBLIC_URL` to an HTTP(S) origin
reachable by every participant. In production use HTTPS/WSS with a proxy
forwarding `/games/*` and WebSocket upgrades. `MONKY_GAMES_HOST` and
`MONKY_GAMES_PORT` set the bind. Without an explicit URL, it uses
`http://<MONKY_SERVE_PUBLIC_HOST or localhost>:7781`. `localhost` only works
when the bot and clients run on the same computer.

The listener starts on demand and checks files and its port before creating a
miniapp. Each client checks HTTP access and WebSocket authentication before
enabling play. A local bind does not prove external reachability: firewall,
DNS and proxy must allow players' connections. Failures appear in the miniapp.

The `games` port is declared to the CLI: `monkybot requirements` lists it for the
firewall, and `monkybot config env set MONKY_GAMES_PUBLIC_URL https://games.example.com`
saves the URL in the profile, outside the package (the process environment wins;
restart the bot after a change). In marketplace mode, without an explicit URL, the
bot and `monkybot doctor` use `http://<public host>:<port>`. **In manual mode** the
public host is unknown: without `MONKY_GAMES_PUBLIC_URL`, games use `localhost` and
`doctor` does not test the port from outside. While open, the listener answers the
signed reachability challenge of `doctor` and the Monky server, proving that the
port reaches **this bot**; while it is closed, `doctor` opens a temporary responder
to test the firewall.
To exercise both engines from a checkout, run `npm run test:games:browser`
with `MONKY_GAMES_ELECTRON` pointing to the Monky checkout's Electron executable.

## Compatibility

This beta uses **Monky protocol 37** with official SDK **37.0.0-beta**.
Use the Monky app and server **v37.0.0-beta**; the external port test of
`monkybot doctor` requires a protocol 37 server. The bundled SDK is checked
during the build and needs no separate installation.
Profiles, identities, registrations, languages and requested capabilities are
preserved; this update does not enable microphone reception.

The `monkybot` command is now the **Monky SDK bot CLI**, the same one used by the
other bots (such as Myinstants): commands, consent, `doctor` and `requirements`
are identical. Installations of the former standalone CLI (through
`v17.0.0-beta`) need a few one-time steps, described in
[Migrate from the former standalone CLI](#migrate-from-the-former-standalone-cli).

The official SDK includes persistent out-of-invocation messaging, native live
actions, and the voice, miniapp, and local-execution
contracts required by the bot. Package provenance and SHA-256 are documented
in `vendor/README.md`.

The `/poll` command has been removed: create polls through the **+** menu in
Monky's composer. `/reminder` and `/giveaway` are now included in the bot.
After upgrading, review the **live actions** capability on the server to
allow giveaways; existing approvals do not automatically grant new access.

The compatible SDK is included in `vendor/` and pinned in `package-lock.json`.
This version removes
only revoked registrations or registrations whose credentials were explicitly
rejected, allowing manifest reinstallation without deleting the identity or
other servers. Its provenance and SHA-256 are documented in
[vendor/README.md](vendor/README.md).

During installation, an administrator with permission to manage bots reviews
the requested access: commands, public messages, voice publication, local
execution, miniapps, and live actions. Reminders use public messages
outside an invocation; giveaways use public messages and live actions. MonkyBot does not request general chat reading
or participant voice reception. Manual links and migrated bots have no access
until that review; denying access prevents the corresponding feature.
Server permission to request local execution never replaces each person's
consent to prepare and run tools on their computer.

When opening a miniapp, participants see what the app may do and choose
**Continue and open** or **Cancel**. This grants no bot capabilities:
the administrator authorizes commands, messages, voice, local execution and miniapps.

Every push to `main` produces a `-beta` prerelease without replacing stable,
regardless of the SDK channel. A stable release is published only through
explicit promotion of a beta.

The default name is **MonkyBot**, with the **official Monky logo** included in
the package. Both manual and marketplace modes synchronize the name and avatar,
including existing bot accounts. To customize the name:

```bash
monkybot config set botName "My MonkyBot"
monkybot restart
```

The client only links the bot, adjusts its behavior settings, and unlinks it.
The bot owns its name and avatar; administrators cannot edit them in the client.

## Host operator consent

Before starting, the host operator confirms the bot's access on this machine.
`monkybot setup` shows the notice and asks, defaulting to **No**;
`monkybot consent` shows the notice and status at any time. MonkyBot runs with the
system account permissions (this is not a sandbox), reads its program and assets,
writes identity, registrations, reminders and giveaways to `<botDir>/.keys`,
connects to Monky servers, listens on the declared ports (manifest and `games`) and
is managed by the profile's own PM2 (`~/.monkybot/.pm2`). For music, YouTube
searches and audio are fetched on the requester's computer by the Monky client; the
host neither contacts YouTube nor needs yt-dlp or FFmpeg.

Consent is stored in `~/.monkybot/host-consent.json`, bound to `botDir` and to a
12-character **fingerprint** computed from the modes, ports, settings and notice
declared by the package (`monkyBot.requirements`). `start`, `start --foreground`,
`restart` and the runner refuse to start without it. Changing `botDir` requires a
new confirmation. So does a version that changes the declared access: `update`
shows the new notice and asks before installing; `update --yes` and auto-update
skip that version and keep the current one running until it is approved.

```bash
monkybot consent                  # Access, status and fingerprint
monkybot consent --accept <fp>    # Approve without an interactive terminal
monkybot consent --revoke         # Withdraw approval; the next start is refused
```

For automation, review the access and set `MONKY_HOST_CONSENT=<fingerprint>` in the
service environment (after changing the variable, apply it with
`monkybot restart --fresh`, which recreates the PM2 process with the current
environment). **The former `MONKY_HOST_CONSENT=1` is no longer valid** and makes
start refuse to run. Profiles from the former CLI (with `hostConsent` in
`config.json`) inherit the current access on their first `start`; `status` and
`doctor` remind you to review it with `monkybot consent`. Running `node dist/index.js`
directly, during development, skips this check. This consent never grants
capabilities on servers that install the bot.

## Quick Start

### Option A: Install via script (recommended)

```bash
curl -fsSL https://monkyorg.github.io/install-monkybot.sh | bash
```

This installs the `monkybot` command globally. Then:

```bash
monkybot setup      # Configure by URL (recommended) or token and confirm the access
monkybot start      # Start in the background and confirm the manifest
monkybot doctor     # Check whether the bot can operate and what is missing
```

### Option B: Clone for development/customization

If you want to modify commands or create your own:

```bash
# Clone the repository
git clone https://github.com/MonkyOrg/MonkyBot.git
cd MonkyBot
```

The checkout includes the compatible SDK in `vendor`, pinned in
`package-lock.json`; it does not depend on another Monky checkout on this machine.
See [vendor/README.md](vendor/README.md) for its provenance and update procedure.

### Configure and start with the CLI

```bash
npm ci
npm run check:sdk
npm run build
npm run cli -- setup      # The packaged CLI, applied to this checkout
npm run cli -- start      # Or: npm run cli -- start --foreground (no PM2)
```

`npm run cli` runs `monky-bot-sdk cli`, the same CLI the package installs as
`monkybot`. `setup` first offers **URL installation — recommended** and, as an
advanced option, **Manual token connection**. In manual mode it asks for the server
URL and the token (hidden input, saved only in the profile); in both modes it keeps
the current `botDir`, identity and name when reconfiguring. At the end it shows the
access notice, asks for confirmation and lists the ports and settings. Setup **does
not start the bot**: run `start`, which reports success only when PM2 confirms the
process is online and, in URL mode, when `/manifest` answers on this machine with
this bot's public key. None of this deletes `.keys`, registrations or data.

For automation, without prompts:

```bash
monkybot setup --non-interactive --mode marketplace --public-host bot.example.com --serve-port 7780
monkybot setup --non-interactive --mode manual --server-url wss://monky.example.com --token-env MONKY_BOT_TOKEN
monkybot consent --accept <fingerprint shown>
```

If startup fails, check `monkybot logs` and `monkybot doctor`, fix the cause and run
`monkybot restart --fresh`; do not delete the keys or redo the registrations.

Bot setup does not install media tools. When someone uses music, their Monky client
requests consent and prepares local tools; the bot host only needs the general
Node.js runtime.

### Link to the server

**By URL (recommended):** after `start`, copy the manifest URL printed by the CLI
and paste it in **Server Settings → Bots** in Monky. `start`, `restart` and `status`
also print this URL. The server obtains the bot identity and exchanges credentials
automatically. The URL must be reachable from the Monky server.

**Manual (advanced):** when the server cannot reach an HTTP endpoint of the bot,
open **Server Settings → Bots → Generate link token**, open **Show advanced
option** and click **Generate token**. Copy the token, shown only once, and choose
the manual option in `setup`. The link waits for the bot connection to receive its
name and avatar. You do not need to set them in the client.

> 💡 The security key (Ed25519) is **generated automatically** on the first `start`, in `<botDir>/.keys`. Nothing to configure.

### Ports, settings and checks

`monkybot requirements` shows, even before setup, **what to open and configure** on
this machine. The same summary appears at the end of `setup` and in `status`.

| Port | Protocol and default | When | Who must reach it | Setting |
|---|---|---|---|---|
| `manifest` | TCP 7780 | Always, URL installation only | Monky servers that install the bot | Port and public host in `setup` |
| `games` | TCP 7781 | On demand (`/doom`, `/nes`) | Every player | `MONKY_GAMES_PORT`, `MONKY_GAMES_HOST`, `MONKY_GAMES_PUBLIC_URL` |

Manual mode does not open the manifest port; it only connects out to the server.
The only extra setting is optional: `MONKY_MUSIC_GRACE_SECONDS` (1 to 600, default
60) sets how long the bot waits before leaving an empty room or an idle queue.

```bash
monkybot requirements                                     # What to allow and configure
monkybot config env                                       # Effective values and their source
monkybot config env set MONKY_GAMES_PUBLIC_URL https://games.example.com
monkybot config env set MONKY_GAMES_PORT 7781
monkybot config env unset MONKY_GAMES_PUBLIC_URL
monkybot restart                                          # Apply the change
```

Values are saved in `~/.monkybot/environment.json`, outside the package, and are
validated by type (port, listening address or `http(s)://host[:port]` URL without a
path). **The process environment wins**: a saved value is used only when the
variable is absent, so Docker, systemd and compose keep working.

`monkybot doctor` tells whether the bot can operate and what is missing, using
`[OK]`, `[WARN]`, `[FAIL]` or `[SKIPPED]`, and exits with an error on failure. It
checks Node.js, the built entry, the profile, the `.keys` identity and consent; the
profile's PM2 process and a leftover `monkybot` process in the account's default PM2
(from the former CLI) that may hold the ports; the manual-mode token; each port,
free or in use **by this bot** (a challenge signed with the Ed25519 key), and the
manifest's validity; and the public URL as seen from this machine. With the Monky
server it checks reachability, token, key link and protocol, and runs an **external
test** of public TCP ports from the server's network (requires a protocol 37
server). In URL mode it uses up to three servers from `.keys/registrations.json`;
without a registration the external test is skipped. Free ports get a temporary
responder during the test, so you can test the firewall with the bot stopped or
before anyone opens a game. `monkybot doctor --local` skips all server traffic.

**More than one bot on the same machine:** every port must be exclusive, including
the games port. `7781` is the default `games` port and also the usual choice for a
second bot's manifest (for example, Myinstants). In that case, move the games to
another free port, allow it through the firewall and restart:

```bash
monkybot config env set MONKY_GAMES_PORT 7782
monkybot config env set MONKY_GAMES_PUBLIC_URL https://games.example.com   # behind a proxy or in manual mode
monkybot restart
```

In URL mode, without `MONKY_GAMES_PUBLIC_URL`, the public URL uses the new port.
`doctor` reports the `games` port held by another process, and the bot logs how to
change it when a game cannot open its listener.

### CLI — Process management

`monkybot` uses the **profile's own PM2**, in `~/.monkybot/.pm2`, separate from the
account's default PM2. Therefore `pm2 list` without `PM2_HOME` does not show the
bot; use the commands below. Running `monkybot` without a command in a terminal
opens the arrow-key menu.

```bash
monkybot setup               # Configure mode, directory, connection and consent
monkybot start               # Start through PM2 and confirm the manifest; if online, only verify
monkybot start --foreground  # Run in this terminal, without PM2
monkybot stop                # Stop the bot
monkybot restart             # Restart with the current configuration
monkybot restart --fresh     # Recreate the process without deleting the profile
monkybot status              # Process state, configuration, ports and consent
monkybot logs                # Live logs (Ctrl+C to exit)
monkybot logs --lines 100 --no-follow  # Last 100 lines, then exit
monkybot doctor [--local]    # Check whether the bot can operate
monkybot requirements        # Ports to allow and settings
monkybot consent             # Review the host operator authorization
monkybot config              # Configuration (menu in a terminal; text in scripts)
monkybot config show         # Show the configuration with secrets hidden
monkybot config set <k> <v>  # mode, botName, botDir, serverUrl, botToken, tokenEnv, servePort, publicHost
monkybot config env [set|unset] <NAME>  # Bot-declared variables
monkybot config language en-US  # CLI language (pt-BR or en-US)
monkybot --version           # Installed version
monkybot update [--check] [--beta] [--yes]
monkybot autoupdate on [HH:MM] [--beta]
monkybot autoupdate off | status
```

Configuration and identity live in `~/.monkybot` (`config.json`, `preferences.json`,
`host-consent.json`, `environment.json` and, by default, `.keys`), outside the
package. `MONKY_BOT_CLI_HOME` changes the base folder, keeping the `.monkybot`
subdirectory.

**Coming back after the machine restarts.** `start` saves the profile's PM2 list,
but a service created by a plain `pm2 startup` only restores the default PM2.
Register a service for the profile's PM2 once (Linux, systemd):

```bash
sudo env PATH="$PATH:$(dirname "$(command -v node)")" "$(command -v pm2)" startup systemd \
  -u "$USER" --hp "$HOME/.monkybot" --service-name pm2-monkybot
```

`--hp` points to the profile folder (the service uses `~/.monkybot/.pm2`) and
`--service-name` avoids replacing the default PM2's `pm2-<user>` service. Check it
with `systemctl status pm2-monkybot`. With `MONKY_BOT_CLI_HOME`, use the matching
`.monkybot` folder.

### CLI and log language

On first interactive use, the CLI asks for **Português (Brasil)** or **English (US)**
and saves only `~/.monkybot/preferences.json` — the same file as the former CLI,
which keeps working. This does not redo setup or modify `config.json`,
registrations, ports or `.keys`. To change it later, open `monkybot config` →
**Idioma / Language** or use `monkybot config language pt-BR` /
`monkybot config language en-US`.

`--help`, `--version`, `--non-interactive`, `--yes`, `--check`, CI and
non-interactive input/output never ask. `--locale pt-BR|en-US` applies to that
invocation only. For automation, `MONKY_BOT_LOCALE=pt-BR` or `en` (or, with lower
precedence, `MONKY_LANG`) selects the language without changing the saved
preference. The CLI passes the language to the bot process, which uses it in its
logs. This choice is **independent** of each user's personal language in the client.

### Exclusive manifest port

Every bot on the same machine needs an **exclusive free port** for URL installation.
`7780` is only the default, not a reserved port. `/manifest` is an endpoint of the
process listening on that port, **not a shared file**: using another process's URL
links that bot, not this one.

`setup` tests the port locally before saving and asks for another one if it is
busy; non-interactive setup and `config set servePort` fail without changing the
configuration. `start` also tests the port before starting a stopped process;
`restart` releases only this profile's managed process before testing. If the bot
itself holds the port, run `monkybot stop` before redoing setup. The listening
address is `0.0.0.0`, or `MONKY_SERVE_HOST` when set in the environment.

After starting, the CLI queries `GET /manifest` on this machine and reports success
only when it is a valid manifest with the configured host and port in its
registration URL and this bot's public key (`X-Monky-Bot-Public-Key` header, sent
by the SDK). If `start` finds the process online with a broken manifest, it
recreates only this profile's process. **Verified locally does not mean reachable
externally:** firewall, NAT and DNS can only be proven from outside, with
`monkybot doctor`.

### Beta and stable updates

`update` checks stable releases at `https://github.com/MonkyOrg/MonkyBot/releases`.
`update --beta` includes betas, selecting by semantic version. Neither command
reinstalls an equal or older version. `--check` only checks, without installing or
restarting; `--yes` skips confirmations in automation.

The self-contained `monky-bot-<version>.tgz` package is installed offline, without
install scripts, and verified (name, version and CLI) before restarting. If the bot
was running, the restart goes through the **newly installed CLI**. Profile, keys,
saved settings and schedule are preserved. For safety, the update is blocked if
`botDir` or `~/.monkybot` is inside the installed package: move them out first (see
the migration below).

Auto-update uses stable by default, even on a beta installation;
`autoupdate on [HH:MM] --beta` includes betas. `monkybot config update-source`
changes the source per profile (GitHub, HTTPS or local file).

### Publishing and promotion (maintainers)

A push to `main`, or a manual run of the **Release** workflow with an empty
`promote_tag`, publishes a beta. Numbering starts from the latest release,
including betas; conventional commits determine patch, minor, or major bumps.

To promote, run **Release** with `promote_tag` set to the published, validated
beta tag. Promotion preserves its number (`v3.0.1-beta` → `v3.0.1`) and the
contents of that beta's package and SDK, changing the root package version;
it does not include later `main` code or replace the SDK.
The Monky SDK does not need to be promoted separately to preserve that package.
Promotion is explicit and is never triggered by an ordinary push.

### Migrate from the former standalone CLI

Through `v17.0.0-beta`, MonkyBot had its own CLI. The current package uses the SDK
CLI, the same as the other bots. The `~/.monkybot` profile is reused: `config.json`
(mode, server, token, port, public host, `botDir` and name), `preferences.json`
(language) and `.keys` (identity, registrations, reminders and giveaways). What
changes:

- PM2 is now the profile's own (`~/.monkybot/.pm2`), not the account's default PM2,
  and it needs its own boot service to come back after the machine restarts;
- consent moves to `host-consent.json`, with a fingerprint, and
  `MONKY_HOST_CONSENT=1` is no longer valid; old profiles inherit the access on
  their first `start`;
- `setup` no longer starts the bot: run `start` afterwards;
- `MONKY_GAMES_*` are no longer copied from the shell into PM2: save them with
  `monkybot config env set` or set them in the service environment.

**If the update came from the former CLI** (`monkybot update --beta --yes`, for
example): it downloads and installs the new package and then ends with an error while
verifying the new CLI entry — this is expected. From then on, `monkybot --version`
already shows the new version; `config.json`, `preferences.json` and `.keys` are
untouched; the old `monkybot` process **stays online in the default PM2** with the
code it had already loaded (if PM2 restarts it, it runs the new runtime directly,
with the `botDir` `.keys`, until it is removed); and the old `monkybot-updater`, if
enabled, starts failing because the former CLI files no longer exist. Follow the
steps below; step 3 is already done.

Do this once, before the first `start` with the new CLI (Linux/macOS). The bot is
offline between steps 1 and 5:

```bash
# 1. Remove the former CLI's processes from the account's default PM2
pm2 delete monkybot-updater   # only if the old auto-update was enabled
pm2 delete monkybot
pm2 save --force             # --force saves even when the list becomes empty
rm -f ~/.monkybot/.monkybot-updater.cjs ~/.monkybot/ecosystem.config.cjs  # optional: old files

# 2. Check where botDir is: it cannot be inside the global package
grep botDir ~/.monkybot/config.json
echo "$(npm root -g)/@monky/bot"

# 3. Install the new version, unless the old update already did
npm install -g "<URL of monky-bot-<version>.tgz>"
monkybot --version

# 4. If another bot on this machine uses 7781 (for example, the Myinstants manifest),
#    move the games port and allow it through the firewall
monkybot config env set MONKY_GAMES_PORT 7782

# 5. Review the access, check and start in the profile's PM2
monkybot consent             # or: monkybot consent --accept <fingerprint>
monkybot doctor --local
monkybot start
monkybot doctor

# 6. Bring the profile's PM2 back after the machine restarts (systemd)
sudo env PATH="$PATH:$(dirname "$(command -v node)")" "$(command -v pm2)" startup systemd \
  -u "$USER" --hp "$HOME/.monkybot" --service-name pm2-monkybot

# 7. Only if you used auto-update
monkybot autoupdate on 04:00 --beta
```

If `botDir` is inside the global package (step 2), copy the whole `.keys` folder
out **before installing** (for example, to `~/.monkybot/.keys`) and update `botDir`
in `config.json`; otherwise the installation replaces the package folder. If the
service set `MONKY_HOST_CONSENT=1`, replace it with the value shown by
`monkybot consent` or remove it. While the old process remains in the default PM2,
the new `start` finds the port busy and `doctor` reports the same-named process.
Do not generate a new identity or delete `.keys`.

### Reconnection after restarting or updating

In marketplace mode, authenticated registrations are saved in `registrations.json`
inside `.keys` in the working directory (`botDir`). On startup, the bot restores
its connections and commands without needing to be added again.

Keep the same `botDir` during updates and back up the entire `.keys` directory.
It contains keys and tokens: do not publish its files. Corrupt registration data
or an incomplete identity stops startup without erasing the existing data.
Saved registrations in the logs are not active connections; wait for the connected event.

**Older registrations:** through version 2.0.0, marketplace registrations existed
only in memory. If a restart already lost them, updating cannot recover them:
the server stores only the token hash. After updating the bot, revoke the old
entry in **Server Settings → Bots** and add it by URL again, once.
This creates a new account; reapply any account-specific settings.
Do not delete `.keys` during this recovery.

Authentication failures are logged. If protocol versions differ, the bot retries
while the server is updated; an invalid token requires correcting the registration.
A failed photo update is reported but does not remove the commands.

> 💡 **No need to keep a terminal open!** The bot runs as a background daemon.

### Alternative mode (development)

For development without PM2, prefer `npm run cli -- start --foreground`, which
applies the profile, consent and saved settings. You can also run the entry
directly:

```bash
npm run dev
```

There is no CLI in this mode: the bot generates/reuses `.keys` in the current
directory, and variables must be present in the process environment; `npm run dev`
and `npm start` do not load `.env` automatically. With Node.js 20.6 or newer, you
can also use:

```bash
node --env-file=.env dist/index.js
```

See `.env.example`. `MONKY_BOT_NAME` applies to both modes, and `MONKY_SERVE_HOST`
controls the listening address (default: `0.0.0.0`).

## URL Installation (Marketplace, recommended)

If you want **any Monky server** to add the bot via URL:

Via CLI:
```bash
monkybot setup   # Option 1 (URL — recommended)
monkybot start   # Start and verify the manifest
```

Or set these environment variables (or load `.env` as shown above):
```env
MONKY_SERVE=true
MONKY_SERVE_PORT=7780
MONKY_SERVE_PUBLIC_HOST=your-ip-or-domain
```

The bot prints the manifest URL. An administrator with bot-management permission
can paste it in **Server Settings → Bots** to link the bot. Its name and avatar
come from the bot; the client does not create or edit its profile.

## Commands

| Command (English) | Description |
|---------|-------------|
| `/ping` | Check whether the bot is responding |
| `/dice [sides]` | Roll a die (default: 6, max: 100) |
| `/coin` | Coin flip |
| `/8ball <question>` | Answer the required complete question privately |
| `/reminder` | Schedule a persistent message in the current channel |
| `/giveaway` | Publish a persistent live action for entries and an automatic draw |
| `/play <search>` | Search by YouTube name or URL, preview privately, and select to add to queue |
| `/queue` | Current track and numbered upcoming queue |
| `/nowplaying` | Current track, pause/loading state and position |
| `/pause` / `/resume` | Pause and resume at the same position, without restarting |
| `/skip` | Skip the current track (or the first pending load) |
| `/stop` | Stop and clear everything; remain connected during the grace period |
| `/leave` | Stop, clear and disconnect voice |
| `/remove <position>` | Remove a 1-based position from the upcoming queue |
| `/clear` | Clear only upcoming tracks, preserving the current track |
| `/tic-tac-toe` | Shared screen for 2 players and spectators |
| `/doom` | Co-op DOOM/Freedoom with bundled free game data |
| `/nes` | NES emulator with a local ROM, for solo or two-player games |
| `/help` | List all commands |

Type `/`, select a command, and fill its named parameters. For example, `lados`
in `/dice` is an **integer from 2 to 100**, not text; questions retain their spaces.
Display/input names, descriptions, fields, replies and forms support
**Brazilian Portuguese and English**. For example, `/dado` appears as `/dice`
in English, and `/play` as `/tocar` in PT-BR. Internal command identifiers and
argument names/values do not change. Canonical names remain accepted in every
language, including those used in the examples below. Presentation follows the
client's selected language by default. In personal bot preferences, **Bot language**
offers **Follow Monky** or a language override for that bot. This is not a shared
server setting. Bot messages include PT-BR/EN variants and appear in **each
reader's app language**, including reminders, giveaway results, queue notices, history, reply
references and copying. The bot preference still controls commands, forms and
previews. Human-authored titles, questions and options are not automatically
translated; dice and coins keep the same result in both languages. Older
messages without variants retain their original text.

### Persistent reminders and giveaways

`/reminder` (canonical `/lembrete`) opens a private form for a **message**,
**whole-number duration**, and **unit**. Durations range from 1 minute to 365
days. It can run once or repeat daily/weekly for up to 30 deliveries. When due,
the bot posts in the originating channel and writes `@nickname` to mention the
creator. Each person may keep up to 20 pending reminders per server.

`/giveaway` (canonical `/sorteio`) accepts a **prize/title**, optional rules,
up to five carousel images, a duration from 1 minute to 30 days, and 1–10 winners. It publishes a live
action with a simple entry confirmation. Repeated submissions by the same
account are idempotent: only the first record for each `userId` is eligible.
At the deadline, the live action is closed, distinct winners are selected with
`crypto.randomInt`, and the public result includes the number of valid entries.
Each server may have up to 20 active or publishing giveaways.

Reminders, giveaway configuration, entries, and already selected winners are
stored in `.keys/scheduled-actions.json` using atomic replacement. Back it up
with the identity's `private.pem`, `public.hex`, and `registrations.json`.
On restart, the bot recovers deadlines; if disconnected when one expires, it
publishes after reconnecting. The server retains the live action, while giveaway
entries belong to the bot's local state.

After an ambiguous acknowledgement loss, the bot retries rather than losing a
reminder or result. Because `sendMessage` does not accept `clientMessageId`, the
server may already have accepted the first copy, so an uncommon duplicate is
possible after a connection failure at exactly that point.

### Music: prerequisites, limits and responsible use

Search, resolution, and processing for each public YouTube track run
**anonymously on the requesting person's Monky client**. The server and the
MonkyBot host/VPS do not download media, do not require Node 22, yt-dlp, or
FFmpeg, and are never used as a fallback. The client prepares its managed tools
after local consent; provider login, cookies, and credentials are unsupported.
Other participants still hear the bot's normal room publication.

Selecting `/play` (`/tocar` in pt-BR) checks client prerequisites before search.
The Monky dialog describes Node.js, yt-dlp, and FFmpeg, their purposes and
estimated storage, and only prepares tools after authorization.
Progress and **Try again** appear in that same dialog.
Ready tools are reused; subsequent searches do not repeat installation.
The bot tools tab in Monky settings lets users review permissions, remove tools,
and clear cache with the app's own confirmation and feedback.

Pause, resume, skip, stop, clear, remove, and leave remain available without
installing local tools. Their existing control permissions do not change.

#### Client-side tools and diagnostics

The terminal commands `music-check`, `music-setup`, and `music-diagnose` were
removed: they inspected or prepared tools on the bot host, not on the client
executing music. Installation, consent, and diagnostics belong in Monky's bot
tool management. All music commands in the app, including `/play`, queue,
pause, resume, and skip, remain available.

Host tools installed by older versions are neither used as a fallback nor
removed automatically. There is no need to repeat setup, delete `.keys`, or
replace the bot identity.

Finding a suggestion does not prove that the client can resolve or download
its audio. On failure, check the private response and tool status on the
requesting client. For bot connection issues, use
`monkybot logs --no-follow --lines 100`. Do not share configuration files,
keys, cookies, tokens, or signed URLs; a generic failure does not establish
an IP block or an authentication requirement.

#### Playback and recovery

1. Join a voice room and run `/play` with a name or an individual
   `https://www.youtube.com/watch?v=...` / `https://youtu.be/...` URL.
2. Suggestions appear while typing, with up to **8 eligible public results**.
   An individual URL returns that video's suggestion. The client debounces,
   throttles, and discards superseded searches.
   The listen button generates a **private preview of up to 10 seconds** only
   when clicked: it plays in your client and adds nothing to the queue.
   Clicking a suggestion or confirming it with the keyboard executes `/play`
   exactly once. There is no separate `/query` or second selection window.
3. The queue joins the first caller's voice room and plays in order.
   Enqueue and skip requests receive an immediate processing acknowledgement.
   After validation and actual acceptance, **Added to queue** appears to everyone
   in the text channel where the track was requested, identifying its requester.
   Pause, resume, skip, stop, leave, remove and clear also publish a confirmation
   in the command's channel. Queries and errors remain private.
   Before the first track and every next track, chat shows **Preparing to play**.
   The invocation keeps its animated indicator while it is running; source lookup
   and audio startup never show an invented percentage.
   A public **Now playing** notice is sent only when the first audio frame
   starts advancing through playback.
   Failures during enqueue use a private reply. Already accepted tracks follow
   the recovery and notice policy described below.
4. Every human **in that same voice room** can control the queue, without a DJ
   role. All music commands, including `/queue`, `/nowplaying`, search and
   preview, require voice membership. If the bot is already in another room,
   the request is rejected with instructions to join the bot's room.
   Existing channel access and `USE_BOT_COMMANDS` permissions still apply.
   The originating device's current room is queried from the server before
   operations and again after search, selection and resolution, never trusting
   the initial invocation snapshot.
   Initial admission uses the active invocation as authorization scoped to that
   room, including private rooms; the server rejects callers who have moved.
   The command waits for initial admission, never for the playback duration.

If search and resolution work but the bot joins and leaves voice without
playing, check `monkybot logs --no-follow --lines 100` on the bot host. An
admission failure retains its original diagnostic in logs and a private voice
error; it is not replaced by “operation cancelled” or treated as a reason to
reinstall tools without evidence. A later attempt starts a fresh admission.
Actually cancelling or stopping during admission still cancels the enqueue,
without late audio.

The bot appears as a normal participant, without automatic mute/deafen, with
audio activity indicators and local volume/mute controls. Muting it only for
yourself does not change anyone else's audio or the queue. The current music
bot does not offer participant voice capture.

Administrative mute/deafen suppresses only audio transmission: playback keeps
advancing silently, and the queue moves on at the track's normal end.
Removing the restriction restores audio at the current position without
restarting the track. This does not change `/pause`: a manual pause stays
paused until `/resume`.

Each server has an independent queue/connection, up to **50 upcoming tracks**
(including pending resolution), and videos up to **1 hour**. Concurrent accepted
additions retain their order even when resolution completes out of order.
The client prepares consent and tools before the **15s autocomplete** and **30s
preview** deadlines. Preview audio remains on the originating client: only an
opaque identifier crosses the protocol, never audio bytes client → VPS → client.
Playback uses a private, reliable, ordered, data-only WebRTC channel to deliver
20 ms Opus packets to the bot; audio never uses the generic WebSocket and no
microphone is captured. Connections and buffers are bounded without imposing a
total deadline on manual pause. Queues are not persisted across bot restarts.

An empty voice room **or** an idle queue disconnects after **60s** by default.
Configure **right-click bot → Bot settings → Behavior on this server → Music → Idle timeout (seconds)**
with an integer from **1 to 600**. This is a shared setting for that bot on
that server, available to people permitted to configure bots and persisted
by the server. Changes apply immediately, including to pending timers:
elapsed inactivity still counts rather than restarting the whole wait.
`MONKY_MUSIC_GRACE_SECONDS` only sets the default offered by the host.
Returning before the deadline cancels the empty-room
departure without restarting the track or clearing the queue. If the requester
of the **current** track leaves voice or their client disconnects, only that
track is stopped: chat receives an explicit notice and the queue advances. That
requester's future tracks stay
queued and are not transferred to another user or device. While that requester
session remains absent, its tracks are deferred without blocking other
requesters; only server confirmation for the retained local context can make
them eligible again. `/queue` labels these entries as **waiting for requester**.
Rejoining voice on the same connection rechecks sources automatically, without
another command. Reconnecting the client creates a new connection and cannot
revive the old one's sources, even with the same session ID; remove and re-add
those entries. A newly authorized track does not inherit the block from older
contexts. Bot disconnection, voice
mode changes, and shutdown cancel loads, empty the queue, and release voice and
retained local contexts. Cancelling an invocation cancels its
pending addition, not already accepted playback; cancelling a preview leaves
the queue unchanged.

Normal queue completion is still announced in chat. Errors appear in shared chat
only when playback actually stops and requires intervention, such as definitive
voice loss or no remaining track being able to play. Recovered failures, individual
peer errors while playback continues, and failed tracks skipped in favor of one
that plays remain in local diagnostics only, except when the consecutive recovery
failure limit is exhausted: that produces one notice per removed track even if
the queue continues. Command, input and permission errors still use private replies.

Reconnection reports lost playback only if work was interrupted and has not resumed;
a healthy recovered connection or an already finished queue produces no such notice.
The bot still obeys channel permissions, and delivery failures remain in the logs.
`/queue` preserves complete titles and uses several responses when necessary to stay
within the size limit of each message.

A track may have **as many successful resumptions as needed**, without retry or
recovery messages in chat. After an interruption, the limit is **five consecutive
attempts that fail to advance audio**. Only a frame actually advanced by the player
resets that counter; a connection, response headers or downloaded bytes do not.
If all five fail, one safe notice reports the recovery failure, the track is removed
and playback moves to the next one. Manual pause suspends counting without resetting it.

The same decoder continues from the interrupted byte without restarting the song
or duplicating audio. Each network operation has a 15-second deadline and retry
delays are capped at 5 seconds. No cumulative recovery count or lifetime limit
overrides a sequence of successful resumptions. A private loopback HTTP input keeps
the decoder open and supports byte seeks without buffering the whole track.

Normal completion still requires complete audio. Corrupt, changed, unauthorized
or non-resumable sources produce explicit diagnostic errors and are skipped;
chat receives an error if playback cannot continue. Those restrictions are never
bypassed and the song is not restarted from zero. `/stop`, `/skip`, leaving or
disconnecting voice, bot shutdown and the configured empty-room deadline cancel
recovery. Manual pause preserves position, and private previews remain limited
to ten seconds without adopting this persistent wait.

**No Spotify, playlists, albums, live streams or authenticated/paywalled media
in this version.** Individual video links may include `list`, `index` or
`start_radio`: that context is discarded and only the selected video is queued.
Playlist-only URLs without a valid individual video are rejected; this does not
add playlist or continuous-radio playback.
Arbitrary URLs are not accepted. yt-dlp extraction **is not an official YouTube
audio API**: it can stop working and is subject to platform terms. Use only
your own or authorized media and respect copyright. Local execution receives no
login, cookies, or credentials, ignores local yt-dlp configuration, and does
not bypass access restrictions. The client manages the tools; terminal provider
errors remain explicit.

### Demo: shared tic-tac-toe screen

Join a voice room and run `/tic-tac-toe` (canonical `/jogo-da-velha`) in an accessible text channel.
An invitation appears in the same corner as screen-sharing notices; open it
to view the miniapp **on the voice stage**, not in a chat card.
Only participants in that room may view or interact.
The tile stays on the stage alongside cameras and screen shares, even when closed.
**Open miniapp** starts local viewing; **Leave miniapp** closes the view without
removing the tile or ending the game. Focusing or returning to the grid only
changes the layout, without restarting the screen or changing player seats.

**End miniapp** ends the game for everyone and removes its tile and invitations.
The server authorizes this action only for an administrator or the user who
invoked the creating command, while retaining room-access checks. The creator
is still recognized after reconnecting. The bot releases that instance's state,
timers and quota; late actions and responses cannot reopen the game or alter a
new instance. Run a fresh command to play again.

The creator plays **X**; a second person in the room clicks **Join as O**. Others can watch.
Click or use Tab + Enter/Space to play. The bot validates identity, turn, empty
cells, revision and win/draw; concurrent clicks cannot overwrite moves.
The self-contained HTML/CSS/JS screen has no network or application DOM access.
Controls follow each viewer's app language and update when that language
changes without resetting the game. Games expire after 30min and disappear on
bot disconnect/restart or loss of room authorization; they are not persisted.
Leaving or changing rooms closes local viewing and blocks further actions. Game
state and player seats remain until expiry or termination of the miniapp, even when the
room becomes empty; there is no automatic reset or seat reassignment.
Up to four miniapps may coexist in a room. Closing local viewing does not end the other participants' game.
Removed screens immediately release their game quota. Synchronization failure closes the
screen instead of accepting moves against uncertain state.

For QA, join the same room with two players and a spectator: attempt out-of-turn
and double clicks, complete wins/draws and verify identical positions in all three
screens. A client outside voice or in another room must not receive the miniapp.
For music, use only authorized original audio; verify pause/resume, two-server
isolation, `/clear`, `/stop`, empty-room cleanup and missing-tool errors.
Automated tests never download songs: they combine fake sources with real SDK
transport, including silent moderation and manual pause.
When FFmpeg is available, `tests/music-audio.test.js` generates an original sine
tone and verifies real Opus, queue pacing and SDK ICE/DTLS/SRTP delivery;
otherwise that test reports the missing
prerequisite and is skipped. Set `MONKY_MUSIC_FFMPEG` to enable it.

## Adding new commands

Create a file in `src/commands/`:

```ts
import { CommandDefinition } from '@monky/bot-sdk';

export const greetCommand: CommandDefinition = {
  name: 'greet',
  description: 'Greets the user',
  handler: (ctx) => ctx.reply(`👋 Hello, ${ctx.invokerNickname}!`),
};
```

Register it in `src/commands/index.ts`:

```ts
import { greetCommand } from './greet';
// ...inside registerAllCommands:
bot.command(greetCommand);
```

For multiple conversational steps, use `await ctx.prompt(form)` as often as
needed. Each form returns typed values (`string`, `number`, `boolean`, or
`string[]`), or `null` on cancellation, timeout, or disconnection:

```ts
const values = await ctx.prompt({
  title: ctx.locale === 'en' ? 'Your name' : 'Seu nome',
  fields: [{
    name: 'nome',
    label: ctx.locale === 'en' ? 'Name' : 'Nome',
    type: 'text',
    required: true,
    maxLength: 50,
  }],
});
if (values === null || ctx.signal.aborted) return;
if (typeof values.nome !== 'string') return;
ctx.reply(`👋 ${values.nome}`);
```

Place this snippet inside `handler: async (ctx) => { ... }`. `ctx.reply` and
`ctx.replyEphemeral` are private; **`ctx.publish` is public** and should only follow
an explicit choice and confirmation. Keep conversation state local to each
invocation.

## Validation and release package

```bash
npm run check:sdk
npm test
npm run pack -- 2.0.0
npm run smoke:pack -- release/monky-bot-2.0.0.tgz
```

`npm run pack` checks the game assets and builds the package with the SDK packager
(`buildBotPackage`, the same as `monky-bot-sdk build`) from a clean compilation.
The package contains `dist`, `assets`, the SDK and the production dependency tree,
and declares `monkyBot` (the `monkybot` CLI, modes, releases and requirements); the
`monkybot` command is the SDK-generated `monky-cli.cjs`.

The tarball smoke test installs **offline, with an empty cache and an isolated
local prefix**, runs `monkybot --version`, `requirements` and `config language`,
negotiates P2P voice with ICE/DTLS, and receives a synthetic Opus packet through
the bundled SDK voice path. It then runs non-interactive `setup`, confirms that
start is refused without consent, approves the fingerprint and starts the
**packaged SDK runner** (the same process PM2 runs) to request `/manifest` with the
profile identity and the official logo, verifying registrations after a process
restart. Module resolution outside the installation is rejected so checkout
dependencies cannot mask packaging failures. The test does not change global
installations or stop/restart existing bot or PM2 processes.

CI runs the smoke test **before publishing** and on pull requests. New betas
are published only after merging into `main`. The workflow uses `npm ci` with
the official SDK in `vendor/`, pinned by the lockfile; it does not replace the
dependency with a newer release during the build. Manual dispatch requires
`promote_tag` and explicit approval to promote an existing beta without rebuilding.
The build fails
unless the SDK matches the protocol declared in `package.json` and supports
native live actions, voice, screens, concrete local execution, localized
command names, the reusable runtime CLI and the reachability challenge.
Publish the compatible Monky release before publishing this bot.

## How it works

```
User types /ping
        ↓
Monky Server (routes the message)
        ↓
Monky Bot (processes) → ctx.reply('🏓 Pong!')
        ↓
Monky Server (delivers only to the caller)
        ↓
User sees the private reply in their own chat
```

The bot is an **external process** — it runs on your machine, VPS or cloud. It has no access to the server's database or files. All communication goes through Monky's public protocol via WebSocket.

## Structure

```
MonkyBot/
├── src/
│   ├── index.ts          # Entry point (runtime started by the SDK CLI)
│   ├── i18n.ts           # Operator language for logs
│   ├── profile.ts        # Default name and bundled official avatar
│   ├── commands/
│   │   ├── index.ts      # Register all commands
│   │   ├── ping.ts
│   │   ├── dice.ts
│   │   ├── coin.ts
│   │   ├── eightball.ts
│   │   ├── games.ts      # /doom and /nes
│   │   ├── music.ts      # Music through local execution on the client
│   │   ├── scheduled.ts  # Persistent reminders and giveaways
│   │   └── help.ts
│   ├── games/
│   │   └── service.ts    # games port listener (assets, multiplayer and reachability challenge)
│   ├── scheduled/
│   │   └── store.ts      # Typed state and atomic writes
│   └── utils/
│       └── keys.ts       # Ed25519 keys for direct runs (the CLI uses <botDir>/.keys)
├── assets/
│   └── monky-logo.png    # Official Monky logo
├── tests/               # Command, game, CLI and packaging tests (node:test)
├── scripts/             # SDK packaging and offline tarball smoke test
├── .env.example
└── package.json          # monkyBot: monkybot CLI, modes, releases, ports and settings
```

## Links

- 📖 [Bot Documentation (EN)](https://monkyorg.github.io/Monky/en/bots)
- 📖 [Documentação de Bots (PT-BR)](https://monkyorg.github.io/Monky/bots)
- 🤖 [Bot SDK (`@monky/bot-sdk`)](https://github.com/MonkyOrg/Monky/tree/main/packages/bot-sdk)
- 🏠 [Monky](https://github.com/MonkyOrg/Monky)

## License

MIT
