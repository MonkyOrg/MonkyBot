import { generateKeyPairSync } from 'crypto';
import fs from 'fs';
import path from 'path';
import { cliText } from '../cli/i18n';

const KEYS_DIR = path.resolve(process.cwd(), '.keys');
const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'private.pem');
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, 'public.hex');
export const REGISTRATIONS_PATH = path.join(KEYS_DIR, 'registrations.json');

export interface KeyPair {
  publicKeyHex: string;
  privateKeyPem: string;
}

/**
 * Loads or generates an Ed25519 key pair for TOFU authentication.
 *
 * Keys are stored in `.keys/` on first run and reused in subsequent runs.
 * The public key is saved as hex (what the Monky server expects), and the
 * private key as PEM (for potential future signing).
 */
export function loadOrGenerateKeys(): KeyPair {
  const hasPublicKey = fs.existsSync(PUBLIC_KEY_PATH);
  const hasPrivateKey = fs.existsSync(PRIVATE_KEY_PATH);
  if (hasPublicKey && hasPrivateKey) {
    return {
      publicKeyHex: fs.readFileSync(PUBLIC_KEY_PATH, 'utf8').trim(),
      privateKeyPem: fs.readFileSync(PRIVATE_KEY_PATH, 'utf8'),
    };
  }
  if (hasPublicKey || hasPrivateKey || fs.existsSync(REGISTRATIONS_PATH)) {
    throw new Error(
      cliText('A identidade do bot está incompleta. Restaure public.hex, private.pem e registrations.json ' +
      'do mesmo backup em .keys/. As chaves existentes não foram substituídas.',
      'The bot identity is incomplete. Restore public.hex, private.pem and registrations.json ' +
      'from the same backup in .keys/. Existing keys were not replaced.')
    );
  }

  console.log(cliText('🔑 Gerando par de chaves Ed25519 (primeira execução)...', '🔑 Generating Ed25519 keys (first run)...'));

  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const publicKeyHex = Buffer.from(publicKey).toString('hex');

  fs.mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(PUBLIC_KEY_PATH, publicKeyHex + '\n', { encoding: 'utf8', mode: 0o600 });
  fs.writeFileSync(PRIVATE_KEY_PATH, privateKey as string, { encoding: 'utf8', mode: 0o600 });

  // Protect the keys directory.
  try {
    fs.chmodSync(KEYS_DIR, 0o700);
    fs.chmodSync(PRIVATE_KEY_PATH, 0o600);
  } catch {
    // Windows doesn't support chmod — that's fine.
  }

  console.log(cliText('✅ Chaves geradas e salvas em .keys/', '✅ Keys generated and saved in .keys/'));
  console.log(cliText(`   Chave pública: ${publicKeyHex.substring(0, 32)}...`, `   Public key: ${publicKeyHex.substring(0, 32)}...`));

  return { publicKeyHex, privateKeyPem: privateKey as string };
}
