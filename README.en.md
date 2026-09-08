# Monky Bot 🤖

The **official reference bot** for Monky — utility commands, fun and more.

> 📖 To create your **own** bot from scratch, see the [Bot Documentation](https://monkyorg.github.io/Monky/en/bots).

## Compatibility

This version requires **Monky protocol 8**. Update the Monky app and server
together before updating the bot; protocol 7 servers are not compatible.
The bundled SDK is checked during the build and needs no separate installation.

The default name is **MonkyBot**, with the **official Monky logo** included in
the package. Both manual and marketplace modes synchronize the name and avatar,
including existing bot accounts. To customize the name:

```bash
monkybot config set botName "My MonkyBot"
monkybot restart
```

## Quick Start

### Option A: Install via script (recommended)

```bash
curl -fsSL https://monkyorg.github.io/install-monkybot.sh | bash
```

This installs the `monkybot` command globally. Then:

```bash
monkybot setup      # Interactive setup (server, token, mode)
monkybot start      # Start in background via pm2
```

### Option B: Clone for development/customization

If you want to modify commands or create your own:

```bash
git clone https://github.com/MonkyOrg/MonkyBot.git
cd MonkyBot
```

For development, `file:../Monky/packages/bot-sdk` expects a sibling Monky checkout
using the same protocol, with `@monky/shared` and `@monky/bot-sdk` already built.
Then run `npm install` in this repository. Alternatively, replace that dependency
with the **bot-sdk** tarball URL from a compatible Monky release using
`npm install "<tarball URL>"`. Verify compatibility with `npm run check:sdk`.

### 2. Create the bot on the server

1. Open the Monky app
2. Go to **Server Settings → Bots**
3. Enter a name (e.g., "MonkyBot") and click **Create**
4. **Copy the token** — it's only shown once!

### 3. Configure and start with the CLI

```bash
npm run build
npm run cli -- setup      # Configure the local checkout
npm run cli -- start      # Start in background via pm2
```

The `setup` wizard lets you choose manual or marketplace mode, enter the server
URL and token in manual mode, and set the bot name in either mode. For a global
installation, use `monkybot setup` and `monkybot start`.

> 💡 The security key (Ed25519) is **automatically generated** on first run. No manual setup needed.

### CLI — Process management

Monky Bot includes a built-in CLI that uses **pm2** for background process management, just like the Monky server CLI:

```bash
monkybot setup               # Interactive bot configuration
monkybot start               # Start in background via pm2
monkybot stop                # Stop the bot
monkybot restart             # Restart with current config
monkybot restart --fresh     # Recreate the pm2 process from scratch
monkybot status              # Show state (PID, uptime, memory, CPU)
monkybot logs                # Show real-time logs (Ctrl+C to exit)
monkybot logs --lines 100    # Last 100 lines
monkybot logs --no-follow    # Print recent logs and exit
monkybot config              # Show current config
monkybot config set <k> <v>  # Change a setting
monkybot --version           # Installed version
```

Configuration is stored in `~/.monkybot/config.json`. pm2 ensures the bot restarts automatically if it crashes.

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

## Marketplace Mode (multiple servers)

If you want **any Monky server** to add the bot via URL:

Via CLI:
```bash
monkybot setup   # Choose option 2 (Marketplace)
monkybot start
```

Or set these environment variables (or load `.env` as shown above):
```env
MONKY_SERVE=true
MONKY_SERVE_PORT=7780
MONKY_SERVE_PUBLIC_HOST=your-ip-or-domain
```

The bot prints the manifest URL. Any Monky server admin can paste it in **Server Settings → Bots → Add Bot from URL** to add the bot automatically.

## Commands

| Command | Description |
|---------|-------------|
| `/ping` | Check whether the bot is responding |
| `/dado [lados]` | Roll a die (default: 6, max: 100) |
| `/moeda` | Coin flip |
| `/8ball [pergunta]` | Answer the complete question; without a parameter, open a private form |
| `/enquete` | Private wizard to create, review, and confirm a poll |
| `/ajuda` | List all commands |

Type `/`, select a command, and fill its named parameters. For example, `lados`
in `/dado` is an **integer from 2 to 100**, not text; questions retain their spaces.
Command names stay the same in every language. Replies and forms follow the
client's language (**Brazilian Portuguese or English**).

### Private conversations and guided polls

Replies appear **only in the invoking user's chat**, without interrupting the
channel. Forms, previews, and corrections are private too.

1. Run `/enquete`, without comma-separated parameters.
2. Enter a question (up to 200 characters) and **2–10 different options**.
   Each option has its own field, up to 80 characters; commas can be part of an
   option's text.
3. Choose **Only for me** (default) or **Publish to the channel after confirmation**.
4. Review the private preview. Choose **Edit poll** to go back without losing your
   values, or confirm the result.
5. Only an explicit publishing choice **plus confirmation** posts the poll to the
   channel. Cancellation, expiration, and disconnection never publish results.

This command creates the question and option list. It **does not implement voting,
automatic tallies, or vote persistence**.

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
local prefix**, runs CLI `--version`, and starts the packaged bot to request
`/manifest`, including the official logo. Module resolution outside the installation
is rejected so checkout dependencies cannot mask packaging failures. The test
does not change global installations or stop/restart existing bot or pm2 processes.

CI runs the smoke test **before publishing**. The repository variable
`MONKY_SDK_RELEASE` can pin the Monky release tag providing the SDK; otherwise,
the latest published SDK is used, including betas. Either way, the build fails
unless the SDK matches protocol 8. Publish the compatible Monky release before
publishing this bot.

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
