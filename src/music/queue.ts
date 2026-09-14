import { performance } from 'node:perf_hooks';
import { MusicError, SourceRecoveryError, aborted } from './errors';
import { bounded, cancellable, errorDiagnostic, safeDiagnostic } from './process';
import type { AudioStream, MusicSource, ResolvedTrack, Track } from './source';
import { cliText } from '../cli/i18n';

export interface MusicVoice {
  readonly channelId: string;
  readonly humanParticipantCount: number;
  writeOpus(frame: Uint8Array): Promise<void>;
  stopSpeaking?(): void;
  close(): Promise<void>;
}
export interface VoiceAdapter {
  joinVoice(serverId: string, channelId: string, options?: { invocationId: string }): Promise<MusicVoice>;
  getVoiceConnection(serverId: string): MusicVoice | undefined;
  leaveVoice(serverId: string): Promise<void>;
}
export interface MusicActor {
  serverId: string;
  voiceChannelId: string | null;
  textChannelId: string;
  locale: 'pt-BR' | 'en';
  invocationId: string;
}
interface Slot {
  token: AbortController;
  actor: MusicActor;
  url: string;
  track?: ResolvedTrack;
}
interface Playback {
  slot: Slot;
  token: AbortController;
  paused: boolean;
  elapsedMs: number;
  started: boolean;
  wake?: () => void;
  stream?: AudioStream;
  done?: Promise<void>;
}
interface Session {
  serverId: string;
  channelId: string;
  queue: Slot[];
  active?: Playback;
  tail: Promise<void>;
  idle?: ReturnType<typeof setTimeout>;
  empty?: ReturnType<typeof setTimeout>;
  idleSince?: number;
  emptySince?: number;
  lastActor: MusicActor;
  endedNoticePending: boolean;
  pendingFailure?: Extract<MusicNotice, { type: 'failed' }>;
  lastRuntimeError?: { key: string; at: number };
  closing: boolean;
  closePromise?: Promise<void>;
  joining?: Promise<MusicVoice>;
}
export interface MusicSnapshot {
  channelId: string | null;
  current: Track | null;
  paused: boolean;
  started: boolean;
  elapsedMs: number;
  upcoming: { title: string; pending: boolean }[];
}
export type MusicNotice = { type: 'started'; actor: MusicActor; track: Track } |
  { type: 'failed'; actor: MusicActor; error: unknown; track?: Track } |
  { type: 'recovery-failed'; actor: MusicActor; track: Track; attempts: number } |
  { type: 'ended'; actor: MusicActor } |
  { type: 'runtime-error'; actor: MusicActor; error: unknown };

export class MusicQueues {
  private readonly sessions = new Map<string, Session>();
  private disposed = false;

  constructor(
    private readonly source: MusicSource,
    private readonly voice: VoiceAdapter,
    private readonly notify: (notice: MusicNotice, signal?: AbortSignal) => Promise<void>,
    private readonly graceMs = 60_000,
    private readonly configuredGrace?: (serverId: string) => number,
  ) {
    if (!Number.isInteger(graceMs) || graceMs < 0 || graceMs > 600_000) throw new Error('Invalid music grace period');
  }

  private graceFor(serverId: string): number {
    const value = this.configuredGrace ? this.configuredGrace(serverId) : this.graceMs;
    if (!Number.isInteger(value) || value < 0 || value > 600_000) throw new MusicError('settings');
    return value;
  }

