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

function getVersion(): string {
  try {
    const pkg = require('../package.json');
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

function printUsage(): void {
  console.log(`
${color('monkybot', ANSI.bold)} — Monky Bot process manager

${color('USO', ANSI.bold)}
  monkybot <comando> [opções]

${color('COMANDOS', ANSI.bold)}
  setup                  Configura o bot interativamente (servidor, token, modo)
  start                  Inicia o bot em background via pm2
  stop                   Para o bot
  restart                Reinicia o bot aplicando a configuração atual
  status                 Exibe o estado do bot (PID, uptime, memória)
  logs                   Exibe os logs do bot em tempo real
  config                 Exibe a configuração atual
  config set <k> <v>     Altera uma configuração

${color('OPÇÕES', ANSI.bold)}
  --version, -v          Exibe a versão
  --help, -h             Exibe esta ajuda

${color('OPÇÕES POR COMANDO', ANSI.bold)}
  restart  --fresh       Recria o processo pm2 do zero
  logs     --lines <n>   Número de linhas iniciais (padrão: 50)
  logs     --no-follow   Imprime os logs recentes e sai

${color('EXEMPLOS', ANSI.bold)}
  monkybot setup                     Configura o bot pela primeira vez
  monkybot start                     Inicia o bot em background
  monkybot logs --lines 100          Exibe as últimas 100 linhas de log
  monkybot config set serverUrl ws://meu-servidor:3000

${color('PRIMEIROS PASSOS', ANSI.bold)}
  1. monkybot setup     — Configure servidor e token
  2. monkybot start     — Inicie em background
  3. monkybot status    — Verifique que está rodando
  4. monkybot logs      — Acompanhe os logs

Documentação: https://monkyorg.github.io/Monky/bots
`.trim());
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    printUsage();
    return;
  }

  if (command === '--version' || command === '-v' || command === 'version') {
    console.log(`monkybot ${getVersion()}`);
    return;
  }

  switch (command) {
    case 'setup':
      await setupCommand();
      break;

    case 'start':
      startCommand();
      break;

    case 'stop':
      stopCommand();
      break;

    case 'restart':
      restartCommand(rest);
      break;

    case 'status':
      statusCommand();
      break;

    case 'logs':
      logsCommand(rest);
      break;

    case 'config':
      configCommand(rest);
      break;

    default:
      console.error(color(`Comando desconhecido: ${command}`, ANSI.red));
      console.error(color('Use "monkybot --help" para ver os comandos.', ANSI.dim));
      process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(color(`Erro: ${message}`, ANSI.red));
  console.error(color('Use "monkybot --help"', ANSI.dim));
  process.exit(1);
});
