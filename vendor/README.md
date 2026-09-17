# SDK compativel

`monky-bot-sdk-22.0.9-beta.tgz` e o pacote oficial da
[release Monky v22.0.9-beta](https://github.com/MonkyOrg/Monky/releases/tag/v22.0.9-beta),
com o shared incluido, para o protocolo Monky **20**. A licenca MIT
acompanha o pacote. O codigo-fonte permanece em `MonkyOrg/Monky`; este
repositorio nao mantem um fork do SDK.

Origem do codigo: commit `b55e2d3e27e6012cf78623fee54d7b1b9b6770da`,
apos o merge do PR MonkyOrg/Monky#667 e a publicacao automatica pela main.
O arquivo foi baixado sem modificacoes e conferido contra o digest do GitHub
e a lista de checksums da release. O manifesto oficial de compatibilidade
confirma protocolo 20 e SDK 22.0.9-beta. SHA-256:
`8ff4d061cf15a314feb25081337e183272a28277c52b6828f982a8714c12613f`.

O pacote oficial permite `npm ci` sem depender de um checkout irmao do Monky.
Cliente e servidor precisam usar o mesmo protocolo. O SDK publica a
identidade do bot e fornece as mesmas validacoes usadas pelo setup generico.
Esta versao preserva voz, preferencias de idioma, miniapps, nomes de comandos
localizados e paginacao, o runtime de midia reutilizavel e os contratos publicos
de execucao local. Acrescenta a declaracao obrigatoria de capacidades, o
consentimento administrativo e as revisoes de permissoes por instalacao.

Inclui a implementacao concreta de `BotClient.localExecution()`, o receptor RTC
privado, `LocalExecutionError` e `LocalExecutionRpcError`, a conclusao
autoritativa `LocalOpusStream.closed` e `checkSourceAvailability()` para verificar
a conexao original de uma fonte. O MonkyBot usa esse caminho em producao, sem
fallback na VPS. Nenhum snapshot local de desenvolvimento e distribuido.

## Atualizar o SDK

Ao atualizar o SDK, baixe o pacote de uma nova release compativel, confira
seu digest e atualize dependencia, lockfile e este registro de origem juntos.
Substitua tag e nome do arquivo do exemplo pela nova versao:

```powershell
gh release download v22.0.9-beta --repo MonkyOrg/Monky --pattern monky-bot-sdk-22.0.9-beta.tgz --dir vendor
npm install --save-exact .\vendor\monky-bot-sdk-22.0.9-beta.tgz
npm run check:sdk
npm test
gh variable set MONKY_SDK_RELEASE --repo MonkyOrg/MonkyBot --body v22.0.9-beta
```

Remova apenas o arquivo substituido. Nao reutilize um caminho antigo com
bytes diferentes: o cache do npm pode reaproveitar seu conteudo.

A publicacao continua usando o SDK de uma release do Monky. Publique o
SDK compativel antes do bot; a CI recusa protocolos diferentes. A variavel
`MONKY_SDK_RELEASE` fixa essa mesma tag no workflow de publicacao.

## Proveniencia anterior

O SDK anterior era `21.0.2-beta`, protocolo 19, da
[release oficial](https://github.com/MonkyOrg/Monky/releases/tag/v21.0.2-beta),
originada no commit `091df3a2fc808fa3aca79f9d098779f53b4c432f`.
Seu SHA-256 era
`ca8f304617206b1029b1963d1c9dcfbd471b7c17ff4daee6f341b04e825a9ede`.

Antes dele, o SDK era `19.0.1-beta`, protocolo 17, da
[release oficial](https://github.com/MonkyOrg/Monky/releases/tag/v19.0.1-beta),
originada no commit `f1b9ca13ba33f43209c6ba2b8a88d53a4955484d`.
Seu SHA-256 era
`a566e8a6bd7190127a14abf680ddb1caad5a0da7b7c6f736d932490b4b5b743e`.
O registro e os bytes anteriores permanecem no historico Git; nao sao a
dependencia ativa.
