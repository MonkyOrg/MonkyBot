# Monky Bot 🤖

O **bot oficial de referência** do Monky — um bot universal onde concentramos tudo que se deseje que um bot tenha.

Serve como **dogfood** da interface de bots: é o "primeiro terceiro" usando o protocolo público, exatamente como um bot externo faria.

## Requisitos

- Node.js 18+
- Um servidor Monky rodando (v9.0.0+)
- Um token de bot criado no servidor

## Instalação

```bash
npm install
```

## Configuração

Crie um arquivo `.env` na raiz:

```env
# Modo manual (um servidor)
MONKY_SERVER_URL=ws://localhost:3000
MONKY_BOT_TOKEN=seu_token_aqui
MONKY_PUBLIC_KEY=sua_chave_ed25519_hex

# Modo marketplace (múltiplos servidores)
MONKY_SERVE=true
MONKY_SERVE_PORT=7780
MONKY_SERVE_PUBLIC_HOST=meubot.example.com
MONKY_BOT_NAME=Monky Bot
```

## Uso

```bash
# Desenvolvimento
npm run dev

# Produção
npm run build
npm start
```

## Comandos disponíveis

| Comando | Descrição |
|---------|-----------|
| `/ping` | Responde com pong e a latência |
| `/dado [lados]` | Rola um dado (padrão: 6 lados) |
| `/enquete <pergunta> [opções]` | Cria uma enquete rápida |
| `/moeda` | Cara ou coroa |
| `/8ball <pergunta>` | Bola mágica responde sua pergunta |
| `/ajuda` | Lista todos os comandos disponíveis |

## Arquitetura

```
MonkyBot (processo externo)
    ↕ WebSocket (via @monky/bot-sdk)
Servidor Monky
```

O bot **não** tem acesso direto ao banco ou arquivos do servidor. Toda comunicação é via protocolo público do Monky.

## Licença

MIT
