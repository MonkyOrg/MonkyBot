# Monky Bot 🤖

O **bot oficial de referência** do Monky — comandos utilitários, diversão e mais.

> 📖 Para criar seu **próprio** bot do zero, veja a [Documentação de Bots](https://monkyorg.github.io/Monky/bots).

## Início rápido

### Opção A: Instalação via script (recomendado)

```bash
curl -fsSL https://monkyorg.github.io/install-monkybot.sh | bash
```

Isso instala o comando `monkybot` globalmente. Depois:

```bash
monkybot setup      # Configura interativamente (servidor, token, modo)
monkybot start      # Inicia em background via pm2
```

### Opção B: Clone para desenvolvimento/customização

Se quiser modificar comandos ou criar os seus próprios:

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

### 3. Configure e inicie com o CLI

```bash
npm run build
monkybot setup      # Configura interativamente (servidor, token, modo)
monkybot start      # Inicia em background via pm2
```

O `setup` guia você pelo processo: escolhe o modo (manual ou marketplace), pede a URL do servidor e o token. Depois é só `monkybot start`.

> 💡 A chave de segurança (Ed25519) é **gerada automaticamente** na primeira execução. Não precisa configurar nada.

### CLI — Gerenciamento de processo

O Monky Bot vem com um CLI integrado que usa **pm2** para rodar em background, assim como o Monky CLI do servidor:

```bash
monkybot setup               # Configura o bot interativamente
monkybot start               # Inicia em background via pm2
monkybot stop                # Para o bot
monkybot restart             # Reinicia aplicando a configuração atual
monkybot restart --fresh     # Recria o processo pm2 do zero
monkybot status              # Exibe estado (PID, uptime, memória, CPU)
monkybot logs                # Exibe logs em tempo real (Ctrl+C para sair)
monkybot logs --lines 100    # Últimas 100 linhas
monkybot logs --no-follow    # Imprime logs recentes e sai
monkybot config              # Exibe a configuração
monkybot config set <k> <v>  # Altera uma configuração
monkybot --version           # Versão instalada
```

A configuração fica salva em `~/.monkybot/config.json`. O pm2 garante que o bot reinicia automaticamente se cair.

> 💡 **Sem precisar manter terminal aberto!** O bot roda como daemon em background.

### Modo alternativo (desenvolvimento)

Para desenvolvimento local sem pm2, você pode rodar diretamente:

```bash
npm run dev
```

Ou configurar via `.env` (veja `.env.example`).

## Modo Marketplace (múltiplos servidores)

Se quiser que **qualquer servidor Monky** possa instalar o bot pela URL:

Via CLI:
```bash
monkybot setup   # Escolha opção 2 (Marketplace)
monkybot start
```

Ou manualmente via `.env`:
```env
MONKY_SERVE=true
MONKY_SERVE_PORT=7780
MONKY_SERVE_PUBLIC_HOST=seu-ip-ou-dominio
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
│   ├── index.ts          # Ponto de entrada (runtime)
│   ├── cli.ts            # CLI — gerenciamento de processo (monkybot start/stop/...)
│   ├── cli/
│   │   ├── constants.ts  # Cores ANSI, paths de config
│   │   ├── config.ts     # Leitura/escrita de ~/.monkybot/config.json
│   │   ├── pm2.ts        # Helpers de pm2 (start, stop, ecosystem)
│   │   ├── process.ts    # Spawn cross-platform
│   │   └── commands/
│   │       ├── setup.ts      # Setup interativo
│   │       └── lifecycle.ts  # start, stop, restart, status, logs, config
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
