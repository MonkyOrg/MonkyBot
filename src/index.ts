import { MonkyBot } from '@monky/bot-sdk';
import { registerAllCommands } from './commands';

// ── Configuration ────────────────────────────────────────────────────

const config = {
  serverUrl: process.env.MONKY_SERVER_URL || '',
  token: process.env.MONKY_BOT_TOKEN || '',
  publicKey: process.env.MONKY_PUBLIC_KEY || '',
  serve: process.env.MONKY_SERVE === 'true',
  servePort: parseInt(process.env.MONKY_SERVE_PORT || '7780', 10),
  servePublicHost: process.env.MONKY_SERVE_PUBLIC_HOST || 'localhost',
  botName: process.env.MONKY_BOT_NAME || 'Monky Bot',
};

// ── Bootstrap ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!config.publicKey) {
    console.error('❌ MONKY_PUBLIC_KEY é obrigatório. Gere um par Ed25519 e informe a chave pública em hex.');
    process.exit(1);
  }

  const bot = new MonkyBot({ publicKey: config.publicKey });

  // Register all commands.
  registerAllCommands(bot);

  // Events.
  bot.on('connected', (info: { serverId: string }) => {
    console.log(`✅ Conectado ao servidor ${info.serverId} (${bot.serverCount} servidor(es) total)`);
  });

  bot.on('disconnected', (info: { serverId: string }) => {
    console.log(`⚠️  Desconectado do servidor ${info.serverId}`);
  });

  bot.on('registered', (info: { serverId: string; serverName: string }) => {
    console.log(`📥 Registrado no servidor "${info.serverName}" (${info.serverId})`);
  });

  bot.on('error', (err: Error) => {
    console.error('❌ Erro:', err.message);
  });

  // ── Start mode ─────────────────────────────────────────────────────

  if (config.serve) {
    // Marketplace mode: serve manifest + accept registrations from any server.
    const server = await bot.serve({
      name: config.botName,
      description: 'O bot oficial de referência do Monky — comandos utilitários, diversão e mais.',
      port: config.servePort,
      publicHost: config.servePublicHost,
    });

    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : config.servePort;
    console.log(`🌐 Manifest disponível em http://${config.servePublicHost}:${port}/manifest`);
    console.log('⏳ Aguardando servidores instalarem o bot...');
  } else {
    // Manual mode: connect to a single server.
    if (!config.serverUrl || !config.token) {
      console.error('❌ MONKY_SERVER_URL e MONKY_BOT_TOKEN são obrigatórios no modo manual.');
      console.error('   Ou defina MONKY_SERVE=true para o modo marketplace.');
      process.exit(1);
    }

    bot.connect({ serverUrl: config.serverUrl, token: config.token });
    console.log(`🔌 Conectando a ${config.serverUrl}...`);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
