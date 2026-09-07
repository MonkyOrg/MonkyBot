import readline from 'readline';
import os from 'os';
import path from 'path';
import { ANSI, color, CONFIG_DIR, CONFIG_FILE } from '../constants';
import { BotConfig, readConfig, writeConfig } from '../config';
import { DEFAULT_BOT_NAME } from '../../profile';

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
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

  console.log(color('🤖 Monky Bot — Setup', ANSI.bold));
  console.log();

  if (existing) {
    console.log(color('⚠️  Configuração existente encontrada.', ANSI.yellow));
    console.log(`   Modo: ${existing.mode}`);
    console.log(`   Bot dir: ${existing.botDir}`);
    console.log();
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    // 1. Modo
    console.log(color('Escolha o modo de operação:', ANSI.bold));
    console.log('  1. Manual — conecta a um servidor usando token');
    console.log('  2. Marketplace — expõe manifest para qualquer servidor instalar');
    console.log();

    const modeChoice = await prompt(rl, 'Modo [1]: ');
    const mode: 'manual' | 'marketplace' = modeChoice === '2' ? 'marketplace' : 'manual';

    // 2. Diretório de trabalho (onde ficam chaves .keys/ e dados)
    const defaultDir = CONFIG_DIR;
    const currentDir = existing?.botDir && existing.botDir !== defaultDir ? ` (atual: ${existing.botDir})` : '';
    const botDirInput = await prompt(rl, `Diretório de trabalho [${defaultDir}]${currentDir}: `);
    const botDir = botDirInput || defaultDir;

    const config: BotConfig = { mode, botDir: path.resolve(botDir) };

    if (mode === 'manual') {
      console.log();
      console.log(color('Modo Manual', ANSI.cyan));
      console.log('Para obter o token:');
      console.log('  1. No app Monky → Configurações do Servidor → Bots');
      console.log('  2. Clique "Criar", dê um nome ao bot');
      console.log('  3. Copie o token exibido (só aparece uma vez!)');
      console.log();

      const defaultUrl = existing?.serverUrl || 'ws://localhost:3000';
      const serverUrl = await prompt(rl, `URL do servidor [${defaultUrl}]: `);
      config.serverUrl = serverUrl || defaultUrl;

      const token = await prompt(rl, 'Token do bot: ');
      if (!token) {
        console.log(color('❌ Token é obrigatório no modo manual.', ANSI.red));
        return;
      }
      config.botToken = token;
    } else {
      console.log();
      console.log(color('Modo Marketplace', ANSI.cyan));
      console.log('Qualquer servidor Monky poderá instalar o bot via URL.');
      console.log('O host público precisa ser acessível pelos servidores que vão instalar o bot.');
      console.log();

      const defaultPort = existing?.servePort || 7780;
      const portInput = await prompt(rl, `Porta do manifest [${defaultPort}]: `);
      config.servePort = portInput ? parseInt(portInput, 10) : defaultPort;

      const detectedIp = getLocalIp();
      const ipHint = detectedIp ? ` (IP local detectado: ${detectedIp})` : '';
      console.log(`Informe o IP ou domínio público desta máquina.${ipHint}`);

      let publicHost = '';
      while (!publicHost) {
        publicHost = await prompt(rl, 'Host público: ');
        if (!publicHost) {
          console.log(color('   O host público é obrigatório para o modo marketplace.', ANSI.yellow));
        }
      }
      config.publicHost = publicHost;

      if (publicHost === 'localhost' || publicHost === '127.0.0.1') {
        console.log(color('⚠️  "localhost" só funciona para servidores na mesma máquina.', ANSI.yellow));
      }
    }

    const defaultName = existing?.botName || DEFAULT_BOT_NAME;
    const nameInput = await prompt(rl, `Nome do bot [${defaultName}]: `);
    config.botName = nameInput || defaultName;

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
  }
}
