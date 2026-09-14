# SDK compativel

## SDK oficial em uso

`monky-bot-sdk-19.0.1-beta.tgz` e o pacote oficial da
[release Monky v19.0.1-beta](https://github.com/MonkyOrg/Monky/releases/tag/v19.0.1-beta),
com o shared incluido, para o protocolo Monky **17**. A licenca MIT
acompanha o pacote. O codigo-fonte permanece em `MonkyOrg/Monky`; este
repositorio nao mantem um fork do SDK.

Origem do codigo: commit `f1b9ca13ba33f43209c6ba2b8a88d53a4955484d`.
O arquivo foi baixado sem modificacoes e conferido contra o digest do GitHub
e a lista de checksums da release. SHA-256:
`a566e8a6bd7190127a14abf680ddb1caad5a0da7b7c6f736d932490b4b5b743e`.

O pacote permite `npm ci` sem depender de um checkout irmao do Monky.
Cliente e servidor precisam usar o mesmo protocolo. O SDK publica a
identidade do bot e fornece as mesmas validacoes usadas pelo setup generico.
O CLI do SDK tambem verifica conflitos na porta do manifest; o MonkyBot
mantem a mesma protecao em seu CLI proprio, preservando perfil e host de escuta.
Esta versao preserva voz, preferencias de idioma e reinicio pelo CLI novo.
Acrescenta nomes de comandos por idioma, mantendo IDs canonicos, e referencias
exatas de instancia para operacoes de miniapp e seus eventos de encerramento.

## Atualizar o SDK

Ao atualizar o SDK, baixe o pacote de uma nova release compativel, confira
seu digest e atualize dependencia, lockfile e este registro de origem juntos.
Substitua tag e nome do arquivo do exemplo pela nova versao:

```powershell
gh release download v19.0.1-beta --repo MonkyOrg/Monky --pattern monky-bot-sdk-19.0.1-beta.tgz --dir vendor
npm install --save-exact .\vendor\monky-bot-sdk-19.0.1-beta.tgz
npm run check:sdk
npm test
gh variable set MONKY_SDK_RELEASE --repo MonkyOrg/MonkyBot --body v19.0.1-beta
```

Remova apenas o arquivo substituido. Nao reutilize um caminho antigo com
bytes diferentes: o cache do npm pode reaproveitar seu conteudo.

A publicacao continua usando o SDK de uma release do Monky. Publique o
SDK compativel antes do bot; a CI recusa protocolos diferentes. A variavel
`MONKY_SDK_RELEASE` fixa essa mesma tag no workflow de publicacao.

## Proveniencia anterior

O SDK anterior era `18.0.3-beta`, protocolo 16, da
[release oficial](https://github.com/MonkyOrg/Monky/releases/tag/v18.0.3-beta).
Seu SHA-256 era
`ae0675e06c12228ea14cd0ef49606c0f5bd00a5415ab2d645b6ee348302e64ac`.
O registro e os bytes anteriores permanecem no historico Git; nao sao a
dependencia ativa.
