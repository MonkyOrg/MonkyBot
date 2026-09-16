import os from 'os';
import path from 'path';
import readline from 'readline';
import { Writable } from 'stream';
import { ANSI, color, CONFIG_DIR, CONFIG_FILE } from '../constants';
import {
  BotConfig, readConfig, writeConfig, validateCliBotName as validateBotName, validateCliBotToken as validateBotToken,
  validateCliPublicHost as validatePublicHost, validateCliServerUrl as validateServerUrl, validateCliServePort as validateServePort,
} from '../config';
import { assertManifestPortAvailable, DEFAULT_MANIFEST_PORT } from '../manifestPort';
import { DEFAULT_BOT_NAME } from '../../profile';
import { cliText } from '../i18n';

const DEFAULT_MANUAL_SERVER_URL = 'ws://localhost:3000';

type SetupMode = BotConfig['mode'];
type Ask = (question: string, secret?: boolean) => Promise<string>;

const MODE_CHOICES: readonly { mode: SetupMode; ptBR: string; en: string }[] = [
  { mode: 'marketplace', ptBR: 'Instalação por URL — recomendado', en: 'URL installation — recommended' },
  { mode: 'manual', ptBR: 'Conexão manual por token — avançado', en: 'Manual token connection — advanced' },
];

function cancelledMessage(): string {
  return cliText('Setup cancelado; a configuração não foi alterada.', 'Setup cancelled; the configuration was not changed.');
}

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const onClose = (): void => reject(new Error(cancelledMessage()));
    rl.once('close', onClose);
    rl.question(question, (answer) => {
      rl.off('close', onClose);
      resolve(answer.trim());
    });
  });
}

async function validatedPrompt<T>(
  ask: Ask,
  question: string,
  validate: (value: string) => T | Promise<T>,
  secret = false
): Promise<T> {
  while (true) {
    const answer = await ask(question, secret);
    try {
      return await validate(answer);
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
      console.error(color(error.message, ANSI.red));
    }
  }
}

function promptServePort(ask: Ask, defaultPort: number): Promise<number> {
  return validatedPrompt(ask, cliText(`Porta do manifest [${defaultPort}]: `, `Manifest port [${defaultPort}]: `), async (answer) => {
    const port = validateServePort(answer || String(defaultPort));
    await assertManifestPortAvailable(port);
    return port;
  });
}

function modeLabel(mode: SetupMode): string {
  const choice = MODE_CHOICES.find((entry) => entry.mode === mode);
  return choice ? cliText(choice.ptBR, choice.en) : mode;
}

function normalizeBotDir(value: string): string {
  if (!value) throw new Error(cliText('O diretório de trabalho não pode ficar vazio.', 'The working directory cannot be empty.'));
  return path.resolve(value);
}

/** Detects a non-loopback local IPv4 address as a hint. */
function getLocalIp(): string | null {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return null;
}

