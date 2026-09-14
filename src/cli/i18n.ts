import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import { normalizeBotLocale, resolveBotLocale, type BotLocale } from '@monky/bot-sdk';
import { CONFIG_DIR } from './constants';

export type CliLocale = BotLocale;
export type CliValues = Readonly<Record<string, string | number>>;

const preferencesFile = path.join(CONFIG_DIR, 'preferences.json');
let currentLocale: CliLocale | undefined;
let preferenceWarningShown = false;
type SavedLocale = { status: 'missing' | 'invalid' } | { status: 'valid'; locale: CliLocale };

export function parseCliLocale(value: unknown): CliLocale | undefined {
  return normalizeBotLocale(value);
}

export function normalizeCliLocale(value: unknown): CliLocale {
  return resolveBotLocale(value);
}

function environmentLocale(): CliLocale | undefined {
  return parseCliLocale(process.env.MONKY_BOT_LOCALE) ?? parseCliLocale(process.env.MONKY_LANG) ??
    parseCliLocale(process.env.MONKYBOT_LOCALE);
}

function systemLocale(): CliLocale {
  const value = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG;
  return normalizeCliLocale(value);
}

function invalidPreference(): SavedLocale {
  if (!preferenceWarningShown) {
    preferenceWarningShown = true;
    const message = messages['language.invalidPreference'];
    console.warn(message[(currentLocale ?? environmentLocale() ?? systemLocale()) === 'en' ? 1 : 0]);
  }
  return { status: 'invalid' };
}

function savedLocale(): SavedLocale {
  try {
    const file = fs.statSync(preferencesFile);
    if (!file.isFile() || file.size > 1024) return invalidPreference();
    const preferences: unknown = JSON.parse(fs.readFileSync(preferencesFile, 'utf8'));
    if (typeof preferences === 'object' && preferences !== null && 'locale' in preferences) {
      const locale = parseCliLocale(preferences.locale);
      if (locale) return { status: 'valid', locale };
    }
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return { status: 'missing' };
    }
  }
  return invalidPreference();
}

export function getCliLocale(): CliLocale {
  if (currentLocale) return currentLocale;
  const explicit = environmentLocale();
  if (explicit) return currentLocale = explicit;
  const saved = savedLocale();
  return currentLocale = saved.status === 'valid' ? saved.locale : systemLocale();
}

export function setCliLocale(locale: CliLocale): void {
  currentLocale = locale;
}

export function cliText(ptBR: string, en: string): string {
  return getCliLocale() === 'en' ? en : ptBR;
}

