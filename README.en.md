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

### 3. Configure

```bash
cp .env.example .env
```

Edit `.env` with your server details:

```env
MONKY_SERVER_URL=ws://your-server:3000
MONKY_BOT_TOKEN=paste_the_token_here
```

> 💡 The security key (Ed25519) is **automatically generated** on first run. No manual setup needed.

### 4. Run

```bash
npm run dev
```

Done! The bot connects, registers commands, and users can use `/ping`, `/dado`, etc.

## Marketplace Mode (multiple servers)

If you want **any Monky server** to install the bot via URL:

```env
MONKY_SERVE=true
MONKY_SERVE_PORT=7780
MONKY_SERVE_PUBLIC_HOST=your-ip-or-domain
```

```bash
npm run dev
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

## Links

- 📖 [Bot Documentation (EN)](https://monkyorg.github.io/Monky/en/bots)
- 📖 [Documentação de Bots (PT-BR)](https://monkyorg.github.io/Monky/bots)
- 🤖 [Bot SDK (`@monky/bot-sdk`)](https://github.com/MonkyOrg/Monky/tree/main/packages/bot-sdk)
- 🏠 [Monky](https://github.com/MonkyOrg/Monky)

## License

MIT
