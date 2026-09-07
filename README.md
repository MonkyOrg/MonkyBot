# Monky Bot 🤖

O **bot oficial de referência** do Monky — comandos utilitários, diversão e mais.

> 📖 Para criar seu **próprio** bot do zero, veja a [Documentação de Bots](https://monkyorg.github.io/Monky/bots).

## Compatibilidade

Esta versão exige **protocolo Monky 8**. Atualize o aplicativo e o servidor Monky
juntos antes de atualizar o bot; servidores com protocolo 7 não são compatíveis.
O SDK incluído no pacote é verificado no build e não precisa ser instalado à parte.

O nome padrão é **MonkyBot**, com o **logo oficial do Monky** incluído no pacote.
Nome e avatar são sincronizados também em contas de bot já existentes, nos modos
manual e marketplace. Para personalizar o nome:

```bash
monkybot config set botName "Meu MonkyBot"
monkybot restart
```

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
```

Para desenvolvimento, a dependência `file:../Monky/packages/bot-sdk` espera um
checkout irmão do Monky com o mesmo protocolo e os pacotes `@monky/shared` e
`@monky/bot-sdk` já compilados. Depois execute `npm install` neste repositório.
Alternativamente, substitua essa dependência pela URL do tarball **bot-sdk** de
uma release compatível do Monky, usando `npm install "<URL do tarball>"`.
Confirme a compatibilidade com `npm run check:sdk`.

### 2. Crie o bot no servidor

1. Abra o app Monky
2. Vá em **Configurações do Servidor → Bots**
3. Digite um nome (ex.: "MonkyBot") e clique **Criar**
4. **Copie o token** — ele só aparece uma vez!

### 3. Configure e inicie com o CLI

```bash
npm run build
npm run cli -- setup      # Configura o checkout local
npm run cli -- start      # Inicia em background via pm2
```

O `setup` guia você pelo processo: escolhe o modo (manual ou marketplace), pede a
URL do servidor e o token no modo manual, e configura o nome do bot nos dois modos.
Na instalação global, use `monkybot setup` e `monkybot start`.

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

As variáveis precisam estar no ambiente do processo; `.env` não é carregado
automaticamente por `npm run dev` ou `npm start`. Com Node.js 20.6 ou superior,
você também pode usar:

```bash
node --env-file=.env dist/index.js
```

Veja `.env.example`. `MONKY_BOT_NAME` vale para ambos os modos e
`MONKY_SERVE_HOST` controla o endereço de escuta (padrão: `0.0.0.0`).

## Modo Marketplace (múltiplos servidores)

Se quiser que **qualquer servidor Monky** possa instalar o bot pela URL:

Via CLI:
```bash
monkybot setup   # Escolha opção 2 (Marketplace)
monkybot start
```

Ou defina estas variáveis no ambiente (ou carregue `.env` como mostrado acima):
```env
MONKY_SERVE=true
MONKY_SERVE_PORT=7780
MONKY_SERVE_PUBLIC_HOST=seu-ip-ou-dominio
```

O bot imprime a URL do manifest. Qualquer admin de servidor Monky pode colar essa URL em **Configurações do Servidor → Bots → Adicionar Bot via URL** para adicionar o bot automaticamente.

## Comandos

| Comando | Descrição |
|---------|-----------|
| `/ping` | Verifica se o bot está respondendo |
| `/dado [lados]` | Rola um dado (padrão: 6, máx: 100) |
| `/moeda` | Cara ou coroa |
| `/8ball [pergunta]` | Responde à pergunta completa; sem parâmetro, abre um formulário privado |
| `/enquete` | Assistente privado para criar, revisar e confirmar uma enquete |
| `/ajuda` | Lista todos os comandos |

Digite `/`, selecione o comando e preencha seus parâmetros nomeados. Por exemplo,
`lados` em `/dado` é um **inteiro entre 2 e 100**, não texto; perguntas com espaços
são preservadas. Os nomes dos comandos permanecem iguais em todos os idiomas.
Respostas e formulários acompanham o idioma do cliente (**PT-BR ou inglês**).

### Conversas privadas e enquete guiada

As respostas aparecem **somente no chat de quem chamou o comando**, sem interromper
o canal. Formulários, prévias e correções também são privados.

1. Execute `/enquete`, sem parâmetros separados por vírgula.
2. Escreva a pergunta (até 200 caracteres) e de **2 a 10 opções diferentes**.
   Cada opção tem seu próprio campo, com até 80 caracteres; vírgulas podem fazer
   parte do texto de uma opção.
3. Escolha **Somente para mim** (padrão) ou **Publicar no canal após confirmar**.
4. Revise a prévia privada. Escolha **Editar enquete** para voltar sem perder os
   valores, ou confirme o resultado.
5. Só a escolha explícita de publicar **mais a confirmação** envia a enquete ao
   canal. Cancelamento, expiração ou desconexão não publicam resultados.

Este comando cria a pergunta e a lista de opções. Ele **não implementa votação,
contagem automática nem persistência de votos**.

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

Para uma conversa em várias etapas, use `await ctx.prompt(form)` quantas vezes
precisar. Cada formulário retorna valores tipados (`string`, `number`, `boolean`
ou `string[]`), ou `null` em caso de cancelamento, expiração ou desconexão:

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

Esse trecho fica dentro de um `handler: async (ctx) => { ... }`. `ctx.reply` e
`ctx.replyEphemeral` são privados; **`ctx.publish` é público** e só deve ser usado
depois de uma escolha e confirmação explícitas. Não compartilhe o estado de uma
conversa entre invocações.

## Validação e pacote de release

```bash
npm run check:sdk
npm test
npm run pack -- 2.0.0
npm run smoke:pack -- release/monky-bot-2.0.0.tgz
```

O teste do tarball instala **offline, com cache vazio e prefixo local isolado**,
executa o CLI `--version` e inicia o bot empacotado para consultar `/manifest`,
incluindo o logo oficial. Resolução de módulos fora da instalação é rejeitada
para impedir que dependências do checkout escondam falhas. Nenhum bot ou pm2
global é instalado, parado ou reiniciado.

A CI executa esse teste **antes de publicar**. A variável de repositório
`MONKY_SDK_RELEASE` pode fixar a tag da release do Monky que fornece o SDK; sem ela,
usa-se o SDK publicado mais recente, betas inclusive. Em ambos os casos, o build
falha se o SDK não corresponder ao protocolo 8. Publique a release compatível do
Monky antes de publicar este bot.

## Como funciona

```
Usuário digita /ping
        ↓
Servidor Monky (roteia a mensagem)
        ↓
Monky Bot (processa) → ctx.reply('🏓 Pong!')
        ↓
Servidor Monky (entrega só ao autor do comando)
        ↓
Usuário vê a resposta privada no próprio chat
```

O bot é um **processo externo** — roda na sua máquina, VPS ou nuvem. Não tem acesso ao banco nem arquivos do servidor. Toda comunicação é pelo protocolo público do Monky via WebSocket.

## Estrutura

```
MonkyBot/
├── src/
│   ├── index.ts          # Ponto de entrada (runtime)
│   ├── profile.ts        # Nome padrão e avatar oficial incluído no pacote
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
├── assets/
│   └── monky-logo.png    # Logo oficial do Monky
├── tests/               # Testes de comandos e empacotamento (node:test)
├── scripts/             # Empacotamento e smoke offline do tarball
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
