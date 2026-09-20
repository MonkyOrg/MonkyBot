# SDK compativel

## SDK oficial ativo

A dependencia ativa e `monky-bot-sdk-24.0.1.tgz`, da
[release stable Monky v24.0.1](https://github.com/MonkyOrg/Monky/releases/tag/v24.0.1).
Inclui `@monky/shared` no protocolo **22** e a arvore completa de dependencias
de producao. O MonkyBot mantem seu CLI proprio e as capacidades existentes;
nao solicita `receive_voice` nem passa a ouvir microfones.

Origem: commit `923ea76a84dcf8a9db5b3cc0d155fcdf6c3e17a9`,
apos o merge do PR MonkyOrg/Monky#691. Os bytes foram produzidos pelo workflow
[Release 35514443807](https://github.com/MonkyOrg/Monky/actions/runs/35514443807)
e conferidos contra o digest do asset e o arquivo de checksums da release,
sem modificacoes locais. O empacotador preserva as instancias compartilhadas
dos registries ASN.1, corrigindo a inicializacao de voz do SDK 24.0.0-beta.
SHA-256:
`a6dc3935d0cd2d626b1f7695cd1ef82149e93d972d0aaf38e93c830b5a3142b3`.
Tamanho: 5.995.670 bytes.

Dependencia e lockfile fixam esses bytes, sem vinculos a outro checkout.
Pacotes temporarios de QA nao acompanham o repositorio.
O pin `MONKY_SDK_RELEASE` do workflow deve apontar para `v24.0.1`.

Cliente, servidor e bot devem usar protocolo 22; o protocolo 21 nao e
compativel. A mudanca exige uma release major do bot. O workflow ainda gera
betas por padrao; promocao para stable exige solicitacao explicita.
Preserve perfis, identidades, vinculos, preferencias e consentimentos
existentes; nao e necessario refazer o setup.

## SDK oficial anterior (protocolo 21)

A dependencia anterior era `monky-bot-sdk-23.0.2-beta.tgz`, da
[release oficial Monky v23.0.2-beta](https://github.com/MonkyOrg/Monky/releases/tag/v23.0.2-beta).
Inclui `@monky/shared` no protocolo **21**, mensagens com variantes PT-BR/EN
por leitor e as ferramentas create, doctor e CLI interativo reutilizavel.
O MonkyBot continua usando seu CLI proprio.

Origem: commit `ba124d1179a5df45938de0287c7c659f720b7976`,
apos o merge do PR MonkyOrg/Monky#685. Os bytes foram produzidos pelo workflow
[Release 35414330845](https://github.com/MonkyOrg/Monky/actions/runs/35414330845)
e conferidos contra o digest do asset publicado, sem modificacoes locais.
SHA-256:
`a5471a013612652c462940807a4969e41deeb02b023fa00f0134d41b70a8ee0e`.

Essa dependencia usava esses bytes, sem vinculos a outro checkout e sem
pacotes de QA. Exigia cliente, servidor e bot no protocolo 21, sem
compatibilidade com o protocolo 20 ou promocao para stable.

## SDK oficial anterior

`monky-bot-sdk-22.1.0.tgz` era o pacote oficial da
[release stable Monky v22.1.0](https://github.com/MonkyOrg/Monky/releases/tag/v22.1.0),
com o shared incluido, para o protocolo Monky **20**. A licenca MIT
acompanha o pacote. O codigo-fonte permanece em `MonkyOrg/Monky`; este
repositorio nao mantem um fork do SDK.

Origem do codigo: commit `c13d3230dd3c6db316ffc2341c38e45dd11ff4d7`,
apos o merge do PR MonkyOrg/Monky#674. O pacote foi produzido pelo workflow
[Release 35292727665](https://github.com/MonkyOrg/Monky/actions/runs/35292727665),
sem modificacoes locais. Os bytes foram conferidos contra o asset publicado.
Protocolo 20 e SDK 22.1.0. SHA-256:
`ab1209189eacf51e5ae2a310bff6399fb0353aa7e588ed26ecb7d0735e4f4de2`.

O pacote oficial permite `npm ci` sem depender de um checkout irmao do Monky.
Cliente e servidor precisam usar o mesmo protocolo. O SDK publica a
identidade do bot e fornece as mesmas validacoes usadas pelo setup generico.
Esta versao preserva voz, preferencias de idioma, miniapps, nomes de comandos
localizados e paginacao, o runtime de midia reutilizavel e os contratos publicos
de execucao local. Mantem a declaracao obrigatoria de capacidades, o
consentimento administrativo e as revisoes de permissoes por instalacao.
O CLI generico do SDK agora permite trocar a origem das atualizacoes apos
instalar. O MonkyBot mantem seu CLI proprio; seus comandos musicais no cliente
continuam disponiveis, sem ferramentas legadas no host do bot.

Inclui a implementacao concreta de `BotClient.localExecution()`, o receptor RTC
privado, `LocalExecutionError` e `LocalExecutionRpcError`, a conclusao
autoritativa `LocalOpusStream.closed` e `checkSourceAvailability()` para verificar
a conexao original de uma fonte. O MonkyBot usa esse caminho em producao, sem
fallback na VPS. A recuperacao de vinculos remove apenas o cadastro revogado
ou com credenciais explicitamente rejeitadas, preservando a identidade e os
demais servidores. Falhas de rede ou incompatibilidade de protocolo nao
apagam os cadastros.

## Atualizar o SDK

Ao atualizar, baixe uma release oficial compativel, confira seu digest e
atualize dependencia, lockfile e este registro de origem juntos.
Informe a tag oficial publicada, nunca uma versao local de QA:

```powershell
$tag = Read-Host "Tag oficial compativel do Monky"
$version = $tag -replace '^v', ''
gh release download $tag --repo MonkyOrg/Monky --pattern "monky-bot-sdk-$version.tgz" --dir vendor
npm install --save-exact ".\vendor\monky-bot-sdk-$version.tgz"
npm run check:sdk
npm test
gh variable set MONKY_SDK_RELEASE --repo MonkyOrg/MonkyBot --body $tag
```

Remova apenas o arquivo substituido. Nao reutilize um caminho antigo com
bytes diferentes: o cache do npm pode reaproveitar seu conteudo.

A publicacao continua usando o SDK de uma release do Monky. Publique o
SDK compativel antes do bot; a CI recusa protocolos diferentes. A variavel
`MONKY_SDK_RELEASE` fixa essa mesma tag no workflow de publicacao.

## Proveniencia anterior

O SDK anterior era `22.0.10-beta`, protocolo 20, da
[release oficial](https://github.com/MonkyOrg/Monky/releases/tag/v22.0.10-beta),
originada no commit `ea0cf0b3d21099b6cb9288bb7fc0c8aba866eca0`.
Seu SHA-256 era
`d0faf1d1728c8f51312b89f61ae7bcef2de1904c428df821a13f742c6f56de5e`.

Antes dele, o SDK era `22.0.9-beta`, protocolo 20, da
[release oficial](https://github.com/MonkyOrg/Monky/releases/tag/v22.0.9-beta),
originada no commit `b55e2d3e27e6012cf78623fee54d7b1b9b6770da`.
Seu SHA-256 era
`8ff4d061cf15a314feb25081337e183272a28277c52b6828f982a8714c12613f`.

Antes dele, o SDK era `21.0.2-beta`, protocolo 19, da
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
