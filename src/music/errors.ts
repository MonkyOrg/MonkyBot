import { MediaError, type MediaErrorCode } from '@monky/bot-sdk/dist/localRuntime';
import { normalizeCliLocale } from '../cli/i18n';

export type MusicErrorCode = MediaErrorCode |
  'selection' | 'not_in_voice' | 'room' | 'voice' | 'voice_runtime' |
  'settings' | 'bot_runtime' | 'full' | 'empty' | 'position' |
  'requester_left_voice' | 'requester_disconnected' |
  'local_permission' | 'local_client_unavailable' | 'local_transport';

export type MusicError = MediaError<MusicErrorCode>;
// Type the prototype too, so instanceof keeps the extended code vocabulary.
export const MusicError: {
  new(code: MusicErrorCode, detail?: string): MusicError;
  readonly prototype: MusicError;
} = MediaError;
export { SourceRecoveryError, SOURCE_RECOVERY_FAILURE_LIMIT, aborted } from '@monky/bot-sdk/dist/localRuntime';

const messages: Record<MusicErrorCode, [string, string]> = {
  input: ['Informe um nome ou link de vídeo individual do YouTube.', 'Enter a name or an individual YouTube video URL.'],
  selection: ['Selecione um vídeo nas sugestões para adicionar à fila.', 'Select a video from the suggestions to add it to the queue.'],
  unsupported: ['Apenas vídeos individuais públicos do YouTube, com duração de até 1 hora. Spotify, playlists, álbuns, lives e conteúdo restrito não são suportados.', 'Only public individual YouTube videos up to 1 hour are supported. Spotify, playlists, albums, live streams and restricted content are unsupported.'],
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
  full: ['A fila está cheia (máximo de 50 itens, incluindo carregamentos).', 'The queue is full (50 items maximum, including pending loads).'],
  busy: ['O bot está ocupado com outros carregamentos. Tente novamente em instantes.', 'The bot is busy with other loads. Please try again shortly.'],
  empty: ['Nenhuma faixa está tocando.', 'Nothing is playing.'],
  position: ['Informe uma posição válida da fila de próximas faixas.', 'Enter a valid position in the upcoming queue.'],
  requester_left_voice: ['A pessoa que pediu a faixa saiu da voz.', 'The person who requested the track left voice.'],
  requester_disconnected: ['O cliente da pessoa que pediu a faixa foi desconectado.', 'The requester’s client disconnected.'],
  local_permission: ['A execução local de música não foi autorizada ou a permissão foi revogada no cliente de quem fez o pedido.', 'Local music execution was not authorized or its permission was revoked on the requester’s client.'],
  local_client_unavailable: ['O cliente original de quem fez o pedido não está disponível para processar esta faixa.', 'The original requester’s client is unavailable to process this track.'],
  local_transport: ['Não foi possível estabelecer o canal privado de áudio entre o cliente de quem fez o pedido e o bot.', 'Could not establish the private audio channel between the requester’s client and the bot.'],
  cancelled: ['Operação cancelada; nenhuma faixa foi adicionada.', 'Operation cancelled; no track was added.'],
};

export function musicError(error: unknown, locale: string, fallback: MusicErrorCode = 'unavailable'): string {
  const code = error instanceof MusicError && Object.hasOwn(messages, error.code) ? error.code : fallback;
  return messages[code][normalizeCliLocale(locale) === 'en' ? 1 : 0];
}