const messages: Readonly<Record<string, readonly [string, string]>> = {
  'language.saved': ['Idioma salvo: {locale}.', 'Language saved: {locale}.'],
  'language.current': ['Idioma atual: {locale}.', 'Current language: {locale}.'],
  'language.usage': ['Uso: monkybot language <pt-BR|en>', 'Usage: monkybot language <pt-BR|en>'],
  'language.invalidPreference': [
    'Não foi possível ler uma preferência de idioma válida em preferences.json; o arquivo foi preservado. Use monkybot language pt-BR ou monkybot language en para salvar uma escolha.',
    'Could not read a valid language preference from preferences.json; the file was preserved. Use monkybot language pt-BR or monkybot language en to save a choice.',
  ],
  'update.localVersion': ['Versão local: {version}', 'Local version: {version}'],
  'update.checking': ['Verificando atualizações ({channel})...', 'Checking for updates ({channel})...'],
  'update.noRelease': ['Nenhuma release instalável disponível neste canal.', 'No installable release is available in this channel.'],
  'update.available': ['🆕 Nova versão disponível: {version}', '🆕 New version available: {version}'],
  'update.downgradeBlocked': ['A versão {version} deste canal é anterior à instalada. Downgrade bloqueado.', 'Version {version} in this channel is older than the installed version. Downgrade blocked.'],
  'update.current': ['✅ Você já está na versão mais recente.', '✅ You are already on the latest version.'],
  'update.confirm': ['Atualizar para {version}?', 'Update to {version}?'],
  'update.cancelled': ['Atualização cancelada.', 'Update cancelled.'],
  'update.starting': ['📦 Atualizando Monky Bot...', '📦 Updating Monky Bot...'],
  'update.downloading': ['Baixando Monky Bot {version}', 'Downloading Monky Bot {version}'],
  'update.verifyingDownload': ['Verificando o pacote baixado...', 'Verifying the downloaded package...'],
  'update.installing': ['Instalando o pacote com npm; esta etapa não informa porcentagem...', 'Installing the package with npm; this stage does not report a percentage...'],
  'update.installFailed': ['Falha ao instalar a atualização.', 'Failed to install the update.'],
  'update.installed': ['✅ Monky Bot atualizado para {version}!', '✅ Monky Bot updated to {version}!'],
  'update.confirmRestart': ['Reiniciar o bot para aplicar?', 'Restart the bot to apply the update?'],
  'update.restartStarting': ['Reiniciando com o CLI recém-instalado...', 'Restarting with the newly installed CLI...'],
  'update.restartFailed': ['Pacote atualizado, mas o reinício do bot falhou: {reason}', 'Package updated, but the bot restart failed: {reason}'],
  'update.restartConfigMissing': ['Pacote atualizado, mas não foi possível ler a configuração para reiniciar.', 'Package updated, but the configuration could not be read for restart.'],
  'update.restarted': ['🔄 Bot reiniciado.', '🔄 Bot restarted.'],
  'update.invalidVersion': ['Versão inválida no pacote: {path}', 'Invalid version in package: {path}'],
  'update.versionMissing': ['Não foi possível determinar a versão instalada.', 'Could not determine the installed version.'],
  'update.unknownOption': ['Opção desconhecida: {option}', 'Unknown option: {option}'],
  'update.npmMissing': ['Não foi possível localizar o CLI do npm para atualizar.', 'Could not locate the npm CLI for the update.'],
  'update.prefixFailed': ['Não foi possível determinar o prefixo global do npm.', 'Could not determine the npm global prefix.'],
  'update.invalidPrefix': ['O npm retornou um prefixo global inválido.', 'npm returned an invalid global prefix.'],
  'update.installedPackageInvalid': ['O pacote instalado não é @monky/bot ou seus metadados são inválidos.', 'The installed package is not @monky/bot or its metadata is invalid.'],
  'update.installedVersionMismatch': ['O pacote instalado tem versão {actual}; esperava {expected}. Nenhum reinício foi executado.', 'Installed package version is {actual}; expected {expected}. No restart was performed.'],
  'update.installedEntryInvalid': ['A entrada do CLI no pacote instalado é inválida ou não está disponível.', 'The CLI entry in the installed package is invalid or unavailable.'],
  'update.installVerificationFailed': ['O npm concluiu a instalação, mas não foi possível verificar o pacote instalado: {reason}', 'npm completed installation, but the installed package could not be verified: {reason}'],
  'update.childFailed': ['O CLI recém-instalado falhou (status {status}).', 'The newly installed CLI failed (status {status}).'],
  'update.downloadFailed': ['Não foi possível baixar a atualização (HTTP {status}).', 'Could not download the update (HTTP {status}).'],
  'update.downloadOrigin': ['O download da atualização apontou para uma origem não autorizada.', 'The update download pointed to an unauthorized origin.'],
  'update.downloadRedirects': ['Redirecionamentos demais ao baixar a atualização.', 'Too many redirects while downloading the update.'],
  'update.downloadRedirectMissing': ['Redirecionamento sem destino ao baixar a atualização.', 'Update download redirect has no destination.'],
  'update.downloadSize': ['O download da atualização excedeu o limite permitido.', 'The update download exceeded its allowed size.'],
  'update.downloadMismatch': ['O pacote baixado não corresponde ao tamanho/checksum publicado. Nada foi instalado.', 'The downloaded package does not match the published size/checksum. Nothing was installed.'],
  'update.downloadEmpty': ['O download da atualização não tem conteúdo.', 'The update download has no content.'],
  'update.downloadWriteFailed': ['Não foi possível gravar o pacote baixado.', 'Could not write the downloaded package.'],
  'update.downloadTimeout': ['Tempo limite ao baixar a atualização.', 'Timed out downloading the update.'],
  'update.downloadMetadataInvalid': ['Os metadados de tamanho/checksum do pacote são inválidos.', 'Invalid package size/checksum metadata.'],
  'update.cancelledSignal': ['Atualização cancelada.', 'Update cancelled.'],
  'auto.extraOptions': ['Opções extras não são aceitas neste subcomando.', 'This subcommand does not accept extra options.'],
  'auto.enabled': ['ativado', 'enabled'],
  'auto.disabled': ['desativado', 'disabled'],
  'auto.enableHint': ['Para ativar: monkybot autoupdate on [HH:MM]', 'To enable: monkybot autoupdate on [HH:MM]'],
  'auto.disableHint': ['Para desativar: monkybot autoupdate off', 'To disable: monkybot autoupdate off'],
  'auto.disableAction': ['desativar auto-update', 'disable auto-update'],
  'auto.stopped': ['✅ Auto-update desativado.', '✅ Auto-update disabled.'],
  'auto.usage': ['Uso: monkybot autoupdate on [HH:MM] [--beta] (horário entre 00:00 e 23:59).', 'Usage: monkybot autoupdate on [HH:MM] [--beta] (time between 00:00 and 23:59).'],
  'auto.startFailed': ['Falha ao iniciar o daemon de auto-update.', 'Failed to start the auto-update daemon.'],
  'auto.started': ['✅ Auto-update ativado!', '✅ Auto-update enabled!'],
  'auto.schedule': ['Horário: {schedule} (diariamente)', 'Schedule: {schedule} (daily)'],
  'auto.channel': ['Canal: {channel}', 'Channel: {channel}'],
  'auto.followInstalled': ['acompanha a versão instalada', 'follows the installed version'],
  'auto.unknownAction': ['Subcomando desconhecido: {action}. Uso: monkybot autoupdate [on [HH:MM] [--beta] | off | status]', 'Unknown subcommand: {action}. Usage: monkybot autoupdate [on [HH:MM] [--beta] | off | status]'],
  'auto.checking': ['Verificando atualizações...', 'Checking for updates...'],
  'auto.invalidVersion': ['Versão instalada inválida.', 'Invalid installed version.'],
  'auto.updateFailed': ['Atualização falhou (status {status}).', 'Update failed (status {status}).'],
  'auto.error': ['Erro:', 'Error:'],
  'auto.nextCheck': ['Próxima verificação:', 'Next check:'],
  'auto.daemonStarted': ['Daemon iniciado (horário: {schedule}).', 'Daemon started (schedule: {schedule}).'],
  'progress.bytes': ['{received} de {total}', '{received} of {total}'],
  'progress.unknownTotal': ['{received} recebidos; tamanho total desconhecido', '{received} received; total size unknown'],
  'music.downloading': ['Baixando {tool} da distribuição oficial do projeto yt-dlp...', 'Downloading {tool} from the official yt-dlp project distribution...'],
  'music.downloadLabel': ['Baixando {tool}', 'Downloading {tool}'],
  'music.verifyingDownload': ['Verificando tamanho e SHA-256 de {tool}...', 'Verifying {tool} size and SHA-256...'],
  'music.extracting': ['Download de FFmpeg conferido por SHA-256. Extraindo o executável...', 'FFmpeg download verified with SHA-256. Extracting the executable...'],
  'music.verifyingExecutable': ['Verificando {tool}...', 'Verifying {tool}...'],
  'music.installed': ['{tool} {version} instalado; SHA-256 conferido.', '{tool} {version} installed; SHA-256 verified.'],
  'music.available': ['{tool} disponível.', '{tool} available.'],
  'music.cancelled': ['Preparação das ferramentas cancelada.', 'Tool preparation cancelled.'],
  'music.timeout': ['Tempo limite preparando as ferramentas de música.', 'Timed out preparing music tools.'],
  'music.failed': ['Preparação das ferramentas de música falhou: {reason}', 'Music tool preparation failed: {reason}'],
  'music.overrideInvalid': ['{reason} Corrija {variable}; o caminho definido não será substituído.', '{reason} Fix {variable}; the configured path will not be replaced.'],
  'music.unsupported': ['Instalação automática de {tool} indisponível em {platform}/{arch}. Instale um executável compatível e configure {variable}.', 'Automatic installation of {tool} is unavailable on {platform}/{arch}. Install a compatible executable and configure {variable}.'],
  'music.glibcRequired': ['A instalação automática em Linux exige glibc (como Ubuntu/Debian). Em musl/Alpine, instale {tool} compatível e configure {variable}.', 'Automatic installation on Linux requires glibc (such as Ubuntu/Debian). On musl/Alpine, install a compatible {tool} and configure {variable}.'],
  'music.tarRequired': ['Extrair FFmpeg exige tar com suporte a xz/zip. No Ubuntu/Debian, disponibilize tar e xz-utils. {reason}', 'Extracting FFmpeg requires tar with xz/zip support. On Ubuntu/Debian, make tar and xz-utils available. {reason}'],
  'music.extractFailed': ['Não foi possível extrair FFmpeg: {reason}', 'Could not extract FFmpeg: {reason}'],
  'music.executableTooLarge': ['O executável de FFmpeg excedeu o limite.', 'The FFmpeg executable exceeded the size limit.'],
  'music.executableMissing': ['O arquivo de FFmpeg não continha um executável.', 'The FFmpeg archive contained no executable.'],
  'music.brewRequired': ['FFmpeg no macOS exige Homebrew instalado ou um executável em MONKY_MUSIC_FFMPEG.', 'FFmpeg on macOS requires Homebrew to be installed or an executable set in MONKY_MUSIC_FFMPEG.'],
  'music.brewConfirm': ['FFmpeg será instalado pelo Homebrew no sistema. Autorizar brew install ffmpeg?', 'FFmpeg will be installed system-wide using Homebrew. Allow brew install ffmpeg?'],
  'music.brewDeclined': ['FFmpeg não foi instalado. Autorize a instalação interativa ou configure MONKY_MUSIC_FFMPEG.', 'FFmpeg was not installed. Approve the interactive installation or configure MONKY_MUSIC_FFMPEG.'],
  'music.brewInstalling': ['Instalando FFmpeg pelo Homebrew, conforme autorizado...', 'Installing FFmpeg with Homebrew, as authorized...'],
  'music.brewPrefixInvalid': ['Homebrew retornou um caminho de FFmpeg inválido.', 'Homebrew returned an invalid FFmpeg path.'],
  'music.unavailable': ['Ferramentas de música indisponíveis. Execute monkybot music-setup para preparar esta instalação.', 'Music tools are unavailable. Run monkybot music-setup to prepare this installation.'],
  'music.ready': ['Ferramentas de música disponíveis. A disponibilidade do provedor não é garantida.', 'Music tools are available. Provider availability is not guaranteed.'],
  'music.downloadOrigin': ['O download da ferramenta apontou para uma origem não autorizada.', 'The tool download pointed to an unauthorized origin.'],
  'music.downloadRedirects': ['Redirecionamentos demais ao baixar a ferramenta.', 'Too many redirects while downloading the tool.'],
  'music.downloadRedirectMissing': ['Redirecionamento sem destino ao baixar a ferramenta.', 'Tool download redirect has no destination.'],
  'music.downloadHttp': ['Não foi possível baixar a ferramenta (HTTP {status}).', 'Could not download the tool (HTTP {status}).'],
  'music.responseEmpty': ['A resposta da ferramenta não tem conteúdo.', 'The tool response has no content.'],
  'music.responseTooLarge': ['A resposta de origem da ferramenta excedeu o limite.', 'The tool source response exceeded the size limit.'],
  'music.releaseInvalid': ['A origem retornou uma release de ferramenta inválida.', 'The source returned an invalid tool release.'],
  'music.assetInvalid': ['A release não oferece um arquivo válido para {name}.', 'The release does not offer a valid file for {name}.'],
  'music.checksumMissing': ['A release não fornece um checksum verificável para a ferramenta.', 'The release does not provide a verifiable tool checksum.'],
  'music.checksumAmbiguous': ['Checksum ausente ou ambíguo para {name}.', 'Missing or ambiguous checksum for {name}.'],
  'music.metadataInvalid': ['Tamanho ou checksum de ferramenta inválido.', 'Invalid tool size or checksum.'],
  'music.downloadEmpty': ['O download da ferramenta não tem conteúdo.', 'The tool download has no content.'],
  'music.downloadTooLarge': ['O download da ferramenta excedeu o tamanho publicado.', 'The tool download exceeded its published size.'],
  'music.downloadWriteFailed': ['Não foi possível gravar a ferramenta baixada.', 'Could not write the downloaded tool.'],
  'music.downloadMismatch': ['O arquivo baixado não corresponde ao tamanho/checksum publicado. Nada foi instalado.', 'The downloaded file does not match the published size/checksum. Nothing was installed.'],
  'music.archiveUnsupported': ['O arquivo de FFmpeg não corresponde a uma distribuição oficial suportada.', 'The FFmpeg archive does not match a supported official distribution.'],
};

