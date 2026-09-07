import readline from 'readline';
import os from 'os';
import path from 'path';
import { ANSI, color, CONFIG_DIR, CONFIG_FILE } from '../constants';
import { BotConfig, readConfig, writeConfig } from '../config';

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

/** Tries to detect the public IP via an external service, with local fallback. */
function getExternalIp(): string | null {
  // Try public IP first (curl ifconfig.me)
  try {
    const { execSync } = require('child_process');
    const publicIp = execSync('curl -fsSL --max-time 3 ifconfig.me', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    if (publicIp && /^\d+\.\d+\.\d+\.\d+$/.test(publicIp)) return publicIp;
  } catch {}

  // Fallback: local non-loopback interface
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

      const detectedIp = getExternalIp();
      const defaultHost = existing?.publicHost && existing.publicHost !== 'localhost'
        ? existing.publicHost
        : detectedIp || 'localhost';
      const hostInput = await prompt(rl, `Host público (IP ou domínio) [${defaultHost}]: `);
      config.publicHost = hostInput || defaultHost;

      if (config.publicHost === 'localhost' || config.publicHost === '127.0.0.1') {
        console.log(color('⚠️  "localhost" só funciona para servidores na mesma máquina.', ANSI.yellow));
        console.log(color('   Para acesso externo, use o IP ou domínio público.', ANSI.yellow));
      }

      const defaultName = existing?.botName || 'Monky Bot';
      const nameInput = await prompt(rl, `Nome do bot [${defaultName}]: `);
      config.botName = nameInput || defaultName;
    }

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
