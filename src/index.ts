import { BotClient, PROTOCOL_VERSION, ProtocolErrorCode } from '@monky/bot-sdk';
import { registerAllCommands } from './commands';
import { DEFAULT_BOT_NAME, loadBotAvatar } from './profile';
import { loadOrGenerateKeys, REGISTRATIONS_PATH } from './utils/keys';

// ── Configuration ────────────────────────────────────────────────────
// Todas as variáveis de ambiente são opcionais — veja README.md para detalhes.

const config = {
  // Modo manual: conectar a um servidor específico.
  serverUrl: process.env.MONKY_SERVER_URL || '',
  token: process.env.MONKY_BOT_TOKEN || '',

  // Modo marketplace: servir manifest para qualquer servidor instalar.
  serve: process.env.MONKY_SERVE === 'true',
  servePort: Number(process.env.MONKY_SERVE_PORT ?? '7780'),
  serveHost: process.env.MONKY_SERVE_HOST || '0.0.0.0',
  servePublicHost: process.env.MONKY_SERVE_PUBLIC_HOST || 'localhost',
  botName: process.env.MONKY_BOT_NAME || DEFAULT_BOT_NAME,
};

// ── Bootstrap ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`🤖 ${config.botName}`);
  console.log('');

  // Chaves Ed25519 são geradas automaticamente na primeira execução
  // e reutilizadas nas seguintes. Salvas em .keys/
  const keys = loadOrGenerateKeys();

  const avatarBase64 = loadBotAvatar();
  const bot = new BotClient({
    publicKey: keys.publicKeyHex,
    name: config.botName,
    avatarBase64,
    registrationFile: config.serve ? REGISTRATIONS_PATH : undefined,
  });

  // Registrar todos os comandos.
  registerAllCommands(bot);

  // Eventos.
  bot.on('connected', (info: { serverId: string }) => {
    console.log(`✅ Conectado ao servidor ${info.serverId} (${bot.serverCount} servidor(es) total)`);
  });

  bot.on('disconnected', (info: { serverId: string }) => {
    console.log(`⚠️  Desconectado do servidor ${info.serverId}`);
  });

  bot.on('registered', (info: { serverId: string; serverName: string }) => {
    console.log(`📥 Registrado no servidor "${info.serverName}" (${info.serverId})`);
  });

  bot.on('error', (err: Error, info?: { serverId: string }) => {
    console.error(info ? `❌ Erro no vínculo ${info.serverId}:` : '❌ Erro:', err.message);
  });

  bot.on('auth_failed', (failure: unknown) => {
    if (typeof failure === 'object' && failure !== null && 'code' in failure &&
        failure.code === ProtocolErrorCode.PROTOCOL_VERSION_UNSUPPORTED) {
      console.error(
        `❌ O MonkyBot usa o protocolo ${PROTOCOL_VERSION}. Atualize o servidor Monky e o bot para versões compatíveis.`
      );
    }
  });

  const close = (): Promise<void> => bot.close().finally(() => {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  });
  const onSignal = (): void => {
    void close().catch((error: unknown) => {
      console.error('❌ Erro ao encerrar:', error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  // ── Escolha de modo ────────────────────────────────────────────────

  try {
    if (config.serve) {
      if (!Number.isInteger(config.servePort) || config.servePort < 0 || config.servePort > 65535) {
        throw new Error('MONKY_SERVE_PORT deve ser um número inteiro entre 0 e 65535.');
      }
      const server = await bot.serve({
        name: config.botName,
        icon: avatarBase64,
        description: 'O bot oficial de referência do Monky — comandos utilitários, diversão e mais.',
        port: config.servePort,
        host: config.serveHost,
        publicHost: config.servePublicHost,
      });

      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : config.servePort;
      const host = config.servePublicHost;
      const urlHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
      const manifestUrl = `http://${urlHost}:${port}/manifest`;
      console.log('');
      console.log(`🌐 Manifest: ${manifestUrl}`);
      console.log(`💾 Cadastros salvos: ${bot.registeredServerCount} (${REGISTRATIONS_PATH})`);
      if (bot.registeredServerCount > 0) {
        console.log('♻️  Reconectando aos servidores salvos. Aguarde a confirmação de conexão nos logs.');
      }
      if (host === 'localhost' || host === '127.0.0.1') {
        console.log('');
        console.log('⚠️  Host local — outros servidores não conseguirão acessar.');
        console.log('   Use o IP ou domínio público. Reconfigure com: monkybot setup');
      }
      console.log('');
      console.log('   Para adicionar a um servidor Monky:');
      console.log('   Configurações do Servidor → Bots → Adicionar Bot via URL');
      console.log(`   Cole: ${manifestUrl}`);
      console.log('');
      console.log('⏳ Aguardando servidores...');
    } else if (config.serverUrl && config.token) {
      bot.connect({ serverUrl: config.serverUrl, token: config.token });
      console.log(`🔌 Conectando a ${config.serverUrl}...`);
    } else {
      console.log('⚙️  Nenhuma configuração encontrada. Escolha um modo:');
      console.log('');
      console.log('  📌 Modo Manual (um servidor):');
      console.log('     Defina as variáveis de ambiente:');
      console.log('       MONKY_SERVER_URL=ws://seu-servidor:3000');
      console.log('       MONKY_BOT_TOKEN=token_do_bot');
      console.log('');
      console.log('     Para obter o token:');
      console.log('     1. No app Monky → Configurações do Servidor → Bots');
      console.log('     2. Digite um nome ao bot e clique "Criar"');
      console.log('     3. Copie o token exibido (só aparece uma vez!)');
      console.log('');
      console.log('  🌐 Modo Marketplace (múltiplos servidores):');
      console.log('     Defina as variáveis de ambiente:');
      console.log('       MONKY_SERVE=true');
      console.log('       MONKY_SERVE_PORT=7780');
      console.log('       MONKY_SERVE_PUBLIC_HOST=seu-ip-ou-dominio');
      console.log('');
      console.log('     Qualquer servidor Monky pode adicionar o bot');
      console.log('     colando a URL do manifest nas configurações.');
      console.log('');
      console.log('  📖 Docs: https://monkyorg.github.io/Monky/bots');
      process.exitCode = 1;
      await close();
    }
  } catch (error: unknown) {
    await close();
    throw error;
  }
}

main().catch((err: unknown) => {
  console.error('Fatal:', err);
  process.exitCode = 1;
});