export function cliT(key: string, values: CliValues = {}): string {
  const message = Object.hasOwn(messages, key) ? messages[key] : undefined;
  if (!message) throw new Error(`Unknown CLI translation: ${key}`);
  return cliText(message[0], message[1]).replace(/\{(\w+)\}/g, (placeholder: string, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : placeholder);
}

export function saveCliLocale(locale: CliLocale): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const pending = `${preferencesFile}.${randomUUID()}.pending`;
  try {
    fs.writeFileSync(pending, `${JSON.stringify({ locale }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(pending, preferencesFile);
    setCliLocale(locale);
  } finally {
    fs.rmSync(pending, { force: true });
  }
}

export async function initializeCliLanguage(options: { interactive?: boolean; force?: boolean } = {}): Promise<void> {
  const interactive = options.interactive ?? (!!process.stdin.isTTY && !!process.stdout.isTTY && !process.env.CI);
  if (!interactive) return;
  if (!options.force && (environmentLocale() || savedLocale().status !== 'missing')) return;
  const defaultLocale = getCliLocale();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, historySize: 0 });
  try {
    while (true) {
      const answer = await new Promise<string>((resolve, reject) => {
        const close = (): void => reject(new Error('Language selection cancelled / Seleção de idioma cancelada.'));
        rl.once('close', close);
        rl.question(`Idioma / Language: 1. Português (Brasil)  2. English [${defaultLocale === 'en' ? '2' : '1'}]: `, (value) => {
          rl.off('close', close);
          resolve(value.trim().toLowerCase());
        });
      });
      const selected = !answer ? defaultLocale : answer === '1' ? 'pt-BR' : answer === '2' ? 'en' : parseCliLocale(answer);
      if (selected) {
        saveCliLocale(selected);
        return;
      }
      console.error('Escolha 1 ou 2 / Choose 1 or 2.');
    }
  } finally {
    rl.close();
  }
}
