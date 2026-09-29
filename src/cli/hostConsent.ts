import path from 'node:path';
import { cliText } from './i18n';

// Increase when the host access described to operators changes.
export const HOST_CONSENT_VERSION = 1;

export interface HostConsent {
  version: number;
  botDir: string;
}

export function hostConsentFor(botDir: string): HostConsent {
  return { version: HOST_CONSENT_VERSION, botDir: path.resolve(botDir) };
}

export function hasHostConsent(consent: unknown, botDir: string): boolean {
  if (typeof consent !== 'object' || consent === null || !('version' in consent) ||
      consent.version !== HOST_CONSENT_VERSION || !('botDir' in consent) ||
      typeof consent.botDir !== 'string' || !path.isAbsolute(consent.botDir)) return false;
  const normalize = (directory: string): string => process.platform === 'win32'
    ? path.resolve(directory).toLowerCase() : path.resolve(directory);
  return normalize(consent.botDir) === normalize(botDir);
}

export function hostAccessNotice(botDir: string): string {
  const keys = path.join(path.resolve(botDir), '.keys');
  return cliText(
    `Este MonkyBot vai ler seu programa e assets, gravar identidade e vínculos em "${keys}", ` +
    'conectar-se a servidores Monky e serviços externos e abrir portas para o manifest e os jogos. ' +
    'O CLI salva a configuração e gerencia o processo pelo PM2. ' +
    'Ele roda com as permissões da conta do sistema; esta confirmação não cria uma sandbox. ' +
    'Cada administrador de servidor continua decidindo quais capacidades o bot pode usar no seu servidor.',
    `This MonkyBot will read its program and assets, write identity and registrations to "${keys}", ` +
    'connect to Monky servers and external services, and listen on ports for its manifest and games. ' +
    'The CLI saves configuration and manages the process through PM2. ' +
    'It runs with the system account permissions; this confirmation does not create a sandbox. ' +
    'Each server administrator still decides which capabilities the bot may use on their server.');
}

export async function reviewHostConsent(
  botDir: string, ask: (question: string) => Promise<string>,
): Promise<HostConsent> {
  console.log(hostAccessNotice(botDir));
  const answer = (await ask(cliText(
    'Autorizar execução nesta máquina com esses acessos? [s/N]: ',
    'Allow execution on this machine with these accesses? [y/N]: ',
  ))).trim().toLowerCase();
  if (!['s', 'sim', 'y', 'yes'].includes(answer)) {
    throw new Error(cliText(
      'Execução não autorizada. A configuração não foi alterada e o bot não foi iniciado.',
      'Execution not authorized. Configuration was not changed and the bot was not started.'));
  }
  return hostConsentFor(botDir);
}

export function assertHostConsent(
  botDir: string, consent: unknown, env: NodeJS.ProcessEnv = process.env,
): void {
  const explicit = env.MONKY_HOST_CONSENT;
  if (explicit === String(HOST_CONSENT_VERSION) ||
      (explicit === undefined && hasHostConsent(consent, botDir))) return;
  throw new Error(cliText(
    'Falta a confirmação do operador para executar o MonkyBot nesta máquina. Execute monkybot setup. ' +
    `Em execução automatizada, leia os acessos na documentação e defina explicitamente MONKY_HOST_CONSENT=${HOST_CONSENT_VERSION}.`,
    'Operator consent is required to run MonkyBot on this machine. Run monkybot setup. ' +
    `For automated execution, review the documented accesses and explicitly set MONKY_HOST_CONSENT=${HOST_CONSENT_VERSION}.`));
}
