import type {
  BotClient, BotLocale, CommandAudioPreviewContext, CommandAudioPreviewData, CommandAudioPreviewResponse,
  CommandAutocompleteContext, CommandContext, CommandDefinition, LocalExecutionProvider, LocalMediaTrack,
} from '@monky/bot-sdk';
import { LIMITS } from '@monky/bot-sdk';
import { MusicQueues, type MusicActor, type MusicNotice } from '../music/queue';
import { MusicError, aborted, musicError } from '../music/errors';
import { IncompleteAudioError, MUSIC_PREVIEW_DURATION_MS, musicInput, videoUrl, type MusicSource, type Track } from '../music/source';
import { bounded, errorDiagnostic } from '../music/process';
import { message, translate, type LocalizedCommandDefinition } from './i18n';
import { cliText } from '../cli/i18n';
import { defaultMusicIdleSeconds, musicIdleMilliseconds, musicSettingsDefinition } from '../music/settings';
import { LocalMusicSourceFactory, localMusicAutocomplete, localMusicPreview } from '../music/localSource';

export const musicDefinitions: Omit<LocalizedCommandDefinition, 'handler'>[] = [
  { name: 'play', voiceRequirement: 'same-bot-channel', description: 'Busca pelo nome ou adiciona um vídeo individual do YouTube à fila.',
    localizations: { 'pt-BR': { name: 'tocar' }, en: {
      name: 'play',
      description: 'Search by name or add an individual YouTube video to the queue.',
      options: { busca: {
        label: 'Search', description: 'Name or individual YouTube video URL',
        placeholder: 'Search for a public video or paste its URL',
      } },
    } },
    options: [{ name: 'busca', description: 'Nome ou link de vídeo individual do YouTube', type: 'string', required: true, autocomplete: true }] },
  { name: 'queue', voiceRequirement: 'same-bot-channel', description: 'Mostra a faixa atual e a fila de próximas faixas.',
    localizations: { 'pt-BR': { name: 'fila' }, en: { name: 'queue', description: 'Show the current track and upcoming queue.' } } },
  { name: 'nowplaying', voiceRequirement: 'same-bot-channel', description: 'Mostra a faixa atual e a posição da reprodução.',
    localizations: { 'pt-BR': { name: 'tocando' }, en: { name: 'nowplaying', description: 'Show the current track and playback position.' } } },
  { name: 'pause', voiceRequirement: 'same-bot-channel', description: 'Pausa a faixa atual sem perder a posição.',
    localizations: { 'pt-BR': { name: 'pausar' }, en: { name: 'pause', description: 'Pause the current track without losing its position.' } } },
  { name: 'resume', voiceRequirement: 'same-bot-channel', description: 'Retoma a faixa pausada na mesma posição.',
    localizations: { 'pt-BR': { name: 'retomar' }, en: { name: 'resume', description: 'Resume the paused track at the same position.' } } },
  { name: 'skip', voiceRequirement: 'same-bot-channel', description: 'Pula a faixa atual e avança para a próxima.',
    localizations: { 'pt-BR': { name: 'pular' }, en: { name: 'skip', description: 'Skip the current track and advance to the next one.' } } },
  { name: 'stop', voiceRequirement: 'same-bot-channel', description: 'Para a reprodução e limpa a fila.',
    localizations: { 'pt-BR': { name: 'parar' }, en: { name: 'stop', description: 'Stop playback and clear the queue.' } } },
  { name: 'leave', voiceRequirement: 'same-bot-channel', description: 'Para, limpa a fila e desconecta da sala de voz.',
    localizations: { 'pt-BR': { name: 'sair' }, en: { name: 'leave', description: 'Stop, clear the queue and disconnect from voice.' } } },
  { name: 'remove', voiceRequirement: 'same-bot-channel', description: 'Remove uma posição da fila de próximas faixas.',
    localizations: { 'pt-BR': { name: 'remover' }, en: {
      name: 'remove',
      description: 'Remove a position from the upcoming queue.',
      options: { position: { label: 'Position', description: 'Position in the upcoming queue' } },
    } },
    options: [{ name: 'position', description: 'Posição na fila de próximas faixas', type: 'integer', required: true, min: 1, max: 50 }] },
  { name: 'clear', voiceRequirement: 'same-bot-channel', description: 'Limpa apenas as próximas faixas; não interrompe a atual.',
    localizations: { 'pt-BR': { name: 'limpar' }, en: { name: 'clear', description: 'Clear only upcoming tracks without interrupting the current track.' } } },
];

