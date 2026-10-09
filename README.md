# Monky Bot 🤖

O **bot oficial de referência** do Monky — comandos utilitários, diversão e mais.

> 📖 Para criar seu **próprio** bot do zero, veja a [Documentação de Bots](https://monkyorg.github.io/Monky/bots).

## DOOM e emulador NES

Na sala de voz, use **`/doom`** para DOOM/Freedoom ou **`/nes`** para o emulador NES.
Os comandos abrem diretamente seus miniapps; não existe catálogo `/games`.
Abra o miniapp no palco: o criador ocupa a vaga 1, um amigo entra como jogador 2
e os demais podem assistir. No DOOM, os arquivos carregam automaticamente e o criador
inicia quando os dois estão prontos. O NES também permite iniciar sozinho.
Sair da visualização de um jogador interrompe a partida; espectadores podem entrar
depois. A sessão expira em 30 minutos.

No DOOM, clique no canvas para capturar o mouse: mova para virar e use o botão
esquerdo ou espaço para atirar. `Esc` libera o cursor; clicar novamente recaptura.
Durante a partida, o jogo ocupa toda a área do miniapp, mantendo sua proporção.
Use o controle de tela cheia do próprio palco do Monky para expandir a view.
Trocar de janela, sair da tela cheia ou encerrar a partida libera os controles.
O botão **Controles e opções** (ou `F2`) também libera o mouse e abre as instruções
do DOOM. Somente o host pode **Reiniciar partida** ou **Voltar ao lobby**, sempre
com confirmação e efeito para jogadores e espectadores. No DOOM, ambas as ações
descartam o progresso; iniciar novamente no lobby mantém as vagas e não exige
reabrir o miniapp. `Esc` continua disponível para liberar o mouse.

DOOM usa uma engine GPL com **Freedoom 0.13.0** incluído: mapas, gráficos e música
livres, diferentes do DOOM comercial. No NES, **somente quem executou `/nes` escolhe
a ROM** iNES, de até 4 MiB, que tenha permissão para compartilhar. O bot a mantém
apenas em memória na sessão e a envia pela conexão autenticada aos jogadores e
espectadores, inclusive aos que entram depois. Não há arquivo salvo pelo bot nem
URL pública de download. Encerrar a sessão ou sair como host libera a ROM.
Os demais veem que estão aguardando o host e já podem escolher **Entrar como
jogador 2**, sem selecionar arquivo. Uma vaga livre também pode ser ocupada durante
uma partida solo. Espectadores começam a assistir automaticamente quando o host
inicia, com replay de inputs para sincronizar quem chega depois.

**Controles NES:** setas = direcional, `X` = A, `Z` = B, `Enter` = Start e
`Shift` = Select. Cada jogador usa essas teclas no próprio controle; para dupla,
selecione o modo de dois jogadores dentro do jogo. As instruções ficam visíveis
no lobby e no botão **Controles e opções**, acessível durante a partida ou com
`Esc`. O menu não pausa o jogo. Somente o host tem **Reiniciar ROM** e **Voltar ao
lobby**, com confirmação e efeito para todos. No NES, voltar ao lobby preserva
o progresso: **Retomar partida** restaura a partida para jogadores e espectadores.
**Iniciar do zero** exige confirmação; trocar por outra ROM válida também descarta
o progresso anterior. A retomada vale apenas na sessão atual e com a mesma ROM,
sem save persistente em disco.
Nenhum jogo comercial acompanha o emulador. Os testes automatizados usam uma ROM
homebrew própria. Fontes, créditos e instruções de rebuild estão em `assets/games`.

É necessário um **cliente Monky com suporte a miniapps web**. Clientes antigos
exibem uma mensagem para atualizar. Assets e multiplayer são servidos pelo bot
na porta **7781**, separada do manifest. Configure `MONKY_GAMES_PUBLIC_URL` com
uma origem HTTP(S) acessível a todos os participantes; em produção, use HTTPS/WSS
com proxy que encaminhe `/games/*` e upgrades WebSocket. `MONKY_GAMES_HOST` e
`MONKY_GAMES_PORT` ajustam o bind. Sem URL explícita, usa
`http://<MONKY_SERVE_PUBLIC_HOST ou localhost>:7781`. `localhost` só funciona
quando bot e clientes estão na mesma máquina.

O listener é iniciado sob demanda, valida arquivos e porta antes de criar o
miniapp; cada cliente verifica acesso HTTP e autenticação WebSocket antes de
habilitar o jogo. Bind local não comprova acesso externo: firewall, DNS e proxy
precisam permitir a conexão dos jogadores. Falhas aparecem no miniapp.

A porta `games` é declarada ao CLI: `monkybot requirements` a lista para liberar
no firewall e `monkybot config env set MONKY_GAMES_PUBLIC_URL https://jogos.exemplo.com`
salva a URL no perfil, fora do pacote (o ambiente do processo prevalece; reinicie
o bot depois de mudar). No modo Marketplace, sem URL explícita, o bot e o
`monkybot doctor` usam `http://<host público>:<porta>`. **No modo manual**, o host
público não é conhecido: sem `MONKY_GAMES_PUBLIC_URL`, os jogos usam `localhost` e
o `doctor` não testa a porta de fora. Enquanto aberto, o listener responde ao
desafio de alcance assinado do `doctor` e do servidor Monky, que confirma que a
porta chega **a este bot**; com o listener fechado, o próprio `doctor` abre um
respondedor temporário para testar o firewall.
Para validar as engines em um checkout, execute `npm run test:games:browser`
com `MONKY_GAMES_ELECTRON` apontando para o executável Electron do checkout Monky.

## Compatibilidade

Esta beta usa **protocolo Monky 38** com o SDK oficial **38.0.0-beta**.
Use cliente e servidor Monky **v38.0.0-beta**; o teste externo de portas do
`monkybot doctor` exige um servidor no protocolo 37 ou mais novo. O SDK incluído é
verificado no build e não precisa ser instalado à parte.
Perfis, identidades, vínculos, idiomas e capacidades solicitadas são preservados;
a atualização não habilita recepção de microfones nem muda os acessos declarados
ao host: o consentimento já dado continua válido.

Playlists do YouTube e álbuns do YouTube Music (veja
[Playlists e álbuns](#playlists-e-álbuns)) exigem o servidor e o cliente de quem
pede na **v38.0.0-beta** ou mais nova. Com um deles desatualizado, `/tocar`
explica qual precisa ser atualizado e continua aceitando vídeos avulsos.

O comando `monkybot` agora é o **CLI de bots do SDK do Monky**, o mesmo usado
pelos demais bots (como o Myinstants): os comandos, o consentimento, o
`doctor` e o `requirements` são iguais. Instalações do CLI próprio anterior
(até `v17.0.0-beta`) precisam de alguns passos únicos, descritos em
[Migrar do CLI próprio anterior](#migrar-do-cli-próprio-anterior).

O SDK oficial inclui envio persistente fora de invocações, live actions nativas
e os contratos de voz, miniapps e execução local exigidos
pelo bot. A origem do pacote e seu SHA-256 estão documentados em `vendor/README.md`.

O comando `/enquete` foi removido: crie enquetes pelo menu **+** do compositor
do Monky. `/lembrete` e `/sorteio` passam a integrar o bot. Após atualizar,
revise a capacidade **live actions** no servidor para permitir os sorteios;
as aprovações existentes não concedem novos acessos automaticamente.

O SDK compatível está incluído em `vendor/` e fixado no `package-lock.json`.
Esta versão remove
somente cadastros revogados ou cujas credenciais foram explicitamente rejeitadas,
permitindo reinstalar pelo manifest sem apagar a identidade nem os demais
servidores. Origem e SHA-256 estão documentados em
[vendor/README.md](vendor/README.md).

Na instalação, um administrador com permissão de gerenciar bots revisa os
acessos solicitados: comandos, mensagens públicas, publicação de voz, execução
local, miniapps e live actions. Lembretes usam mensagens públicas
fora da invocação; sorteios usam mensagens públicas e live actions. O MonkyBot não solicita leitura geral do chat nem
recepção da voz dos participantes. Vínculos manuais e bots migrados ficam sem
acessos até essa revisão; negar um acesso impede a funcionalidade correspondente.
A autorização do servidor para solicitar execução local não substitui o
consentimento de cada pessoa para preparar e usar ferramentas no seu computador.

Ao abrir um miniapp, o participante vê um aviso do que o app pode fazer e escolhe
**Continuar e abrir** ou **Cancelar**. Isso não concede capacidades ao bot:
quem autoriza comandos, mensagens, voz, execução local e miniapps é o administrador.

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

O cliente apenas vincula o bot, ajusta suas configurações de funcionamento e
desfaz o vínculo. Nome e avatar pertencem ao bot e não são editáveis pelo
administrador no cliente.

## Consentimento de quem hospeda

Antes de iniciar, quem hospeda confirma os acessos do bot nesta máquina.
`monkybot setup` mostra o aviso e pergunta, com **Não** como padrão;
`monkybot consent` mostra o aviso e o estado a qualquer momento. O MonkyBot roda
com as permissões da conta do sistema (não é uma sandbox), lê seu programa e
assets, grava identidade, vínculos, lembretes e sorteios em `<botDir>/.keys`,
conecta-se a servidores Monky, abre as portas declaradas (manifest e `games`) e é
gerenciado pelo PM2 do próprio perfil (`~/.monkybot/.pm2`). Para música, buscas e
áudio do YouTube são obtidos no computador de quem pede, pelo cliente Monky; o
host não acessa o YouTube nem precisa de yt-dlp ou FFmpeg.

A confirmação fica em `~/.monkybot/host-consent.json`, vinculada ao `botDir` e a
uma **impressão digital** de 12 caracteres calculada a partir dos modos, portas,
configurações e aviso declarados no pacote (`monkyBot.requirements`). `start`,
`start --foreground`, `restart` e o runner recusam iniciar sem ela. Mudar o
`botDir` exige nova confirmação. Uma versão que mude os acessos declarados também:
`update` mostra o aviso novo e pergunta antes de instalar; `update --yes` e o
auto-update pulam essa versão e mantêm a atual rodando até a aprovação.

```bash
monkybot consent                  # Acessos, estado e impressão digital
monkybot consent --accept <fp>    # Aprova sem terminal interativo
monkybot consent --revoke         # Retira a aprovação; o próximo start é recusado
```

Em automação, leia os acessos e defina `MONKY_HOST_CONSENT=<impressão digital>`
no ambiente do serviço (ao mudar a variável, aplique com `monkybot restart --fresh`,
que recria o processo do PM2 com o ambiente atual). **O antigo
`MONKY_HOST_CONSENT=1` não vale mais** e faz o start ser recusado. Perfis do CLI anterior (com `hostConsent` no `config.json`)
herdam os acessos atuais no primeiro `start`; `status` e `doctor` lembram de
revisá-los com `monkybot consent`. Executar `node dist/index.js` diretamente,
em desenvolvimento, não passa por essa verificação. Esse consentimento nunca
concede capacidades nos servidores onde o bot é instalado.

## Início rápido

### Opção A: Instalação via script (recomendado)

```bash
curl -fsSL https://monkyorg.github.io/install-monkybot.sh | bash
```

Isso instala o comando `monkybot` globalmente. Depois:

```bash
monkybot setup      # Configura por URL (recomendado) ou token e confirma os acessos
monkybot start      # Inicia em background e confirma o manifest
monkybot doctor     # Verifica se o bot pode operar e o que falta
```

### Opção B: Clone para desenvolvimento/customização

Se quiser modificar comandos ou criar os seus próprios:

```bash
# Clone o repositório
git clone https://github.com/MonkyOrg/MonkyBot.git
cd MonkyBot
```

O checkout inclui o SDK compatível em `vendor`, fixado no
`package-lock.json`; não depende de outro checkout do Monky nesta máquina.
Veja [vendor/README.md](vendor/README.md) para consultar sua origem e atualizar essa dependência.

### Configure e inicie com o CLI

```bash
npm ci
npm run check:sdk
npm run build
npm run cli -- setup      # Mesmo CLI do pacote, aplicado a este checkout
npm run cli -- start      # Ou: npm run cli -- start --foreground (sem PM2)
```

`npm run cli` executa `monky-bot-sdk cli`, o mesmo CLI que o pacote instala como
`monkybot`. O `setup` oferece primeiro **Instalação por URL — recomendado** e, como
opção avançada, **Conexão manual por token**. No modo manual ele pede a URL do
servidor e o token (entrada oculta, salvo só no perfil); nos dois modos preserva
o `botDir`, a identidade e o nome atuais ao reconfigurar. No fim, mostra o aviso
de acessos, pede a confirmação e lista as portas e configurações. O setup **não
inicia o bot**: execute `start`, que só anuncia sucesso quando o PM2 confirma o
processo online e, no modo URL, quando o `/manifest` responde nesta máquina com a
chave pública deste bot. Nada disso apaga `.keys`, vínculos nem dados.

Para automação, sem perguntas:

```bash
monkybot setup --non-interactive --mode marketplace --public-host bot.exemplo.com --serve-port 7780
monkybot setup --non-interactive --mode manual --server-url wss://monky.exemplo.com --token-env MONKY_BOT_TOKEN
monkybot consent --accept <impressão digital mostrada>
```

Se o início falhar, consulte `monkybot logs` e `monkybot doctor`, corrija a causa e
execute `monkybot restart --fresh`; não apague as chaves nem refaça os vínculos.

O setup do bot não instala ferramentas de mídia. Quando uma pessoa usa música,
o próprio cliente Monky solicita consentimento e prepara suas ferramentas locais;
o host do bot permanece somente com o runtime geral Node.js.

### Vincule ao servidor

**Por URL (recomendado):** depois do `start`, copie a URL do manifest mostrada pelo
CLI e cole-a em **Configurações do Servidor → Bots** no Monky. `start`, `restart` e
`status` também exibem essa URL. O servidor
obtém a identidade do bot e troca as credenciais automaticamente. A URL deve
estar acessível a partir do servidor Monky.

**Manual (avançado):** quando o servidor não puder acessar um endpoint HTTP
do bot, vá em **Configurações do Servidor → Bots → Gerar vínculo/token**,
abra **Mostrar opção avançada** e clique em **Gerar token**.
Copie o token, exibido uma única vez, e escolha a opção manual
no `setup`. O vínculo aguarda a conexão do bot para receber seu nome e avatar.
Não é necessário definir esses campos no cliente.

> 💡 A chave de segurança (Ed25519) é **gerada automaticamente** no primeiro `start`, em `<botDir>/.keys`. Não precisa configurar nada.

### Portas, configurações e verificação

`monkybot requirements` mostra, mesmo antes do setup, **o que abrir e configurar**
nesta máquina. O mesmo resumo aparece no fim do `setup` e no `status`.

| Porta | Protocolo e padrão | Quando | Quem precisa acessar | Ajuste |
|---|---|---|---|---|
| `manifest` | TCP 7780 | Sempre, só na instalação por URL | Servidores Monky que instalam o bot | Porta e host público no `setup` |
| `games` | TCP 7781 | Sob demanda (`/doom`, `/nes`) | Todos os jogadores | `MONKY_GAMES_PORT`, `MONKY_GAMES_HOST`, `MONKY_GAMES_PUBLIC_URL` |

O modo manual não abre a porta do manifest; só faz conexões de saída ao servidor.
A única configuração extra é opcional: `MONKY_MUSIC_GRACE_SECONDS` (1 a 600,
padrão 60) define o tempo para sair de uma sala vazia ou de uma fila ociosa.

```bash
monkybot requirements                                     # O que liberar e configurar
monkybot config env                                       # Valores efetivos e origem
monkybot config env set MONKY_GAMES_PUBLIC_URL https://jogos.exemplo.com
monkybot config env set MONKY_GAMES_PORT 7781
monkybot config env unset MONKY_GAMES_PUBLIC_URL
monkybot restart                                          # Aplica a mudança
```

Os valores ficam em `~/.monkybot/environment.json`, fora do pacote, e são validados
pelo tipo (porta, endereço de escuta ou URL `http(s)://host[:porta]` sem caminho).
**O ambiente do processo prevalece**: o valor salvo só é usado quando a variável
não existe no ambiente, o que mantém Docker, systemd e compose funcionando.

`monkybot doctor` diz se o bot pode operar e o que falta, com `[OK]`, `[AVISO]`,
`[FALHA]` ou `[PULADO]`, e termina com erro se houver falha. Ele confere Node.js,
a entrada compilada, o perfil, a identidade em `.keys` e o consentimento; o
processo no PM2 do perfil e um processo `monkybot` esquecido no PM2 padrão (do CLI
anterior), que pode ocupar as portas; o token no modo manual; cada porta, livre ou
em uso **por este bot** (desafio assinado com a chave Ed25519) e a validade do
manifest; e a URL pública vista desta máquina. Com o servidor Monky, verifica
alcance, token, vínculo da chave, protocolo e faz um **teste externo** das portas
públicas TCP pela rede do servidor (exige servidor no protocolo 37 ou mais novo). No modo URL,
usa até três servidores de `.keys/registrations.json`; sem vínculo, o teste
externo é pulado. Portas livres recebem um respondedor temporário durante o teste,
então dá para testar o firewall com o bot parado ou antes de alguém abrir um jogo.
`monkybot doctor --local` pula toda comunicação com servidores.

**Mais de um bot na mesma máquina:** cada porta precisa ser exclusiva, inclusive a
de jogos. `7781` é o padrão da porta `games` e também a escolha comum para o
manifest de um segundo bot (por exemplo, o Myinstants). Nesse caso, mova os jogos
para outra porta livre, libere-a no firewall e reinicie:

```bash
monkybot config env set MONKY_GAMES_PORT 7782
monkybot config env set MONKY_GAMES_PUBLIC_URL https://jogos.exemplo.com   # com proxy ou no modo manual
monkybot restart
```

No modo URL, sem `MONKY_GAMES_PUBLIC_URL`, a URL pública passa a usar a porta nova.
O `doctor` aponta a porta `games` ocupada por outro processo, e o bot registra no
log como trocá-la quando um jogo não consegue abrir o listener.

### CLI — Gerenciamento de processo

O `monkybot` usa um **PM2 próprio do perfil**, em `~/.monkybot/.pm2`, separado do
PM2 padrão da conta. Por isso `pm2 list` sem `PM2_HOME` não mostra o bot; use os
comandos abaixo. Executar `monkybot` sem comando, em um terminal, abre o menu por setas.

```bash
monkybot setup               # Configura o modo, o diretório, a conexão e o consentimento
monkybot start               # Inicia via PM2 e confirma o manifest; já online, só verifica
monkybot start --foreground  # Roda neste terminal, sem PM2
monkybot stop                # Para o bot
monkybot restart             # Reinicia com a configuração atual
monkybot restart --fresh     # Recria o processo do zero, sem apagar o perfil
monkybot status              # Estado do processo, configuração, portas e consentimento
monkybot logs                # Logs em tempo real (Ctrl+C para sair)
monkybot logs --lines 100 --no-follow  # Últimas 100 linhas e sai
monkybot doctor [--local]    # Verifica se o bot pode operar
monkybot requirements        # Portas a liberar e configurações
monkybot consent             # Revisa a autorização de quem hospeda
monkybot config              # Configuração (menu em terminal; texto em scripts)
monkybot config show         # Exibe a configuração, com segredos ocultos
monkybot config set <k> <v>  # mode, botName, botDir, serverUrl, botToken, tokenEnv, servePort, publicHost
monkybot config env [set|unset] <NOME>  # Variáveis declaradas pelo bot
monkybot config language en-US  # Idioma do CLI (pt-BR ou en-US)
monkybot --version           # Versão instalada
monkybot update [--check] [--beta] [--yes]
monkybot autoupdate on [HH:MM] [--beta]
monkybot autoupdate off | status
```

Configuração e identidade ficam em `~/.monkybot` (`config.json`, `preferences.json`,
`host-consent.json`, `environment.json` e, por padrão, `.keys`), fora do pacote.
`MONKY_BOT_CLI_HOME` troca a pasta-base, mantendo o subdiretório `.monkybot`.

**Voltar após reiniciar a máquina.** O `start` salva a lista do PM2 do perfil, mas
um serviço criado por `pm2 startup` comum só restaura o PM2 padrão. Registre uma vez
um serviço para o PM2 do perfil (Linux, systemd):

```bash
sudo env PATH="$PATH:$(dirname "$(command -v node)")" "$(command -v pm2)" startup systemd \
  -u "$USER" --hp "$HOME/.monkybot" --service-name pm2-monkybot
```

`--hp` aponta para a pasta do perfil (o serviço usa `~/.monkybot/.pm2`) e
`--service-name` evita substituir o serviço `pm2-<usuário>` do PM2 padrão. Confira
com `systemctl status pm2-monkybot`. Com `MONKY_BOT_CLI_HOME`, use a pasta
`.monkybot` correspondente.

### Idioma do CLI e dos logs

Na primeira utilização interativa, o CLI pergunta **Português (Brasil)** ou
**English (US)** e salva apenas `~/.monkybot/preferences.json` — o mesmo arquivo do
CLI anterior, que continua valendo. Isso não refaz o setup nem modifica
`config.json`, vínculos, portas ou `.keys`. Para mudar depois, abra
`monkybot config` → **Idioma / Language** ou use `monkybot config language pt-BR` /
`monkybot config language en-US`.

`--help`, `--version`, `--non-interactive`, `--yes`, `--check`, CI e entrada/saída
não interativas não abrem essa pergunta. `--locale pt-BR|en-US` vale só para aquela
execução. Em automação, `MONKY_BOT_LOCALE=pt-BR` ou `en` (ou, com prioridade menor,
`MONKY_LANG`) define o idioma sem alterar a preferência salva. O CLI repassa o
idioma ao processo do bot, que o usa nos logs. Essa escolha é **independente** do
idioma pessoal de cada usuário no cliente.

### Porta exclusiva do manifest

Cada bot na mesma máquina precisa de uma **porta livre exclusiva** para instalar
por URL. `7780` é apenas o padrão, não uma porta reservada. `/manifest` é um
endpoint do processo que escuta nessa porta, **não um arquivo compartilhado**:
usar a URL de outro processo vincula aquele bot, não este.

O `setup` testa a porta localmente antes de salvar e pede outra se ela estiver
ocupada; o `setup` não interativo e o `config set servePort` falham sem alterar a
configuração. `start` também testa a porta antes de iniciar um processo parado;
`restart` libera somente o processo gerenciado deste perfil antes do teste. Se o
próprio bot estiver usando a porta, execute `monkybot stop` antes de refazer o setup.
O endereço de escuta é `0.0.0.0`, ou `MONKY_SERVE_HOST` quando definido no ambiente.

Depois de iniciar, o CLI consulta `GET /manifest` nesta máquina e só anuncia
sucesso quando a resposta é um manifest válido, com a URL de registro do host e da
porta configurados e a chave pública deste bot (cabeçalho `X-Monky-Bot-Public-Key`,
enviado pelo SDK). Se `start` encontrar o processo online com o manifest quebrado,
recria apenas o processo deste perfil. **Verificado localmente não significa
acessível externamente:** firewall, NAT e DNS só se comprovam de fora, com
`monkybot doctor`.

### Atualizações beta e stable

`update` consulta a stable em `https://github.com/MonkyOrg/MonkyBot/releases`.
`update --beta` inclui betas, escolhendo pela versão semântica. Nenhum dos comandos
reinstala uma versão igual ou mais antiga. `--check` apenas consulta, sem instalar
nem reiniciar; `--yes` dispensa as confirmações em automação.

O pacote autocontido `monky-bot-<versão>.tgz` é instalado offline, sem scripts de
instalação, e conferido (nome, versão e CLI) antes de reiniciar. Se o bot estava
rodando, o reinício passa pelo **CLI recém-instalado**. Perfil, chaves,
configurações salvas e agendamento são preservados. Por segurança, a atualização
é bloqueada se o `botDir` ou `~/.monkybot` estiver dentro do pacote instalado:
mova-os para fora antes (veja a migração abaixo).

O auto-update usa stable por padrão, inclusive em uma instalação beta;
`autoupdate on [HH:MM] --beta` inclui betas. `monkybot config update-source`
permite trocar a origem por perfil (GitHub, HTTPS ou arquivo local).

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

### Migrar do CLI próprio anterior

Até `v17.0.0-beta`, o MonkyBot tinha um CLI próprio. O pacote atual usa o CLI do
SDK, igual ao dos demais bots. O perfil `~/.monkybot` é reaproveitado: `config.json`
(modo, servidor, token, porta, host público, `botDir` e nome), `preferences.json`
(idioma) e `.keys` (identidade, vínculos, lembretes e sorteios). O que muda:

- o PM2 passa a ser o do perfil (`~/.monkybot/.pm2`), não o PM2 padrão da conta,
  e precisa do próprio serviço de inicialização para voltar após reiniciar a máquina;
- o consentimento passa para `host-consent.json`, com impressão digital, e
  `MONKY_HOST_CONSENT=1` deixa de valer; perfis antigos herdam os acessos no
  primeiro `start`;
- `setup` não inicia mais o bot: use `start` em seguida;
- `MONKY_GAMES_*` não são mais copiadas do shell para o PM2: salve-as com
  `monkybot config env set` ou defina-as no ambiente do serviço.

**Se a atualização veio do CLI anterior** (`monkybot update --beta --yes`, por
exemplo): ele baixa e instala o pacote novo e depois termina com erro ao verificar a
entrada do CLI novo — isso é esperado. A partir daí, `monkybot --version` já mostra a
versão nova; `config.json`, `preferences.json` e `.keys` continuam intactos; o processo
`monkybot` antigo **continua online no PM2 padrão** com o código que já estava
carregado (se o PM2 o reiniciar, ele executa o runtime novo diretamente, com o `.keys`
do `botDir`, até ser removido); e o `monkybot-updater` antigo, se ativo, passa a
falhar, porque os arquivos do CLI anterior não existem mais. Siga os passos abaixo;
o passo 3 já está feito.

Faça uma vez, antes do primeiro `start` pelo CLI novo (Linux/macOS). O bot fica
fora do ar entre os passos 1 e 5:

```bash
# 1. Remova os processos do CLI anterior do PM2 padrão da conta
pm2 delete monkybot-updater   # só se o auto-update antigo estava ativo
pm2 delete monkybot
pm2 save --force             # --force grava mesmo se a lista ficar vazia
rm -f ~/.monkybot/.monkybot-updater.cjs ~/.monkybot/ecosystem.config.cjs  # opcional: arquivos antigos

# 2. Confira onde está o botDir: ele não pode ficar dentro do pacote global
grep botDir ~/.monkybot/config.json
echo "$(npm root -g)/@monky/bot"

# 3. Instale a versão nova, se o update antigo ainda não a instalou
npm install -g "<URL do monky-bot-<versão>.tgz>"
monkybot --version

# 4. Com outro bot na máquina usando a 7781 (por exemplo, o manifest do Myinstants),
#    mova a porta de jogos e libere-a no firewall
monkybot config env set MONKY_GAMES_PORT 7782

# 5. Revise os acessos, verifique e inicie no PM2 do perfil
monkybot consent             # ou: monkybot consent --accept <impressão digital>
monkybot doctor --local
monkybot start
monkybot doctor

# 6. Faça o PM2 do perfil voltar após reiniciar a máquina (systemd)
sudo env PATH="$PATH:$(dirname "$(command -v node)")" "$(command -v pm2)" startup systemd \
  -u "$USER" --hp "$HOME/.monkybot" --service-name pm2-monkybot

# 7. Só se usava auto-update
monkybot autoupdate on 04:00 --beta
```

Se o `botDir` estiver dentro do pacote global (passo 2), copie a pasta `.keys`
inteira para fora **antes de instalar** (por exemplo, para `~/.monkybot/.keys`) e
ajuste `botDir` no `config.json`; caso contrário, a instalação substitui a pasta do
pacote. Se o serviço definia `MONKY_HOST_CONSENT=1`, troque pelo valor mostrado em
`monkybot consent` ou remova a variável. Enquanto o processo antigo existir no PM2
padrão, o `start` novo encontra a porta ocupada e o `doctor` aponta o processo
homônimo. Não gere outra identidade nem apague `.keys`.

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

Para desenvolvimento sem PM2, prefira `npm run cli -- start --foreground`, que
aplica o perfil, o consentimento e as configurações salvas. Também é possível
rodar a entrada diretamente:

```bash
npm run dev
```

Nesse modo não há CLI: o bot gera/reutiliza `.keys` no diretório atual, e as
variáveis precisam estar no ambiente do processo; `.env` não é carregado
automaticamente por `npm run dev` ou `npm start`. Com Node.js 20.6 ou superior,
você também pode usar:

```bash
node --env-file=.env dist/index.js
```

Veja `.env.example`. `MONKY_BOT_NAME` vale para ambos os modos e
`MONKY_SERVE_HOST` controla o endereço de escuta (padrão: `0.0.0.0`).

## Instalação por URL (Marketplace, recomendado)

Se quiser que **qualquer servidor Monky** possa adicionar o bot pela URL:

Via CLI:
```bash
monkybot setup   # Opção 1 (URL — recomendado)
monkybot start   # Inicia e verifica o manifest
```

Ou defina estas variáveis no ambiente (ou carregue `.env` como mostrado acima):
```env
MONKY_SERVE=true
MONKY_SERVE_PORT=7780
MONKY_SERVE_PUBLIC_HOST=seu-ip-ou-dominio
```

O bot imprime a URL do manifest. Um administrador com permissão para gerenciar
bots pode colá-la em **Configurações do Servidor → Bots** para vincular o bot.
Nome e avatar vêm do bot; não há criação ou edição de perfil no cliente.

## Comandos

| Comando (PT-BR) | Descrição |
|---------|-----------|
| `/ping` | Verifica se o bot está respondendo |
| `/dado [lados]` | Rola um dado (padrão: 6, máx: 100) |
| `/moeda` | Cara ou coroa |
| `/bola-magica <pergunta>` | Responde à pergunta completa obrigatória, em privado |
| `/lembrete` | Agenda uma mensagem persistente no canal atual |
| `/sorteio` | Publica uma live action persistente para inscrições e sorteio automático |
| `/tocar <busca>` | Busca por nome ou link do YouTube, prévia privada e seleção para adicionar à fila; aceita links de playlists e álbuns |
| `/fila` | Faixa atual e fila numerada de próximas faixas |
| `/tocando` | Faixa atual, pausa/carregamento e posição |
| `/pausar` / `/retomar` | Pausa e retoma na mesma posição, sem reiniciar |
| `/pular` | Pula a faixa atual (ou o primeiro carregamento pendente) |
| `/parar` | Para e limpa toda a fila; permanece conectado durante a carência |
| `/sair` | Para, limpa a fila e sai da voz |
| `/remover <posição>` | Remove uma posição, a partir de 1, das próximas faixas |
| `/limpar` | Limpa somente as próximas faixas, preservando a atual |
| `/jogo-da-velha` | Tela compartilhada para 2 jogadores, com espectadores |
| `/doom` | DOOM/Freedoom cooperativo com conteúdo livre incluído |
| `/nes` | Emulador NES com ROM local, para jogar sozinho ou em dupla |
| `/ajuda` | Lista todos os comandos |

Digite `/`, selecione o comando e preencha seus parâmetros nomeados. Por exemplo,
`lados` em `/dado` é um **inteiro entre 2 e 100**, não texto; perguntas com espaços
são preservadas. Nomes de apresentação/entrada, descrições, campos, respostas e
formulários suportam **PT-BR e inglês**. Por exemplo, `/dado` aparece como `/dice`
em inglês, e `/play` como `/tocar` em PT-BR. Os identificadores internos e os
nomes/valores dos argumentos não mudam. Os nomes canônicos continuam aceitos em
qualquer idioma, inclusive os usados nos exemplos abaixo.
Por padrão, acompanham o idioma selecionado no cliente. Nas preferências pessoais
do bot, **Idioma do bot** permite manter **Seguir o Monky** ou escolher um idioma
somente para aquele bot. Não é uma configuração compartilhada do servidor.
Mensagens do bot incluem variantes PT-BR/EN e aparecem no **idioma do aplicativo
de cada leitor**, inclusive lembretes, resultados de sorteios, avisos da fila, histórico,
referências de resposta e cópia. A preferência do bot continua controlando
comandos, formulários e prévias. Títulos, perguntas e opções escritos por pessoas
não são traduzidos automaticamente; dados e moedas mantêm o mesmo resultado nos
dois idiomas. Mensagens antigas sem variantes preservam seu texto original.

### Lembretes e sorteios persistentes

`/lembrete` abre um formulário privado para **mensagem**, **prazo inteiro** e
**unidade**. O prazo pode variar de 1 minuto a 365 dias. O lembrete pode ser
enviado uma vez ou repetido diariamente/semanalmente, com até 30 envios. Quando
vencer, o bot publica no canal de origem e escreve `@apelido` para mencionar o
criador. Cada pessoa pode manter até 20 lembretes pendentes por servidor.

`/sorteio` recebe **prêmio/título**, regras opcionais, até cinco imagens em
carrossel, duração de 1 minuto a 30 dias e de 1 a 10 vencedores. O comando
publica uma live action com uma confirmação simples de inscrição. Reenvios da mesma conta são idempotentes:
somente o primeiro registro de cada `userId` participa. No prazo, a live action
é fechada, os vencedores únicos são escolhidos com `crypto.randomInt` e o
resultado público inclui o total de inscrições válidas. Há no máximo 20 sorteios
ativos ou em publicação por servidor.

Lembretes, configurações de sorteio, inscrições e vencedores já escolhidos ficam
em `.keys/scheduled-actions.json`, gravado por substituição atômica. Preserve
esse arquivo junto de `private.pem`, `public.hex` e `registrations.json` em
backups da identidade. Ao reiniciar, o bot recupera os prazos; se estiver
desconectado no vencimento, publica quando a conexão voltar. O servidor mantém
a live action, mas as inscrições do sorteio pertencem ao estado local do bot.

Em uma perda ambígua de confirmação, o bot tenta novamente para não perder o
lembrete ou resultado. Como `sendMessage` não aceita `clientMessageId`, o servidor
pode já ter aceitado a primeira cópia; por isso, uma duplicata rara é possível
se a conexão falhar exatamente nesse ponto.

### Música: pré-requisitos, limites e uso responsável

A busca, a resolução e o processamento de cada faixa pública do YouTube rodam
**anonimamente no cliente Monky da pessoa que fez o pedido**. O servidor e o
host/VPS do MonkyBot não baixam mídia, não exigem Node 22, yt-dlp ou FFmpeg e
não são usados como fallback. O cliente prepara suas ferramentas gerenciadas
após consentimento local; login, cookies e credenciais do provedor não são
aceitos. Os demais participantes continuam ouvindo a publicação normal do bot.

Ao selecionar `/play` (`/tocar` em PT-BR), o cliente verifica os requisitos
antes da busca. O modal do Monky descreve Node.js, yt-dlp e FFmpeg, suas
finalidades e o espaço previsto, e só prepara as ferramentas após a autorização.
O progresso e a opção **Tentar novamente** aparecem no mesmo modal.
Ferramentas prontas são reutilizadas; pesquisas seguintes não repetem a instalação.
A aba de ferramentas de bots nas configurações do Monky permite rever permissões,
remover ferramentas e limpar cache com confirmação e feedback próprios do aplicativo.

Pausar, retomar, pular, parar, limpar, remover e sair continuam disponíveis
sem instalar ferramentas locais. Esses controles e suas permissões não mudam.

#### Ferramentas e diagnóstico no cliente

Os comandos de terminal `music-check`, `music-setup` e `music-diagnose` foram
removidos: consultavam ou preparavam ferramentas no host do bot, não no cliente
que executa a música. Instalação, consentimento e diagnóstico ficam no
gerenciamento de ferramentas de bots do Monky. Todos os comandos musicais no
aplicativo, incluindo `/play`, fila, pausa, retomada e skip, permanecem disponíveis.

Ferramentas instaladas no host por versões antigas não são usadas como fallback
nem removidas automaticamente. Não é necessário refazer o setup, apagar `.keys`
ou trocar a identidade do bot.

Encontrar uma sugestão não comprova que o cliente conseguirá resolver ou baixar
o áudio. Em falhas, confira a resposta privada e o estado das ferramentas no
cliente solicitante. Para problemas de conexão do bot, use
`monkybot logs --no-follow --lines 100`. Não envie arquivos de configuração,
chaves, cookies, tokens ou URLs assinadas; uma falha genérica não confirma
bloqueio de IP ou necessidade de autenticação.

#### Reprodução e recuperação

1. Entre numa sala de voz e execute `/play` com nome, link de vídeo
   `https://www.youtube.com/watch?v=...` / `https://youtu.be/...` ou link de
   playlist (veja [Playlists e álbuns](#playlists-e-álbuns)).
2. As sugestões aparecem durante a digitação, com até **8 resultados públicos
   elegíveis**. Um link de vídeo retorna a sugestão daquele vídeo; se ele também
   tiver uma playlist, a sugestão da playlist vem logo depois. O cliente
   aplica debounce, limita a frequência e descarta buscas anteriores.
   O botão de ouvir gera uma **prévia privada de até 10 segundos**, somente
   quando clicado: ela toca no seu cliente e não adiciona nada à fila.
   Clicar na sugestão ou confirmá-la pelo teclado executa `/play` uma única vez.
   Não há `/query` separado nem uma segunda janela de seleção.
3. A fila conecta à sala de quem adicionou o primeiro item e toca em ordem.
   Os pedidos de adicionar e pular recebem uma resposta imediata de processamento.
   Depois da validação e aceitação real, **Adicionado à fila** aparece para todos
   no canal de texto onde a faixa foi pedida, identificando quem a adicionou.
   Pausar, retomar, pular, parar, sair, remover e limpar também publicam uma
   confirmação no canal do comando. Consultas e erros continuam privados.
   Antes da primeira faixa e de cada próxima, o chat mostra **Preparando para tocar**.
   A invocação mantém seu indicador animado enquanto estiver em execução; não há
   percentual inventado para consulta da fonte ou início do áudio.
   O aviso público **Tocando** só é enviado quando o primeiro quadro de áudio
   começa a avançar na reprodução.
   Falhas durante a adição geram resposta privada. Para uma faixa já aceita,
   a fila segue a política de recuperação e avisos descrita abaixo.
4. Qualquer humano **na mesma sala de voz** pode controlar a fila, sem cargo DJ.
   Todos os comandos de música, inclusive `/queue`, `/nowplaying`, busca e
   prévia, exigem estar em voz. Se o bot já estiver em outra sala, o pedido é
   recusado com uma orientação para entrar na sala dele. As permissões existentes
   de acesso ao canal e `USE_BOT_COMMANDS` continuam obrigatórias.
   A sala atual do dispositivo é consultada no servidor antes das operações e
   novamente após buscas, escolhas e resolução; não se confia no snapshot inicial.
   A entrada inicial usa a invocação ativa como autorização restrita àquela sala,
   inclusive em sala privada; o servidor recusa se a pessoa mudou de sala.
   O comando aguarda somente essa admissão inicial, nunca a duração da reprodução.

Se a busca e a resolução funcionarem, mas o bot entrar e sair da voz sem tocar,
confira `monkybot logs --no-follow --lines 100` no host do bot. Uma falha nessa
admissão mantém seu diagnóstico original nos logs e uma resposta privada de voz;
não é substituída por “operação cancelada” nem exige reinstalar ferramentas por
suposição. Uma tentativa posterior cria uma nova admissão. Cancelar ou parar de
fato durante a entrada continua cancelando a adição, sem áudio tardio.

O bot aparece como um participante normal, sem mute/deafen automático, com
indicador de atividade ao transmitir áudio e controles de volume/mute local.
Mutar apenas para si não muda o áudio dos demais nem a fila. O bot de música
atual não oferece captura da voz dos participantes.

Mute/deafen administrativo bloqueia apenas o envio de som: a música continua
avançando em silêncio, e a fila passa à próxima faixa no término normal.
Ao remover o bloqueio, o áudio volta na posição atual, sem reiniciar a faixa.
Isso não altera `/pause`: uma pausa manual continua parada até `/resume`.

Há uma fila/conexão independente por servidor, com até **100 próximas faixas** por
padrão (incluindo adições em resolução) e vídeos de no máximo **1 hora**. O limite
da fila é configurável de **10 a 500** em
**botão direito no bot → Configurações do bot → Comportamento neste servidor → Música → Limite da fila (faixas)**;
reduzi-lo não remove faixas já na fila, só impede novas entradas até a fila
diminuir. `/remover` aceita posições até 500. Adições
concorrentes mantêm a ordem de confirmação, mesmo com resoluções fora de ordem.
O cliente prepara consentimento e ferramentas antes dos prazos de **15s para
autocomplete** e **30s para prévia**. A prévia permanece no cliente de origem:
somente um identificador opaco atravessa o protocolo, nunca os bytes de áudio
cliente → VPS → cliente. A reprodução usa um canal WebRTC privado, confiável,
ordenado e somente de dados para entregar pacotes Opus de 20 ms ao bot; áudio
não usa o WebSocket genérico e não há captura de microfone. Conexões e buffers
são limitados, sem impor um prazo total à pausa manual. Não há persistência da
fila após reinício.

Sala vazia **ou** fila ociosa desconecta após **60s** por padrão. Configure em
**botão direito no bot → Configurações do bot → Comportamento neste servidor → Música → Tempo de inatividade (segundos)**,
com um inteiro de **1 a 600**. É uma configuração compartilhada desse bot
nesse servidor, disponível a quem tem permissão para configurar bots, e fica
salva no servidor. Alterações valem imediatamente, inclusive para contadores
em andamento: o tempo já decorrido conta, sem reiniciar a espera inteira.
`MONKY_MUSIC_GRACE_SECONDS` define somente o valor padrão oferecido pelo host.
Voltar antes do prazo cancela a saída por sala vazia, sem
reiniciar a música ou limpar a fila. Se a pessoa que pediu a faixa **atual**
sair da voz ou se o cliente dela for desconectado, somente essa faixa é
interrompida: o chat recebe um aviso explícito e a fila avança. As faixas futuras
dessa pessoa continuam na fila e não são
transferidas para outro usuário ou dispositivo. Enquanto a sessão solicitante
estiver ausente, essas faixas ficam adiadas sem impedir as faixas de outras
pessoas; somente uma confirmação do servidor para o contexto local retido pode
torná-las elegíveis novamente. `/fila` identifica essas entradas como
**aguardando solicitante**. Voltar à voz na mesma conexão reavalia as fontes
automaticamente, sem precisar enviar outro comando. Reconectar o cliente cria
uma conexão nova e não reativa fontes da anterior, mesmo com o mesmo ID de
sessão; remova essas entradas e adicione-as novamente. Uma nova faixa autorizada
não herda o bloqueio dos contextos antigos. Desconexão do bot, troca de modo de voz
e encerramento do bot cancelam carregamentos, esvaziam a fila e liberam a voz e
os contextos locais retidos. Cancelar uma invocação
cancela a adição pendente, não a reprodução já aceita; cancelar uma prévia
não interfere na fila.

O fim normal da fila continua sendo avisado no chat. Erros só aparecem no chat
compartilhado quando a reprodução realmente para e exige intervenção: por exemplo,
perda definitiva da voz ou nenhuma faixa restante capaz de tocar. Falhas recuperadas,
erros de um peer enquanto a reprodução continua e faixas com falha puladas em favor
de outra que toca ficam apenas nos diagnósticos locais, exceto quando o limite de
falhas consecutivas de retomada é esgotado: nesse caso há um aviso por faixa removida,
mesmo que a fila continue. Erros de comando, entrada e permissão continuam nas
respostas privadas.

Uma reconexão só avisa sobre reprodução perdida se havia trabalho interrompido e ele
não foi retomado; uma conexão saudável recuperada ou uma fila já encerrada não gera
esse aviso. O bot continua sujeito às permissões do canal, e falhas de entrega ficam
nos logs. `/queue` conserva os títulos completos e usa várias respostas, quando
necessário, para respeitar o limite de tamanho de cada mensagem.

Uma faixa pode ter **quantas retomadas bem-sucedidas forem necessárias**, sempre
sem avisos de tentativa ou recuperação no chat. Após uma interrupção, o limite é de
**cinco tentativas consecutivas que não conseguem fazer o áudio avançar**. Só um
frame efetivamente avançado pelo player zera esse contador; conectar ao servidor,
receber cabeçalhos ou baixar bytes não basta. Se as cinco falharem, um aviso seguro
informa a falha de retomada, a faixa é removida e o player segue para a próxima.
A pausa manual suspende a contagem sem zerá-la.

O mesmo decoder continua do byte interrompido, sem reiniciar a música ou duplicar
áudio. Cada operação de rede tem limite de 15 segundos e a espera entre tentativas
é de até 5 segundos. Não existe um limite acumulado de retomadas ou de tempo de
recuperação que interrompa uma sequência de retomadas bem-sucedidas. Uma entrada
HTTP privada em loopback mantém o decoder aberto e suporta buscas por byte, sem
guardar a faixa inteira em memória.

O fim normal ainda exige áudio completo. Fontes corrompidas, alteradas, sem
permissão ou que recusam a retomada geram erro explícito nos diagnósticos e são
puladas; o chat recebe um aviso se a reprodução não puder continuar. Não se tenta contornar
essas restrições nem reiniciar do zero. `/stop`, `/skip`, saída/desconexão da voz,
encerramento do bot e o prazo configurado de sala vazia cancelam a recuperação.
A pausa manual preserva a posição, e as prévias privadas continuam limitadas
a dez segundos, sem adotar essa espera persistente.

#### Playlists e álbuns

`/tocar` aceita playlists do YouTube e álbuns do YouTube Music
(`https://www.youtube.com/playlist?list=...`, `https://music.youtube.com/playlist?list=OLAK5uy_...`).
Ao colar um link de vídeo que também tem uma playlist (`watch?v=...&list=...`),
as sugestões mostram **primeiro o vídeo e depois a playlist**, com o título e o
número de vídeos. Um link só
de playlist sugere apenas a playlist. A leitura roda no cliente de quem pede,
como as buscas, e a playlist não tem prévia de áudio.

Ao escolher a playlist, o bot lê no máximo as vagas livres da fila (até 500
faixas, na ordem da playlist) e adiciona, de uma vez e em sequência, o que couber.
Entradas com mais de 1 hora, ao vivo, privadas ou sem duração são puladas. Um
aviso público informa quantas faixas entraram, quantas foram puladas e quantas
ficaram de fora por falta de espaço; quando o YouTube não informa o total, o aviso
diz que a playlist pode ter mais faixas. Cancelar o pedido antes desse aviso
desfaz toda a adição. Cada faixa é validada novamente quando chega a vez dela:
um vídeo que ficou privado ou tem restrição de idade é pulado e a fila continua.
Cada pedido vale por até 24 horas: uma faixa que esperar mais que isso na fila
expira e precisa ser adicionada de novo.

Faixas de playlist seguem as mesmas regras das demais: pertencem a quem pediu,
ficam **aguardando solicitante** se essa pessoa sair da voz e podem ser removidas
com `/remover`, `/limpar` ou `/parar`. Mixes e rádios (`list=RD…`) não são
suportados, porque são infinitos e personalizados por conta.

**Sem Spotify, mixes/rádios do YouTube, lives ou conteúdo com autenticação/paywall
nesta versão.** Links de um vídeo podem conter `list`, `index` ou `start_radio`:
colado e enviado sem escolher uma sugestão, o link adiciona somente o vídeo.
Mixes (`list=RD…`) nunca são lidos: a sugestão e a resposta avisam que só o
vídeo será adicionado.
URLs arbitrárias não são aceitas. A extração com yt-dlp **não é uma API oficial
de áudio do YouTube**: pode deixar de funcionar e está sujeita aos termos da
plataforma. Utilize somente mídia própria ou autorizada e respeite direitos
autorais. A execução local não recebe login, cookies ou credenciais, ignora
configurações locais do yt-dlp e não contorna restrições de acesso. O cliente
gerencia as ferramentas; erros definitivos do provedor continuam explícitos.

### Demo: tela compartilhada de jogo da velha

Entre em uma sala de voz e execute `/jogo-da-velha` em um canal de texto acessível.
O convite aparece no mesmo canto dos avisos de compartilhamento de tela; abra-o
para visualizar o miniapp **no palco de voz**, não em um card do chat.
Somente participantes daquela sala podem visualizar ou interagir.
O cartão continua no palco junto de câmeras e compartilhamentos, mesmo fechado.
**Abrir miniapp** inicia a visualização local; **Sair do miniapp** a fecha sem
remover o cartão ou encerrar a partida. Focar ou voltar à grade só muda o layout,
sem reiniciar a tela nem alterar vagas de jogador.

**Encerrar miniapp** encerra a partida para todos e remove seu cartão e convites.
Essa ação é autorizada pelo servidor somente para um administrador ou para quem
invocou o comando criador, mantendo as verificações de acesso à sala. O criador
continua reconhecido após reconectar. O bot libera o estado, os prazos e a cota
daquela instância; ações e respostas atrasadas não reabrem o jogo nem alteram uma
nova partida. Para jogar novamente, execute um novo comando.

Quem criou joga como **X**; outra pessoa na sala clica **Jogar como O**. Os demais assistem.
Use clique ou Tab + Enter/Espaço para jogar. O bot valida identidade, turno,
casa livre, revisão e vitória/empate; cliques concorrentes não sobrescrevem jogadas.
A tela usa HTML/CSS/JS autocontido, sem acesso à rede nem ao DOM do aplicativo.
Os controles seguem o idioma de cada participante e se atualizam ao trocar
o idioma do aplicativo, sem reiniciar a partida. Jogos expiram em 30min e são
removidos ao desconectar/reiniciar o bot ou perder a autorização de acesso à sala; não são persistidos.
Sair ou mudar de sala fecha a visualização local e impede novas ações. O estado
e as vagas dos jogadores são mantidos até a expiração ou o encerramento do miniapp,
inclusive se a sala ficar vazia; não há reinício nem liberação automática de vaga.
Há até quatro miniapps simultâneos por sala. Fechar a visualização não encerra a partida dos demais.
Telas removidas liberam imediatamente a cota de jogos. Erro de sincronização fecha a tela
em vez de aceitar jogadas sobre um estado incerto.

Para QA, entre na mesma sala com dois jogadores e um espectador: tente jogar fora
da vez, clicar duas vezes e completar vitória/empate; confira a mesma posição nas
três telas. Um cliente fora da voz ou em outra sala não deve receber o miniapp.
Para música, use apenas áudio original autorizado; valide pausa/retomada, fila
entre dois servidores, `/clear`, `/stop`, saída da sala e ausência de ferramentas.
Os testes automatizados não baixam músicas: combinam fontes falsas com
transporte real do SDK, incluindo moderação silenciosa e pausa manual.
Se FFmpeg estiver disponível, `tests/music-audio.test.js` gera um tom senoidal
original e verifica Opus real, cadência da fila e entrega ICE/DTLS/SRTP pelo SDK;
caso contrário, esse teste informa
o pré-requisito ausente e é ignorado. Configure `MONKY_MUSIC_FFMPEG` para executá-lo.

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

O `npm run pack` confere os assets dos jogos e gera o pacote com o empacotador do
SDK (`buildBotPackage`, o mesmo do `monky-bot-sdk build`), a partir de uma
compilação limpa. O pacote inclui `dist`, `assets`, o SDK e a árvore de dependências
de produção, e declara `monkyBot` (CLI `monkybot`, modos, releases e
requisitos); o comando `monkybot` é o `monky-cli.cjs` gerado pelo SDK.

O teste do tarball instala **offline, com cache vazio e prefixo local isolado**,
executa `monkybot --version`, `requirements` e `config language`, negocia voz P2P
com ICE/DTLS e recebe um pacote Opus sintético pelo caminho de voz do SDK incluído.
Depois faz `setup` não interativo, confirma que o início é recusado sem
consentimento, aprova a impressão digital e inicia o **runner empacotado do SDK**
(o mesmo processo que o PM2 executa) para consultar `/manifest` com a identidade do
perfil e o logo oficial, verificando os vínculos após reiniciar o processo.
Resolução de módulos fora da instalação é rejeitada para impedir que dependências
do checkout escondam falhas. Nenhum bot ou PM2 global é instalado, parado ou reiniciado.

A CI executa esse teste **antes de publicar** e também nos PRs. Novas betas
são publicadas somente após merge na `main`. O workflow usa `npm ci` com o SDK
oficial em `vendor/`, fixado pelo lockfile; não troca a dependência por uma
versão mais recente durante o build. O disparo manual exige `promote_tag` e
autorização explícita para promover uma beta existente, sem recompilar.
O build falha se o SDK não corresponder ao protocolo declarado em `package.json` ou não
oferecer live actions nativas, voz, telas, execução local concreta, nomes de
comandos localizados, o CLI reutilizável e o desafio de alcance. Publique
a release compatível do Monky antes de publicar este bot.

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
│   ├── index.ts          # Ponto de entrada (runtime iniciado pelo CLI do SDK)
│   ├── i18n.ts           # Idioma do operador nos logs
│   ├── profile.ts        # Nome padrão e avatar oficial incluído no pacote
│   ├── commands/
│   │   ├── index.ts      # Registro de todos os comandos
│   │   ├── ping.ts
│   │   ├── dice.ts
│   │   ├── coin.ts
│   │   ├── eightball.ts
│   │   ├── games.ts      # /doom e /nes
│   │   ├── music.ts      # Música pela execução local no cliente
│   │   ├── scheduled.ts  # Lembretes e sorteios persistentes
│   │   └── help.ts
│   ├── games/
│   │   └── service.ts    # Listener da porta games (assets, multiplayer e desafio de alcance)
│   ├── scheduled/
│   │   └── store.ts      # Estado tipado e gravação atômica
│   └── utils/
│       └── keys.ts       # Chaves Ed25519 na execução direta (o CLI usa <botDir>/.keys)
├── assets/
│   └── monky-logo.png    # Logo oficial do Monky
├── tests/               # Testes de comandos, jogos, CLI e empacotamento (node:test)
├── scripts/             # Empacotamento pelo SDK e smoke offline do tarball
├── .env.example
└── package.json          # monkyBot: CLI monkybot, modos, releases, portas e configurações
```

## Links

- 📖 [Documentação de Bots (PT-BR)](https://monkyorg.github.io/Monky/bots)
- 📖 [Bot Documentation (EN)](https://monkyorg.github.io/Monky/en/bots)
- 🤖 [Bot SDK (`@monky/bot-sdk`)](https://github.com/MonkyOrg/Monky/tree/main/packages/bot-sdk)
- 🏠 [Monky](https://github.com/MonkyOrg/Monky)

## Licença

MIT
