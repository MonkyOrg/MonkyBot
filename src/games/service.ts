import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { WebSocket, WebSocketServer } from 'ws';
import { handleReachabilityProbe } from '@monky/bot-sdk';
import { errorDiagnostic } from '../music/process';
import { cliText } from '../i18n';

export type GameId = 'doom' | 'nes';
/** Both controller masks of one NES frame; a trailing 1 marks an autosave checkpoint after it. */
export type NesFrame = [number, number] | [number, number, 1];
/** A gzip `monky-nes-save` envelope kept only in memory. Slot 0 is the autosave; null is an imported file. */
export interface NesSave {
  slot: number | null;
  data: Buffer;
  hash: string;
  romHash: string;
  romName: string;
  /** Small data-URL image of the screen when the save was made ('' when absent). */
  thumbnail: string;
  nickname: string;
  savedAt: number;
}
interface Identity { userId: string; nickname: string; expires: number }
interface Peer {
  socket: WebSocket;
  challenge: string;
  key?: string;
  proof?: string;
  identity?: Identity;
  slot: number | null;
  uid: number;
  ready: boolean;
  hash: string;
  window: number;
  count: number;
  lastSave: number;
  lastDownload: number;
  /** Thumbnail requests answered on this connection (bounded; repeats are allowed when saves reappear). */
  thumbnails: number;
  /** Saves brought back from this player's computer in the current 10-second window. */
  restores: number;
  restoreWindow: number;
  lastClosing: number;
}
/** A player is closing the miniapp: every player is asked whether to save before the game stops. */
interface Closing {
  closers: Map<number, { reason: 'leave' | 'end'; nickname: string }>;
  answered: Set<number>;
  deadline: number;
  timer?: ReturnType<typeof setTimeout>;
}
export interface GameRoom {
  id: string;
  game: GameId;
  creatorId: string;
  identities: Map<string, Identity>;
  peers: Set<Peer>;
  started: boolean;
  nextUid: number;
  /** Committed inputs after `base` (power-on when there is no base). */
  frames: NesFrame[];
  rom?: Buffer;
  romHash: string;
  round: number;
  /** Each player's own saves by Monky user id; slot 0 is their autosave. Nobody else sees or overwrites them. */
  saves: Map<string, Map<number, NesSave>>;
  base?: NesSave;
  /** Frames already folded into `base` by checkpoints, so marker positions stay absolute. */
  dropped: number;
  /** Host checkpoint id -> absolute frame count right after the marked frame. */
  markers: Map<number, number>;
  lastAuto: number;
  lastImport: number;
  /** The host cannot see the game, so the emulator that produces every frame is paused for everyone. */
  paused: boolean;
  closing?: Closing;
  /** When the last authenticated viewer left; undefined while someone is connected. */
  idleSince?: number;
}