async function actor(ctx: CommandContext): Promise<MusicActor> {
  const voiceChannelId = await ctx.getVoiceChannel();
  return {
    botId: ctx.botId, serverId: ctx.serverId, voiceChannelId, textChannelId: ctx.channelId,
    locale: ctx.locale, invocationId: ctx.invocationId,
    invokerId: ctx.invokerId, invokerSessionId: ctx.invokerSessionId,
    invokerNickname: ctx.invokerNickname,
  };
}
function time(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
function label(track: Track): string {
  return `${track.title} (${time(track.duration)})`;
}

function replyLines(ctx: CommandContext, ptBR: string, en: string): void {
  const lines = { 'pt-BR': ptBR.split('\n'), en: en.split('\n') };
  if (lines['pt-BR'].length !== lines.en.length) throw new Error('Localized music replies must keep matching lines');
  let ptPart = '', enPart = '';
  for (let i = 0; i < lines.en.length; i++) {
    const ptLine = lines['pt-BR'][i], enLine = lines.en[i];
    if (Math.max(ptLine.length, enLine.length) > LIMITS.MAX_MESSAGE_LENGTH) throw new MusicError('unavailable');
    const ptNext = ptPart ? `${ptPart}\n${ptLine}` : ptLine;
    const enNext = enPart ? `${enPart}\n${enLine}` : enLine;
    if (Math.max(ptNext.length, enNext.length) > LIMITS.MAX_MESSAGE_LENGTH) {
      ctx.reply(message(ctx.locale, ptPart, enPart));
      ptPart = ptLine;
      enPart = enLine;
    } else { ptPart = ptNext; enPart = enNext; }
  }
  if (ptPart.trim()) ctx.reply(message(ctx.locale, ptPart, enPart));
}

interface MusicInteractions<T extends Track> {
  tracks(ctx: CommandAutocompleteContext): Promise<T[]>;
  preview(ctx: CommandAudioPreviewContext): Promise<CommandAudioPreviewResponse>;
  resourceId(track: T): string;
  local: boolean;
}

function createMusicCommandSet<TQueue extends Track, TLookup extends Track>(
  queues: MusicQueues<TQueue>,
  interactions: MusicInteractions<TLookup>,
): CommandDefinition[] {
  const autocomplete = async (ctx: CommandAutocompleteContext) => {
    if (ctx.signal.aborted) return [];
    try {
      if (ctx.optionName !== 'busca') throw new MusicError('input');
      const tracks = await interactions.tracks(ctx);
      if (ctx.signal.aborted) return [];
      return tracks.map((track) => ({
        value: track.url,
        label: label(track).slice(0, 100),
        description: translate(ctx.locale, 'YouTube · Prévia privada de 10 segundos', 'YouTube · Private 10-second preview'),
        audio: {
          resourceId: interactions.resourceId(track), fileName: `youtube-${track.id}-preview.ogg`,
          durationMs: MUSIC_PREVIEW_DURATION_MS,
        },
      }));
    } catch (error: unknown) {
      throw new Error(musicError(error, ctx.locale), { cause: error });
    }
  };
  const audioPreview = async (ctx: CommandAudioPreviewContext): Promise<CommandAudioPreviewResponse> => {
    try {
      aborted(ctx.signal);
      if (ctx.optionName !== 'busca') throw new MusicError('input');
      const result = await interactions.preview(ctx);
      aborted(ctx.signal);
      return result;
    } catch (error: unknown) {
      throw new Error(musicError(error, ctx.locale), { cause: error });
    }
  };
  return musicDefinitions.map((definition) => ({
    ...definition,
    ...(definition.name === 'play' ? {
      autocomplete, audioPreview,
      ...(interactions.local ? { localCapabilities: ['youtube-audio'] as const } : {}),
    } : {}),
    handler: async (ctx) => {
      if (ctx.signal.aborted) return;
      try {
        const caller = await actor(ctx);
        if (ctx.signal.aborted) return;
        queues.assertControl(caller);
        if (definition.name === 'queue' || definition.name === 'nowplaying') {
          const state = queues.snapshot(ctx.serverId);
          const render = (locale: BotLocale): string => {
            const current = state.current
              ? `${state.paused ? '⏸' : state.started ? '▶' : '⏳'} ${label(state.current)} — ${time(state.elapsedMs / 1000)}`
              : translate(locale, 'Nenhuma faixa está tocando.', 'Nothing is playing.');
            const upcoming = definition.name === 'queue'
              ? `\n\n${translate(locale, 'Próximas faixas', 'Up next')}:\n${state.upcoming.map((item, index) =>
                `${index + 1}. ${item.pending ? translate(locale, 'Carregando…', 'Loading…')
                  : item.title}${item.waitingForRequester
                  ? translate(locale, ' — aguardando solicitante', ' — waiting for requester') : ''}`).join('\n') ||
                translate(locale, 'Fila vazia.', 'Queue empty.')}` : '';
            return `${current}${upcoming}`;
          };
          replyLines(ctx, render('pt-BR'), render('en'));
          return;
        }
        if (definition.name === 'play') {
          const input = musicInput(ctx.args.busca);
          if (input.kind !== 'url') throw new MusicError('selection');
          ctx.reply(message(ctx.locale,
            '⏳ Recebi a música. Estou validando os dados para adicioná-la à fila…',
            '⏳ Track received. I am checking its details before adding it to the queue…'));
          await queues.enqueue(caller, input.value, ctx.signal, () => actor(ctx));
        } else {
          const control = definition.name;
          if (control !== 'pause' && control !== 'resume' && control !== 'skip' && control !== 'stop' &&
              control !== 'leave' && control !== 'remove' && control !== 'clear') return;
          const position = typeof ctx.args.position === 'number' ? ctx.args.position : undefined;
          if (control === 'skip') ctx.reply(message(ctx.locale,
            '⏳ Recebi o pedido para pular a faixa. Encerrando o áudio atual…',
            '⏳ Skip received. Stopping the current audio…'));
          await queues.control(caller, control, position);
          if (!ctx.signal.aborted) {
            const done = {
              pause: ['Reprodução pausada.', 'Playback paused.'], resume: ['Reprodução retomada.', 'Playback resumed.'],
              skip: ['Faixa pulada.', 'Track skipped.'], stop: ['Reprodução parada e fila limpa.', 'Playback stopped and queue cleared.'],
              leave: ['Reprodução parada, fila limpa e sala desconectada.', 'Playback stopped, queue cleared and voice disconnected.'],
              remove: ['Faixa removida da fila.', 'Track removed from the queue.'], clear: ['Próximas faixas removidas; faixa atual preservada.', 'Upcoming tracks cleared; current track preserved.'],
            };
            ctx.publish(message(ctx.locale, done[control][0], done[control][1]));
          }
        }
      } catch (error: unknown) {
        if (!ctx.signal.aborted) {
          if (!(error instanceof MusicError) || error.detail ||
              ['tools', 'runtime', 'unavailable', 'timeout', 'voice', 'voice_runtime', 'settings', 'bot_runtime',
                'local_permission', 'local_client_unavailable', 'local_transport'].includes(error.code)) {
            console.error(`[music] ${cliText('Comando falhou', 'Command failed')} (command=${definition.name}, stage=execute): ${errorDiagnostic(error)}`);
          }
          ctx.reply(message(ctx.locale, `⚠️ ${musicError(error, 'pt-BR')}`, `⚠️ ${musicError(error, 'en')}`));
        }
      }
    },
  }));
}

export function createMusicCommands(queues: MusicQueues, source: MusicSource): CommandDefinition[] {
  return createMusicCommandSet(queues, {
    local: false,
    resourceId: (track) => track.url,
    tracks: async (ctx) => {
      const input = musicInput(ctx.query);
      await source.check(ctx.signal);
      aborted(ctx.signal);
      return input.kind === 'url'
        ? [await source.resolve(input.value, ctx.signal)]
        : source.search(input.value, ctx.signal);
    },
    preview: async (ctx): Promise<CommandAudioPreviewData> => ({
      bytes: await source.preview(videoUrl(ctx.resourceId), ctx.signal),
      mimeType: 'audio/ogg',
    }),
  });
}

export function createLocalMusicCommands(
  queues: MusicQueues<LocalMediaTrack>,
  provider: LocalExecutionProvider,
): CommandDefinition[] {
  return createMusicCommandSet(queues, {
    local: true,
    resourceId: (track) => track.id,
    tracks: (ctx) => localMusicAutocomplete(provider, ctx),
    preview: (ctx) => localMusicPreview(provider, ctx),
  });
}

export function registerMusicCommands(bot: BotClient): () => Promise<void> {
  const source = new LocalMusicSourceFactory(bot);
  const seconds = defaultMusicIdleSeconds();
  bot.settings(musicSettingsDefinition(seconds));
  const notice = async (event: MusicNotice, signal?: AbortSignal): Promise<void> => {
    if (signal) aborted(signal);
    const sending = bot.sendMessage(event.actor.serverId, event.actor.textChannelId,
      message(event.actor.locale, musicNoticeText(event, 'pt-BR'), musicNoticeText(event, 'en')));
    if (signal) await bounded(sending, signal, 5000);
    else await sending;
  };
  const queues = new MusicQueues(source, bot, notice, seconds * 1000,
    (serverId) => musicIdleMilliseconds(bot.getServerSettings(serverId)));
  const detachSettings = bot.onSettingsChanged((_snapshot, { serverId }) => queues.refreshGracePeriod(serverId));
  for (const command of createLocalMusicCommands(queues, bot)) bot.command(command);
  const interrupted = new Map<string, { actor: MusicActor; sending: boolean }>();
  const disconnectQueue = (serverId: string, error?: unknown): void => {
    void queues.disconnect(serverId, error).catch((failure: unknown) =>
      console.error(`[music] ${cliText('Falha ao encerrar voz.', 'Voice teardown failed.')} ${errorDiagnostic(failure)}`));
  };
  const rememberInterruption = (serverId: string): void => {
    const actor = queues.notificationActor(serverId);
    if (actor) {
      if (interrupted.has(serverId) || interrupted.size < 128) interrupted.set(serverId, { actor, sending: false });
      else console.error(`[music] ${cliText('Limite de avisos de desconexão atingido.', 'Disconnection notice limit reached.')}`);
    }
  };
  const disconnected = ({ serverId }: { serverId: string }): void => {
    rememberInterruption(serverId);
    disconnectQueue(serverId);
  };
  const connected = ({ serverId }: { serverId: string }): void => {
    const interruption = interrupted.get(serverId);
    if (!interruption || interruption.sending) return;
    const playback = queues.snapshot(serverId);
    if (playback.current && playback.started) {
      interrupted.delete(serverId);
      return;
    }
    const { actor } = interruption;
    interruption.sending = true;
    void bounded(bot.sendMessage(serverId, actor.textChannelId, message(actor.locale,
      '⚠️ O bot perdeu a conexão com o servidor e a reprodução foi interrompida. A conexão voltou, mas a fila não foi retomada.',
      '⚠️ The bot lost its server connection and playback was interrupted. The connection is back, but the queue was not resumed.')),
    new AbortController().signal, 10_000)
      .then(() => { if (interrupted.get(serverId) === interruption) interrupted.delete(serverId); })
      .catch((error: unknown) => console.error(`[music] ${cliText('Não foi possível entregar o aviso de desconexão.',
        'Could not deliver the disconnection notice.')} ${errorDiagnostic(error)}`))
      .finally(() => { interruption.sending = false; });
  };
  const voiceDisconnected = ({ serverId, reason, channelId }: { serverId: string; reason: string; channelId?: string }): void => {
    // The SDK clears the disconnected voice first; an existing one belongs to a newer generation.
    if (bot.getVoiceConnection(serverId) || (channelId && queues.snapshot(serverId).channelId !== channelId)) return;
    // The pending join rejects with its own cause and each enqueue releases its source.
    // Cancelling the queue here would replace that admission failure with "cancelled".
    if (queues.hasPendingVoiceAdmission(serverId) &&
        (reason === 'join_failed' || reason === 'transport_failed')) return;
    if (['disconnected', 'socket_lost', 'server_shutdown'].includes(reason)) {
      rememberInterruption(serverId);
      disconnectQueue(serverId);
    } else {
      disconnectQueue(serverId, ['left', 'join_failed'].includes(reason) ? undefined : new MusicError('voice_runtime'));
    }
  };
  const runtimeError = (error: Error, info?: { serverId: string }): void => {
    if (info?.serverId) void queues.reportRuntimeError(info.serverId, error);
  };
  const participants = (event: { serverId: string; channelId: string; humanParticipantCount: number }): void => {
    queues.participantsChanged(event.serverId, event.channelId, event.humanParticipantCount);
  };
  let disposal: Promise<void> | undefined;
  const onClosed = (): void => {
    void dispose().catch((error: unknown) =>
      console.error(`[music] ${cliText('Falha ao encerrar.', 'Shutdown failed.')} ${errorDiagnostic(error)}`));
  };
  const dispose = (): Promise<void> => {
    bot.off('disconnected', disconnected);
    bot.off('connected', connected);
    bot.off('voiceDisconnected', voiceDisconnected);
    bot.off('error', runtimeError);
    bot.off('voiceParticipantsChanged', participants);
    bot.off('closed', onClosed);
    detachSettings();
    interrupted.clear();
    return disposal ??= queues.dispose();
  };
  bot.on('disconnected', disconnected);
  bot.on('connected', connected);
  bot.on('voiceDisconnected', voiceDisconnected);
  bot.on('error', runtimeError);
  bot.on('voiceParticipantsChanged', participants);
  bot.once('closed', onClosed);
  return dispose;
}

export function musicNoticeText(event: MusicNotice, locale = event.actor.locale): string {
  switch (event.type) {
    case 'queued':
      return translate(locale, `➕ Adicionado à fila por ${event.actor.invokerNickname}: ${label(event.track)}.`,
        `➕ Added to queue by ${event.actor.invokerNickname}: ${label(event.track)}.`);
    case 'loading':
      return translate(locale,
        `⏳ Preparando para tocar: ${label(event.track)}. Aguarde o início do áudio…`,
        `⏳ Preparing to play: ${label(event.track)}. Waiting for audio to start…`);
    case 'started':
      return translate(locale, `▶ Tocando: ${label(event.track)}`, `▶ Now playing: ${label(event.track)}`);
    case 'ended':
      return translate(locale,
        '✅ Fim da fila. Vou sair da voz após o tempo de inatividade configurado se nenhuma música for adicionada.',
        '✅ Queue finished. I will leave voice after the configured idle timeout unless another track is added.');
    case 'runtime-error':
      return translate(locale,
        '⚠️ Não foi possível sair da sala de voz automaticamente. Use /leave ou reconecte o bot.',
        '⚠️ Could not leave the voice room automatically. Use /leave or reconnect the bot.');
    case 'recovery-failed':
      return translate(locale,
        `⚠️ Falha ao retomar ${label(event.track)} após ${event.attempts} tentativas consecutivas sem avanço do áudio. A faixa foi removida da fila.`,
        `⚠️ Could not resume ${label(event.track)} after ${event.attempts} consecutive attempts without audio progress. The track was removed from the queue.`);
    case 'requester-left':
      return translate(locale,
        `⏭️ ${event.actor.invokerNickname} saiu da voz. ${label(event.track)} foi interrompida e pulada; as próximas faixas continuam na fila.`,
        `⏭️ ${event.actor.invokerNickname} left voice. ${label(event.track)} was stopped and skipped; upcoming tracks remain queued.`);
    case 'requester-disconnected':
      return translate(locale,
        `⏭️ O cliente de ${event.actor.invokerNickname} foi desconectado. ${label(event.track)} foi interrompida e pulada; as próximas faixas continuam na fila.`,
        `⏭️ ${event.actor.invokerNickname}'s client disconnected. ${label(event.track)} was stopped and skipped; upcoming tracks remain queued.`);
    case 'failed': {
      const reason = event.error instanceof IncompleteAudioError
        ? translate(locale,
          `A fonte entregou áudio incompleto (${time(event.error.emittedDurationMs / 1000)} de aproximadamente ${time(event.error.expectedDurationMs / 1000)}).`,
          `The source delivered incomplete audio (${time(event.error.emittedDurationMs / 1000)} of approximately ${time(event.error.expectedDurationMs / 1000)}).`)
        : musicError(event.error, locale);
      return `⚠️ ${event.track ? `${label(event.track)}: ` : ''}${reason} ${translate(locale,
        'A reprodução parou. Verifique a conexão de voz ou adicione outra faixa.',
        'Playback stopped. Check the voice connection or add another track.')}`;
    }
  }
}