  private serial<T>(session: Session, action: () => T | Promise<T>): Promise<T> {
    const result = session.tail.then(action);
    session.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  private authorize(actor: MusicActor, session?: Session): void {
    if (!actor.voiceChannelId) throw new MusicError('not_in_voice');
    const connection = this.voice.getVoiceConnection(actor.serverId);
    if ((session && actor.voiceChannelId !== session.channelId) ||
        (connection && actor.voiceChannelId !== connection.channelId)) throw new MusicError('room');
  }

  assertControl(actor: MusicActor): void {
    this.authorize(actor, this.sessions.get(actor.serverId));
  }

  async enqueue(actor: MusicActor, url: string, invocationSignal?: AbortSignal, currentActor?: () => MusicActor | Promise<MusicActor>): Promise<Track> {
    if (this.disposed) throw new MusicError('cancelled');
    this.assertControl(actor);
    this.graceFor(actor.serverId);
    let session = this.sessions.get(actor.serverId);
    if (!session) {
      if (this.sessions.size >= 128) throw new MusicError('busy');
      session = {
        serverId: actor.serverId, channelId: actor.voiceChannelId!, queue: [], tail: Promise.resolve(),
        closing: false, lastActor: { ...actor }, endedNoticePending: false,
      };
      this.sessions.set(actor.serverId, session);
    }
    const state = session;
    const slot: Slot = { token: new AbortController(), actor: { ...actor }, url };
    try {
      await this.serial(state, () => {
        this.authorize(actor, state);
        if (state.closing || this.disposed) throw new MusicError('cancelled');
        if (state.queue.length >= 50) throw new MusicError('full');
        state.queue.push(slot);
        clearTimeout(state.idle);
        state.idle = undefined;
        state.idleSince = undefined;
      });
    } catch (error: unknown) {
      if (!state.active && !state.queue.length) this.armIdle(state);
      throw error;
    }
    // Invocation expiry cancels only the pending addition, never accepted playback.
    const cancel = (): void => slot.token.abort();
    invocationSignal?.addEventListener('abort', cancel, { once: true });
    if (invocationSignal?.aborted) cancel();
    try {
      await this.source.check(slot.token.signal);
      aborted(slot.token.signal);
      const track = await this.source.resolve(url, slot.token.signal);
      aborted(slot.token.signal);
      let current = currentActor ? await currentActor() : actor;
      aborted(slot.token.signal);
      this.authorize(current, state);
      const joined = await this.admit(state, slot);
      aborted(slot.token.signal);
      if (joined && currentActor) current = await currentActor();
      await this.serial(state, () => {
        aborted(slot.token.signal);
        if (!state.queue.includes(slot) || state.closing) throw new MusicError('cancelled');
        this.authorize(current, state);
        slot.track = track;
        this.pump(state);
      });
      return track;
    } catch (error: unknown) {
      await this.serial(state, () => {
        const index = state.queue.indexOf(slot);
        if (index !== -1) state.queue.splice(index, 1);
        this.pump(state);
      });
      throw error;
    } finally {
      invocationSignal?.removeEventListener('abort', cancel);
    }
  }

  private async admit(session: Session, slot: Slot): Promise<boolean> {
    let joined = session.joining !== undefined;
    if (!session.joining && !this.voice.getVoiceConnection(session.serverId)) {
      joined = true;
      const joining = this.voice.joinVoice(session.serverId, session.channelId, { invocationId: slot.actor.invocationId });
      session.joining = joining;
      void joining.finally(() => {
        if (session.joining === joining) session.joining = undefined;
        if (!session.active && !session.queue.length) this.armIdle(session);
      }).catch(() => undefined);
    }
    try {
      const connection = session.joining
        ? await session.joining : this.voice.getVoiceConnection(session.serverId);
      if (!connection || connection.channelId !== session.channelId) throw new MusicError('voice');
      return joined;
    } catch (error: unknown) {
      aborted(slot.token.signal);
      throw new MusicError('voice', error instanceof Error ? safeDiagnostic(error.message) : 'Voice admission failed.');
    }
  }

  private pump(session: Session): void {
    if (session.closing || this.disposed || session.active) return;
    const slot = session.queue[0];
    if (!slot) { this.armIdle(session); return; }
    if (!slot.track) return;
    session.queue.shift();
    clearTimeout(session.idle);
    session.idle = undefined;
    session.idleSince = undefined;
    session.lastActor = slot.actor;
    session.endedNoticePending = true;
    session.lastRuntimeError = undefined;
    const active: Playback = { slot, token: new AbortController(), paused: false, elapsedMs: 0, started: false };
    session.active = active;
    active.done = this.play(session, active).finally(() => this.serial(session, () => {
      if (session.active === active) session.active = undefined;
      this.pump(session);
    }));
    void active.done.catch((error: unknown) =>
      console.error(`[music] ${cliText('Falha ao encerrar reprodução.', 'Playback teardown failed.')} ${errorDiagnostic(error)}`));
  }

  private async report(notice: MusicNotice): Promise<void> {
    try { await bounded(this.notify(notice), new AbortController().signal, 10_000); }
    catch (error: unknown) {
      console.error(`[music] ${cliText(`Não foi possível entregar o aviso ${notice.type}`, `Could not deliver ${notice.type} notice`)}: ${errorDiagnostic(error)}`);
    }
  }

  async reportRuntimeError(serverId: string, error: unknown): Promise<void> {
    const session = this.sessions.get(serverId);
    if (!session) return;
    const key = error instanceof MusicError ? error.code
      : error instanceof Error ? safeDiagnostic(`${error.name}: ${error.message}`) : 'unknown';
    const now = performance.now();
    if (session.lastRuntimeError?.key === key && now - session.lastRuntimeError.at < 5000) return;
    session.lastRuntimeError = { key, at: now };
    console.error(`[music] ${cliText('Diagnóstico de execução', 'Runtime diagnostic')}: ${errorDiagnostic(error)}`);
  }

  private hasPendingPlayback(session: Session): boolean {
    return !session.closing && (!!session.active && !session.active.token.signal.aborted ||
      session.queue.length > 0 || session.pendingFailure !== undefined);
  }

  notificationActor(serverId: string): MusicActor | undefined {
    const session = this.sessions.get(serverId);
    if (!session || !this.hasPendingPlayback(session)) return undefined;
    return { ...(session.active?.slot.actor ?? session.pendingFailure?.actor ?? session.lastActor) };
  }

  private async play(session: Session, active: Playback): Promise<void> {
    const signal = active.token.signal;
    const track = active.slot.track!;
    let stage = 'resolve';
    let connection: MusicVoice | undefined;
    try {
      // Refresh expiring signed media URLs only when this item reaches the head.
      const fresh = await this.source.resolve(track.url, signal);
      aborted(signal);
      connection = this.voice.getVoiceConnection(session.serverId);
      aborted(signal);
      if (!connection) throw new MusicError('voice');
      if (connection.channelId !== session.channelId) throw new MusicError('room');
      this.participantsChanged(session.serverId, session.channelId, connection.humanParticipantCount);
      stage = 'open';
      active.stream = await this.source.open(fresh, signal, { mode: 'persistent', progress: 'playback' });
      aborted(signal);
      active.stream.setPaused?.(active.paused);
      const iterator = active.stream.frames[Symbol.asyncIterator]();
      let nextAt = performance.now();
      let started = false;
      for (;;) {
        stage = 'read';
        const frame = active.stream.recoveryMode === 'persistent'
          ? await cancellable(iterator.next(), signal)
          : await bounded(iterator.next(), signal, 30_000);
        if (frame.done) {
          if (!started) throw new MusicError('unavailable');
          break;
        }
        if (!started) nextAt = performance.now();
        while (active.paused) {
          await cancellable(new Promise<void>((resolve) => { active.wake = resolve; }), signal);
          active.wake = undefined;
          nextAt = performance.now();
        }
        aborted(signal);
        const delay = nextAt - performance.now();
        if (delay > 0) await this.sleep(delay, signal);
        // A pause/stop can arrive while waiting for the next 20 ms frame.
        while (active.paused) {
          await cancellable(new Promise<void>((resolve) => { active.wake = resolve; }), signal);
          active.wake = undefined;
          nextAt = performance.now();
        }
        aborted(signal);
        const sentAt = performance.now();
        // Keep a fixed media clock: rebasing on every late Windows timer tick
        // makes 20 ms of audio take ~31 ms. Only a real stall starts a new clock.
        if (sentAt - nextAt > 100) nextAt = sentAt;
        stage = 'write';
        await bounded(connection.writeOpus(frame.value), signal, 5000);
        aborted(signal);
        active.elapsedMs += 20;
        active.stream.markFrameAdvanced?.();
        nextAt += 20;
        if (!started) {
          started = true;
          active.started = true;
          // A replacement is viable only after its first successful audio write.
          session.pendingFailure = undefined;
          void this.report({ type: 'started', actor: active.slot.actor, track });
        }
      }
    } catch (error: unknown) {
      if (!signal.aborted) {
        const detail = errorDiagnostic(error);
        const failure = stage === 'write' && !(error instanceof MusicError)
          ? new MusicError('voice_runtime', safeDiagnostic(detail)) : error;
        const code = failure instanceof MusicError ? failure.code : 'unavailable';
        console.error(`[music] ${cliText('Reprodução falhou', 'Playback failed')} (stage=${stage}, code=${code}, advancedMs=${active.elapsedMs}): ${detail}`);
        if (failure instanceof SourceRecoveryError) {
          session.pendingFailure = undefined;
          session.endedNoticePending = false;
          void this.report({ type: 'recovery-failed', actor: active.slot.actor, track, attempts: failure.attempts });
        } else {
          session.pendingFailure = { type: 'failed', actor: active.slot.actor, error: failure, track };
        }
      }
    } finally {
      active.token.abort();
      active.wake?.();
      this.stopSpeaking(connection);
      await active.stream?.close().catch((error: unknown) =>
        console.error(`[music] ${cliText('Não foi possível fechar o fluxo de áudio.', 'Could not close the audio stream.')} ${errorDiagnostic(error)}`));
    }
  }

  private stopSpeaking(connection: MusicVoice | undefined): void {
    try { connection?.stopSpeaking?.(); }
    catch { console.error(`[music] ${cliText('Não foi possível limpar a atividade de voz.', 'Could not clear voice activity.')}`); }
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const cancel = (): void => { clearTimeout(timer); reject(new MusicError('cancelled')); };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', cancel);
        resolve();
      }, ms);
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
    });
  }

  snapshot(serverId: string): MusicSnapshot {
    const session = this.sessions.get(serverId);
    const active = session?.active;
    return {
      channelId: session?.channelId ?? null,
      current: active && !active.token.signal.aborted ? active.slot.track ?? null : null,
      paused: active?.paused ?? false, started: active?.started ?? false, elapsedMs: active?.elapsedMs ?? 0,
      upcoming: session?.queue.map((slot) => ({ title: slot.track?.title ?? '…', pending: !slot.track })) ?? [],
    };
  }

  async control(actor: MusicActor, command: 'pause' | 'resume' | 'skip' | 'stop' | 'leave' | 'clear' | 'remove', position?: number): Promise<void> {
    this.assertControl(actor);
    const session = this.sessions.get(actor.serverId);
    if (!session) {
      if (command === 'leave' && this.voice.getVoiceConnection(actor.serverId)) await this.voice.leaveVoice(actor.serverId);
      if (['stop', 'leave', 'clear'].includes(command)) return;
      throw new MusicError('empty');
    }
    if (command === 'leave') { await this.disconnect(actor.serverId); return; }
    await this.serial(session, () => {
      this.authorize(actor, session);
      const active = session.active;
      const connection = this.voice.getVoiceConnection(actor.serverId);
      if (command === 'pause' || command === 'resume') {
        if (!active || active.token.signal.aborted) throw new MusicError('empty');
        active.paused = command === 'pause';
        active.stream?.setPaused?.(active.paused);
        if (active.paused) this.stopSpeaking(connection);
        if (!active.paused) active.wake?.();
      } else if (command === 'skip') {
        session.pendingFailure = undefined;
        if (active && !active.token.signal.aborted) {
          active.token.abort();
          active.wake?.();
          this.stopSpeaking(connection);
        } else if (session.queue.length) {
          session.queue.shift()!.token.abort();
          this.pump(session);
        } else throw new MusicError('empty');
      } else if (command === 'remove') {
        if (!Number.isInteger(position) || position! < 1 || position! > session.queue.length) throw new MusicError('position');
        session.queue.splice(position! - 1, 1)[0].token.abort();
        this.pump(session);
      } else {
        if (command === 'stop') {
          session.endedNoticePending = false;
          session.pendingFailure = undefined;
        }
        for (const slot of session.queue.splice(0)) slot.token.abort();
        if (command === 'stop' && active) {
          active.token.abort();
          active.wake?.();
          this.stopSpeaking(connection);
        }
        this.pump(session);
      }
    });
  }

  refreshGracePeriod(serverId: string): void {
    const session = this.sessions.get(serverId);
    if (!session || session.closing) return;
    const grace = this.graceFor(serverId);
    for (const kind of ['idle', 'empty'] as const) {
      if (!session[kind]) continue;
      clearTimeout(session[kind]);
      session[kind] = undefined;
      this.scheduleLeave(session, kind, grace);
    }
  }

  private scheduleLeave(session: Session, kind: 'idle' | 'empty', grace = this.graceFor(session.serverId)): void {
    const since = kind === 'idle' ? session.idleSince : session.emptySince;
    const now = performance.now();
    if (kind === 'idle') session.idleSince = since ?? now;
    else session.emptySince = since ?? now;
    const remaining = since === undefined ? grace : Math.max(0, grace - (now - since));
    const timer = setTimeout(() => {
      if (this.sessions.get(session.serverId) !== session || session[kind] !== timer || session.closing) return;
      session[kind] = undefined;
      const connection = this.voice.getVoiceConnection(session.serverId);
      void this.disconnect(session.serverId).catch((error: unknown) => {
        console.error(`[music] ${cliText(`Não foi possível sair da sala de voz (${kind}).`, `Could not leave an ${kind} voice room.`)}`);
        if (connection && this.voice.getVoiceConnection(session.serverId) === connection) {
          void this.report({ type: 'runtime-error', actor: session.lastActor, error });
        }
      });
    }, remaining);
    session[kind] = timer;
    timer.unref();
  }

  private armIdle(session: Session): void {
    if (session.idle || session.closing || session.joining) return;
    if (session.pendingFailure) {
      const failure = session.pendingFailure;
      session.pendingFailure = undefined;
      session.endedNoticePending = false;
      void this.report(failure);
    } else if (session.endedNoticePending) {
      session.endedNoticePending = false;
      void this.report({ type: 'ended', actor: session.lastActor });
    }
    const connection = this.voice.getVoiceConnection(session.serverId);
    if (!connection || connection.channelId !== session.channelId) {
      session.closing = true;
      clearTimeout(session.empty);
      if (this.sessions.get(session.serverId) === session) this.sessions.delete(session.serverId);
      return;
    }
    this.scheduleLeave(session, 'idle');
  }

  participantsChanged(serverId: string, channelId: string, count: number): void {
    const session = this.sessions.get(serverId);
    if (!session || session.channelId !== channelId || session.closing) return;
    if (count > 0) {
      clearTimeout(session.empty);
      session.empty = undefined;
      session.emptySince = undefined;
    } else if (!session.empty) {
      this.scheduleLeave(session, 'empty');
    }
  }

  async disconnect(serverId: string, error?: unknown): Promise<void> {
    const session = this.sessions.get(serverId);
    if (!session) return;
    if (session.closePromise) return session.closePromise;
    const actor = error === undefined ? undefined : this.notificationActor(serverId);
    const track = session.active?.slot.track ?? session.pendingFailure?.track;
    session.closing = true;
    session.pendingFailure = undefined;
    session.endedNoticePending = false;
    clearTimeout(session.idle);
    clearTimeout(session.empty);
    for (const slot of session.queue.splice(0)) slot.token.abort();
    session.active?.token.abort();
    session.active?.wake?.();
    session.closePromise = Promise.resolve().then(async () => {
      try {
        try { await this.voice.leaveVoice(serverId); }
        finally {
          await session.joining?.catch(() => undefined);
          await session.active?.done;
        }
      } finally {
        if (this.sessions.get(serverId) === session) this.sessions.delete(serverId);
      }
    });
    if (actor) {
      console.error(`[music] ${cliText('Reprodução interrompida por perda de voz', 'Playback stopped by voice loss')}: ${errorDiagnostic(error)}`);
      void this.report({ type: 'failed', actor, track, error });
    }
    return session.closePromise;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await Promise.all([...this.sessions.keys()].map((serverId) => this.disconnect(serverId)));
  }
}