export const AUTOSAVE_SLOT = 0;
const SAVE_FORMAT = 'monky-nes-save';
const MAX_SAVE_BYTES = 512 * 1024;
const MAX_SAVE_JSON = 4 * 1024 * 1024;
const MAX_THUMBNAIL = 96 * 1024;
const MAX_THUMBNAIL_REQUESTS = 128;
/** Users whose saves a room keeps; the host and current players are never evicted. */
const MAX_SAVE_USERS = 6;
const MAX_RESTORES = 8;
const jsnesRoot = path.join(path.dirname(require.resolve('jsnes')), '..');
/** Saves are only exchanged between identical emulator versions. */
export const NES_EMULATOR = `jsnes@${(JSON.parse(readFileSync(path.join(jsnesRoot, 'package.json'), 'utf8')) as { version: string }).version}`;
const root = path.resolve(__dirname, '..', '..', 'assets', 'games');
const files = new Map<string, { file: string; type: string }>([
  ['/games/app.js', { file: path.join(root, 'app.js'), type: 'text/javascript' }],
  ['/games/nes.js', { file: path.join(jsnesRoot, 'dist', 'jsnes.min.js'), type: 'text/javascript' }],
  ['/games/nes-license', { file: path.join(jsnesRoot, 'LICENSE'), type: 'text/plain' }],
  ...['engine.js', 'engine.wasm', 'freedoom1.wad', 'COPYING-engine.txt', 'COPYING-freedoom.txt',
    'AUTHORS-engine.txt', 'CREDITS-freedoom.txt', 'CREDITS-MUSIC-freedoom.txt',
    'engine-build.json', 'source/engine.tar.gz', 'source/build.cjs', 'source/monky.c',
    ...['SDL2-2.32.8', 'SDL2_mixer-2.8.0', 'SDL2_net-version_2', 'ogg-1.3.5', 'vorbis-1.3.7'].map(name => `source/ports/${name}.zip`),
    ...['SDL2-2.32.8', 'SDL2_mixer-2.8.0', 'SDL2_net-version_2', 'ogg-1.3.5', 'vorbis-1.3.7',
      'Emscripten', 'musl', 'compiler-rt', 'libcxx', 'libcxxabi', 'yuv2rgb'].map(name => `licenses/${name}.txt`)].map(name => [
    `/games/doom/${name}`, { file: path.join(root, 'doom', ...name.split('/')),
      type: name.endsWith('.js') ? 'text/javascript' : name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' },
  ] as const),
]);

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function saveSlot(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= AUTOSAVE_SLOT && value <= 3;
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Validates a base64 save envelope for the room's current ROM without trusting its producer. */
function decodeSave(room: GameRoom, data: unknown): { data: Buffer; romName: string; thumbnail: string; savedAt: number } {
  if (typeof data !== 'string' || !data.length || data.length % 4 || data.length > Math.ceil(MAX_SAVE_BYTES / 3) * 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new Error('Invalid NES save encoding.');
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length < 20 || bytes.length > MAX_SAVE_BYTES || bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new Error('Invalid NES save size.');
  const value: unknown = JSON.parse(gunzipSync(bytes, { maxOutputLength: MAX_SAVE_JSON }).toString('utf8'));
  if (!object(value) || value.format !== SAVE_FORMAT || value.version !== 1 || value.emulator !== NES_EMULATOR ||
      !room.romHash || value.romHash !== room.romHash || typeof value.savedAt !== 'number' || !Number.isFinite(value.savedAt) ||
      (value.romName !== undefined && typeof value.romName !== 'string') || !object(value.state) ||
      !['cpu', 'mmap', 'ppu', 'papu'].every(key => object((value.state as Record<string, unknown>)[key]))) {
    throw new Error('Invalid NES save.');
  }
  // Only raster data URLs: viewers render it directly as an <img>.
  const thumbnail = typeof value.thumbnail === 'string' && value.thumbnail.length <= MAX_THUMBNAIL &&
    /^data:image\/(?:png|webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value.thumbnail) ? value.thumbnail : '';
  return { data: bytes, thumbnail, savedAt: value.savedAt,
    romName: typeof value.romName === 'string' ? value.romName.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80) : '' };
}

export class GamesService {
  readonly rooms = new Map<string, GameRoom>();
  private server?: Server;
  private sockets?: WebSocketServer;
  private starting?: Promise<string>;
  private url = '';
  private timer?: ReturnType<typeof setInterval>;
  private closed = false;
  /**
   * `closingAnswerMs` bounds how long a closing player may keep the game frozen without answering;
   * `closingLeaveMs` how long after answering they may stay before the game resumes.
   */
  constructor(private readonly config: {
    host: string; port: number; publicUrl: string; closingAnswerMs?: number; closingLeaveMs?: number;
  }) {}

  start(): Promise<string> {
    if (this.closed) return Promise.reject(new Error('Games service has closed.'));
    return this.starting ??= this.listen().catch(error => {
      this.starting = undefined;
      throw error;
    });
  }

  private async listen(): Promise<string> {
    for (const { file } of files.values()) if (!statSync(file).isFile()) throw new Error(`Missing game asset: ${path.basename(file)}`);
    const publicUrl = new URL(this.config.publicUrl);
    if (!['http:', 'https:'].includes(publicUrl.protocol) || publicUrl.username || publicUrl.password ||
        publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash) throw new Error('Invalid games public URL.');
    if (!Number.isInteger(this.config.port) || this.config.port < 0 || this.config.port > 65535) throw new Error('Invalid games port.');
    const server = createServer((request, response) => {
      // Lets `monkybot doctor` and Monky servers prove this port reaches this bot.
      if (handleReachabilityProbe(request, response)) return;
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end(); return; }
      if (request.url === '/games/health') {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ application: 'monky-games', version: 1 }));
        return;
      }
      const asset = files.get(request.url ?? '');
      if (!asset) { response.writeHead(404); response.end(); return; }
      const input = createReadStream(asset.file);
      input.once('error', error => {
        console.error('[games] Asset read failed.', errorDiagnostic(error));
        if (!response.headersSent) response.writeHead(500);
        response.end();
      });
      response.setHeader('Content-Type', asset.type);
      response.setHeader('Cache-Control', 'no-cache');
      if (request.method === 'HEAD') { input.destroy(); response.end(); }
      else input.pipe(response);
      response.once('close', () => input.destroy());
    });
    const sockets = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024, perMessageDeflate: false });
    server.on('upgrade', (request, socket, head) => {
      const match = /^\/games\/room\/([a-f0-9]{32})$/.exec(request.url ?? '');
      const room = match ? this.rooms.get(match[1]) : undefined;
      if (!room || room.peers.size >= 12 || this.closed) { socket.destroy(); return; }
      sockets.handleUpgrade(request, socket, head, client => this.accept(room, client));
    });
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error): void => {
        server.close();
        sockets.close();
        // 7781 is also the natural manifest port of a second bot on the same host.
        reject('code' in error && error.code === 'EADDRINUSE' ? new Error(cliText(
          `A porta de jogos ${this.config.port} já está em uso (por exemplo, pelo manifest de outro bot). ` +
          'Escolha outra com "monkybot config env set MONKY_GAMES_PORT <porta>" (e MONKY_GAMES_PUBLIC_URL, se usar) e "monkybot restart".',
          `Games port ${this.config.port} is already in use (for example, by another bot's manifest). ` +
          'Choose another with "monkybot config env set MONKY_GAMES_PORT <port>" (and MONKY_GAMES_PUBLIC_URL, if used) and "monkybot restart".'),
        { cause: error }) : error);
      };
      server.once('error', failed);
      server.listen(this.config.port, this.config.host, () => {
        server.off('error', failed);
        resolve();
      });
    });
    this.server = server;
    this.sockets = sockets;
    server.on('error', error => console.error('[games] HTTP service failed.', errorDiagnostic(error)));
    if (this.config.port === 0) {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Games listener has no TCP address.');
      publicUrl.port = String(address.port);
    }
    this.url = publicUrl.origin;
    this.timer = setInterval(() => {
      for (const room of this.rooms.values()) {
        for (const [key, identity] of room.identities) if (identity.expires < Date.now()) room.identities.delete(key);
        for (const peer of room.peers) {
          if (!peer.identity || peer.identity.expires < Date.now()) peer.socket.close(4003, 'Membership expired');
        }
      }
    }, 15_000);
    this.timer.unref();
    return this.url;
  }

  create(game: GameId, creatorId: string): GameRoom {
    if (this.closed || this.rooms.size >= 16) throw new Error('Active game limit reached.');
    const room: GameRoom = {
      id: randomBytes(16).toString('hex'), game, creatorId, identities: new Map(),
      peers: new Set(), started: false, nextUid: 2, frames: [], romHash: '', round: 0,
      saves: new Map(), dropped: 0, markers: new Map(), lastAuto: 0, lastImport: 0, paused: false,
      idleSince: Date.now(),
    };
    this.rooms.set(room.id, room);
    return room;
  }

  /** Milliseconds since the last authenticated viewer left; 0 while anyone is connected. */
  idleFor(room: GameRoom): number {
    return room.idleSince === undefined ? 0 : Date.now() - room.idleSince;
  }

  authorize(room: GameRoom, key: string, userId: string, nickname: string): void {
    if (this.rooms.get(room.id) !== room || !/^[A-Za-z0-9+/]{87}=$/.test(key)) throw new Error('Invalid game authorization.');
    if (!room.identities.has(key) && room.identities.size >= 24) throw new Error('Too many game views.');
    const bytes = Buffer.from(key, 'base64');
    if (bytes.length !== 65 || bytes[0] !== 4) throw new Error('Invalid game public key.');
    const existing = room.identities.get(key);
    if (existing && existing.userId !== userId) throw new Error('Game key belongs to another user.');
    const identity = existing ?? { userId, nickname: nickname.slice(0, 80), expires: 0 };
    identity.expires = Date.now() + 20_000;
    room.identities.set(key, identity);
    for (const peer of room.peers) if (peer.key === key && !peer.identity) this.authenticate(room, peer);
  }

  remove(room: GameRoom): void {
    if (this.rooms.get(room.id) !== room) return;
    this.rooms.delete(room.id);
    room.identities.clear();
    room.frames = [];
    room.rom = undefined;
    room.romHash = '';
    room.saves.clear();
    room.base = undefined;
    room.markers.clear();
    this.endClosing(room);
    for (const peer of room.peers) peer.socket.close(4000, 'Game ended');
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.starting) await this.starting.catch(error => console.error('[games] Startup failed during shutdown.', errorDiagnostic(error)));
    clearInterval(this.timer);
    for (const room of this.rooms.values()) this.remove(room);
    for (const socket of this.sockets?.clients ?? []) socket.terminate();
    this.sockets?.close();
    if (this.server?.listening) await new Promise<void>((resolve, reject) => {
      this.server!.close(error => error ? reject(error) : resolve());
      this.server!.closeAllConnections();
    });
  }

  private accept(room: GameRoom, socket: WebSocket): void {
    const peer: Peer = {
      socket, challenge: randomBytes(32).toString('hex'), slot: null,
      uid: room.nextUid++, ready: false, hash: '', window: Date.now(), count: 0, lastSave: 0, lastDownload: 0,
      thumbnails: 0, restores: 0, restoreWindow: 0, lastClosing: 0,
    };
    room.peers.add(peer);
    const timeout = setTimeout(() => { if (!peer.identity) socket.close(4003, 'Authentication timed out'); }, 12_000);
    timeout.unref();
    this.send(peer, { type: 'challenge', challenge: peer.challenge });
    socket.on('message', (data, binary) => {
      try {
        if (this.rooms.get(room.id) !== room) throw new Error('Game has ended.');
        if (Date.now() - peer.window >= 1000) { peer.window = Date.now(); peer.count = 0; }
        if (++peer.count > 240) throw new Error('Game message rate exceeded.');
        const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
        if (binary) {
          if (room.game === 'nes') {
            if (!peer.identity || peer.identity.expires < Date.now() || peer.slot !== 0 ||
                peer.identity.userId !== room.creatorId || room.started) throw new Error('Only the host can select a ROM in the lobby.');
            if (bytes.length < 16 || bytes.length > 4 * 1024 * 1024 ||
                !bytes.subarray(0, 4).equals(Buffer.from([0x4e, 0x45, 0x53, 0x1a])) ||
                (bytes[7] & 0x0c) === 0x08 || !bytes[4] ||
                bytes.length !== 16 + (bytes[6] & 4 ? 512 : 0) + bytes[4] * 16384 + bytes[5] * 8192) {
              throw new Error('Invalid iNES ROM.');
            }
            room.rom = bytes;
            room.romHash = sha256(bytes);
            this.setBase(room, undefined);
            for (const other of room.peers) {
              other.ready = false;
              other.hash = '';
              if (other.identity) this.sendRom(room, other);
            }
            this.lobby(room);
            return;
          }
          if (!peer.identity || peer.identity.expires < Date.now() ||
              room.game !== 'doom' || bytes.length < 12 || bytes.length > 8196) {
            throw new Error('Unexpected game packet.');
          }
          if (!this.currentRound(room, { round: bytes.readUInt32LE(0) })) return;
          if (!room.started) throw new Error('Unexpected game packet outside a running round.');
          bytes.writeUInt32LE(peer.uid, 8);
          const target = bytes.readUInt32LE(4);
          for (const other of room.peers) {
            if (other !== peer && other.identity && (target === 0 || target === other.uid)) this.sendBinary(other, bytes);
          }
          return;
        }
        const value: unknown = JSON.parse(bytes.toString('utf8'));
        if (!object(value) || typeof value.type !== 'string') throw new Error('Invalid game message.');
        if (value.type === 'authenticate') {
          if (peer.identity || typeof value.key !== 'string' || typeof value.proof !== 'string' ||
              value.key.length !== 88 || value.proof.length > 100) throw new Error('Invalid authentication.');
          peer.key = value.key;
          peer.proof = value.proof;
          this.authenticate(room, peer);
          return;
        }
        if (!peer.identity || peer.identity.expires < Date.now()) throw new Error('Game membership expired.');
        this.handle(room, peer, value);
      } catch (error: unknown) {
        console.warn('[games] Rejected game message.', errorDiagnostic(error));
        socket.close(4002, 'Invalid game message');
      }
    });
    socket.on('error', error => console.warn('[games] Game connection failed.', errorDiagnostic(error)));
    socket.once('close', () => {
      clearTimeout(timeout);
      room.peers.delete(peer);
      if (![...room.peers].some(other => other.identity)) room.idleSince ??= Date.now();
      if (peer.slot !== null && room.started || peer.slot === 0 && room.game === 'nes') {
        room.started = false;
        room.paused = false;
        this.endClosing(room);
        // Saves stay in the room; only the interrupted timeline is discarded.
        this.setBase(room, undefined);
        if (peer.slot === 0) { room.rom = undefined; room.romHash = ''; }
        for (const other of room.peers) other.ready = false;
        // The remaining player is asked whether to save, so they learn who left.
        this.broadcast(room, { type: 'stopped', reason: 'player-left', nickname: peer.identity?.nickname ?? '' });
      }
      this.lobby(room);
    });
  }

  private authenticate(room: GameRoom, peer: Peer): void {
    const identity = peer.key ? room.identities.get(peer.key) : undefined;
    if (!identity || !peer.proof || identity.expires < Date.now()) return;
    const raw = Buffer.from(peer.key!, 'base64');
    const key = createPublicKey({ key: {
      kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url'),
    }, format: 'jwk' });
    if (!verify('sha256', Buffer.from(`${room.id}:${peer.challenge}`),
      { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(peer.proof, 'base64'))) throw new Error('Game proof rejected.');
    peer.identity = identity;
    room.idleSince = undefined;
    if (identity.userId === room.creatorId && ![...room.peers].some(other => other !== peer && other.slot === 0)) {
      peer.slot = 0;
      peer.uid = 1;
    }
    this.send(peer, { type: 'authenticated', uid: peer.uid, game: room.game, ...room.game === 'nes' ? { emulator: NES_EMULATOR } : {} });
    this.lobby(room);
    if (room.game === 'nes') {
      this.sendRom(room, peer);
      if (room.base) this.sendBinary(peer, this.baseMessage(room), false);
    }
  }

  private handle(room: GameRoom, peer: Peer, value: Record<string, unknown>): void {
    if (['state', 'load', 'import', 'download', 'thumbnail', 'keep', 'restore', 'pause', 'unpause', 'closing', 'closing-done']
      .includes(value.type as string) && room.game !== 'nes') {
      throw new Error('Unknown game action.');
    }
    if (value.type === 'request-rom') {
      if (room.game !== 'nes' || !room.rom) this.send(peer, { type: 'unavailable' });
      else {
        this.sendRom(room, peer);
        if (room.base) this.sendBinary(peer, this.baseMessage(room), false);
      }
    } else if (value.type === 'join') {
      if ((room.started && (room.game !== 'nes' || !peer.ready || peer.hash !== room.romHash)) ||
          peer.slot !== null || [...room.peers].some(other => other.slot === 1 ||
          (other !== peer && other.slot !== null && other.identity?.userId === peer.identity!.userId))) {
        this.send(peer, { type: 'unavailable' });
        return;
      }
      peer.slot = 1;
      this.lobby(room);
    } else if (value.type === 'unready') {
      if (room.started || peer.slot === null) throw new Error('Unexpected player readiness change.');
      peer.ready = false;
      peer.hash = '';
      this.lobby(room);
    } else if (value.type === 'ready') {
      if (typeof value.hash !== 'string' || !/^[a-f0-9]{64}$/.test(value.hash) ||
          (room.game === 'doom' && (room.started || peer.slot === null))) throw new Error('Invalid player readiness.');
      if (room.game === 'nes' && (!room.rom || value.hash !== room.romHash)) {
        this.send(peer, { type: 'mismatch', hash: room.romHash });
        return;
      }
      peer.hash = value.hash;
      peer.ready = true;
      this.lobby(room);
    } else if (value.type === 'start' || value.type === 'resume') {
      const players = [...room.peers].filter(other => other.slot !== null);
      if (peer.slot !== 0 || room.started || players.length < (room.game === 'doom' ? 2 : 1) ||
          players.length > 2 || players.some(other => !other.ready) ||
          value.type === 'resume' && (room.game !== 'nes' || !room.frames.length && !room.base)) {
        this.send(peer, { type: 'unavailable' });
        return;
      }
      if (players.some(other => other.hash !== players[0].hash)) {
        this.broadcast(room, { type: 'mismatch' });
        return;
      }
      if (value.type === 'start') this.setBase(room, undefined);
      this.startRound(room, value.type === 'resume');
    } else if (value.type === 'restart' || value.type === 'return-lobby') {
      if (!this.isHost(room, peer) || !room.started || value.round !== room.round) {
        this.send(peer, { type: 'unavailable' });
        return;
      }
      if (value.type === 'restart') {
        this.setBase(room, undefined);
        this.startRound(room);
      } else {
        room.started = false;
        if (room.game !== 'nes') room.frames = [];
        room.markers.clear();
        room.paused = false;
        this.endClosing(room);
        room.round++;
        this.broadcast(room, { type: 'reset-lobby', round: room.round });
        this.lobby(room);
      }
    } else if (value.type === 'input') {
      if (room.game === 'nes' && !this.currentRound(room, value)) return;
      // Inputs already in flight when a player left belong to a game that just stopped.
      if (room.game === 'nes' && !room.started && peer.slot !== null) return;
      if (!room.started || room.game !== 'nes' || peer.slot === null ||
          !Number.isInteger(value.buttons) || typeof value.buttons !== 'number' || value.buttons < 0 || value.buttons > 255) throw new Error('Invalid player input.');
      for (const host of room.peers) if (host.slot === 0) this.send(host, { type: 'input', slot: peer.slot, buttons: value.buttons, round: room.round });
    } else if (value.type === 'frames') {
      if (room.game === 'nes' && !this.currentRound(room, value)) return;
      // Frames the host sent before learning that the other player left are stale, not a violation.
      if (room.game === 'nes' && !room.started && peer.slot === 0) return;
      const checkpoint = value.checkpoint;
      const frames: unknown = value.frames;
      if (!room.started || room.game !== 'nes' || peer.slot !== 0 || !Array.isArray(frames) ||
          frames.length < 1 || frames.length > 8 ||
          checkpoint !== undefined && (typeof checkpoint !== 'number' || !Number.isSafeInteger(checkpoint) || checkpoint < 1) ||
          frames.some((frame, index) => !Array.isArray(frame) ||
            frame.length !== (checkpoint !== undefined && index === frames.length - 1 ? 3 : 2) ||
            frame.slice(0, 2).some(mask => !Number.isInteger(mask) || mask < 0 || mask > 255) ||
            frame.length === 3 && frame[2] !== 1)) throw new Error('Invalid NES frames.');
      if (room.frames.length + frames.length > 120_000) throw new Error('Game replay duration exceeded.');
      for (const frame of frames as number[][]) room.frames.push(frame.length === 3 ? [frame[0], frame[1], 1] : [frame[0], frame[1]]);
      if (typeof checkpoint === 'number') {
        room.markers.set(checkpoint, room.dropped + room.frames.length);
        if (room.markers.size > 8) room.markers.delete(room.markers.keys().next().value!);
      }
      this.broadcast(room, { type: 'frames', frames, round: room.round }, peer);
    } else if (value.type === 'watch') {
      if (room.game === 'nes' && !this.currentRound(room, value)) return;
      const host = [...room.peers].find(other => other.slot === 0);
      if (!room.started || room.game !== 'nes' || typeof value.hash !== 'string' ||
          !host || host.hash !== value.hash) {
        this.send(peer, { type: 'mismatch' });
        return;
      }
      peer.hash = value.hash;
      this.send(peer, { type: 'replay', frames: room.frames, round: room.round, base: room.base?.hash ?? '' });
    } else if (value.type === 'keep' || value.type === 'restore') {
      // Each player keeps their own saves: a snapshot of their own emulator, or one brought back from their
      // computer. Only the host's saves can be loaded into the game, so a seat cannot inject state into it.
      const restoring = value.type === 'restore';
      if (restoring && Date.now() - peer.restoreWindow >= 10_000) { peer.restoreWindow = Date.now(); peer.restores = 0; }
      if (peer.slot === null || !room.rom || !saveSlot(value.slot) || !restoring && value.slot === AUTOSAVE_SLOT ||
          (restoring ? ++peer.restores > MAX_RESTORES : Date.now() - peer.lastSave < 250)) {
        this.send(peer, { type: 'unavailable', action: value.type, slot: value.slot });
        return;
      }
      if (!restoring) peer.lastSave = Date.now();
      let decoded: ReturnType<typeof decodeSave>;
      // Kept on a computer, a save may come from another emulator version; refusing it is not a protocol error.
      try { decoded = decodeSave(room, value.data); }
      catch (error) {
        console.warn('[games] Rejected NES save.', error instanceof Error ? error.message : error);
        this.send(peer, { type: 'unavailable', action: value.type, slot: value.slot, reason: 'invalid' });
        return;
      }
      const { userId, nickname } = peer.identity!;
      const saves = this.userSaves(room, userId);
      const savedAt = restoring ? Math.min(Date.now(), Math.max(0, decoded.savedAt)) : Date.now();
      const current = saves.get(value.slot);
      if (restoring && current?.romHash === room.romHash && current.savedAt >= savedAt) return;
      const save: NesSave = { slot: value.slot, data: decoded.data, romName: decoded.romName, thumbnail: decoded.thumbnail,
        hash: sha256(decoded.data), romHash: room.romHash, nickname: value.slot === AUTOSAVE_SLOT ? '' : nickname, savedAt };
      saves.set(value.slot, save);
      if (!restoring) {
        for (const other of room.peers) if (other.identity?.userId === userId) this.send(other, { type: 'saved', slot: save.slot,
          nickname: save.nickname, hash: save.hash, ...save.thumbnail ? { thumbnail: save.thumbnail } : {} });
      }
      this.lobby(room);
    } else if (value.type === 'state') {
      // The host emulator produces the shared autosave checkpoint; it becomes every player's own Automático.
      if (!this.currentRound(room, value)) return;
      const checkpoint = value.checkpoint;
      if (!this.isHost(room, peer) || value.slot !== AUTOSAVE_SLOT || checkpoint !== undefined &&
          (typeof checkpoint !== 'number' || !Number.isSafeInteger(checkpoint))) {
        throw new Error('Unexpected NES save.');
      }
      if (!room.started || Date.now() - room.lastAuto < 30_000) {
        this.send(peer, { type: 'unavailable', action: 'state', slot: AUTOSAVE_SLOT });
        return;
      }
      const decoded = decodeSave(room, value.data);
      const save: NesSave = { slot: AUTOSAVE_SLOT, data: decoded.data, romName: decoded.romName, thumbnail: decoded.thumbnail,
        hash: sha256(decoded.data), romHash: room.romHash, nickname: '', savedAt: Date.now() };
      room.lastAuto = save.savedAt;
      const at = typeof checkpoint === 'number' ? room.markers.get(checkpoint) : undefined;
      if (typeof checkpoint === 'number' && at !== undefined && at >= room.dropped) {
        // Every viewer reloaded from this state at the marker, so the replay can start there.
        room.frames.splice(0, at - room.dropped);
        room.dropped = at;
        for (const id of [...room.markers.keys()]) if (id <= checkpoint) room.markers.delete(id);
        room.base = save;
        this.broadcastBase(room, true);
      }
      // Players get the screenshot with the notice; spectators have no saves.
      const players = [...room.peers].filter(other => other.slot !== null && other.identity);
      for (const userId of new Set(players.map(other => other.identity!.userId))) this.userSaves(room, userId).set(AUTOSAVE_SLOT, save);
      for (const other of players) this.send(other, { type: 'saved', slot: AUTOSAVE_SLOT, nickname: '', hash: save.hash,
        ...save.thumbnail ? { thumbnail: save.thumbnail } : {} });
      this.lobby(room);
    } else if (value.type === 'load' || value.type === 'import') {
      if (!this.currentRound(room, value)) return;
      let save = value.type === 'load' && saveSlot(value.slot) ? room.saves.get(room.creatorId)?.get(value.slot) : undefined;
      if (!this.isHost(room, peer) || !room.rom || value.type === 'load' && save?.romHash !== room.romHash ||
          value.type === 'import' && Date.now() - room.lastImport < 2000) {
        this.send(peer, { type: 'unavailable', action: value.type });
        return;
      }
      if (value.type === 'import') {
        room.lastImport = Date.now();
        let decoded: ReturnType<typeof decodeSave>;
        // A user-chosen file is refused on its own; only host-generated uploads are protocol violations.
        try { decoded = decodeSave(room, value.data); }
        catch (error) {
          console.warn('[games] Rejected NES save file.', error instanceof Error ? error.message : error);
          this.send(peer, { type: 'unavailable', action: 'import', reason: 'invalid' });
          return;
        }
        save = { slot: null, data: decoded.data, romName: decoded.romName, thumbnail: decoded.thumbnail,
          hash: sha256(decoded.data), romHash: room.romHash, nickname: peer.identity!.nickname, savedAt: Date.now() };
      }
      this.setBase(room, save);
      if (room.started) this.startRound(room);
      else this.lobby(room);
    } else if (value.type === 'download') {
      const save = saveSlot(value.slot) ? this.ownSaves(room, peer)?.get(value.slot) : undefined;
      if (peer.slot === null || !save || save.romHash !== room.romHash || Date.now() - peer.lastDownload < 1000) {
        this.send(peer, { type: 'unavailable', action: 'download', slot: value.slot });
        return;
      }
      peer.lastDownload = Date.now();
      this.sendBinary(peer, JSON.stringify({ type: 'save-data', slot: save.slot, hash: save.hash, romName: save.romName,
        nickname: save.nickname, age: Date.now() - save.savedAt, data: save.data.toString('base64') }), false);
    } else if (value.type === 'thumbnail') {
      // Players fetch the screenshots of their own saves and the resume point; a per-connection budget bounds the traffic.
      const save = typeof value.hash === 'string' ? [...this.ownSaves(room, peer)?.values() ?? [], ...room.base ? [room.base] : []]
        .find(entry => entry.hash === value.hash && entry.romHash === room.romHash && entry.thumbnail) : undefined;
      if (peer.slot === null || !save || peer.thumbnails >= MAX_THUMBNAIL_REQUESTS) return;
      peer.thumbnails++;
      this.send(peer, { type: 'thumbnail', hash: save.hash, thumbnail: save.thumbnail });
    } else if (value.type === 'pause' || value.type === 'unpause') {
      // The host's emulator produces every frame: while the host cannot see the game, everyone waits.
      if (!this.currentRound(room, value)) return;
      if (!this.isHost(room, peer)) throw new Error('Only the host pauses the game.');
      const paused = value.type === 'pause';
      if (!room.started || room.paused === paused) return;
      room.paused = paused;
      this.broadcast(room, paused ? { type: 'paused', round: room.round, nickname: peer.identity!.nickname }
        : { type: 'unpaused', round: room.round });
    } else if (value.type === 'closing') {
      // A player is leaving or ending the miniapp: the game freezes and every player is asked whether to save.
      if (!this.currentRound(room, value)) return;
      if (value.reason !== 'leave' && value.reason !== 'end') throw new Error('Invalid closing reason.');
      if (peer.slot === null || !room.started || Date.now() - peer.lastClosing < 10_000) return;
      peer.lastClosing = Date.now();
      const closing = room.closing ??= { closers: new Map(), answered: new Set(), deadline: 0 };
      closing.closers.set(peer.uid, { reason: value.reason, nickname: peer.identity!.nickname });
      closing.answered.delete(peer.uid);
      this.scheduleClosing(room, Date.now() + (this.config.closingAnswerMs ?? 3 * 60_000));
      this.broadcast(room, { type: 'closing', uid: peer.uid, nickname: peer.identity!.nickname, reason: value.reason, round: room.round });
    } else if (value.type === 'closing-done') {
      if (!this.currentRound(room, value)) return;
      const closing = room.closing;
      if (peer.slot === null || !closing || closing.answered.has(peer.uid)) return;
      closing.answered.add(peer.uid);
      this.broadcast(room, { type: 'closing-answered', uid: peer.uid, round: room.round });
      // A closer that answered leaves within seconds; one that stays has given up closing. Ending for everyone
      // first waits for every player's answer.
      const players = [...room.peers].filter(other => other.slot !== null && other.identity);
      if ([...closing.closers].some(([uid, closer]) => closing.answered.has(uid) &&
          (closer.reason === 'leave' || players.every(other => closing.answered.has(other.uid))))) {
        this.scheduleClosing(room, Math.min(closing.deadline, Date.now() + (this.config.closingLeaveMs ?? 15_000)));
      }
    } else {
      throw new Error('Unknown game action.');
    }
  }

  private isHost(room: GameRoom, peer: Peer): boolean {
    return peer.slot === 0 && peer.identity?.userId === room.creatorId;
  }

  private ownSaves(room: GameRoom, peer: Peer): Map<number, NesSave> | undefined {
    return peer.identity ? room.saves.get(peer.identity.userId) : undefined;
  }

  /** The user's saves, most recently used last; the oldest absent users are dropped beyond the room bound. */
  private userSaves(room: GameRoom, userId: string): Map<number, NesSave> {
    const saves = room.saves.get(userId) ?? new Map<number, NesSave>();
    room.saves.delete(userId);
    room.saves.set(userId, saves);
    if (room.saves.size > MAX_SAVE_USERS) {
      const playing = new Set([...room.peers].filter(peer => peer.slot !== null && peer.identity).map(peer => peer.identity!.userId));
      for (const id of [...room.saves.keys()]) {
        if (room.saves.size <= MAX_SAVE_USERS) break;
        if (id !== room.creatorId && id !== userId && !playing.has(id)) room.saves.delete(id);
      }
    }
    return saves;
  }

  /** Resumes the frozen game when nobody actually closes before `deadline`. */
  private scheduleClosing(room: GameRoom, deadline: number): void {
    const closing = room.closing!;
    closing.deadline = deadline;
    clearTimeout(closing.timer);
    closing.timer = setTimeout(() => {
      if (room.closing !== closing) return;
      this.endClosing(room);
      this.broadcast(room, { type: 'closing-cancelled', round: room.round });
    }, Math.max(0, deadline - Date.now()));
    closing.timer.unref();
  }

  private endClosing(room: GameRoom): void {
    clearTimeout(room.closing?.timer);
    room.closing = undefined;
  }

  /** Replaces the timeline origin; viewers receive the new base before any round that uses it. */
  private setBase(room: GameRoom, save: NesSave | undefined): void {
    room.frames = [];
    room.dropped = 0;
    room.markers.clear();
    if (room.base === save) return;
    room.base = save;
    this.broadcastBase(room);
  }

  private baseMessage(room: GameRoom, checkpoint = false): string {
    const base = room.base;
    return JSON.stringify(base ? { type: 'base', hash: base.hash, data: base.data.toString('base64'), slot: base.slot,
      nickname: base.nickname, age: Date.now() - base.savedAt, thumb: !!base.thumbnail, checkpoint } : { type: 'base', hash: '' });
  }

  private broadcastBase(room: GameRoom, checkpoint = false): void {
    const message = this.baseMessage(room, checkpoint);
    for (const peer of room.peers) if (peer.identity) this.sendBinary(peer, message, false);
  }

  private currentRound(room: GameRoom, value: Record<string, unknown>): boolean {
    if (typeof value.round !== 'number' || !Number.isInteger(value.round) || value.round < 0 || value.round > room.round) {
      throw new Error('Invalid game round.');
    }
    // In-flight inputs from before restart/lobby must not enter the new round.
    return value.round === room.round;
  }

  private startRound(room: GameRoom, resume = false): void {
    room.started = true;
    if (!resume) {
      room.frames = [];
      room.dropped = 0;
    }
    room.markers.clear();
    room.paused = false;
    this.endClosing(room);
    room.round++;
    this.broadcast(room, { type: resume ? 'resume' : 'start', round: room.round, base: room.base?.hash ?? '' });
  }

  private sendRom(room: GameRoom, peer: Peer): void {
    if (!room.rom) return;
    this.send(peer, { type: 'rom', hash: room.romHash });
    this.sendBinary(peer, room.rom);
  }

  /** Room state for everyone, with each player's own saves: nobody sees another player's slots. */
  private lobby(room: GameRoom): void {
    const canResume = room.game === 'nes' && !room.started && (room.frames.length > 0 || !!room.base);
    const now = Date.now();
    const shared = { type: 'lobby', started: room.started, round: room.round, romHash: room.romHash,
      canResume, resumeFrom: canResume ? room.frames.length ? 'progress' : 'save' : null, paused: room.started && room.paused,
      base: room.base ? { slot: room.base.slot, nickname: room.base.nickname, age: now - room.base.savedAt,
        hash: room.base.hash, thumb: !!room.base.thumbnail } : null,
      peers: [...room.peers]
      .filter(peer => peer.identity).map(peer => ({
        uid: peer.uid, slot: peer.slot, nickname: peer.identity!.nickname, ready: peer.ready,
      })) };
    for (const peer of room.peers) {
      if (!peer.identity) continue;
      // Saves of another ROM stay hidden until the host chooses that ROM again.
      const own = room.game === 'nes' && room.romHash && peer.slot !== null ? room.saves.get(peer.identity.userId) : undefined;
      this.send(peer, { ...shared, saves: own ? [...own.values()].filter(save => save.romHash === room.romHash)
        .map(save => ({ slot: save.slot, nickname: save.nickname, romName: save.romName, age: now - save.savedAt,
          hash: save.hash, thumb: !!save.thumbnail })) : [] });
    }
  }
  private broadcast(room: GameRoom, value: unknown, exclude?: Peer): void {
    for (const peer of room.peers) if (peer.identity && peer !== exclude) this.send(peer, value);
  }
  private send(peer: Peer, value: unknown): void {
    this.sendBinary(peer, JSON.stringify(value), false);
  }
  private sendBinary(peer: Peer, data: Buffer | string, binary = true): void {
    if (peer.socket.readyState !== WebSocket.OPEN) return;
    if (peer.identity && peer.identity.expires < Date.now()) { peer.socket.close(4003, 'Membership expired'); return; }
    if (peer.socket.bufferedAmount > 4 * 1024 * 1024) { peer.socket.close(4008, 'Game connection is too slow'); return; }
    peer.socket.send(data, { binary });
  }
}
