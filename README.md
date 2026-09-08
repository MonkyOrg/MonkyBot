# Monky Bot 🤖

O **bot oficial de referência** do Monky — comandos utilitários, diversão e mais.

> 📖 Para criar seu **próprio** bot do zero, veja a [Documentação de Bots](https://monkyorg.github.io/Monky/bots).

## Compatibilidade

Esta versão exige **protocolo Monky 9**. Atualize o aplicativo e o servidor Monky
juntos antes de atualizar o bot; servidores com protocolos anteriores não são compatíveis.
O SDK incluído no pacote é verificado no build e não precisa ser instalado à parte.

Todo push na `main` gera uma versão `-beta`, marcada como pré-release, sem
substituir a stable, independentemente do canal do SDK. Uma stable só é
publicada por promoção explícita de uma beta.

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
monkybot update              # Atualiza para a stable mais recente
monkybot update --beta       # Inclui betas e stable; instala a versão mais nova
monkybot update --beta --check # Consulta o canal beta sem instalar
monkybot update --beta --yes # Atualiza sem confirmação
monkybot autoupdate on 04:00 # Segue o canal da versão instalada
monkybot autoupdate on 04:00 --beta # Inclui betas mesmo em uma instalação stable
monkybot autoupdate off     # Desativa a atualização automática
```

A configuração fica salva em `~/.monkybot/config.json`. O pm2 garante que o bot reinicia automaticamente se cair.

### Atualizações beta e stable

`update` consulta apenas a stable. `update --beta` inclui betas e versões stable,
escolhendo pela versão semântica, não pela ordem de publicação no GitHub.
Uma stable supera a beta do mesmo número (`3.0.1` > `3.0.1-beta`).
Nenhum dos comandos reinstala uma versão igual ou mais antiga, nem com `--yes`.
`--check` apenas consulta e não instala nem reinicia o bot.

Após instalar, o CLI oferece reiniciar o bot se ele estiver rodando; `--yes`
também confirma esse reinício. A configuração, o `botDir` e a pasta `.keys`
continuam os mesmos. Atualize cliente e servidor para um protocolo compatível.

O auto-update consulta a versão instalada a cada execução: uma instalação beta
busca betas; uma stable busca stable. Com `autoupdate on [HH:MM] --beta`,
o canal beta permanece habilitado mesmo após uma promoção para stable.
Depois de atualizar um CLI antigo, execute novamente `autoupdate on` com o
horário e canal desejados para substituir o daemon antigo.

**Primeira entrada no canal beta com um CLI antigo:** versões até `3.0.0-beta`
não reconhecem `update --beta`. Instale diretamente a URL do `.tgz` da beta
desejada, disponível nas notas da [release](https://github.com/MonkyOrg/MonkyBot/releases),
usando `npm install -g "<URL do pacote>"`, e execute `monkybot restart`.
Se o auto-update antigo estiver ativo, desative-o antes com
`monkybot autoupdate off`; reative depois usando o CLI atualizado.
Não refaça o setup nem apague `.keys`.

### Publicação e promoção (mantenedores)

Push na `main`, ou execução manual do workflow **Release** com `promote_tag`
vazio, publica beta. O número parte da última release, betas inclusive;
commits convencionais determinam os saltos de patch, minor ou major.

Para promover, execute **Release** informando em `promote_tag` a tag beta
publicada que foi validada. A promoção mantém o número (`v3.0.1-beta` →
`v3.0.1`) e o conteúdo do pacote e SDK daquela beta, alterando a versão do
pacote raiz; não inclui código posterior da `main` nem troca o SDK.
Não é necessário promover o SDK Monky separadamente para preservar esse pacote.
A promoção é explícita; nunca é disparada por um push comum.

### Reconexão após reiniciar ou atualizar

No Marketplace, os vínculos autenticados são salvos em `registrations.json`, dentro
de `.keys` no diretório de trabalho (`botDir`). Ao iniciar novamente, o bot recupera
as conexões e os comandos sem precisar ser adicionado outra vez.

Mantenha o mesmo `botDir` nas atualizações e faça backup da pasta `.keys` inteira.
Ela contém chaves e tokens: não publique seus arquivos. Um arquivo corrompido ou
uma identidade incompleta interrompe a inicialização, sem apagar os dados.
`Cadastros salvos` nos logs não significa conectado; aguarde `Conectado ao servidor`.

**Cadastros antigos:** até a versão 2.0.0, os vínculos do Marketplace existiam apenas
na memória. Se já foram perdidos após reiniciar, atualizar não consegue recuperá-los:
o servidor armazena somente o hash do token. Depois de atualizar o bot, revogue o
cadastro antigo em **Configurações do Servidor → Bots** e adicione pela URL novamente,
uma única vez. Isso cria um novo cadastro; reaplique eventuais configurações específicas.
Não apague `.keys` para fazer essa recuperação.

Falhas de autenticação aparecem nos logs. Com versões de protocolo diferentes, o
bot tenta reconectar enquanto o servidor é atualizado; token inválido exige corrigir
o vínculo. Uma falha ao atualizar a foto é informada, mas não remove os comandos.

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

Se quiser que **qualquer servidor Monky** possa adicionar o bot pela URL:

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
| `/8ball <pergunta>` | Responde à pergunta completa obrigatória, em privado |
| `/enquete` | Formulário privado que publica uma votação com encerramento automático |
| `/ajuda` | Lista todos os comandos |

Digite `/`, selecione o comando e preencha seus parâmetros nomeados. Por exemplo,
`lados` em `/dado` é um **inteiro entre 2 e 100**, não texto; perguntas com espaços
são preservadas. Os nomes dos comandos permanecem iguais em todos os idiomas.
Respostas e formulários acompanham o idioma do cliente (**PT-BR ou inglês**).

### Conversas privadas e enquete guiada

As respostas comuns aparecem **somente no chat de quem chamou o comando**, sem
interromper o canal. O formulário de enquete é privado, mas seu envio publica a
pergunta e os botões de votação para os participantes do canal.

1. Execute `/enquete`, sem parâmetros separados por vírgula.
2. Escreva a pergunta (até 200 caracteres) e de **2 a 10 opções diferentes**.
   Cada opção tem seu próprio campo, com até 80 caracteres; vírgulas podem fazer
   parte do texto de uma opção.
3. Informe uma **duração inteira** em minutos, horas ou dias (de 1 minuto a
   30 dias), um **limite de 1 a 10.000 votantes**, ou ambos. Pelo menos um limite
   é obrigatório.
4. Clique em **Publicar enquete**. Não há prévia nem segunda confirmação.
   Se faltar um limite ou a duração ultrapassar 30 dias, o bot explica o erro
   e reabre o formulário com os dados preenchidos para você corrigir.
   Cancelar o formulário antes de enviar não cria uma enquete.
   Isso também funciona em canais privados: o servidor vincula a enquete à
   invocação autorizada e revalida o acesso de quem a criou nas operações futuras.
   Se essa pessoa perder acesso ou as permissões necessárias, o bot deixa de
   receber as respostas e de publicar resultados até a autorização ser restaurada.
5. Cada pessoa vota pelos botões e pode **trocar seu único voto enquanto a
   enquete estiver aberta**. O limite conta pessoas diferentes, não cliques.
6. A votação encerra no primeiro limite atingido: prazo ou quantidade de
   votantes. O resultado público mostra contagens, percentuais, opção vencedora,
   empate ou ausência de votos, no idioma de quem criou a enquete.

O servidor Monky persiste a pergunta, os votos e o encerramento; continua
controlando o prazo e recusando votos tardios mesmo com o bot desligado. O bot
recupera enquetes ao conectar e verifica pendências a cada 30 segundos. Falhas
de consulta ou publicação aparecem nos logs e são tentadas novamente, sem
duplicar o resultado já publicado. Se o bot estiver offline no encerramento, o
resultado será publicado depois que ele se reconectar. Uma enquete apenas com
limite de votantes permanece aberta até atingir esse limite.

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
falha se o SDK não corresponder ao protocolo 9 ou não oferecer seletores duráveis. Publique a release compatível do
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
