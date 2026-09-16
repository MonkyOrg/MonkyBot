import {
  LocalExecutionError,
  LocalExecutionRpcError,
  ProtocolErrorCode,
  type CommandAudioPreviewContext,
  type CommandAutocompleteContext,
  type LocalExecutionClient,
  type LocalExecutionProvider,
  type LocalMediaTrack,
  type LocalOpusStream,
  type LocalSourceContext,
  type LocalTaskCancellationCause,
  type LocalTaskFailureReason,
  type LocalWirePreviewResult,
} from '@monky/bot-sdk';
import { MusicError, SourceRecoveryError, aborted, type MusicErrorCode } from './errors';
import { errorDiagnostic } from './process';
import { cliText } from '../cli/i18n';
import type {
  MusicActor,
  QueueAudioStream,
  QueueMusicSource,
  QueueMusicSourceFactory,
} from './queue';
import { musicInput, videoUrl } from './source';

const failureCodes: Readonly<Record<LocalTaskFailureReason, MusicErrorCode>> = {
  invalid_request: 'input',
  permission_denied: 'local_permission',
  executor_unavailable: 'local_client_unavailable',
  unsupported_platform: 'runtime',
  tools_missing: 'tools',
  tool_install_failed: 'tools',
  integrity_failed: 'runtime',
  storage_failed: 'runtime',
  provider_unavailable: 'unavailable',
  transport_failed: 'local_transport',
  worker_failed: 'runtime',
  busy: 'busy',
  timeout: 'timeout',
};

const cancellationCodes: Readonly<Record<LocalTaskCancellationCause, MusicErrorCode>> = {
  requested: 'cancelled',
  requester_left_voice: 'requester_left_voice',
  requester_disconnected: 'requester_disconnected',
  bot_left_voice: 'voice_runtime',
  bot_disconnected: 'bot_runtime',
  permission_revoked: 'local_permission',
  source_released: 'cancelled',
  voice_mode_changed: 'voice_runtime',
  expired: 'timeout',
  server_shutdown: 'bot_runtime',
};

export function localMusicFailure(error: unknown): unknown {
  if (error instanceof LocalExecutionRpcError) {
    if (error.cancellationCause) return new MusicError(cancellationCodes[error.cancellationCause]);
    if (error.reason) return new MusicError(failureCodes[error.reason]);
    switch (error.code) {
      case ProtocolErrorCode.BAD_REQUEST: return new MusicError('input');
      case ProtocolErrorCode.PERMISSION_DENIED: return new MusicError('local_permission');
      case ProtocolErrorCode.BOT_COMMAND_BUSY: return new MusicError('busy');
      case ProtocolErrorCode.UNAUTHORIZED:
      case ProtocolErrorCode.BOT_INTERACTION_EXPIRED: return new MusicError('local_client_unavailable');
      default: return error;
    }
  }
  if (!(error instanceof LocalExecutionError)) return error;
  if (error.event.state === 'cancelled') {
    return new MusicError(cancellationCodes[error.event.cause]);
  }
  const source = error.event.sourceFailure;
  if (source?.code === 'recovery_failed') return new SourceRecoveryError(source.attempts);
  if (source) return new MusicError(source.code);
  return new MusicError(failureCodes[error.event.reason]);
}

function checkedTrack(track: LocalMediaTrack, expectedUrl?: string): LocalMediaTrack {
  const canonical = videoUrl(track.url);
  if (canonical !== track.url || expectedUrl !== undefined && canonical !== expectedUrl ||
      track.id !== canonical.slice(-11) || track.title.length < 1 || track.title.length > 512 ||
      !Number.isFinite(track.duration) || track.duration <= 0 || track.duration > 3600) {
    throw new MusicError('unavailable');
  }
  return Object.freeze({ ...track });
}

function checkedSource(source: LocalSourceContext, actor: MusicActor, url: string): LocalSourceContext {
  if (source.sourceContextId.length < 1 || source.sourceContextId.length > 128 ||
      !/^[a-f0-9]{64,128}$/i.test(source.botPublicKey) ||
      source.botId !== actor.botId || source.invokerId !== actor.invokerId ||
      source.invokerSessionId !== actor.invokerSessionId ||
      source.originChannelId !== actor.textChannelId || source.capability !== 'youtube-audio' ||
      source.provider !== 'youtube-local' || source.url !== url ||
      !Number.isSafeInteger(source.expiresAt) || source.expiresAt <= 0) {
    throw new MusicError('unavailable');
  }
  return Object.freeze({ ...source });
}

export function localVideoUrl(resourceId: string): string {
  if (!/^[A-Za-z0-9_-]{11}$/.test(resourceId)) throw new MusicError('unsupported');
  return videoUrl(`https://www.youtube.com/watch?v=${resourceId}`);
}

export async function localMusicAutocomplete(
  provider: LocalExecutionProvider,
  ctx: CommandAutocompleteContext,
): Promise<LocalMediaTrack[]> {
  try {
    aborted(ctx.signal);
    const input = musicInput(ctx.query);
    const executor = provider.localExecution(ctx.serverId)
      .executor({ kind: 'autocomplete', requestId: ctx.requestId });
    const tracks = input.kind === 'url'
      ? [(await executor.execute(
        { operation: 'youtube.resolve', url: input.value },
        { signal: ctx.signal },
      )).track]
      : (await executor.execute(
        { operation: 'youtube.search', query: input.value },
        { signal: ctx.signal },
      )).tracks;
    aborted(ctx.signal);
    return tracks.map((track) => checkedTrack(track));
  } catch (error: unknown) {
    throw localMusicFailure(error);
  }
}

