import { createPublicKey } from 'node:crypto';
import { BotClient, PROTOCOL_VERSION, ProtocolErrorCode, validateBotPublicHost } from '@monky/bot-sdk';
import { registerAllCommands, requestedCapabilities } from './commands';
import { DEFAULT_BOT_NAME, loadBotAvatar } from './profile';
import { loadOrGenerateKeys, REGISTRATIONS_PATH } from './utils/keys';
import { getManifestUrl } from './utils/manifest';
import { errorDiagnostic, safeDiagnostic } from './music/process';
import { cliText } from './i18n';

// ── Configuration ────────────────────────────────────────────────────
// O CLI do SDK (monkybot) fornece estas variáveis ao processo. Em execução
// direta (npm start/dev), todas são opcionais — veja README.md.

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
  registrationFile: process.env.MONKY_BOT_REGISTRATION_FILE || REGISTRATIONS_PATH,
};

/**
 * The SDK CLI runner owns the identity in `<botDir>/.keys` and passes only its
 * public key. Direct runs keep generating/reusing `.keys` in the working directory.
 */
function botPublicKey(): string {
  const provided = process.env.MONKY_BOT_PUBLIC_KEY;
  if (provided === undefined || provided === '') return loadOrGenerateKeys().publicKeyHex;
  const invalid = new Error(cliText('MONKY_BOT_PUBLIC_KEY deve ser uma chave pública Ed25519 em DER/SPKI (88 caracteres hex).',
    'MONKY_BOT_PUBLIC_KEY must be a DER/SPKI Ed25519 public key (88 hex characters).'));
  if (!/^[a-f0-9]{88}$/i.test(provided)) throw invalid;
  try {
    const key = createPublicKey({ key: Buffer.from(provided, 'hex'), format: 'der', type: 'spki' });
    if (key.asymmetricKeyType !== 'ed25519') throw invalid;
  } catch (error: unknown) {
    throw error === invalid ? invalid : new Error(invalid.message, { cause: error });
  }
  return provided.toLowerCase();
}

function validatedPublicHost(value: string): string {
  try { return validateBotPublicHost(value); }
  catch (error: unknown) {
    throw new Error(cliText('O host público deve ser um domínio ou IP, sem protocolo nem porta.',
      'The public host must be a hostname or IP without a scheme or port.'), { cause: error });
  }
}

