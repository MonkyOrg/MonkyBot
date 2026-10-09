import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { handleReachabilityProbe } from '@monky/bot-sdk';
import { errorDiagnostic } from '../music/process';
import { cliText } from '../i18n';

export type GameId = 'doom' | 'nes';
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
}
export interface GameRoom {
  id: string;
  game: GameId;
  creatorId: string;
  identities: Map<string, Identity>;
  peers: Set<Peer>;
  started: boolean;
  nextUid: number;
  frames: [number, number][];
  rom?: Buffer;
  romHash: string;
  round: number;
}

const root = path.resolve(__dirname, '..', '..', 'assets', 'games');
const files = new Map<string, { file: string; type: string }>([
  ['/games/app.js', { file: path.join(root, 'app.js'), type: 'text/javascript' }],
  ['/games/nes.js', { file: path.join(path.dirname(require.resolve('jsnes')), 'jsnes.min.js'), type: 'text/javascript' }],
  ['/games/nes-license', { file: path.join(path.dirname(require.resolve('jsnes')), '..', 'LICENSE'), type: 'text/plain' }],
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

export class GamesService {
  readonly rooms = new Map<string, GameRoom>();
  private server?: Server;
  private sockets?: WebSocketServer;
  private starting?: Promise<string>;
  private url = '';
  private timer?: ReturnType<typeof setInterval>;
  private closed = false;
  constructor(private readonly config: { host: string; port: number; publicUrl: string }) {}

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
    };
    this.rooms.set(room.id, room);
    return room;
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
      uid: room.nextUid++, ready: false, hash: '', window: Date.now(), count: 0,
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
            room.romHash = createHash('sha256').update(bytes).digest('hex');
            room.frames = [];
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
      if (peer.slot !== null && room.started || peer.slot === 0 && room.game === 'nes') {
        room.started = false;
        room.frames = [];
        if (peer.slot === 0) { room.rom = undefined; room.romHash = ''; }
        for (const other of room.peers) other.ready = false;
        this.broadcast(room, { type: 'stopped', reason: 'player-left' });
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
    if (identity.userId === room.creatorId && ![...room.peers].some(other => other !== peer && other.slot === 0)) {
      peer.slot = 0;
      peer.uid = 1;
    }
    this.send(peer, { type: 'authenticated', uid: peer.uid, game: room.game });
    this.lobby(room);
    if (room.game === 'nes') this.sendRom(room, peer);
  }

  private handle(room: GameRoom, peer: Peer, value: Record<string, unknown>): void {
    if (value.type === 'request-rom') {
      if (room.game !== 'nes' || !room.rom) this.send(peer, { type: 'unavailable' });
      else this.sendRom(room, peer);
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
          value.type === 'resume' && (room.game !== 'nes' || !room.frames.length)) {
        this.send(peer, { type: 'unavailable' });
        return;
      }
      if (players.some(other => other.hash !== players[0].hash)) {
        this.broadcast(room, { type: 'mismatch' });
        return;
      }
      this.startRound(room, value.type === 'resume');
    } else if (value.type === 'restart' || value.type === 'return-lobby') {
      if (peer.slot !== 0 || peer.identity!.userId !== room.creatorId ||
          !room.started || value.round !== room.round) {
        this.send(peer, { type: 'unavailable' });
        return;
      }
      if (value.type === 'restart') this.startRound(room);
      else {
        room.started = false;
        if (room.game !== 'nes') room.frames = [];
        room.round++;
        this.broadcast(room, { type: 'reset-lobby', round: room.round });
        this.lobby(room);
      }
    } else if (value.type === 'input') {
      if (room.game === 'nes' && !this.currentRound(room, value)) return;
      if (!room.started || room.game !== 'nes' || peer.slot === null ||
          !Number.isInteger(value.buttons) || typeof value.buttons !== 'number' || value.buttons < 0 || value.buttons > 255) throw new Error('Invalid player input.');
      for (const host of room.peers) if (host.slot === 0) this.send(host, { type: 'input', slot: peer.slot, buttons: value.buttons, round: room.round });
    } else if (value.type === 'frames') {
      if (room.game === 'nes' && !this.currentRound(room, value)) return;
      if (!room.started || room.game !== 'nes' || peer.slot !== 0 || !Array.isArray(value.frames) ||
          value.frames.length < 1 || value.frames.length > 8 ||
          value.frames.some(frame => !Array.isArray(frame) || frame.length !== 2 ||
            frame.some(mask => !Number.isInteger(mask) || mask < 0 || mask > 255))) throw new Error('Invalid NES frames.');
      if (room.frames.length + value.frames.length > 120_000) throw new Error('Game replay duration exceeded.');
      for (const frame of value.frames) room.frames.push([frame[0], frame[1]]);
      this.broadcast(room, { type: 'frames', frames: value.frames, round: room.round }, peer);
    } else if (value.type === 'watch') {
      if (room.game === 'nes' && !this.currentRound(room, value)) return;
      const host = [...room.peers].find(other => other.slot === 0);
      if (!room.started || room.game !== 'nes' || typeof value.hash !== 'string' ||
          !host || host.hash !== value.hash) {
        this.send(peer, { type: 'mismatch' });
        return;
      }
      peer.hash = value.hash;
      this.send(peer, { type: 'replay', frames: room.frames, round: room.round });
    } else {
      throw new Error('Unknown game action.');
    }
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
    if (!resume) room.frames = [];
    room.round++;
    this.broadcast(room, { type: resume ? 'resume' : 'start', round: room.round });
  }

  private sendRom(room: GameRoom, peer: Peer): void {
    if (!room.rom) return;
    this.send(peer, { type: 'rom', hash: room.romHash });
    this.sendBinary(peer, room.rom);
  }

  private lobby(room: GameRoom): void {
    this.broadcast(room, { type: 'lobby', started: room.started, round: room.round, romHash: room.romHash,
      canResume: room.game === 'nes' && !room.started && room.frames.length > 0, peers: [...room.peers]
      .filter(peer => peer.identity).map(peer => ({
        uid: peer.uid, slot: peer.slot, nickname: peer.identity!.nickname, ready: peer.ready,
      })) });
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