export async function localMusicPreview(
  provider: LocalExecutionProvider,
  ctx: CommandAudioPreviewContext,
): Promise<LocalWirePreviewResult> {
  try {
    aborted(ctx.signal);
    const result = await provider.localExecution(ctx.serverId)
      .executor({ kind: 'audio-preview', requestId: ctx.requestId })
      .execute(
        { operation: 'youtube.preview', url: localVideoUrl(ctx.resourceId) },
        { signal: ctx.signal },
      );
    aborted(ctx.signal);
    return result;
  } catch (error: unknown) {
    throw localMusicFailure(error);
  }
}

class LocalQueueAudioStream implements QueueAudioStream {
  readonly frames: AsyncIterable<Uint8Array>;
  readonly signal: AbortSignal;
  readonly closed: Promise<void>;
  readonly recoveryMode = 'persistent';
  private readonly controller = new AbortController();
  private readonly cancel: () => void;

  constructor(private readonly stream: LocalOpusStream) {
    this.signal = this.controller.signal;
    this.cancel = () => this.controller.abort(localMusicFailure(this.stream.signal.reason));
    this.stream.signal.addEventListener('abort', this.cancel, { once: true });
    if (this.stream.signal.aborted) this.cancel();
    this.closed = this.stream.closed.catch((error: unknown) => { throw localMusicFailure(error); });
    void this.closed.catch(() => undefined);
    const frames = this.stream.frames;
    this.frames = {
      [Symbol.asyncIterator]: async function* () {
        try {
          yield* frames;
        } catch (error: unknown) {
          throw localMusicFailure(error);
        }
      },
    };
  }

  markFrameAdvanced(): void {
    try {
      this.stream.markFrameAdvanced();
    } catch (error: unknown) {
      throw localMusicFailure(error);
    }
  }

  async setPaused(paused: boolean): Promise<void> {
    try {
      await this.stream.setPaused(paused);
    } catch (error: unknown) {
      throw localMusicFailure(error);
    }
  }

  async close(): Promise<void> {
    try {
      await this.stream.close();
    } catch (error: unknown) {
      throw localMusicFailure(error);
    } finally {
      this.stream.signal.removeEventListener('abort', this.cancel);
    }
  }
}

export class LocalMusicSource implements QueueMusicSource<LocalMediaTrack> {
  readonly resolvesOnOpen = true;
  private releasePromise?: Promise<void>;

  constructor(
    private readonly client: LocalExecutionClient,
    readonly reference: LocalSourceContext,
    private readonly voiceChannelId: string,
  ) {}

  async check(signal: AbortSignal): Promise<void> {
    aborted(signal);
  }

  async checkAvailability(signal: AbortSignal): Promise<void> {
    aborted(signal);
    try {
      await this.client.checkSourceAvailability(this.reference.sourceContextId, this.voiceChannelId, { signal });
      aborted(signal);
    } catch (error: unknown) {
      throw localMusicFailure(error);
    }
  }

  async resolve(url: string, signal: AbortSignal): Promise<LocalMediaTrack> {
    aborted(signal);
    if (videoUrl(url) !== this.reference.url) throw new MusicError('unsupported');
    try {
      const result = await this.client.executor({
        kind: 'source',
        sourceContextId: this.reference.sourceContextId,
      }).execute(
        { operation: 'youtube.resolve', url: this.reference.url },
        { signal },
      );
      aborted(signal);
      return checkedTrack(result.track, this.reference.url);
    } catch (error: unknown) {
      throw localMusicFailure(error);
    }
  }

  async open(
    track: LocalMediaTrack,
    signal: AbortSignal,
  ): Promise<QueueAudioStream> {
    aborted(signal);
    checkedTrack(track, this.reference.url);
    try {
      const stream = await this.client.executor({
        kind: 'source',
        sourceContextId: this.reference.sourceContextId,
      }).stream(
        { operation: 'youtube.stream', url: this.reference.url },
        { voiceChannelId: this.voiceChannelId, signal },
      );
      try {
        aborted(signal);
        checkedTrack(stream.track, this.reference.url);
        return new LocalQueueAudioStream(stream);
      } catch (error: unknown) {
        try {
          await stream.close();
        } catch (closeError: unknown) {
          console.error(`[music] ${cliText(
            'Não foi possível encerrar um fluxo local não aceito.',
            'Could not close an unaccepted local stream.',
          )} ${errorDiagnostic(closeError)}`);
        }
        throw error;
      }
    } catch (error: unknown) {
      throw localMusicFailure(error);
    }
  }

  release(): Promise<void> {
    return this.releasePromise ??= this.client.releaseSource(this.reference.sourceContextId);
  }
}

export class LocalMusicSourceFactory implements QueueMusicSourceFactory<LocalMediaTrack> {
  constructor(private readonly provider: LocalExecutionProvider) {}

  async bind(actor: MusicActor, url: string, signal: AbortSignal): Promise<LocalMusicSource> {
    aborted(signal);
    if (!actor.voiceChannelId) throw new MusicError('not_in_voice');
    const canonical = videoUrl(url);
    const client = this.provider.localExecution(actor.serverId);
    try {
      const retained = await client.retainSource(actor.invocationId, canonical, { signal });
      try {
        aborted(signal);
        return new LocalMusicSource(client, checkedSource(retained, actor, canonical), actor.voiceChannelId);
      } catch (error: unknown) {
        try {
          await client.releaseSource(retained.sourceContextId);
        } catch (releaseError: unknown) {
          console.error(`[music] ${cliText(
            'Não foi possível liberar um contexto local inválido.',
            'Could not release an invalid local source context.',
          )} ${errorDiagnostic(releaseError)}`);
        }
        throw error;
      }
    } catch (error: unknown) {
      throw localMusicFailure(error);
    }
  }
}
