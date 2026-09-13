# SDK compativel

`monky-bot-sdk-16.0.5-beta.tgz` e o pacote oficial da
[release Monky v16.0.5-beta](https://github.com/MonkyOrg/Monky/releases/tag/v16.0.5-beta),
com o shared incluido, para o protocolo Monky 14. A licenca MIT
acompanha o pacote. O codigo-fonte permanece em `MonkyOrg/Monky`; este
repositorio nao mantem um fork do SDK.

O pacote permite `npm ci` sem depender de um checkout irmao do Monky.
Cliente e servidor precisam usar o mesmo protocolo. O SDK publica a
identidade do bot e fornece as mesmas validacoes usadas pelo setup generico.
O CLI do SDK tambem verifica conflitos na porta do manifest; o MonkyBot
mantem a mesma protecao em seu CLI proprio, preservando perfil e host de escuta.

O arquivo foi baixado sem modificacoes da release. Seu SHA-256 e
`bea49f1ec74dd601cb0ceeb638c01df6c75352efd41e514fd74aed099f447e6b`.

Ao atualizar o SDK, baixe o pacote de uma nova release compativel, confira
seu digest e atualize dependencia, lockfile e este registro de origem juntos.
Substitua tag e nome do arquivo do exemplo pela nova versao:

```powershell
gh release download v16.0.5-beta --repo MonkyOrg/Monky --pattern monky-bot-sdk-16.0.5-beta.tgz --dir vendor
npm install --save-exact .\vendor\monky-bot-sdk-16.0.5-beta.tgz
npm run check:sdk
npm test
```

Remova apenas o arquivo substituido. Nao reutilize um caminho antigo com
bytes diferentes: o cache do npm pode reaproveitar seu conteudo.

A publicacao continua usando o SDK de uma release do Monky. Publique o
SDK compativel antes do bot; a CI recusa protocolos diferentes.
