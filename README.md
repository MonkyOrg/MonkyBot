# Monky Bot 🤖

O **bot oficial de referência** do Monky — um bot universal onde concentramos tudo que se deseje que um bot tenha.

Serve como **dogfood** da interface de bots: é o "primeiro terceiro" usando o protocolo público, exatamente como um bot externo faria.

> 📖 Para aprender a criar seu próprio bot, consulte a [documentação completa de Bots](https://monkyorg.github.io/Monky/bots) no site do Monky.

## Requisitos

- Node.js 18+
- Um servidor Monky rodando (v9.0.0+)

## Instalação

```bash
git clone https://github.com/MonkyOrg/MonkyBot.git
cd MonkyBot
npm install
```

## Configuração

Crie um arquivo `.env` na raiz (use `.env.example` como base):

### Modo Manual (um servidor)

```env
MONKY_SERVER_URL=ws://localhost:3000
MONKY_BOT_TOKEN=seu_token_aqui
MONKY_PUBLIC_KEY=sua_chave_ed25519_hex
```

Para obter o token:
1. No client Monky, vá em **Configurações do Servidor → Bots**
2. Clique **Criar**, copie o token

### Modo Marketplace (múltiplos servidores)

```env
MONKY_PUBLIC_KEY=sua_chave_ed25519_hex
MONKY_SERVE=true
MONKY_SERVE_PORT=7780
MONKY_SERVE_PUBLIC_HOST=meubot.example.com
MONKY_BOT_NAME=Monky Bot
```

Nesse modo, qualquer servidor Monky pode instalar o bot colando a URL `http://meubot.example.com:7780/manifest` nas configurações.

## Uso

```bash
# Desenvolvimento (com hot-reload via ts-node)
npm run dev

# Produção
npm run build
npm start
```

## Comandos

| Comando | Descrição |
|---------|-----------|
| `/ping` | Responde com pong e a latência |
| `/dado [lados]` | Rola um dado (padrão: 6, máx: 100) |
| `/moeda` | Cara ou coroa |
| `/8ball <pergunta>` | Bola mágica responde sua pergunta |
| `/enquete <pergunta> [opções]` | Enquete rápida (opções separadas por vírgula) |
| `/ajuda` | Lista todos os comandos |

## Adicionando novos comandos

Crie um arquivo em `src/commands/`:

```ts
// src/commands/saudacao.ts
import { CommandDefinition } from '@monky/bot-sdk';

export const saudacaoCommand: CommandDefinition = {
  name: 'saudacao',
  description: 'Saúda o usuário',
  handler: (ctx) => {
    ctx.reply(`👋 Olá, ${ctx.invokerNickname}!`);
  },
};
```

Registre em `src/commands/index.ts`:

```ts
import { saudacaoCommand } from './saudacao';
// ...
bot.command(saudacaoCommand);
```

## Arquitetura

```
MonkyBot (este repositório)
  ↕ WebSocket (via @monky/bot-sdk)
Servidor Monky
```

- O bot **não** tem acesso direto ao banco ou arquivos do servidor
- Toda comunicação é via protocolo público do Monky
- No modo marketplace, o bot mantém conexões independentes com cada servidor
- Cada conexão tem reconnect automático

## Links

- 📖 [Documentação de Bots (PT-BR)](https://monkyorg.github.io/Monky/bots)
- 📖 [Bot Documentation (EN)](https://monkyorg.github.io/Monky/en/bots)
- 🤖 [Bot SDK (`@monky/bot-sdk`)](https://github.com/MonkyOrg/Monky/tree/main/packages/bot-sdk)
- 🏠 [Monky](https://github.com/MonkyOrg/Monky)

## Licença

MIT
