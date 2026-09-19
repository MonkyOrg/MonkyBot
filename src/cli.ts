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
import { cliText, initializeCliLanguage, languageCommand } from './cli/i18n';
import { CliPromptCancelled } from '@monky/bot-sdk';
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
  setup                  Configura e inicia/reinicia automaticamente (URL recomendado ou token manual avançado)
  start                  Inicia o bot via pm2 ou verifica o manifest se já estiver online
  stop                   Para o bot
  restart                Reinicia o bot aplicando a configuração atual
  status                 Exibe o estado do bot (PID, uptime, memória)
  logs                   Exibe os logs do bot em tempo real
  update                 Atualiza o Monky Bot para a última stable
  autoupdate             Gerencia atualização automática
  config                 Abre Configurações (exibe a configuração em scripts)
  config language [pt-BR|en-US]  Consulta ou altera o idioma do CLI
  config set <k> <v>     Altera uma configuração
  language [pt-BR|en-US] Atalho para config language

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
  autoupdate  on [HH:MM]   Ativa verificação diária de stable (padrão: 04:00)
  autoupdate  on --beta    Inclui betas somente com esta opção explícita
  autoupdate  off           Desativa
  autoupdate  status        Mostra se está ativo

${color('EXEMPLOS', ANSI.bold)}
  monkybot setup                     Configura e aplica um início/reinício limpo automaticamente
  monkybot start                     Inicia o bot em background
  monkybot update                    Atualiza para a última versão
  monkybot update --check            Verifica se há atualizações
  monkybot update --beta             Atualiza incluindo versões beta
  monkybot autoupdate on 03:00       Ativa auto-update diário às 3h
  monkybot logs --lines 100          Exibe as últimas 100 linhas de log

${color('PRIMEIROS PASSOS', ANSI.bold)}
  1. monkybot setup     — Escolha URL ou token; o bot inicia/reinicia automaticamente
  2. Instalação por URL — Copie o manifest exibido para Configurações do Servidor → Bots
  3. monkybot status    — Verifique que está rodando
  4. monkybot logs      — Acompanhe os logs

Documentação: https://monkyorg.github.io/Monky/bots
`, `
${color('monkybot', ANSI.bold)} — Monky Bot process manager

${color('USAGE', ANSI.bold)}
  monkybot <command> [options]

${color('COMMANDS', ANSI.bold)}
  setup                  Configure and automatically start/restart (recommended URL or advanced manual token)
  start                  Start with pm2 or verify the manifest if already online
  stop                   Stop the bot
  restart                Restart the bot with the current configuration
  status                 Show bot status (PID, uptime, memory)
  logs                   Show live bot logs
  update                 Update Monky Bot to the latest stable
  autoupdate             Manage automatic updates
  config                 Open Settings (show configuration in scripts)
  config language [pt-BR|en-US]  Show or change the CLI language
  config set <k> <v>      Change a setting
  language [pt-BR|en-US]  Alias for config language

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
  autoupdate  on [HH:MM]    Enable daily stable checks (default: 04:00)
  autoupdate  on --beta     Include betas only with this explicit option
  autoupdate  off           Disable
  autoupdate  status        Show whether enabled

${color('EXAMPLES', ANSI.bold)}
  monkybot setup                    Configure and automatically apply a fresh start/restart
  monkybot start                    Start the bot in the background
  monkybot update                   Update to the latest version
  monkybot update --check           Check for updates
  monkybot update --beta            Include beta versions
  monkybot autoupdate on 03:00      Enable daily auto-update at 3 AM
  monkybot logs --lines 100         Show the last 100 log lines

${color('GETTING STARTED', ANSI.bold)}
  1. monkybot setup     — Choose URL or token; the bot automatically starts/restarts
  2. URL installation  — Copy the displayed manifest into Server Settings → Bots
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
    await languageCommand(rest);
    return;
  }
  if (command === 'config' && rest[0] === 'language') {
    await configCommand(rest);
    return;
  }

  if (['music-check', 'music-setup', 'music-diagnose'].includes(command)) {
    throw new Error(cliText(
      'Os comandos de ferramentas de música do CLI foram removidos. Use o gerenciamento de ferramentas de bots no cliente Monky. Os comandos de música do bot continuam disponíveis.',
      'The CLI music-tool commands were removed. Use bot tool management in the Monky client. The bot music commands are still available.'));
  }

  if (['setup', 'start', 'stop', 'restart', 'status', 'logs', 'config', 'update', 'autoupdate'].includes(command)) {
    await initializeCliLanguage({
      interactive: !rest.some((arg) => ['--yes', '-y', '--check', '--non-interactive'].includes(arg)) &&
        !!process.stdin.isTTY && !!process.stdout.isTTY && !process.env.CI,
    });
  }

  switch (command) {
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
  if (error instanceof CliPromptCancelled) {
    console.log(cliText('Operação cancelada.', 'Operation cancelled.'));
    return;
  }
  console.error(color(`${cliText('Erro', 'Error')}: ${errorDiagnostic(error)}`, ANSI.red));
  console.error(color(cliText('Use "monkybot --help"', 'Use "monkybot --help"'), ANSI.dim));
  process.exit(1);
});
