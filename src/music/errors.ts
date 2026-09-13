export type MusicErrorCode = 'input' | 'selection' | 'unsupported' | 'tools' | 'runtime' | 'unavailable' | 'recovery_failed' | 'timeout' | 'not_in_voice' | 'room' | 'voice' | 'voice_runtime' | 'settings' | 'bot_runtime' | 'full' | 'busy' | 'empty' | 'position' | 'cancelled';

export class MusicError extends Error {
  constructor(readonly code: MusicErrorCode, readonly detail?: string) {
    super(code);
    this.name = 'MusicError';
  }
}

export const SOURCE_RECOVERY_FAILURE_LIMIT = 5;

export class SourceRecoveryError extends MusicError {
  constructor(readonly attempts = SOURCE_RECOVERY_FAILURE_LIMIT) {
    super('recovery_failed', `Audio did not advance after ${attempts} consecutive recovery attempts.`);
    this.name = 'SourceRecoveryError';
  }
}

const messages: Record<MusicErrorCode, [string, string]> = {
  input: ['Informe um nome ou link de vídeo individual do YouTube.', 'Enter a name or an individual YouTube video URL.'],
  selection: ['Selecione um vídeo nas sugestões para adicionar à fila.', 'Select a video from the suggestions to add it to the queue.'],
  unsupported: ['Apenas vídeos individuais públicos do YouTube, com duração de até 1 hora. Spotify, playlists, álbuns, lives e conteúdo restrito não são suportados.', 'Only public individual YouTube videos up to 1 hour are supported. Spotify, playlists, albums, live streams and restricted content are unsupported.'],
  tools: ['Música indisponível: instale yt-dlp e FFmpeg com libopus no host do bot (veja README).', 'Music unavailable: install yt-dlp and FFmpeg with libopus on the bot host (see README).'],
  runtime: ['Música exige Node.js 22 ou superior para o JavaScript do yt-dlp. Atualize o Node ou configure MONKY_MUSIC_NODE (veja README).', 'Music requires Node.js 22 or newer for yt-dlp JavaScript. Update Node or set MONKY_MUSIC_NODE (see README).'],
  unavailable: ['Não foi possível carregar o áudio público. O provedor pode estar indisponível ou exigir autenticação; nenhuma restrição será contornada.', 'Could not load public audio. The provider may be unavailable or require authentication; restrictions will not be bypassed.'],
  recovery_failed: ['Não foi possível retomar a faixa após tentativas consecutivas sem avanço do áudio.', 'Could not resume the track after consecutive attempts without audio progress.'],
  timeout: ['O carregamento excedeu o tempo limite. Tente novamente.', 'Loading timed out. Please try again.'],
  not_in_voice: ['Entre em uma sala de voz para usar este comando de música.', 'Join a voice room to use this music command.'],
  room: ['O bot já está usando outra sala de voz. Entre nessa sala para usar os comandos de música.', 'The bot is already using another voice room. Join that room to use music commands.'],
  voice: ['Não foi possível entrar na sala de voz autorizada. Verifique sua sala atual, as permissões e a conexão.', 'Could not join the authorized voice room. Check your current room, permissions and connection.'],
  voice_runtime: ['A transmissão de áudio foi interrompida por uma falha na conexão de voz.', 'Audio transmission was interrupted by a voice connection failure.'],
  settings: ['Não foi possível carregar as configurações de música deste servidor. Reabra as configurações do bot ou reconecte-o.', 'Could not load this server’s music settings. Reopen the bot settings or reconnect it.'],
  bot_runtime: ['O bot encontrou um erro ao executar uma operação. A operação pode não ter sido concluída.', 'The bot encountered an error while performing an operation. The operation may not have completed.'],
  full: ['A fila está cheia (máximo de 50 itens, incluindo carregamentos).', 'The queue is full (50 items maximum, including pending loads).'],
  busy: ['O bot está ocupado com outros carregamentos. Tente novamente em instantes.', 'The bot is busy with other loads. Please try again shortly.'],
  empty: ['Nenhuma faixa está tocando.', 'Nothing is playing.'],
  position: ['Informe uma posição válida da fila de próximas faixas.', 'Enter a valid position in the upcoming queue.'],
  cancelled: ['Operação cancelada; nenhuma faixa foi adicionada.', 'Operation cancelled; no track was added.'],
};

export function musicError(error: unknown, locale: string, fallback: MusicErrorCode = 'unavailable'): string {
  const code = error instanceof MusicError ? error.code : fallback;
  return messages[code][locale === 'en' ? 1 : 0];
}

export function aborted(signal: AbortSignal): void {
  if (signal.aborted) throw new MusicError('cancelled');
}
