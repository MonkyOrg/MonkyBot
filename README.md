# Monky Bot 🤖

O **bot oficial de referência** do Monky — comandos utilitários, diversão e mais.

> 📖 Para criar seu **próprio** bot do zero, veja a [Documentação de Bots](https://monkyorg.github.io/Monky/bots).

## Compatibilidade

Esta versão exige **protocolo Monky 20**. Atualize o aplicativo e o servidor Monky
juntos antes de atualizar o bot; servidores com protocolos anteriores não são compatíveis.
O SDK incluído no pacote é verificado no build e não precisa ser instalado à parte.

O SDK oficial da
[release Monky v22.0.10-beta](https://github.com/MonkyOrg/Monky/releases/tag/v22.0.10-beta)
está incluído em `vendor/` e fixado no `package-lock.json`. Esta versão remove
somente cadastros revogados ou cujas credenciais foram explicitamente rejeitadas,
permitindo reinstalar pelo manifest sem apagar a identidade nem os demais
servidores. Origem e SHA-256 estão documentados em
[vendor/README.md](vendor/README.md).

Na instalação, um administrador com permissão de gerenciar bots revisa os
acessos solicitados: comandos, mensagens públicas, publicação de voz, execução
local, enquetes e miniapps. O MonkyBot não solicita leitura geral do chat nem
recepção da voz dos participantes. Vínculos manuais e bots migrados ficam sem
acessos até essa revisão; negar um acesso impede a funcionalidade correspondente.
A autorização do servidor para solicitar execução local não substitui o
consentimento de cada pessoa para preparar e usar ferramentas no seu computador.

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

## Início rápido

### Opção A: Instalação via script (recomendado)

```bash
curl -fsSL https://monkyorg.github.io/install-monkybot.sh | bash
```

Isso instala o comando `monkybot` globalmente. Depois:

```bash
monkybot setup      # Configura por URL (recomendado) ou token e inicia/reinicia automaticamente
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
npm run cli -- setup      # Configura o checkout e inicia/reinicia automaticamente via pm2
```

O `setup` guia você pelo processo: oferece primeiro **Instalação por URL —
recomendado** e, como opção avançada, **Conexão manual por token**. No modo
manual ele pede a URL do servidor e o token; nos dois modos ele preserva o
`botDir` e o nome atuais por padrão ao reconfigurar. Depois de salvar, o setup
aplica automaticamente um **reinício limpo** do processo pm2, ou um início se o
bot estiver parado ou ainda não registrado. Não é necessário executar um restart separado.
Isso não apaga `.keys`, vínculos nem os dados do diretório escolhido.
Na instalação global, use `monkybot setup`; `monkybot start` continua disponível
para iniciar um bot parado ou verificar o manifest de um bot já online.

Se a configuração for salva, mas o início/reinício falhar, o CLI informa as duas
etapas separadamente e retorna erro. Consulte `monkybot logs`, corrija a causa e
execute `monkybot restart --fresh`; não apague as chaves nem refaça os vínculos.

O setup do bot não instala ferramentas de mídia. Quando uma pessoa usa música,
o próprio cliente Monky solicita consentimento e prepara suas ferramentas locais;
o host do bot permanece somente com o runtime geral Node.js 18+.

### Vincule ao servidor

**Por URL (recomendado):** conclua o setup, copie a URL do manifest mostrada pelo
CLI e cole-a em **Configurações do Servidor → Bots** no Monky. `start` e `restart`
também verificam o manifest e exibem essa URL. O servidor
obtém a identidade do bot e troca as credenciais automaticamente. A URL deve
estar acessível a partir do servidor Monky.

**Manual (avançado):** quando o servidor não puder acessar um endpoint HTTP
do bot, vá em **Configurações do Servidor → Bots → Gerar vínculo/token**,
abra **Mostrar opção avançada** e clique em **Gerar token**.
Copie o token, exibido uma única vez, e escolha a opção manual
no `setup`. O vínculo aguarda a conexão do bot para receber seu nome e avatar.
Não é necessário definir esses campos no cliente.

> 💡 A chave de segurança (Ed25519) é **gerada automaticamente** na primeira execução. Não precisa configurar nada.

### CLI — Gerenciamento de processo

O Monky Bot vem com um CLI integrado que usa **pm2** para rodar em background, assim como o Monky CLI do servidor:

```bash
monkybot setup               # Configura e aplica início/reinício limpo automaticamente
monkybot start               # Inicia via pm2 ou verifica o manifest se já estiver online
monkybot stop                # Para o bot
monkybot restart             # Reinicia aplicando a configuração atual
monkybot restart --fresh     # Recria o processo pm2 do zero
monkybot status              # Exibe estado (PID, uptime, memória, CPU)
monkybot logs                # Exibe logs em tempo real (Ctrl+C para sair)
monkybot logs --lines 100    # Últimas 100 linhas
monkybot logs --no-follow    # Imprime logs recentes e sai
monkybot config              # Exibe a configuração
monkybot config set <k> <v>  # Altera uma configuração
monkybot music-check         # Diagnóstico manual legado das ferramentas do host
monkybot music-setup         # Prepara ferramentas do host somente quando solicitado
monkybot music-diagnose --url <url> # Diagnóstico manual legado, somente metadados
monkybot language en         # Salva o idioma do CLI (pt-BR ou en)
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

### Idioma do CLI e dos logs

Na primeira utilização interativa de um comando, o CLI pergunta **Português
(Brasil)** ou **English** e salva apenas `~/.monkybot/preferences.json`.
Isso não refaz o setup nem modifica `config.json`, vínculos, portas ou `.keys`.
Para mudar depois, use `monkybot language pt-BR` ou `monkybot language en`.

`--help`, `--version`, consultas `update --check`, execução com `--yes`, CI e
entrada/saída não interativas não abrem essa pergunta. Sem preferência salva,
o CLI usa um idioma do sistema reconhecido ou `pt-BR`. Para uma automação, defina
`MONKY_BOT_LOCALE=pt-BR` ou `MONKY_BOT_LOCALE=en` no ambiente, sem alterar a
preferência salva. Os aliases `pt` e `en-US` usam a normalização do Monky.
`MONKY_LANG` também é aceito, com prioridade menor que `MONKY_BOT_LOCALE`.
Uma preferência ilegível ou inválida gera um aviso sem expor seu conteúdo nem
reescrever o arquivo; `language` permite salvar uma escolha explícita.

O idioma do operador também acompanha os próximos reinícios pelo CLI e os
cabeçalhos de log do runtime. Diagnósticos técnicos dos executáveis podem
permanecer no idioma original. Essa escolha é **independente** do idioma pessoal
de cada usuário no cliente.

### Porta exclusiva do manifest

Cada bot na mesma máquina precisa de uma **porta livre exclusiva** para instalar
por URL. `7780` é apenas o padrão, não uma porta reservada. Por exemplo, se outro
bot já usa `7780`, escolha outra porta livre para o MonkyBot no setup. `/manifest`
é um endpoint do processo que escuta nessa porta, **não um arquivo compartilhado**:
usar a URL de outro processo vincula aquele bot, não este.

O CLI testa um bind TCP local no endereço de escuta do runtime: `0.0.0.0` por
padrão, ou `MONKY_SERVE_HOST` quando definido no ambiente do CLI. No start/restart
(inclusive update), sem override no shell, o host anterior do próprio processo
gerenciado no pm2 é preservado; só na ausência dele vale o padrão. Assim um bind
em `127.0.0.1` não muda para `0.0.0.0` por falta da variável no shell.
O probe e o ecosystem recebem o mesmo host resolvido e a porta testada. O socket
de teste é fechado imediatamente. Após iniciar/reiniciar, o CLI também consulta
`GET /manifest` no endereço de escuta local (`127.0.0.1` para `0.0.0.0`, `::1` para
`::`), sem consultar o host público. Ele confere o JSON do SDK, o nome, a URL de
registro atual e a identidade pública da **mesma resposta HTTP** contra
`botDir/.keys/public.hex`. Como o JSON estrito do SDK não tem campo de identidade,
o próprio runtime acrescenta apenas o header público `x-monky-bot-public-key`;
não há um segundo servidor ou alteração do protocolo de registro.

A espera HTTP após iniciar é limitada a 10 segundos, com até 1,5 segundo por
resposta e corpo de até 8 MiB. O probe não envia tokens, não chama `/register`
e não gera nem apaga chaves. **Verificado localmente não significa acessível
externamente:** firewall, DNS público e acesso a partir do servidor Monky ainda
precisam ser conferidos pelo operador.

- **Setup:** uma porta ocupada por outro serviço pede somente uma nova porta,
  sem refazer as demais respostas. A porta é revalidada antes de salvar; a
  configuração anterior e `.keys` permanecem intactas se não houver porta válida.
  Depois de salvar, o próprio setup aplica um início/reinício limpo e aguarda o
  manifest antes de mostrar sua URL.
- **Reconfigurar o próprio bot:** a porta já configurada pode ser reutilizada
  sem um `stop` manual quando o CLI identifica o processo deste bot no pm2,
  incluindo seu diretório de trabalho. Após coletar as respostas, o setup para
  somente esse ID e **confirma a liberação com um novo bind antes de salvar**.
  Se outro serviço continuar ocupando a porta, nada é salvo e só a porta é
  perguntada novamente. O nome ou a resposta de um manifest não autorizam parar
  um serviço. Cancelar antes dessa etapa não para o bot; cancelar após a parada
  pode deixá-lo parado, sem alterar a configuração ou a identidade.
  `config set` continua sem parar serviços automaticamente.
- **Configuração:** o teste ocorre somente ao habilitar Marketplace ou mudar sua
  porta efetiva. Em caso de conflito, nada é salvo. Alterar `publicHost` ou
  `botName`, repetir o mesmo `mode`/`servePort` e usar o modo manual não testa a
  porta nem para o bot. O host e a porta continuam sendo validados nas chaves pertinentes.
- **Start/restart:** o start de um bot parado ou não registrado testa a porta antes
  de instalar pm2 ou gerar o ecosystem. Se já estiver online, verifica o manifest
  real e mostra novamente a URL; um runtime saudável continua idempotente.
  Se não estiver servindo o manifest correto, tenta **uma única recriação limpa**
  do processo identificado, com a configuração atual, e verifica novamente.
  O restart para somente o processo identificado deste bot, por ID do pm2,
  confirma o sucesso dessa parada e testa o bind antes de iniciar.
  Se a porta continuar ocupada, o bot fica parado e nenhum outro serviço é encerrado.
  O reinício via update/auto-update usa o mesmo caminho.
  Falhas ao consultar o inventário do pm2 interrompem a operação; não são tratadas
  como ausência do bot e a resposta bruta de `jlist` não é exibida.

Erros de permissão (`EACCES`) e outros erros de bind também interrompem a operação
com o endereço e o motivo; não são tratados como porta livre. O teste é pontual,
**não reserva a porta até o runtime iniciar**: outro processo ainda pode ocupá-la
nesse intervalo. Por isso, pm2 online ou uma porta aberta não bastam para anunciar
sucesso: o manifest também precisa passar na verificação. Se houver erro, consulte
os logs. Libere o acesso de rede necessário se o servidor Monky estiver em outra máquina.

### Atualizações beta e stable

`update` consulta apenas a stable. `update --beta` inclui betas e versões stable,
escolhendo pela versão semântica, não pela ordem de publicação no GitHub.
Uma stable supera a beta do mesmo número (`3.0.1` > `3.0.1-beta`).
Nenhum dos comandos reinstala uma versão igual ou mais antiga, nem com `--yes`.
`--check` apenas consulta e não instala nem reinicia o bot.

O download mostra bytes recebidos e porcentagem quando o tamanho é conhecido:
barra em terminais interativos e linhas limitadas em logs/pipes. Tamanho e
SHA-256 publicados no asset são conferidos antes de instalar; releases antigas
sem esses metadados continuam compatíveis. A instalação pelo npm aparece como
uma etapa separada, sem porcentagem inventada.

Após instalar, o CLI oferece reiniciar o bot se ele estiver rodando; `--yes`
também confirma esse reinício. A configuração, o `botDir` e a pasta `.keys`
continuam os mesmos. Atualize cliente e servidor para um protocolo compatível.
O updater confere a versão e a entrada do CLI no prefixo global informado pelo
npm e executa o **CLI recém-instalado em um novo processo Node**, preservando
`PM2_HOME`, idioma e overrides de host/ferramentas. Um bot parado não é iniciado.
Falha no reinício é informada separadamente da instalação concluída. O reinício
não prepara ferramentas de música no host.

Um atualizador antigo já carregado não recebe essa correção retroativamente.
Na primeira atualização, se o pacote instalar mas o reinício antigo falhar,
execute `monkybot restart` separadamente; não refaça o setup nem apague `.keys`.

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

## Instalação por URL (Marketplace, recomendado)

Se quiser que **qualquer servidor Monky** possa adicionar o bot pela URL:

Via CLI:
```bash
monkybot setup   # Opção 1 (URL — recomendado); inicia/reinicia e verifica o manifest automaticamente
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
| `/enquete` | Formulário privado que publica uma votação com encerramento automático |
| `/tocar <busca>` | Busca por nome ou link do YouTube, prévia privada e seleção para adicionar à fila |
| `/fila` | Faixa atual e fila numerada de próximas faixas |
| `/tocando` | Faixa atual, pausa/carregamento e posição |
| `/pausar` / `/retomar` | Pausa e retoma na mesma posição, sem reiniciar |
| `/pular` | Pula a faixa atual (ou o primeiro carregamento pendente) |
| `/parar` | Para e limpa toda a fila; permanece conectado durante a carência |
| `/sair` | Para, limpa a fila e sai da voz |
| `/remover <posição>` | Remove uma posição, a partir de 1, das próximas faixas |
| `/limpar` | Limpa somente as próximas faixas, preservando a atual |
| `/jogo-da-velha` | Tela compartilhada para 2 jogadores, com espectadores |
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
Conteúdo público gerado, como o resultado de uma enquete ou um aviso da fila,
mantém o idioma da pessoa cuja interação o originou.

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

#### Diagnóstico manual do host (legado)

Os comandos `monkybot music-check` e `monkybot music-diagnose` verificam somente
o runtime de mídia instalado no **host do bot**. `monkybot music-setup` permite
preparar ferramentas nesse host manualmente para usos legados. Eles não são
executados na inicialização normal e nunca servem de fallback para a execução
local aprovada.

Os executáveis não vêm no tarball. Ferramentas válidas são reaproveitadas;
as ausentes ou incompatíveis são baixadas das releases oficiais de
[yt-dlp](https://github.com/yt-dlp/yt-dlp/releases) e
[yt-dlp/FFmpeg-Builds](https://github.com/yt-dlp/FFmpeg-Builds/releases),
com conferência de tamanho e SHA-256 antes de executar. Os downloads diretos ficam
em `~/.monkybot/tools`, sem alterar pacotes do sistema. Downloads exigem HTTPS e
acesso ao GitHub. Cada preparação tem prazo máximo de dez minutos.
O FFmpeg é extraído em uma única passagem, sem descompactar o `.tar.xz` antes
apenas para listar seu conteúdo. A extração usa o prazo global, não um limite
separado de 30 segundos; o CLI distingue download, extração e verificação.
O progresso do download usa os bytes realmente recebidos e o tamanho publicado.
A conclusão do download não significa fim da preparação: a conferência de
SHA-256, a extração e a validação do executável aparecem como etapas separadas.

Uma ferramenta válida é verificada uma única vez em cada preparação; candidatos
baixados são verificados antes da instalação atômica. Os limites por processo
são **5 segundos para Node.js, 30 para yt-dlp e 15 para FFmpeg**, permitindo
inicializações mais lentas sem remover a validação. O prazo total continua em
dez minutos. Um timeout não provoca a instalação silenciosa de outro executável.

- **Ubuntu/Debian e outros Linux com glibc:** instalação automática em x64 e
  arm64. É necessário `tar` com suporte a xz; GNU tar usa também `xz-utils`.
- **Windows:** instalação automática em x64, arm64 e x86, usando o `tar`
  fornecido pelo sistema para extrair o FFmpeg.
- **macOS:** yt-dlp é instalado localmente; FFmpeg usa um Homebrew já instalado,
  **somente após confirmação explícita**. Sem terminal interativo, não autoriza
  instalação no sistema. Pode-se fornecer um FFmpeg já existente.
- **musl/Alpine ou outra plataforma:** instale executáveis compatíveis e
  informe seus caminhos; não é baixado um binário glibc como se fosse compatível.

A ordem de resolução é: `MONKY_MUSIC_YTDLP` / `MONKY_MUSIC_FFMPEG` explícitos,
ferramentas gerenciadas e, por último, `PATH`. Overrides devem conter caminhos
completos, **sem argumentos extras**; um override inválido gera erro e não é
substituído silenciosamente. Os caminhos resolvidos são repassados ao PM2.
No start/restart, overrides anteriores do próprio processo são preservados se
não houver uma nova definição no shell. Configure variáveis no ambiente do
processo/PM2; `.env.example` é referência, não é carregado automaticamente.

Para a resolução manual legada no host, é necessário **Node.js 22+** para os
desafios JavaScript atuais do YouTube. O setup legado exige esse runtime;
não atualiza o Node global nem altera os requisitos do executor no cliente.
O bot habilita explicitamente `--js-runtimes node:<executável>`, usando o Node
que o iniciou ou `MONKY_MUSIC_NODE`; não depende da descoberta automática do
yt-dlp. Use o executável oficial do yt-dlp, que inclui **EJS**, ou instale/atualize
`yt-dlp[default]` no seu ambiente gerenciado. EJS deve acompanhar a versão do
yt-dlp. Veja o [guia oficial de EJS](https://github.com/yt-dlp/yt-dlp/wiki/EJS).
Plugins, outros runtimes e downloads remotos de componentes EJS estão
explicitamente desativados: não são usados atalhos `ejs:github`/`ejs:npm` nem
helpers EJS remotos sem versão fixada. O diagnóstico valida Node e executáveis
localmente; a disponibilidade do extrator/EJS para um vídeo é confirmada somente
na resolução, antes de aceitar o item na fila.

```bash
monkybot music-setup
monkybot music-check
# Checkout local, após npm run build:
npm run check:music
```

`music-check` mostra o estado e o motivo de falha de cada ferramenta do host.
Não instala, não baixa mídia e não promete disponibilidade do YouTube. Seu
resultado não representa a prontidão do cliente que executará uma faixa local.

Ferramentas de host preparadas por versões antigas podem permanecer instaladas,
mas não precisam ser atualizadas nem removidas para a execução local. Reiniciar
ou iniciar o MonkyBot não prepara ferramentas de música automaticamente.

#### Quando a busca funciona, mas o áudio público não é resolvido

Este roteiro investiga apenas o host legado, não as ferramentas ou a rede do
cliente solicitante. Na execução local atual, confira o estado e os erros na
aba de ferramentas de bots do Monky.

A busca usa metadados resumidos; encontrar uma sugestão **não comprova** que o
extrator conseguirá obter um endereço de áudio público elegível. A resposta
“Não foi possível carregar o áudio público” corresponde a `unavailable`: sozinha,
ela **não confirma timeout, bloqueio do IP ou necessidade de autenticação**.

O bot mantém a resposta privada e localizada. Os logs agora preservam o código
da falha e o stderr sanitizado, inclusive quando a resolução falha antes de
entrar na fila e quando uma busca/prévia propaga uma exceção. URLs, credenciais
identificáveis e chaves são redigidas; o diagnóstico é limitado em tamanho.

No host afetado, sem reinstalar nem reiniciar apenas para investigar:

```bash
monkybot --version
monkybot music-check
# Exemplo público; substitua pelo vídeo individual público que falhou:
monkybot music-diagnose --url "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
monkybot logs --no-follow --lines 100
```

`music-diagnose` exige uma URL explícita e válida. Tem prazo global de **45
segundos**, consulta somente metadados com as mesmas validações do `/play` e
nunca baixa/reproduz áudio ou instala ferramentas. Exibe versões, identificação
do vídeo e etapa da falha, **não** JSON do provedor nem endereço assinado.
Sem uma assinatura específica de erro, `providerCause=UNRESOLVED` deixa claro
que a causa ainda precisa ser confirmada; conserve a linha sanitizada para
análise, junto da versão, sistema e horário do teste. Um resultado aceito valida
metadados/endereço, não a transferência de áudio. Sucesso em outra máquina não
prova funcionamento nesse host.

`providerCause=YOUTUBE_BOT_CHALLENGE` identifica a resposta explícita do YouTube
pedindo confirmação de que o acesso não é de um bot, na etapa `resolve`. É uma
recusa da aplicação, não evidência de bloqueio geral de saída da VPS. O critério
de IP/reputação não foi comprovado e o acesso ao host de áudio ainda não foi
exercitado. Isso é diferente de um timeout ao verificar os executáveis.
As instruções nativas de autenticação são omitidas do diagnóstico.

Não envie `.keys`, `config.json`, `.env`, cookies, tokens nem URLs assinadas.
Não habilite autenticação, proxies ou componentes EJS remotos para contornar uma
restrição. O executável oficial do yt-dlp já inclui EJS e deve ser mantido
compatível com Node.js 22+; configurações locais e plugins continuam ignorados.
Sem o diagnóstico do host, a causa do provedor permanece **não confirmada**.

#### Reprodução e recuperação

1. Entre numa sala de voz e execute `/play` com nome ou link individual
   `https://www.youtube.com/watch?v=...` / `https://youtu.be/...`.
2. As sugestões aparecem durante a digitação, com até **8 resultados públicos
   elegíveis**. Um link individual retorna a sugestão daquele vídeo. O cliente
   aplica debounce, limita a frequência e descarta buscas anteriores.
   O botão de ouvir gera uma **prévia privada de até 10 segundos**, somente
   quando clicado: ela toca no seu cliente e não adiciona nada à fila.
   Clicar na sugestão ou confirmá-la pelo teclado executa `/play` uma única vez.
   Não há `/query` separado nem uma segunda janela de seleção.
3. A fila conecta à sala de quem adicionou o primeiro item e toca em ordem.
   Os pedidos de adicionar e pular recebem uma resposta imediata de processamento.
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

Há uma fila/conexão independente por servidor, até **50 próximas faixas**
(incluindo adições em resolução) e vídeos de no máximo **1 hora**. Adições
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

**Sem Spotify, playlists, álbuns, lives ou conteúdo com autenticação/paywall
nesta versão.** Links de um vídeo individual podem conter `list`, `index` ou
`start_radio`: esse contexto é descartado e somente o vídeo selecionado entra
na fila. Links apenas de playlist, sem vídeo individual válido, são rejeitados;
isso não adiciona reprodução de playlists ou rádios contínuas.
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

O teste do tarball instala **offline, com cache vazio e prefixo local isolado**,
executa o CLI `--version`, negocia voz P2P com ICE/DTLS e recebe um pacote Opus
sintético pelo caminho de voz do SDK incluído. Também inicia o bot empacotado
para consultar `/manifest`, incluindo o logo oficial, e verifica os vínculos
após reiniciar o processo. Resolução de módulos fora da instalação é rejeitada
para impedir que dependências do checkout escondam falhas. Nenhum bot ou pm2
global é instalado, parado ou reiniciado.

A CI executa esse teste **antes de publicar**. A variável de repositório
`MONKY_SDK_RELEASE` pode fixar a tag da release do Monky que fornece o SDK; sem ela,
usa-se o SDK publicado mais recente, betas inclusive. Em ambos os casos, o build
falha se o SDK não corresponder ao protocolo declarado em `package.json` ou não
oferecer seletores duráveis, voz, telas, execução local concreta e nomes de
comandos localizados. O pacote preserva a localização e a identidade das
dependências transitivas do SDK (incluindo WebRTC/werift), sem clonar uma
dependência compartilhada para cada consumidor. Instâncias ou versões
distintas permanecem separadas; uma resolução que não possa ser preservada
interrompe o empacotamento. Workspaces `file:` continuam suportados. Publique
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