export async function setupCommand(): Promise<void> {
  const existing = readConfig();
  if (existing && !MODE_CHOICES.some((choice) => choice.mode === existing.mode)) {
    throw new Error(cliText('A configuração existente tem um modo inválido; corrija-a antes de refazer o setup.',
      'The existing configuration has an invalid mode; correct it before repeating setup.'));
  }

  console.log(color('🤖 Monky Bot — Setup', ANSI.bold));
  console.log();

  if (existing) {
    console.log(color(cliText('⚠️  Configuração existente encontrada.', '⚠️  Existing configuration found.'), ANSI.yellow));
    console.log(`   ${cliText('Modo', 'Mode')}: ${modeLabel(existing.mode)}`);
    console.log(`   Bot dir: ${existing.botDir}`);
    console.log();
  }

  let muted = false;
  const output = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true, historySize: 0 });
  let closed = false;
  const onClose = (): void => {
    closed = true;
  };
  const onSigint = (): void => { rl.close(); };
  const ensureOpen = (): void => {
    if (closed) throw new Error(cancelledMessage());
  };
  rl.once('close', onClose);
  rl.on('SIGINT', onSigint);
  const ask: Ask = async (question, secret = false) => {
    ensureOpen();
    const answer = prompt(rl, question);
    muted = secret;
    try {
      return await answer;
    } finally {
      muted = false;
      if (secret) console.log();
    }
  };

  try {
    console.log(color(cliText('Escolha o modo de operação:', 'Choose the operating mode:'), ANSI.bold));
    for (const [index, choice] of MODE_CHOICES.entries()) {
      console.log(`  ${index + 1}. ${modeLabel(choice.mode)}`);
    }
    console.log();

    const defaultMode = existing?.mode === 'manual' ? 'manual' : 'marketplace';
    const defaultChoice = MODE_CHOICES.findIndex((choice) => choice.mode === defaultMode) + 1;
    const mode = await validatedPrompt(ask, cliText(`Modo [${defaultChoice}]: `, `Mode [${defaultChoice}]: `), (answer): SetupMode => {
      const selected = Number(answer || defaultChoice) - 1;
      if (!Number.isInteger(selected) || selected < 0 || selected >= MODE_CHOICES.length) {
        throw new Error(cliText(`Escolha um modo entre 1 e ${MODE_CHOICES.length}.`, `Choose a mode between 1 and ${MODE_CHOICES.length}.`));
      }
      return MODE_CHOICES[selected].mode;
    });

    const defaultDir = existing?.botDir ?? CONFIG_DIR;
    const botDir = await validatedPrompt(ask, cliText(`Diretório de trabalho [${defaultDir}]: `, `Working directory [${defaultDir}]: `),
      (answer) => normalizeBotDir(answer || defaultDir));

    let config: BotConfig;

    if (mode === 'manual') {
      console.log();
      console.log(color(cliText('Conexão manual por token', 'Manual token connection'), ANSI.cyan));
      console.log(cliText('Para obter o token:', 'To obtain the token:'));
      console.log(cliText('  1. No app Monky → Configurações do Servidor → Bots', '  1. In Monky → Server Settings → Bots'));
      console.log(cliText('  2. Em "Gerar vínculo/token", abra "Mostrar opção avançada" e clique "Gerar token"',
        '  2. In "Generate link token", open "Show advanced option" and click "Generate token"'));
      console.log(cliText('  3. Copie o token exibido (só aparece uma vez!)', '  3. Copy the token (shown only once!)'));
      console.log(cliText('  Nome e foto são definidos pelo próprio bot, não pelo servidor.',
        '  The bot owns its name and avatar, not the server.'));
      console.log();

      const defaultUrl = existing?.mode === 'manual'
        ? existing.serverUrl ?? DEFAULT_MANUAL_SERVER_URL
        : DEFAULT_MANUAL_SERVER_URL;
      const serverUrl = await validatedPrompt(ask, cliText(`URL do servidor [${defaultUrl}]: `, `Server URL [${defaultUrl}]: `),
        (answer) => validateServerUrl(answer || defaultUrl));

      const tokenHint = existing?.mode === 'manual' && existing.botToken
        ? cliText(' [Enter mantém o atual]', ' [Enter keeps the current token]') : '';
      const botToken = await validatedPrompt(ask, cliText(`Token do bot${tokenHint}: `, `Bot token${tokenHint}: `), (answer) => {
        if (answer) return validateBotToken(answer);
        if (existing?.mode === 'manual' && existing.botToken) return existing.botToken;
        return validateBotToken(answer);
      }, true);

      config = { mode: 'manual', botDir, serverUrl, botToken };
    } else {
      console.log();
      console.log(color(cliText('Instalação por URL', 'URL installation'), ANSI.cyan));
      console.log(cliText('Qualquer servidor Monky poderá instalar o bot via URL.', 'Any Monky server can install the bot by URL.'));
      console.log(cliText('O host e a porta do manifest precisam ser acessíveis pelos servidores que vão instalar o bot.',
        'The manifest host and port must be reachable by the servers installing the bot.'));
      console.log(cliText('Cada bot precisa de uma porta livre exclusiva. Para reconfigurar este bot rodando, use monkybot stop antes.',
        'Each bot needs its own available port. Before reconfiguring this running bot, use monkybot stop.'));
      console.log();

      const defaultPort = existing?.mode === 'marketplace'
        ? existing.servePort ?? DEFAULT_MANIFEST_PORT
        : DEFAULT_MANIFEST_PORT;
      const servePort = await promptServePort(ask, defaultPort);

      const detectedIp = getLocalIp();
      console.log(cliText(`Informe o IP ou domínio público desta máquina.${detectedIp ? ` (IP local detectado: ${detectedIp})` : ''}`,
        `Enter this machine's public IP or domain.${detectedIp ? ` (Detected local IP: ${detectedIp})` : ''}`));
      const defaultHost = existing?.mode === 'marketplace' ? existing.publicHost ?? '' : '';
      const publicHost = await validatedPrompt(ask,
        `${cliText('Host público', 'Public host')}${defaultHost ? ` [${defaultHost}]` : ''}: `,
        (answer) => validatePublicHost(answer || defaultHost));

      if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(publicHost.toLowerCase())) {
        console.log(color(cliText('Host local: somente servidores na mesma máquina conseguirão acessar.',
          'Local host: only servers on the same machine can access it.'), ANSI.yellow));
      }

      config = { mode: 'marketplace', botDir, servePort, publicHost };
    }

    const defaultName = existing?.botName || DEFAULT_BOT_NAME;
    config = {
      ...config,
      botName: await validatedPrompt(ask, cliText(`Nome do bot [${defaultName}]: `, `Bot name [${defaultName}]: `),
        (answer) => validateBotName(answer || defaultName)),
    };

    ensureOpen();
    if (config.mode === 'marketplace') {
      const port = config.servePort ?? DEFAULT_MANIFEST_PORT;
      try {
        await assertManifestPortAvailable(port);
      } catch (error: unknown) {
        if (!(error instanceof Error)) throw error;
        ensureOpen();
        console.error(color(error.message, ANSI.red));
        config.servePort = await promptServePort(ask, port);
      }
    }
    ensureOpen();
    writeConfig(config);

    console.log();
    console.log(color(cliText('✅ Configuração salva!', '✅ Configuration saved!'), ANSI.green));
    console.log(`   ${cliText('Arquivo', 'File')}: ${CONFIG_FILE}`);
    console.log();
    console.log(color(cliText('Próximos passos:', 'Next steps:'), ANSI.bold));
    console.log(cliText('  monkybot start    — Inicia o bot em background', '  monkybot start    — Start the bot in the background'));
    console.log(cliText('  monkybot status   — Verifica o estado', '  monkybot status   — Check status'));
    console.log(cliText('  monkybot logs     — Exibe os logs', '  monkybot logs     — Show logs'));
  } finally {
    rl.close();
    rl.off('close', onClose);
    rl.off('SIGINT', onSigint);
    output.end();
  }
}
