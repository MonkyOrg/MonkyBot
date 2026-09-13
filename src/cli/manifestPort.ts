import { createServer, Socket } from 'node:net';

export const DEFAULT_MANIFEST_PORT = 7780;

export function getManifestBindHost(previousHost?: string): string {
  return process.env.MONKY_SERVE_HOST || previousHost || '0.0.0.0';
}

function portError(error: unknown, port: number, host: string): Error {
  const code = typeof error === 'object' && error !== null && 'code' in error &&
    typeof error.code === 'string' ? error.code : 'sem código';
  const context = `${host}:${port} (${code})`;

  if (code === 'EADDRINUSE') {
    return new Error(
      `A porta ${port} já está em uso por um bot ou outro serviço; escolha outra porta. ` +
      `Se for este bot, execute monkybot stop antes de continuar. Endereço local: ${context}.`,
      { cause: error }
    );
  }
  if (code === 'EACCES') {
    return new Error(`Sem permissão para usar a porta ${port} no endereço local ${context}.`, { cause: error });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`Não foi possível verificar a porta do manifest em ${context}: ${message}`, { cause: error });
}

export async function assertManifestPortAvailable(port: number, host = getManifestBindHost()): Promise<void> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Porta do manifest inválida para ${host}: ${port}. Use um inteiro entre 1 e 65535.`);
  }

  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    let closing = false;
    const onConnection = (socket: Socket): void => { socket.destroy(); };
    const finish = (error?: unknown): void => {
      if (closing) return;
      closing = true;
      server.off('listening', onListening);
      server.close((closeError?: Error) => {
        server.off('error', onError);
        server.off('connection', onConnection);
        const failure = error ?? closeError;
        if (failure) reject(portError(failure, port, host));
        else resolve();
      });
    };
    const onError = (error: Error): void => finish(error);
    const onListening = (): void => finish();

    server.on('connection', onConnection);
    server.once('error', onError);
    server.once('listening', onListening);
    try {
      server.listen({ port, host, exclusive: true });
    } catch (error: unknown) {
      finish(error);
    }
  });
}