// ── Bootstrap ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`🤖 ${config.botName}`);
  console.log('');

  const publicKey = botPublicKey();

  const avatarBase64 = loadBotAvatar();
  const bot = new BotClient({
    publicKey,
    requestedCapabilities,
    name: config.botName,
    avatarBase64,
    registrationFile: config.serve ? config.registrationFile : undefined,
  });

  // Registrar todos os comandos.
  const disposeCommands = registerAllCommands(bot);

  // Eventos.
  bot.on('connected', (info: { serverId: string }) => {
    console.log(cliText(`✅ Conectado ao servidor ${info.serverId} (${bot.serverCount} servidor(es) total)`,
      `✅ Connected to server ${info.serverId} (${bot.serverCount} total server(s))`));
  });

  bot.on('disconnected', (info: { serverId: string }) => {
    console.log(cliText(`⚠️  Desconectado do servidor ${info.serverId}`, `⚠️  Disconnected from server ${info.serverId}`));
  });

  bot.on('registered', (info: { serverId: string; serverName: string }) => {
    console.log(cliText(`📥 Registrado no servidor "${info.serverName}" (${info.serverId})`,
      `📥 Registered on server "${info.serverName}" (${info.serverId})`));
  });

  bot.on('error', (err: Error, info?: { serverId: string }) => {
    console.error(info ? cliText(`❌ Erro no vínculo ${safeDiagnostic(info.serverId)}:`, `❌ Link error ${safeDiagnostic(info.serverId)}:`)
      : cliText('❌ Erro:', '❌ Error:'), errorDiagnostic(err));
  });

  bot.on('auth_failed', (failure: unknown) => {
    if (typeof failure === 'object' && failure !== null && 'code' in failure &&
        failure.code === ProtocolErrorCode.PROTOCOL_VERSION_UNSUPPORTED) {
      console.error(
        cliText(`❌ O MonkyBot usa o protocolo ${PROTOCOL_VERSION}. Atualize o servidor Monky e o bot para versões compatíveis.`,
          `❌ MonkyBot uses protocol ${PROTOCOL_VERSION}. Update the Monky server and bot to compatible versions.`)
      );
    }
  });

  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => closing ??= (async () => {
    try { await disposeCommands(); }
    finally {
      try { await bot.close(); }
      finally {
        process.off('SIGINT', onSignal);
        process.off('SIGTERM', onSignal);
      }
    }
  })();
  const onSignal = (): void => {
    void close().catch((error: unknown) => {
      console.error(cliText('❌ Erro ao encerrar:', '❌ Shutdown error:'), errorDiagnostic(error));
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  // ── Escolha de modo ────────────────────────────────────────────────

  try {
    if (config.serve) {
      if (!Number.isInteger(config.servePort) || config.servePort < 0 || config.servePort > 65535) {
        throw new Error(cliText('MONKY_SERVE_PORT deve ser um número inteiro entre 0 e 65535.',
          'MONKY_SERVE_PORT must be an integer between 0 and 65535.'));
      }
      const host = validatedPublicHost(config.servePublicHost);
      const server = await bot.serve({
        name: config.botName,
        icon: avatarBase64,
        description: cliText('O bot oficial de referência do Monky — comandos utilitários, diversão e mais.',
          'The official Monky reference bot — utility commands, fun and more.'),
        port: config.servePort,
        host: config.serveHost,
        publicHost: host,
      });

      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : config.servePort;
      const manifestUrl = getManifestUrl(host, port);
      console.log('');
      console.log(`🌐 Manifest: ${manifestUrl}`);
      console.log(cliText(`💾 Cadastros salvos: ${bot.registeredServerCount} (${config.registrationFile})`,
        `💾 Saved registrations: ${bot.registeredServerCount} (${config.registrationFile})`));
      if (bot.registeredServerCount > 0) {
        console.log(cliText('♻️  Reconectando aos servidores salvos. Aguarde a confirmação de conexão nos logs.',
          '♻️  Reconnecting to saved servers. Wait for connection confirmation in the logs.'));
      }
      if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(host.toLowerCase())) {
        console.log('');
        console.log(cliText('⚠️  Host local — outros servidores não conseguirão acessar.',
          '⚠️  Local host — other servers cannot access it.'));
        console.log(cliText('   Use o IP ou domínio público. Reconfigure com: monkybot setup',
          '   Use the public IP or domain. Reconfigure with: monkybot setup'));
      }
      console.log('');
      console.log(cliText('   Para vincular a um servidor Monky:', '   To link to a Monky server:'));
      console.log(cliText('   Cole a URL do manifest em Configurações do Servidor → Bots',
        '   Paste the manifest URL in Server Settings → Bots'));
      console.log(cliText(`   Cole: ${manifestUrl}`, `   Paste: ${manifestUrl}`));
      console.log('');
      console.log(cliText('⏳ Aguardando servidores...', '⏳ Waiting for servers...'));
    } else if (config.serverUrl && config.token) {
      bot.connect({ serverUrl: config.serverUrl, token: config.token });
      console.log(cliText(`🔌 Conectando a ${config.serverUrl}...`, `🔌 Connecting to ${config.serverUrl}...`));
    } else {
      console.log(cliText('⚙️  Nenhuma configuração encontrada. Escolha um modo:', '⚙️  No configuration found. Choose a mode:'));
      console.log('');
      console.log(cliText('  🧰 Recomendado: monkybot setup (no checkout: npm run cli -- setup)',
        '  🧰 Recommended: monkybot setup (in a checkout: npm run cli -- setup)'));
      console.log('');
      console.log(cliText('  🌐 Instalação por URL (recomendado):', '  🌐 URL installation (recommended):'));
      console.log(cliText('     Defina as variáveis de ambiente:', '     Set environment variables:'));
      console.log('       MONKY_SERVE=true');
      console.log('       MONKY_SERVE_PORT=7780');
      console.log(cliText('       MONKY_SERVE_PUBLIC_HOST=seu-ip-ou-dominio', '       MONKY_SERVE_PUBLIC_HOST=your-ip-or-domain'));
      console.log('');
      console.log(cliText('     Vincule o bot colando a URL do manifest nas configurações.',
        '     Link the bot by pasting its manifest URL in settings.'));
      console.log(cliText('     Nome e avatar são fornecidos pelo bot.', '     The bot provides its name and avatar.'));
      console.log('');
      console.log(cliText('  📌 Conexão manual por token (avançado):', '  📌 Manual token connection (advanced):'));
      console.log(cliText('     Defina as variáveis de ambiente:', '     Set environment variables:'));
      console.log(cliText('       MONKY_SERVER_URL=ws://seu-servidor:3000', '       MONKY_SERVER_URL=ws://your-server:3000'));
      console.log(cliText('       MONKY_BOT_TOKEN=token_do_bot', '       MONKY_BOT_TOKEN=bot_token'));
      console.log('');
      console.log(cliText('     Para obter o token:', '     To obtain the token:'));
      console.log(cliText('     1. No app Monky → Configurações do Servidor → Bots → Gerar vínculo/token',
        '     1. In Monky → Server Settings → Bots → Generate link token'));
      console.log(cliText('     2. Abra "Mostrar opção avançada" e clique "Gerar token", sem definir nome ou avatar no cliente',
        '     2. Open "Show advanced option" and click "Generate token", without client-side name or avatar fields'));
      console.log(cliText('     3. Copie o token exibido (só aparece uma vez!)', '     3. Copy the token (shown only once!)'));
      console.log('');
      console.log(cliText('  📖 Docs: https://monkyorg.github.io/Monky/bots', '  📖 Docs: https://monkyorg.github.io/Monky/en/bots'));
      process.exitCode = 1;
      await close();
    }
  } catch (error: unknown) {
    await close();
    throw error;
  }
}

main().catch((err: unknown) => {
  console.error('Fatal:', errorDiagnostic(err));
  process.exitCode = 1;
});
