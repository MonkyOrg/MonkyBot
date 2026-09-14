#!/usr/bin/env node

import { ANSI, color } from './cli/constants';
import { setupCommand } from './cli/commands/setup';
import {
  startCommand,
  stopCommand,
  restartCommand,
  statusCommand,
  logsCommand,
  configCommand,
} from './cli/commands/lifecycle';
import { updateCommand, autoUpdateCommand } from './cli/commands/update';
import { cliText, cliT, getCliLocale, initializeCliLanguage, parseCliLocale, saveCliLocale } from './cli/i18n';
import { errorDiagnostic } from './music/process';

function getVersion(): string {
  try {
    const pkg: unknown = require('../package.json');
    return typeof pkg === 'object' && pkg !== null && 'version' in pkg && typeof pkg.version === 'string'
      ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

function printUsage(): void {
  console.log(cliText(`
${color('monkybot', ANSI.bold)} — Gerenciador do Monky Bot

${color('USO', ANSI.bold)}
  monkybot <comando> [opções]

${color('COMANDOS', ANSI.bold)}
  setup                  Configura o bot interativamente (URL recomendado ou token manual avançado)
  start                  Inicia o bot em background via pm2
  stop                   Para o bot
  restart                Reinicia o bot aplicando a configuração atual
  status                 Exibe o estado do bot (PID, uptime, memória)
  logs                   Exibe os logs do bot em tempo real
  update                 Atualiza o Monky Bot para a última stable
  autoupdate             Gerencia atualização automática
  config                 Exibe a configuração atual
  config set <k> <v>     Altera uma configuração
  music-check            Verifica Node, yt-dlp e FFmpeg/libopus sem baixar mídia
  music-setup            Prepara as ferramentas de música sem refazer o vínculo
  music-diagnose         Diagnostica um vídeo público explícito, somente metadados
  language <pt-BR|en>    Salva o idioma do CLI

${color('OPÇÕES', ANSI.bold)}
  --version, -v          Exibe a versão
  --help, -h             Exibe esta ajuda

${color('OPÇÕES POR COMANDO', ANSI.bold)}
  restart     --fresh       Recria o processo pm2 do zero
  logs        --lines <n>   Número de linhas iniciais (padrão: 50)
  logs        --no-follow   Imprime os logs recentes e sai
  update      --check       Apenas verifica, sem instalar
  update      --beta        Inclui betas e stable, escolhendo a versão mais nova
  update      --yes         Atualiza sem pedir confirmação
  autoupdate  on [HH:MM]   Ativa verificação diária (padrão: 04:00)
  autoupdate  on --beta    Inclui betas mesmo quando a instalação é stable
  autoupdate  off           Desativa
  autoupdate  status        Mostra se está ativo
  music-diagnose --url <url> Consulta só metadados; não baixa nem reproduz áudio

${color('EXEMPLOS', ANSI.bold)}
  monkybot setup                     Configura a instalação por URL (recomendado) ou o token manual
  monkybot start                     Inicia o bot em background
  monkybot update                    Atualiza para a última versão
  monkybot update --check            Verifica se há atualizações
  monkybot update --beta             Atualiza incluindo versões beta
  monkybot autoupdate on 03:00       Ativa auto-update diário às 3h
  monkybot logs --lines 100          Exibe as últimas 100 linhas de log

${color('PRIMEIROS PASSOS', ANSI.bold)}
  1. monkybot setup     — Escolha URL (recomendado) ou token manual (avançado)
  2. monkybot start     — Inicie em background
  3. monkybot status    — Verifique que está rodando
  4. monkybot logs      — Acompanhe os logs

Documentação: https://monkyorg.github.io/Monky/bots
`, `
${color('monkybot', ANSI.bold)} — Monky Bot process manager

${color('USAGE', ANSI.bold)}
  monkybot <command> [options]

${color('COMMANDS', ANSI.bold)}
  setup                  Interactive setup (recommended URL or advanced manual token)
  start                  Start the bot in the background with pm2
  stop                   Stop the bot
  restart                Restart the bot with the current configuration
  status                 Show bot status (PID, uptime, memory)
  logs                   Show live bot logs
  update                 Update Monky Bot to the latest stable
  autoupdate             Manage automatic updates
  config                 Show current configuration
  config set <k> <v>      Change a setting
  music-check            Check Node, yt-dlp and FFmpeg/libopus without downloading media
  music-setup            Prepare music tools without recreating registrations
  music-diagnose         Diagnose an explicit public video, metadata only
  language <pt-BR|en>     Save the CLI language

${color('OPTIONS', ANSI.bold)}
  --version, -v           Show version
  --help, -h              Show this help

${color('COMMAND OPTIONS', ANSI.bold)}
  restart     --fresh       Recreate the pm2 process from scratch
  logs        --lines <n>   Initial log lines (default: 50)
  logs        --no-follow   Print recent logs and exit
  update      --check       Check only, without installing
  update      --beta        Include betas and stable; select the newest version
  update      --yes         Update without confirmation
  autoupdate  on [HH:MM]    Enable daily checks (default: 04:00)
  autoupdate  on --beta     Include betas even on stable installations
  autoupdate  off           Disable
  autoupdate  status        Show whether enabled
  music-diagnose --url <url> Metadata only; never download or play audio

${color('EXAMPLES', ANSI.bold)}
  monkybot setup                    Configure URL installation or a manual token
  monkybot start                    Start the bot in the background
  monkybot update                   Update to the latest version
  monkybot update --check           Check for updates
  monkybot update --beta            Include beta versions
  monkybot autoupdate on 03:00      Enable daily auto-update at 3 AM
  monkybot logs --lines 100         Show the last 100 log lines

${color('GETTING STARTED', ANSI.bold)}
  1. monkybot setup     — Choose URL (recommended) or manual token (advanced)
  2. monkybot start     — Start in the background
  3. monkybot status    — Confirm it is running
  4. monkybot logs      — Follow the logs

Documentation: https://monkyorg.github.io/Monky/en/bots
`).trim());
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);

  if (!command || command === '--help' || command === '-h' || command === 'help' ||
      rest.includes('--help') || rest.includes('-h')) {
    printUsage();
    return;
  }

  if (command === '--version' || command === '-v' || command === 'version') {
    console.log(`monkybot ${getVersion()}`);
    return;
  }

  if (command === 'language') {
    const selected = parseCliLocale(rest[0]);
    if (rest.length === 1 && selected) saveCliLocale(selected);
    else if (rest.length) throw new Error(cliT('language.usage'));
    else await initializeCliLanguage({ force: true });
    console.log(cliT(rest.length ? 'language.saved' : 'language.current', { locale: getCliLocale() }));
    return;
  }

  if (['music-check', 'music-setup'].includes(command) && rest.length) {
    throw new Error(cliText(`Uso: monkybot ${command}`, `Usage: monkybot ${command}`));
  }

  if (['setup', 'start', 'stop', 'restart', 'status', 'logs', 'config', 'update', 'autoupdate',
    'music-check', 'music-setup'].includes(command)) {
    await initializeCliLanguage({
      interactive: !rest.some((arg) => ['--yes', '-y', '--check', '--non-interactive'].includes(arg)) &&
        !!process.stdin.isTTY && !!process.stdout.isTTY && !process.env.CI,
    });
  }

  switch (command) {
    case 'music-check': {
      const { checkMusicToolsCommand } = await import('./cli/musicTools');
      await checkMusicToolsCommand();
      break;
    }
    case 'music-setup': {
      const { prepareMusicToolsForCli } = await import('./cli/musicTools');
      await prepareMusicToolsForCli();
      console.log(cliText(
        '✅ Ferramentas de música preparadas. Se o bot já estiver rodando, execute monkybot restart.',
        '✅ Music tools ready. If the bot is already running, run monkybot restart.'));
      break;
    }
    case 'music-diagnose': {
      const { musicDiagnoseCommand } = await import('./cli/commands/musicDiagnose');
      await musicDiagnoseCommand(rest);
      break;
    }

    case 'setup':
      await setupCommand();
      break;

    case 'start':
      await startCommand();
      break;

    case 'stop':
      stopCommand();
      break;

    case 'restart':
      await restartCommand(rest);
      break;

    case 'status':
      statusCommand();
      break;

    case 'logs':
      logsCommand(rest);
      break;

    case 'config':
      await configCommand(rest);
      break;

    case 'update':
      await updateCommand(rest);
      break;

    case 'autoupdate':
      await autoUpdateCommand(rest);
      break;

    default:
      console.error(color(cliText(`Comando desconhecido: ${command}`, `Unknown command: ${command}`), ANSI.red));
      console.error(color(cliText('Use "monkybot --help" para ver os comandos.', 'Use "monkybot --help" to see commands.'), ANSI.dim));
      process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(color(`${cliText('Erro', 'Error')}: ${errorDiagnostic(error)}`, ANSI.red));
  console.error(color(cliText('Use "monkybot --help"', 'Use "monkybot --help"'), ANSI.dim));
  process.exit(1);
});
