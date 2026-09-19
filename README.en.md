# Monky Bot 🤖

The **official reference bot** for Monky — utility commands, fun and more.

> 📖 To create your **own** bot from scratch, see the [Bot Documentation](https://monkyorg.github.io/Monky/en/bots).

## Compatibility

This version requires **Monky protocol 21**. Update the Monky app and server
together before updating the bot; earlier protocol versions are not compatible.
The bundled SDK is checked during the build and needs no separate installation.

The compatible SDK is included in `vendor/` and pinned in `package-lock.json`.
This version removes
only revoked registrations or registrations whose credentials were explicitly
rejected, allowing manifest reinstallation without deleting the identity or
other servers. Its provenance and SHA-256 are documented in
[vendor/README.md](vendor/README.md).

During installation, an administrator with permission to manage bots reviews
the requested access: commands, public messages, voice publication, local
execution, polls and miniapps. MonkyBot does not request general chat reading
or participant voice reception. Manual links and migrated bots have no access
until that review; denying access prevents the corresponding feature.
Server permission to request local execution never replaces each person's
consent to prepare and run tools on their computer.

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

## Quick Start

### Option A: Install via script (recommended)

```bash
curl -fsSL https://monkyorg.github.io/install-monkybot.sh | bash
```

This installs the `monkybot` command globally. Then:

```bash
monkybot setup      # Configure by URL (recommended) or token and automatically start/restart
```

### Option B: Clone for development/customization

If you want to modify commands or create your own:

```bash
git clone https://github.com/MonkyOrg/MonkyBot.git
cd MonkyBot
```

The checkout includes the compatible SDK in `vendor`, pinned in
`package-lock.json`; it does not depend on another local Monky checkout.
See [vendor/README.md](vendor/README.md) for its provenance and dependency update instructions.

### Configure and start with the CLI

```bash
npm ci
npm run check:sdk
npm run build
npm run cli -- setup      # Configure the checkout and automatically start/restart with pm2
```

The `setup` wizard offers **URL installation — recommended** first and
**manual token connection** as the advanced option. In manual mode it asks for
the server URL and token; in both modes it keeps the current `botDir` and bot
name as the defaults when reconfiguring. After saving, setup automatically applies
a **fresh restart** of the pm2 process, or starts it if stopped or not yet registered.
No separate restart command is required. This does not delete `.keys`,
registrations, or data in the selected directory.
For a global installation, use `monkybot setup`; `monkybot start` remains available
to start a stopped bot or verify the manifest of an already-online bot.

If configuration saves but startup/restart fails, the CLI reports those stages
separately and returns an error. Check `monkybot logs`, fix the cause, and run
`monkybot restart --fresh`; do not delete keys or recreate registrations.

Bot setup does not install media tools. When someone uses music, their Monky
client requests consent and prepares its own local tools; the bot host keeps
only the general Node.js 18+ runtime.

### Link to the server

**By URL (recommended):** finish setup, copy the manifest URL printed by the
CLI, and paste it in **Server Settings → Bots** in Monky. `start` and `restart`
also verify the manifest and display that URL. The server obtains
the bot's identity and exchanges credentials automatically. The URL must be
reachable from the Monky server.

**Manual (advanced):** when the server cannot reach an HTTP endpoint on the bot,
go to **Server Settings → Bots → Generate link token**, open **Show advanced option**,
and click **Generate token**. Copy the token,
shown only once, and choose manual mode in `setup`. The link waits for the bot
to connect and announce its name and avatar. No client profile fields are needed.

> 💡 The security key (Ed25519) is **automatically generated** on first run. No manual setup needed.

### CLI — Process management

Monky Bot includes a built-in CLI that uses **pm2** for background process management, just like the Monky server CLI:

```bash
monkybot setup               # Configure and automatically apply a fresh start/restart
monkybot start               # Start with pm2 or verify the manifest if already online
monkybot stop                # Stop the bot
monkybot restart             # Restart with current config
monkybot restart --fresh     # Recreate the pm2 process from scratch
monkybot status              # Show state (PID, uptime, memory, CPU)
monkybot logs                # Show real-time logs (Ctrl+C to exit)
monkybot logs --lines 100    # Last 100 lines
monkybot logs --no-follow    # Print recent logs and exit
monkybot config              # Open Settings in a terminal
monkybot config show         # Show current config directly
monkybot config set <k> <v>  # Change a setting
monkybot config language en-US # Save the CLI language (pt-BR or en-US)
monkybot --version           # Installed version
monkybot update              # Update to the latest stable
monkybot update --beta       # Include betas and stable; install the newest version
monkybot update --beta --check # Check the beta channel without installing
monkybot update --beta --yes # Update without confirmation
monkybot autoupdate on 04:00 # Check stable, even on a beta installation
monkybot autoupdate on 04:00 --beta # Explicitly opt into beta releases
monkybot autoupdate off     # Disable automatic updates
```

Configuration is stored in `~/.monkybot/config.json`. pm2 ensures the bot restarts automatically if it crashes.

### CLI and log language

On the first interactive command, the CLI asks for **Português (Brasil)** or
**English (US)** and saves only `~/.monkybot/preferences.json`. This does not repeat
setup or change `config.json`, registrations, ports, or `.keys`. Change it later
by opening `monkybot config` and choosing **Idioma / Language**, or with
`monkybot config language pt-BR` / `monkybot config language en-US`.
The next menu already uses the new language. Without a TTY or in CI, `config`
keeps the direct configuration query. `language` remains a supported alias.

`--help`, `--version`, `update --check`, `--yes`, CI, and noninteractive input/output
never open that prompt. Without a saved preference, the CLI uses a recognized
system language or `pt-BR`. For automation, set `MONKY_BOT_LOCALE=pt-BR` or
`MONKY_BOT_LOCALE=en` in the environment without changing the saved preference.
The aliases `pt` and `en-US` follow Monky's canonical normalization.
`MONKY_LANG` is also accepted, with lower priority than `MONKY_BOT_LOCALE`.
An unreadable or invalid preference produces a warning without exposing its
contents or rewriting the file; `language` saves an explicit choice.

The operator language is also passed on subsequent CLI-managed restarts and
used for runtime log headings. Technical executable diagnostics may remain in
their original language. This is **independent** of each client's personal bot
language preference.

### Exclusive manifest port

Each bot on the same machine needs its own **available port** for URL installation.
`7780` is only the default, not a reserved port. For example, if another bot already
uses `7780`, choose a different free port for MonkyBot during setup. `/manifest` is
an endpoint of the process listening on that port, **not a shared file**: using
another process's URL links that bot, not this one.

The CLI tests a local TCP bind on the runtime's listening address: `0.0.0.0` by
default, or `MONKY_SERVE_HOST` when set in the CLI's environment. For start/restart
(including updates), without a shell override, the previous host of this bot's
managed pm2 process is preserved; the default applies only when no previous host
exists. A `127.0.0.1` bind therefore does not become `0.0.0.0` just because the
variable is missing from the shell.
The probe and ecosystem receive the same resolved host and tested port. The probe
socket is closed immediately. After starting/restarting, the CLI also requests
`GET /manifest` at the local listening address (`127.0.0.1` for `0.0.0.0`, `::1` for
`::`), without contacting the public host. It checks the SDK JSON, name, current
registration URL, and public identity of the **same HTTP response** against
`botDir/.keys/public.hex`. Because the SDK's strict JSON has no identity field,
the runtime only adds the public `x-monky-bot-public-key` header; there is no
second server or change to the registration protocol.

The HTTP startup wait is bounded to 10 seconds, with at most 1.5 seconds per
response and an 8 MiB body limit. The probe sends no tokens, never calls
`/register`, and never generates or deletes keys. **Verified locally does not
mean externally reachable:** the operator must still check firewall rules,
public DNS, and access from the Monky server.

- **Setup:** a port occupied by another service prompts only for a new port,
  retaining the other answers. The port is rechecked before saving; previous
  configuration and `.keys` remain unchanged if no valid port is selected.
  After saving, setup applies a fresh start/restart and waits for the manifest
  before displaying its URL.
- **Reconfiguring this bot:** the already-configured port can be reused without
  a manual `stop` when the CLI identifies this bot's pm2 process, including its
  working directory. After collecting the answers, setup stops only that ID
  and **confirms release with another bind before saving**. If another service
  still occupies the port, nothing is saved and only the port is requested again.
  A name or manifest response never authorizes stopping a service.
  Cancelling before that step does not stop the bot; cancelling after the stop
  can leave it stopped, without changing configuration or identity.
  `config set` still never stops services automatically.
- **Configuration:** the port check runs only when enabling Marketplace or changing
  its effective port. A conflict prevents saving. Changing `publicHost` or
  `botName`, repeating the same `mode`/`servePort`, and using manual mode do not
  probe the port or stop the bot. Host and port syntax are still validated for the relevant keys.
- **Start/restart:** starting a stopped or unregistered bot checks the port before
  installing pm2 or generating the ecosystem. An already-online bot has its actual
  manifest checked and URL displayed again; a healthy runtime remains idempotent.
  If it is not serving the correct manifest, the CLI attempts **one fresh recreation**
  of the identified process with the current configuration, then verifies again.
  Restart stops only this bot's identified process, by pm2 ID, confirms that stop
  succeeded, and tests the bind before starting. If the port remains occupied,
  the bot stays stopped and no other service is terminated.
  Updates and auto-updates use the same restart path.
  Errors querying the pm2 process inventory abort the operation rather than
  counting as an absent bot; the raw `jlist` response is never displayed.

Permission errors (`EACCES`) and other bind errors also fail with the address and
reason; they never count as an available port. This is a point-in-time check,
**not a reservation until the runtime starts**: another process can still take
the port in that interval. That is why pm2 online or an open port alone cannot
produce a success message: the manifest must pass verification too. Check the
logs on failure, and allow the required network access if the Monky server runs
on another machine.

### Beta and stable updates

`update` checks stable only. `update --beta` includes betas and stable releases,
selecting by semantic version rather than GitHub publication order.
A stable release supersedes the beta with the same number (`3.0.1` > `3.0.1-beta`).
Neither command reinstalls an equal or older version, even with `--yes`.
`--check` only queries and never installs or restarts the bot.

Downloads show received bytes and a percentage when the size is known: a bar
in interactive terminals and rate-limited lines in logs/pipes. Published asset
size and SHA-256 are checked before installation; older releases without this
metadata remain compatible. npm installation is a separate stage, without a
fabricated percentage.

After installation, the CLI offers to restart the bot if it is running;
`--yes` also confirms that restart. The configuration, `botDir`, and `.keys`
directory remain unchanged. Update the client and server to a compatible protocol.
The updater verifies the installed version and CLI entry in npm's actual global
prefix and runs the **newly installed CLI in a fresh Node process**, preserving
`PM2_HOME`, language, and host/media overrides. A stopped bot is not started.
Restart failure is reported separately from a completed installation. Restarting
does not prepare music tools on the host.

An already loaded old updater cannot receive this fix retroactively. On the
first upgrade, if installation succeeds but its old restart fails, run
`monkybot restart` separately; do not repeat setup or delete `.keys`.

Auto-update uses stable by default, even on a beta installation. With
`autoupdate on [HH:MM] --beta`, it includes both beta and stable releases and
selects the newest version; this opt-in survives promotion to stable.
After updating an older CLI, run `autoupdate on` again
with your preferred time and channel to replace the old daemon.

**First entry into the beta channel with an older CLI:** versions through
`3.0.0-beta` do not recognize `update --beta`. Install the desired beta's `.tgz`
URL directly, available in its [release notes](https://github.com/MonkyOrg/MonkyBot/releases),
using `npm install -g "<package URL>"`, then run `monkybot restart`.
If the old auto-updater is enabled, disable it first with
`monkybot autoupdate off`; re-enable it afterward using the updated CLI.
Do not repeat setup or delete `.keys`.

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

For local development without pm2, you can run directly:

```bash
npm run dev
```

Variables must be present in the process environment; `npm run dev` and `npm start`
do not load `.env` automatically. With Node.js 20.6 or newer, you can also use:

```bash
node --env-file=.env dist/index.js
```

See `.env.example`. `MONKY_BOT_NAME` applies to both modes, and `MONKY_SERVE_HOST`
controls the listening address (default: `0.0.0.0`).

## URL Installation (Marketplace, recommended)

If you want **any Monky server** to add the bot via URL:

Via CLI:
```bash
monkybot setup   # Option 1 (URL — recommended); automatically starts/restarts and verifies the manifest
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
| `/poll` | Private form that publishes voting with automatic closing |
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
reader's app language**, including poll results, queue notices, history, reply
references and copying. The bot preference still controls commands, forms and
previews. Human-authored titles, questions and options are not automatically
translated; dice and coins keep the same result in both languages. Older
messages without variants retain their original text.

### Private conversations and guided polls

Ordinary replies appear **only in the invoking user's chat**, without
interrupting the channel. The poll form is private, but submitting it publishes
the question and voting buttons for channel participants.

1. Run `/poll` (canonical `/enquete`), without comma-separated parameters.
2. Enter a question (up to 200 characters) and **2–10 different options**.
   Each option has its own field, up to 80 characters; commas can be part of an
   option's text.
3. Set a **whole-number duration** in minutes, hours, or days (1 minute to
   30 days), a **limit of 1–10,000 voters**, or both. At least one limit is
   required.
4. Click **Publish poll**. There is no preview or second confirmation.
   If a limit is missing or the duration exceeds 30 days, the bot explains the
   error and reopens the form with your entries preserved for correction.
   Cancelling the form before submitting does not create a poll.
   Private channels are supported: the server binds the poll to its authorized
   invocation and rechecks the creator's access for future operations.
   If that person loses access or the required permissions, the bot stops
   receiving responses and publishing results until authorization is restored.
5. Each person votes using the buttons and may **change their single vote while
   voting is open**. The limit counts distinct people, not clicks.
6. Voting closes at the first limit reached: duration or voter count.
   The public result shows counts, percentages, the winning option, a tie, or no
   votes, using each reader's app language.

The Monky server persists the question, votes, and closure; it continues enforcing
expiry and rejecting late votes even when the bot is offline. The bot recovers
polls on connection and checks for pending results every 30 seconds. List and
publication failures are logged and retried without duplicating an already
published result. If the bot is offline when voting closes, results are published
after it reconnects. A poll with only a voter limit stays open until that limit
is reached.

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

The tarball smoke test installs **offline, with an empty cache and an isolated
local prefix**, runs CLI `--version`, negotiates P2P voice with ICE/DTLS, and
receives a synthetic Opus packet through the bundled SDK voice path. It also
starts the packaged bot to request `/manifest`, including the official logo,
and verifies registrations after a process restart. Module resolution outside the installation
is rejected so checkout dependencies cannot mask packaging failures. The test
does not change global installations or stop/restart existing bot or pm2 processes.

CI runs the smoke test **before publishing**. The repository variable
`MONKY_SDK_RELEASE` can pin the Monky release tag providing the SDK; otherwise,
the latest published SDK is used, including betas. Either way, the build fails
unless the SDK matches the protocol declared in `package.json` and supports
durable selectors, voice, screens, concrete local execution, and localized
command names. Packaging preserves the location and identity of transitive SDK
dependencies (including WebRTC/werift), without cloning a shared dependency for
each consumer. Distinct instances or versions remain separate; a resolution
that cannot be preserved stops packaging. `file:` workspaces remain supported.
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
│   ├── index.ts          # Entry point (runtime)
│   ├── profile.ts        # Default name and bundled official avatar
│   ├── cli.ts            # CLI — process management (monkybot start/stop/...)
│   ├── cli/
│   │   ├── constants.ts  # ANSI colors, config paths
│   │   ├── config.ts     # Read/write ~/.monkybot/config.json
│   │   ├── pm2.ts        # pm2 helpers (start, stop, ecosystem)
│   │   ├── process.ts    # Cross-platform spawn
│   │   └── commands/
│   │       ├── setup.ts      # Interactive setup
│   │       └── lifecycle.ts  # start, stop, restart, status, logs, config
│   ├── commands/
│   │   ├── index.ts      # Register all commands
│   │   ├── ping.ts
│   │   ├── dice.ts
│   │   ├── coin.ts
│   │   ├── eightball.ts
│   │   ├── poll.ts
│   │   └── help.ts
│   └── utils/
│       └── keys.ts       # Ed25519 key auto-generation
├── assets/
│   └── monky-logo.png    # Official Monky logo
├── tests/               # Command and packaging tests (node:test)
├── scripts/             # Packaging and offline tarball smoke test
├── .env.example
├── .keys/                # Auto-generated (not committed)
│   ├── private.pem
│   └── public.hex
└── package.json
```

## Links

- 📖 [Bot Documentation (EN)](https://monkyorg.github.io/Monky/en/bots)
- 📖 [Documentação de Bots (PT-BR)](https://monkyorg.github.io/Monky/bots)
- 🤖 [Bot SDK (`@monky/bot-sdk`)](https://github.com/MonkyOrg/Monky/tree/main/packages/bot-sdk)
- 🏠 [Monky](https://github.com/MonkyOrg/Monky)

## License

MIT
