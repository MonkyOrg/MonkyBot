import { MonkyBot } from '@monky/bot-sdk';
import { registerAllCommands } from './commands';
import { loadOrGenerateKeys } from './utils/keys';

// ── Configuration ────────────────────────────────────────────────────
// Todas as variáveis de ambiente são opcionais — veja README.md para detalhes.

const config = {
  // Modo manual: conectar a um servidor específico.
  serverUrl: process.env.MONKY_SERVER_URL || '',
  token: process.env.MONKY_BOT_TOKEN || '',

  // Modo marketplace: servir manifest para qualquer servidor instalar.
  serve: process.env.MONKY_SERVE === 'true',
  servePort: parseInt(process.env.MONKY_SERVE_PORT || '7780', 10),
  servePublicHost: process.env.MONKY_SERVE_PUBLIC_HOST || 'localhost',
  botName: process.env.MONKY_BOT_NAME || 'Monky Bot',
};

// ── Bootstrap ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('🤖 Monky Bot');
  console.log('');

  // Chaves Ed25519 são geradas automaticamente na primeira execução
  // e reutilizadas nas seguintes. Salvas em .keys/
  const keys = loadOrGenerateKeys();

  const bot = new MonkyBot({ publicKey: keys.publicKeyHex });

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

  bot.on('error', (err: Error) => {
    console.error('❌ Erro:', err.message);
  });

  // ── Escolha de modo ────────────────────────────────────────────────

  if (config.serve) {
    // Marketplace: expõe manifest HTTP. Qualquer servidor Monky pode instalar.
    const server = await bot.serve({
      name: config.botName,
      description: 'O bot oficial de referência do Monky — comandos utilitários, diversão e mais.',
      port: config.servePort,
      publicHost: config.servePublicHost,
    });

    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : config.servePort;
    console.log('');
    console.log(`🌐 Manifest: http://${config.servePublicHost}:${port}/manifest`);
    console.log('');
    console.log('   Para instalar em um servidor Monky:');
    console.log('   Configurações do Servidor → Bots → Instalar Bot via URL');
    console.log(`   Cole: http://${config.servePublicHost}:${port}/manifest`);
    console.log('');
    console.log('⏳ Aguardando servidores...');
  } else if (config.serverUrl && config.token) {
    // Manual: conecta a um servidor usando token.
    bot.connect({ serverUrl: config.serverUrl, token: config.token });
    console.log(`🔌 Conectando a ${config.serverUrl}...`);
  } else {
    // Nenhum modo configurado — mostrar ajuda.
    console.log('⚙️  Nenhuma configuração encontrada. Escolha um modo:');
    console.log('');
    console.log('  📌 Modo Manual (um servidor):');
    console.log('     Crie um arquivo .env com:');
    console.log('       MONKY_SERVER_URL=ws://seu-servidor:3000');
    console.log('       MONKY_BOT_TOKEN=token_do_bot');
    console.log('');
    console.log('     Para obter o token:');
    console.log('     1. No app Monky → Configurações do Servidor → Bots');
    console.log('     2. Clique "Criar", dê um nome ao bot');
    console.log('     3. Copie o token exibido (só aparece uma vez!)');
    console.log('');
    console.log('  🌐 Modo Marketplace (múltiplos servidores):');
    console.log('     Crie um arquivo .env com:');
    console.log('       MONKY_SERVE=true');
    console.log('       MONKY_SERVE_PORT=7780');
    console.log('       MONKY_SERVE_PUBLIC_HOST=seu-ip-ou-dominio');
    console.log('');
    console.log('     Qualquer servidor Monky pode instalar o bot');
    console.log('     colando a URL do manifest nas configurações.');
    console.log('');
    console.log('  📖 Docs: https://monkyorg.github.io/Monky/bots');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
