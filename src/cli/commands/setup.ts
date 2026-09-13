import {
  validateBotName,
  validateBotToken,
  validateBotPublicHost as validatePublicHost,
  validateBotServerUrl as validateServerUrl,
  validateBotServePort as validateServePort,
} from '@monky/bot-sdk';
import os from 'os';
import path from 'path';
import readline from 'readline';
import { Writable } from 'stream';
import { ANSI, color, CONFIG_DIR, CONFIG_FILE } from '../constants';
import { BotConfig, readConfig, writeConfig } from '../config';
import { assertManifestPortAvailable, DEFAULT_MANIFEST_PORT } from '../manifestPort';
import { DEFAULT_BOT_NAME } from '../../profile';

const DEFAULT_MANUAL_SERVER_URL = 'ws://localhost:3000';

type SetupMode = BotConfig['mode'];
type Ask = (question: string, secret?: boolean) => Promise<string>;

const MODE_CHOICES: readonly { mode: SetupMode; label: string }[] = [
  { mode: 'marketplace', label: 'Instalação por URL — recomendado' },
  { mode: 'manual', label: 'Conexão manual por token — avançado' },
];

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const onClose = (): void => reject(new Error('Setup cancelado; a configuração não foi alterada.'));
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
  return validatedPrompt(ask, `Porta do manifest [${defaultPort}]: `, async (answer) => {
    const port = validateServePort(answer || String(defaultPort));
    await assertManifestPortAvailable(port);
    return port;
  });
}

function modeLabel(mode: SetupMode): string {
  return MODE_CHOICES.find((choice) => choice.mode === mode)?.label ?? mode;
}

function normalizeBotDir(value: string): string {
  if (!value) throw new Error('O diretório de trabalho não pode ficar vazio.');
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
    throw new Error('A configuração existente tem um modo inválido; corrija-a antes de refazer o setup.');
  }

  console.log(color('🤖 Monky Bot — Setup', ANSI.bold));
  console.log();

  if (existing) {
    console.log(color('⚠️  Configuração existente encontrada.', ANSI.yellow));
    console.log(`   Modo: ${modeLabel(existing.mode)}`);
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
  const onClose = (): void => { closed = true; };
  const onSigint = (): void => { rl.close(); };
  const ensureOpen = (): void => {
    if (closed) throw new Error('Setup cancelado; a configuração não foi alterada.');
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
    console.log(color('Escolha o modo de operação:', ANSI.bold));
    for (const [index, choice] of MODE_CHOICES.entries()) {
      console.log(`  ${index + 1}. ${choice.label}`);
    }
    console.log();

    const defaultMode = existing?.mode === 'manual' ? 'manual' : 'marketplace';
    const defaultChoice = MODE_CHOICES.findIndex((choice) => choice.mode === defaultMode) + 1;
    const mode = await validatedPrompt(ask, `Modo [${defaultChoice}]: `, (answer): SetupMode => {
      const selected = Number(answer || defaultChoice) - 1;
      if (!Number.isInteger(selected) || selected < 0 || selected >= MODE_CHOICES.length) {
        throw new Error(`Escolha um modo entre 1 e ${MODE_CHOICES.length}.`);
      }
      return MODE_CHOICES[selected].mode;
    });

    const defaultDir = existing?.botDir ?? CONFIG_DIR;
    const botDir = await validatedPrompt(ask, `Diretório de trabalho [${defaultDir}]: `,
      (answer) => normalizeBotDir(answer || defaultDir));

    let config: BotConfig;

    if (mode === 'manual') {
      console.log();
      console.log(color('Conexão manual por token', ANSI.cyan));
      console.log('Para obter o token:');
      console.log('  1. No app Monky → Configurações do Servidor → Bots');
      console.log('  2. Na seção Avançado, gere um vínculo/token');
      console.log('  3. Copie o token exibido (só aparece uma vez!)');
      console.log();

      const defaultUrl = existing?.mode === 'manual'
        ? existing.serverUrl ?? DEFAULT_MANUAL_SERVER_URL
        : DEFAULT_MANUAL_SERVER_URL;
      const serverUrl = await validatedPrompt(ask, `URL do servidor [${defaultUrl}]: `,
        (answer) => validateServerUrl(answer || defaultUrl));

      const tokenHint = existing?.mode === 'manual' && existing.botToken ? ' [Enter mantém o atual]' : '';
      const botToken = await validatedPrompt(ask, `Token do bot${tokenHint}: `, (answer) => {
        if (answer) return validateBotToken(answer);
        if (existing?.mode === 'manual' && existing.botToken) return existing.botToken;
        return validateBotToken(answer);
      }, true);

      config = { mode: 'manual', botDir, serverUrl, botToken };
    } else {
      console.log();
      console.log(color('Instalação por URL', ANSI.cyan));
      console.log('Qualquer servidor Monky poderá instalar o bot via URL.');
      console.log('O host e a porta do manifest precisam ser acessíveis pelos servidores que vão instalar o bot.');
      console.log('Cada bot precisa de uma porta livre exclusiva. Para reconfigurar este bot rodando, use monkybot stop antes.');
      console.log();

      const defaultPort = existing?.mode === 'marketplace'
        ? existing.servePort ?? DEFAULT_MANIFEST_PORT
        : DEFAULT_MANIFEST_PORT;
      const servePort = await promptServePort(ask, defaultPort);

      const detectedIp = getLocalIp();
      console.log(`Informe o IP ou domínio público desta máquina.${detectedIp ? ` (IP local detectado: ${detectedIp})` : ''}`);
      const defaultHost = existing?.mode === 'marketplace' ? existing.publicHost ?? '' : '';
      const publicHost = await validatedPrompt(ask, `Host público${defaultHost ? ` [${defaultHost}]` : ''}: `,
        (answer) => validatePublicHost(answer || defaultHost));

      if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(publicHost.toLowerCase())) {
        console.log(color('Host local: somente servidores na mesma máquina conseguirão acessar.', ANSI.yellow));
      }

      config = { mode: 'marketplace', botDir, servePort, publicHost };
    }

    const defaultName = existing?.botName || DEFAULT_BOT_NAME;
    config = {
      ...config,
      botName: await validatedPrompt(ask, `Nome do bot [${defaultName}]: `,
        (answer) => validateBotName(answer || defaultName)),
    };

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
    console.log(color('✅ Configuração salva!', ANSI.green));
    console.log(`   Arquivo: ${CONFIG_FILE}`);
    console.log();
    console.log(color('Próximos passos:', ANSI.bold));
    console.log('  monkybot start    — Inicia o bot em background');
    console.log('  monkybot status   — Verifica o estado');
    console.log('  monkybot logs     — Exibe os logs');
  } finally {
    rl.close();
    rl.off('close', onClose);
    rl.off('SIGINT', onSigint);
    output.end();
  }
}
