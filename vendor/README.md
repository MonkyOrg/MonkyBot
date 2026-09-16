# SDK compativel

## SDK oficial em uso

`monky-bot-sdk-21.0.2-beta.tgz` e o pacote oficial da
[release Monky v21.0.2-beta](https://github.com/MonkyOrg/Monky/releases/tag/v21.0.2-beta),
com o shared incluido, para o protocolo Monky **19**. A licenca MIT
acompanha o pacote. O codigo-fonte permanece em `MonkyOrg/Monky`; este
repositorio nao mantem um fork do SDK.

Origem do codigo: commit `091df3a2fc808fa3aca79f9d098779f53b4c432f`,
apos o merge do PR MonkyOrg/Monky#664 e a publicacao automatica pela main.
O arquivo foi baixado sem modificacoes e conferido contra o digest do GitHub
e a lista de checksums da release. O manifesto oficial de compatibilidade
confirma protocolo 19 e SDK 21.0.2-beta. SHA-256:
`ca8f304617206b1029b1963d1c9dcfbd471b7c17ff4daee6f341b04e825a9ede`.

O pacote oficial permite `npm ci` sem depender de um checkout irmao do Monky.
Cliente e servidor precisam usar o mesmo protocolo. O SDK publica a
identidade do bot e fornece as mesmas validacoes usadas pelo setup generico.
Esta versao preserva voz, preferencias de idioma, miniapps, nomes de comandos
localizados e paginacao, acrescentando o runtime de midia reutilizavel e os
contratos publicos de execucao local.

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
gh release download v21.0.2-beta --repo MonkyOrg/Monky --pattern monky-bot-sdk-21.0.2-beta.tgz --dir vendor
npm install --save-exact .\vendor\monky-bot-sdk-21.0.2-beta.tgz
npm run check:sdk
npm test
gh variable set MONKY_SDK_RELEASE --repo MonkyOrg/MonkyBot --body v21.0.2-beta
```

Remova apenas o arquivo substituido. Nao reutilize um caminho antigo com
bytes diferentes: o cache do npm pode reaproveitar seu conteudo.

A publicacao continua usando o SDK de uma release do Monky. Publique o
SDK compativel antes do bot; a CI recusa protocolos diferentes. A variavel
`MONKY_SDK_RELEASE` fixa essa mesma tag no workflow de publicacao.

## Proveniencia anterior

O SDK anterior era `19.0.1-beta`, protocolo 17, da
[release oficial](https://github.com/MonkyOrg/Monky/releases/tag/v19.0.1-beta),
originada no commit `f1b9ca13ba33f43209c6ba2b8a88d53a4955484d`.
Seu SHA-256 era
`a566e8a6bd7190127a14abf680ddb1caad5a0da7b7c6f736d932490b4b5b743e`.
O registro e os bytes anteriores permanecem no historico Git; nao sao a
dependencia ativa.
