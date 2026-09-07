# Monky Bot 🤖

The **official reference bot** for Monky — utility commands, fun and more.

> 📖 To create your **own** bot from scratch, see the [Bot Documentation](https://monkyorg.github.io/Monky/en/bots).

## Quick Start

### 1. Install Monky Bot

```bash
git clone https://github.com/MonkyOrg/MonkyBot.git
cd MonkyBot
npm install
```

### 2. Create the bot on the server

1. Open the Monky app
2. Go to **Server Settings → Bots**
3. Click **Create**, give it a name (e.g., "Monky Bot")
4. **Copy the token** — it's only shown once!

### 3. Configure and start with the CLI

```bash
npm run build
monkybot setup      # Interactive setup (server, token, mode)
monkybot start      # Start in background via pm2
```

The `setup` wizard walks you through: choose the mode (manual or marketplace), enter the server URL and token. Then just `monkybot start`.

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

> 💡 **No need to keep a terminal open!** The bot runs as a background daemon.

### Alternative mode (development)

For local development without pm2, you can run directly:

```bash
npm run dev
```

Or configure via `.env` (see `.env.example`).

## Marketplace Mode (multiple servers)

If you want **any Monky server** to install the bot via URL:

Via CLI:
```bash
monkybot setup   # Choose option 2 (Marketplace)
monkybot start
```

Or manually via `.env`:
```env
MONKY_SERVE=true
MONKY_SERVE_PORT=7780
MONKY_SERVE_PUBLIC_HOST=your-ip-or-domain
```

The bot prints the manifest URL. Any Monky server admin can paste it in **Settings → Bots → Install Bot from URL** to add the bot automatically.

## Commands

| Command | Description |
|---------|-------------|
| `/ping` | Responds with pong and latency |
| `/dado [sides]` | Roll a dice (default: 6, max: 100) |
| `/moeda` | Coin flip |
| `/8ball <question>` | Magic 8-ball |
| `/enquete <question> [options]` | Quick poll (comma-separated options) |
| `/ajuda` | List all commands |

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

## How it works

```
User types /ping
        ↓
Monky Server (routes the message)
        ↓
Monky Bot (processes) → ctx.reply('🏓 Pong!')
        ↓
Monky Server (delivers to channel)
        ↓
User sees the response
```

The bot is an **external process** — it runs on your machine, VPS or cloud. It has no access to the server's database or files. All communication goes through Monky's public protocol via WebSocket.

## Structure

```
MonkyBot/
├── src/
│   ├── index.ts          # Entry point (runtime)
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
