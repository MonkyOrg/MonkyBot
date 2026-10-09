import { MediaError, type MediaErrorCode } from '@monky/bot-sdk/dist/localRuntime';
import { normalizeCliLocale } from '../i18n';

export type MusicErrorCode = MediaErrorCode |
  'selection' | 'not_in_voice' | 'room' | 'voice' | 'voice_runtime' |
  'settings' | 'bot_runtime' | 'full' | 'empty' | 'position' |
  'requester_left_voice' | 'requester_disconnected' |
  'local_permission' | 'local_client_unavailable' | 'local_transport' |
  'mix' | 'playlist_empty' | 'client_outdated' | 'server_outdated' | 'expired';

export type MusicError = MediaError<MusicErrorCode>;
// Type the prototype too, so instanceof keeps the extended code vocabulary.
export const MusicError: {
  new(code: MusicErrorCode, detail?: string): MusicError;
  readonly prototype: MusicError;
} = MediaError;
export { SourceRecoveryError, SOURCE_RECOVERY_FAILURE_LIMIT, aborted } from '@monky/bot-sdk/dist/localRuntime';

/** A full queue, reporting the server's configured limit. */
export class QueueFullError extends MusicError {
  constructor(readonly limit: number) {
    super('full');
  }
}

const messages: Record<MusicErrorCode, [string, string]> = {
  input: ['Informe um nome ou um link de vídeo ou de playlist do YouTube.', 'Enter a name or a YouTube video or playlist URL.'],
  selection: ['Selecione um vídeo nas sugestões para adicionar à fila.', 'Select a video from the suggestions to add it to the queue.'],
  unsupported: ['Apenas vídeos públicos do YouTube com até 1 hora, playlists do YouTube e álbuns do YouTube Music são suportados. Spotify, mixes, lives e conteúdo restrito não são suportados.', 'Only public YouTube videos up to 1 hour, YouTube playlists and YouTube Music albums are supported. Spotify, mixes, live streams and restricted content are unsupported.'],
  tools: ['As ferramentas locais de música não estão prontas no cliente de quem fez o pedido.', 'Local music tools are not ready on the requester’s client.'],
  runtime: ['O runtime local de música não está disponível no cliente de quem fez o pedido.', 'The local music runtime is unavailable on the requester’s client.'],
  unavailable: ['Não foi possível carregar o áudio público. O provedor pode estar indisponível ou exigir autenticação; nenhuma restrição será contornada.', 'Could not load public audio. The provider may be unavailable or require authentication; restrictions will not be bypassed.'],
  recovery_failed: ['Não foi possível retomar a faixa após tentativas consecutivas sem avanço do áudio.', 'Could not resume the track after consecutive attempts without audio progress.'],
  timeout: ['O carregamento excedeu o tempo limite. Tente novamente.', 'Loading timed out. Please try again.'],
  not_in_voice: ['Entre em uma sala de voz para usar este comando de música.', 'Join a voice room to use this music command.'],
  room: ['O bot já está usando outra sala de voz. Entre nessa sala para usar os comandos de música.', 'The bot is already using another voice room. Join that room to use music commands.'],
  voice: ['Não foi possível entrar na sala de voz autorizada. Verifique sua sala atual, as permissões e a conexão.', 'Could not join the authorized voice room. Check your current room, permissions and connection.'],
  voice_runtime: ['A transmissão de áudio foi interrompida por uma falha na conexão de voz.', 'Audio transmission was interrupted by a voice connection failure.'],
  settings: ['Não foi possível carregar as configurações de música deste servidor. Reabra as configurações do bot ou reconecte-o.', 'Could not load this server’s music settings. Reopen the bot settings or reconnect it.'],
  bot_runtime: ['O bot encontrou um erro ao executar uma operação. A operação pode não ter sido concluída.', 'The bot encountered an error while performing an operation. The operation may not have completed.'],
  full: ['A fila está cheia (o limite inclui carregamentos).', 'The queue is full (the limit includes pending loads).'],
  busy: ['O bot está ocupado com outros carregamentos. Tente novamente em instantes.', 'The bot is busy with other loads. Please try again shortly.'],
  empty: ['Nenhuma faixa está tocando.', 'Nothing is playing.'],
  position: ['Informe uma posição válida da fila de próximas faixas.', 'Enter a valid position in the upcoming queue.'],
  requester_left_voice: ['A pessoa que pediu a faixa saiu da voz.', 'The person who requested the track left voice.'],
  requester_disconnected: ['O cliente da pessoa que pediu a faixa foi desconectado.', 'The requester’s client disconnected.'],
  local_permission: ['A execução local de música não foi autorizada ou a permissão foi revogada no cliente de quem fez o pedido.', 'Local music execution was not authorized or its permission was revoked on the requester’s client.'],
  local_client_unavailable: ['O cliente original de quem fez o pedido não está disponível para processar esta faixa.', 'The original requester’s client is unavailable to process this track.'],
  local_transport: ['Não foi possível estabelecer o canal privado de áudio entre o cliente de quem fez o pedido e o bot.', 'Could not establish the private audio channel between the requester’s client and the bot.'],
  cancelled: ['Operação cancelada; nenhuma faixa foi adicionada.', 'Operation cancelled; no track was added.'],
  mix: ['Mixes do YouTube não são suportados. Envie o link de um vídeo, de uma playlist ou de um álbum.', 'YouTube mixes are not supported. Send a video, playlist or album link.'],
  playlist_empty: ['A playlist não tem vídeos que possam ser tocados (públicos, com até 1 hora e fora de transmissões ao vivo).', 'The playlist has no playable videos (public, up to 1 hour and not live).'],
  client_outdated: ['Atualize o cliente Monky de quem fez o pedido para tocar playlists do YouTube.', 'Update the requester’s Monky client to play YouTube playlists.'],
  server_outdated: ['O servidor Monky precisa ser atualizado para tocar playlists do YouTube.', 'The Monky server must be updated to play YouTube playlists.'],
  expired: ['O pedido desta faixa expirou: uma faixa pode esperar até 24 horas na fila. Adicione-a novamente.', 'This track’s request expired: a track can wait up to 24 hours in the queue. Add it again.'],
};

export function musicError(error: unknown, locale: string, fallback: MusicErrorCode = 'unavailable'): string {
  const english = normalizeCliLocale(locale) === 'en';
  if (error instanceof QueueFullError) {
    return english
      ? `The queue is full (limit of ${error.limit} tracks, including pending loads).`
      : `A fila está cheia (limite de ${error.limit} faixas, incluindo carregamentos).`;
  }
  const code = error instanceof MusicError && Object.hasOwn(messages, error.code) ? error.code : fallback;
  return messages[code][english ? 1 : 0];
}
