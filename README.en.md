# Monky Bot 🤖

The **official reference bot** for Monky — a universal bot where we concentrate everything a bot should have.

It serves as **dogfood** for the bot interface: the "first third-party" using the public protocol, exactly as any external bot would.

> 📖 To learn how to create your own bot, see the [complete Bot documentation](https://monkyorg.github.io/Monky/en/bots) on the Monky site.

## Requirements

- Node.js 18+
- A Monky server running (v9.0.0+)

## Installation

```bash
git clone https://github.com/MonkyOrg/MonkyBot.git
cd MonkyBot
npm install
```

## Configuration

Create a `.env` file in the root (use `.env.example` as a base):

### Manual mode (single server)

```env
MONKY_SERVER_URL=ws://localhost:3000
MONKY_BOT_TOKEN=your_token_here
MONKY_PUBLIC_KEY=your_ed25519_public_key_hex
```

To get a token:
1. In the Monky client, go to **Server Settings → Bots**
2. Click **Create**, copy the token

### Marketplace mode (multiple servers)

```env
MONKY_PUBLIC_KEY=your_ed25519_public_key_hex
MONKY_SERVE=true
MONKY_SERVE_PORT=7780
MONKY_SERVE_PUBLIC_HOST=mybot.example.com
MONKY_BOT_NAME=Monky Bot
```

In this mode, any Monky server can install the bot by pasting `http://mybot.example.com:7780/manifest` in the settings.

## Usage

```bash
# Development (with hot-reload via ts-node)
npm run dev

# Production
npm run build
npm start
```

## Commands

| Command | Description |
|---------|-------------|
| `/ping` | Responds with pong and latency |
| `/dado [sides]` | Roll a dice (default: 6, max: 100) |
| `/moeda` | Coin flip |
| `/8ball <question>` | Magic 8-ball answers your question |
| `/enquete <question> [options]` | Quick poll (comma-separated options) |
| `/ajuda` | List all commands |

## Adding new commands

Create a file in `src/commands/`:

```ts
// src/commands/greet.ts
import { CommandDefinition } from '@monky/bot-sdk';

export const greetCommand: CommandDefinition = {
  name: 'greet',
  description: 'Greets the user',
  handler: (ctx) => {
    ctx.reply(`👋 Hello, ${ctx.invokerNickname}!`);
  },
};
```

Register it in `src/commands/index.ts`:

```ts
import { greetCommand } from './greet';
// ...
bot.command(greetCommand);
```

## Architecture

```
MonkyBot (this repository)
  ↕ WebSocket (via @monky/bot-sdk)
Monky Server
```

- The bot does **not** have direct access to the server's database or files
- All communication goes through Monky's public protocol
- In marketplace mode, the bot maintains independent connections to each server
- Each connection has automatic reconnection

## Links

- 📖 [Bot Documentation (EN)](https://monkyorg.github.io/Monky/en/bots)
- 📖 [Documentação de Bots (PT-BR)](https://monkyorg.github.io/Monky/bots)
- 🤖 [Bot SDK (`@monky/bot-sdk`)](https://github.com/MonkyOrg/Monky/tree/main/packages/bot-sdk)
- 🏠 [Monky](https://github.com/MonkyOrg/Monky)

## License

MIT
