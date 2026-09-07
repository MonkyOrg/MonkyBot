# Monky Bot 🤖

O **bot oficial de referência** do Monky — comandos utilitários, diversão e mais.

> 📖 Para criar seu **próprio** bot do zero, veja a [Documentação de Bots](https://monkyorg.github.io/Monky/bots).

## Início rápido

### 1. Instale o Monky Bot

```bash
# Clone o repositório
git clone https://github.com/MonkyOrg/MonkyBot.git
cd MonkyBot
npm install
```

### 2. Crie o bot no servidor

1. Abra o app Monky
2. Vá em **Configurações do Servidor → Bots**
3. Clique **Criar**, dê um nome (ex.: "Monky Bot")
4. **Copie o token** — ele só aparece uma vez!

### 3. Configure

```bash
cp .env.example .env
```

Edite o `.env` com os dados do seu servidor:

```env
MONKY_SERVER_URL=ws://seu-servidor:3000
MONKY_BOT_TOKEN=cole_o_token_aqui
```

> 💡 A chave de segurança (Ed25519) é **gerada automaticamente** na primeira execução. Não precisa configurar nada.

### 4. Execute

```bash
npm run dev
```

Pronto! O bot conecta, registra os comandos, e os usuários já podem usar `/ping`, `/dado`, etc.

## Modo Marketplace (múltiplos servidores)

Se quiser que **qualquer servidor Monky** possa instalar o bot pela URL:

```env
MONKY_SERVE=true
MONKY_SERVE_PORT=7780
MONKY_SERVE_PUBLIC_HOST=seu-ip-ou-dominio
```

```bash
npm run dev
```

O bot imprime a URL do manifest. Qualquer admin de servidor Monky pode colar essa URL em **Configurações → Bots → Instalar Bot via URL** para adicionar o bot automaticamente.

## Comandos

| Comando | Descrição |
|---------|-----------|
| `/ping` | Responde com pong e a latência |
| `/dado [lados]` | Rola um dado (padrão: 6, máx: 100) |
| `/moeda` | Cara ou coroa |
| `/8ball <pergunta>` | Bola mágica responde |
| `/enquete <pergunta> [opções]` | Enquete rápida (opções separadas por vírgula) |
| `/ajuda` | Lista todos os comandos |

## Adicionando novos comandos

Crie um arquivo em `src/commands/`:

```ts
import { CommandDefinition } from '@monky/bot-sdk';

export const meuComando: CommandDefinition = {
  name: 'ola',
  description: 'Saúda o usuário',
  handler: (ctx) => ctx.reply(`👋 Olá, ${ctx.invokerNickname}!`),
};
```

Registre em `src/commands/index.ts`:

```ts
import { meuComando } from './meuComando';
// ...dentro de registerAllCommands:
bot.command(meuComando);
```

## Como funciona

```
Usuário digita /ping
        ↓
Servidor Monky (roteia a mensagem)
        ↓
Monky Bot (processa) → ctx.reply('🏓 Pong!')
        ↓
Servidor Monky (entrega no canal)
        ↓
Usuário vê a resposta
```

O bot é um **processo externo** — roda na sua máquina, VPS ou nuvem. Não tem acesso ao banco nem arquivos do servidor. Toda comunicação é pelo protocolo público do Monky via WebSocket.

## Estrutura

```
MonkyBot/
├── src/
│   ├── index.ts          # Ponto de entrada + configuração
│   ├── commands/
│   │   ├── index.ts      # Registro de todos os comandos
│   │   ├── ping.ts
│   │   ├── dice.ts
│   │   ├── coin.ts
│   │   ├── eightball.ts
│   │   ├── poll.ts
│   │   └── help.ts
│   └── utils/
│       └── keys.ts       # Auto-geração de chaves Ed25519
├── .env.example
├── .keys/                # Gerado automaticamente (não commitado)
│   ├── private.pem
│   └── public.hex
└── package.json
```

## Links

- 📖 [Documentação de Bots (PT-BR)](https://monkyorg.github.io/Monky/bots)
- 📖 [Bot Documentation (EN)](https://monkyorg.github.io/Monky/en/bots)
- 🤖 [Bot SDK (`@monky/bot-sdk`)](https://github.com/MonkyOrg/Monky/tree/main/packages/bot-sdk)
- 🏠 [Monky](https://github.com/MonkyOrg/Monky)

## Licença

MIT
