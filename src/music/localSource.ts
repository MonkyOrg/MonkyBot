import {
  LocalExecutionError,
  LocalExecutionRpcError,
  ProtocolErrorCode,
  type CommandAudioPreviewContext,
  type CommandAutocompleteContext,
  type LocalExecutionClient,
  type LocalExecutionProvider,
  type LocalExecutor,
  type LocalMediaTrack,
  type LocalOpusStream,
  type LocalSourceContext,
  type LocalTaskCancellationCause,
  type LocalTaskFailureReason,
  type LocalWirePreviewResult,
} from '@monky/bot-sdk';
import { MusicError, SourceRecoveryError, aborted, type MusicErrorCode } from './errors';
import { errorDiagnostic } from './process';
import { cliText } from '../i18n';
import type {
  MusicActor,
  QueueAudioStream,
  QueueMusicSource,
  QueueMusicSourceFactory,
} from './queue';
import { musicSuggestions, type MusicSuggestion, type PlaylistRead } from './playlist';
import { videoUrl } from './source';

/**
 * Source RPCs held at once by this bot. The server admits 16 pending local requests per bot,
 * including searches and streams, and the SDK at most 100 pending source requests: clearing a
 * 500-track queue must not turn into hundreds of simultaneous releases. Releases get their own
 * lane so a large backlog never delays retaining new tracks or availability checks.
 */
const SOURCE_RPC_CONCURRENCY = 4;
const SOURCE_RELEASE_CONCURRENCY = 2;

type RpcLimiter = <R>(task: () => Promise<R>) => Promise<R>;

