# SDK compativel

`monky-bot-sdk-18.0.3-beta.tgz` e o pacote oficial da
[release Monky v18.0.3-beta](https://github.com/MonkyOrg/Monky/releases/tag/v18.0.3-beta),
com o shared incluido, para o protocolo Monky 16. A licenca MIT
acompanha o pacote. O codigo-fonte permanece em `MonkyOrg/Monky`; este
repositorio nao mantem um fork do SDK.

O pacote permite `npm ci` sem depender de um checkout irmao do Monky.
Cliente e servidor precisam usar o mesmo protocolo. O SDK publica a
identidade do bot e fornece as mesmas validacoes usadas pelo setup generico.
O CLI do SDK tambem verifica conflitos na porta do manifest; o MonkyBot
mantem a mesma protecao em seu CLI proprio, preservando perfil e host de escuta.
Esta versao preserva voz e miniapps e acrescenta metadados de idioma,
preferencia de idioma no CLI e reinicio pelo CLI recem-instalado.

O arquivo foi baixado sem modificacoes da release. Seu SHA-256 e
`ae0675e06c12228ea14cd0ef49606c0f5bd00a5415ab2d645b6ee348302e64ac`.

Ao atualizar o SDK, baixe o pacote de uma nova release compativel, confira
seu digest e atualize dependencia, lockfile e este registro de origem juntos.
Substitua tag e nome do arquivo do exemplo pela nova versao:

```powershell
gh release download v18.0.3-beta --repo MonkyOrg/Monky --pattern monky-bot-sdk-18.0.3-beta.tgz --dir vendor
npm install --save-exact .\vendor\monky-bot-sdk-18.0.3-beta.tgz
npm run check:sdk
npm test
```

Remova apenas o arquivo substituido. Nao reutilize um caminho antigo com
bytes diferentes: o cache do npm pode reaproveitar seu conteudo.

A publicacao continua usando o SDK de uma release do Monky. Publique o
SDK compativel antes do bot; a CI recusa protocolos diferentes.