function rpcLimiter(concurrency: number): RpcLimiter {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (task) => {
    if (active < concurrency) active++;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await task();
    } finally {
      // Hand the slot straight to the next waiter, or free it.
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

const unlimited: RpcLimiter = (task) => task();

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
    // The SDK refuses before sending when the server lacks the operation; the server
    // answers executor_unavailable when the requester's client lacks it.
    if (error.code === ProtocolErrorCode.FEATURE_REQUIRES_UPDATE) {
      return new MusicError(error.reason === 'executor_unavailable' ? 'client_outdated' : 'server_outdated');
    }
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

function checkedPlaylist(
  result: { title: string | null; total: number | null; tracks: LocalMediaTrack[]; skipped: number },
  limit: number,
): PlaylistRead<LocalMediaTrack> {
  if (!Array.isArray(result.tracks) || !Number.isSafeInteger(result.skipped) || result.skipped < 0 ||
      result.tracks.length + result.skipped > limit ||
      result.total !== null && (!Number.isSafeInteger(result.total) || result.total < 0) ||
      result.title !== null && typeof result.title !== 'string') {
    throw new MusicError('unavailable');
  }
  const title = result.title?.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 512);
  return Object.freeze({
    title: title || null, total: result.total, skipped: result.skipped,
    tracks: result.tracks.map((track) => checkedTrack(track)),
  });
}

export async function localMusicAutocomplete(
  provider: LocalExecutionProvider,
  ctx: CommandAutocompleteContext,
): Promise<MusicSuggestion<LocalMediaTrack>[]> {
  try {
    aborted(ctx.signal);
    let client: LocalExecutionClient | undefined;
    let executor: LocalExecutor | undefined;
    const local = (): LocalExecutor => {
      client ??= provider.localExecution(ctx.serverId);
      return executor ??= client.executor({ kind: 'autocomplete', requestId: ctx.requestId });
    };
    const suggestions = await musicSuggestions(ctx.query, ctx.signal, {
      search: async (query) => (await local().execute(
        { operation: 'youtube.search', query },
        { signal: ctx.signal },
      )).tracks.map((track) => checkedTrack(track)),
      resolve: async (url) => checkedTrack((await local().execute(
        { operation: 'youtube.resolve', url },
        { signal: ctx.signal },
      )).track),
      playlist: async (url, limit) => checkedPlaylist(await local().execute(
        { operation: 'youtube.playlist', url, limit },
        { signal: ctx.signal },
      ), limit),
      supportsPlaylists: () => (client ??= provider.localExecution(ctx.serverId)).supports('youtube.playlist'),
    });
    aborted(ctx.signal);
    return suggestions;
  } catch (error: unknown) {
    throw localMusicFailure(error);
  }
}

/** Reads a playlist on the requester's client, bound to the running /play invocation. */
export async function localMusicPlaylist(
  provider: LocalExecutionProvider,
  ctx: { serverId: string; invocationId: string; signal: AbortSignal },
  url: string,
  limit: number,
): Promise<PlaylistRead<LocalMediaTrack>> {
  try {
    aborted(ctx.signal);
    const result = await provider.localExecution(ctx.serverId)
      .executor({ kind: 'invocation', invocationId: ctx.invocationId })
      .execute({ operation: 'youtube.playlist', url, limit }, { signal: ctx.signal });
    aborted(ctx.signal);
    return checkedPlaylist(result, limit);
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

class LocalQueueAudioStream implements QueueAudioStream<LocalMediaTrack> {
  readonly frames: AsyncIterable<Uint8Array>;
  readonly signal: AbortSignal;
  readonly closed: Promise<void>;
  readonly recoveryMode = 'persistent';
  private readonly controller = new AbortController();
  private readonly cancel: () => void;

  constructor(private readonly stream: LocalOpusStream, readonly track: LocalMediaTrack) {
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
    private readonly rpc: RpcLimiter = unlimited,
    private readonly releases: RpcLimiter = rpc,
  ) {}

  /** The server discards a retained source after its fixed lifetime (24 hours); it cannot be renewed. */
  private assertCurrent(): void {
    if (Date.now() >= this.reference.expiresAt) throw new MusicError('expired');
  }

  async check(signal: AbortSignal): Promise<void> {
    aborted(signal);
  }

  async checkAvailability(signal: AbortSignal): Promise<void> {
    aborted(signal);
    this.assertCurrent();
    try {
      await this.rpc(() => this.client.checkSourceAvailability(
        this.reference.sourceContextId, this.voiceChannelId, { signal },
      ));
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
  ): Promise<QueueAudioStream<LocalMediaTrack>> {
    aborted(signal);
    checkedTrack(track, this.reference.url);
    this.assertCurrent();
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
        // Flat playlist metadata can differ from the stream's; only the video identity must match.
        return new LocalQueueAudioStream(stream, checkedTrack(stream.track, this.reference.url));
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
    // An expired source is already gone from the server; releasing it would only fail.
    return this.releasePromise ??= Date.now() >= this.reference.expiresAt
      ? Promise.resolve()
      : this.releases(() => this.client.releaseSource(this.reference.sourceContextId));
  }
}

export class LocalMusicSourceFactory implements QueueMusicSourceFactory<LocalMediaTrack> {
  private readonly rpc = rpcLimiter(SOURCE_RPC_CONCURRENCY);
  private readonly releases = rpcLimiter(SOURCE_RELEASE_CONCURRENCY);

  constructor(private readonly provider: LocalExecutionProvider) {}

  async bind(actor: MusicActor, url: string, signal: AbortSignal): Promise<LocalMusicSource> {
    aborted(signal);
    if (!actor.voiceChannelId) throw new MusicError('not_in_voice');
    const canonical = videoUrl(url);
    const client = this.provider.localExecution(actor.serverId);
    try {
      const retained = await this.rpc(() => {
        aborted(signal);
        return client.retainSource(actor.invocationId, canonical, { signal });
      });
      try {
        aborted(signal);
        return new LocalMusicSource(
          client, checkedSource(retained, actor, canonical), actor.voiceChannelId, this.rpc, this.releases,
        );
      } catch (error: unknown) {
        try {
          await this.releases(() => client.releaseSource(retained.sourceContextId));
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
