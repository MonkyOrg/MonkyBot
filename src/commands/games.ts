import type { BotClient, BotScreen, BotScreenActionEvent, BotScreenRemoved } from '@monky/bot-sdk';
import { GamesService, type GameRoom } from '../games/service';
import { message, type LocalizedCommandDefinition } from './i18n';
import { errorDiagnostic } from '../music/process';

export const gameDefinitions: Record<'doom' | 'nes', Omit<LocalizedCommandDefinition, 'handler'>> = {
  doom: {
    name: 'doom', description: 'Jogue DOOM/Freedoom em dupla na sala de voz.',
    localizations: { 'pt-BR': { name: 'doom' }, en: {
      name: 'doom', description: 'Play DOOM/Freedoom with a friend in your voice room.',
    } },
    voiceRequirement: 'joined',
  },
  nes: {
    name: 'nes', description: 'Abra o emulador NES e escolha sua ROM para jogar sozinho ou em dupla.',
    localizations: { 'pt-BR': { name: 'nes' }, en: {
      name: 'nes', description: 'Open the NES emulator and choose your ROM to play solo or with a friend.',
    } },
    voiceRequirement: 'joined',
  },
};

export function gamesHtml(base: string, room: GameRoom): string {
  const config = JSON.stringify({ base, roomId: room.id, game: room.game }).replace(/</g, '\\u003c');
  return `<!doctype html><meta charset="utf-8"><main id="game-root"><p id="boot-status"></p></main><script>
  window.monkyGame=${config};
  const en=window.monkyScreen.viewer.locale==='en';
  const status=document.getElementById('boot-status');
  status.textContent=en?'Connecting to game service...':'Conectando ao serviço de jogos...';
  if(typeof RTCPeerConnection!=='function'||!crypto.subtle){
    status.textContent=en?'Update Monky to a version supporting web miniapps.':'Atualize o Monky para uma versão com suporte a miniapps web.';
  }else{
    const script=document.createElement('script');
    script.src=window.monkyGame.base+'/games/app.js';
    script.onerror=()=>{status.textContent=en?'Cannot reach the game service. Check its public URL, port and firewall.':'Não foi possível acessar o serviço de jogos. Verifique a URL pública, porta e firewall.';};
    document.head.append(script);
  }
  </script>`;
}

function defaultService(): GamesService {
  const port = Number(process.env.MONKY_GAMES_PORT ?? '7781');
  const host = process.env.MONKY_GAMES_HOST ?? process.env.MONKY_SERVE_HOST ?? '0.0.0.0';
  const publicHost = process.env.MONKY_SERVE_PUBLIC_HOST ?? 'localhost';
  const hostname = publicHost.includes(':') && !publicHost.startsWith('[') ? `[${publicHost}]` : publicHost;
  return new GamesService({
    host, port, publicUrl: process.env.MONKY_GAMES_PUBLIC_URL ?? `http://${hostname}:${port}`,
  });
}

interface Active {
  serverId: string;
  room: GameRoom;
  screen: BotScreen;
  timer: ReturnType<typeof setTimeout>;
}

export function registerGames(bot: BotClient, service = defaultService(), lifetime = 30 * 60_000): () => Promise<void> {
  const active = new Map<string, Active>();
  const creating = new Set<Promise<void>>();
  const pending = new Set<{ serverId: string; id: string; cancelled: boolean; overflow: boolean; removed: Set<string> }>();
  let disposed = false;
  let disposal: Promise<void> | undefined;
  const key = (serverId: string, instanceId: string): string => JSON.stringify([serverId, instanceId]);
  const release = (entry: Active): boolean => {
    if (active.get(key(entry.serverId, entry.screen.instanceId)) !== entry) return false;
    active.delete(key(entry.serverId, entry.screen.instanceId));
    clearTimeout(entry.timer);
    service.remove(entry.room);
    return true;
  };
  const closeScreen = async (serverId: string, screen: BotScreen): Promise<void> => {
    try { await bot.closeScreen(serverId, screen); }
    catch (error: unknown) { console.error('[games] Could not confirm miniapp closure.', errorDiagnostic(error)); }
  };
  const close = async (entry: Active): Promise<void> => {
    if (release(entry)) await closeScreen(entry.serverId, entry.screen);
  };
  for (const game of ['doom', 'nes'] as const) bot.command({
    ...gameDefinitions[game],
    handler: async ctx => {
      if (disposed || ctx.signal.aborted) return;
      if (active.size + pending.size >= 16) {
        ctx.reply(message(ctx.locale, 'Encerre uma partida antes de abrir outra.', 'End a game before opening another one.'));
        return;
      }
      const tracker = { serverId: ctx.serverId, id: ctx.invocationId, cancelled: false, overflow: false, removed: new Set<string>() };
      pending.add(tracker);
      const operation = Promise.resolve().then(async () => {
        let room: GameRoom | undefined;
        try {
          const base = await service.start();
          if (disposed || ctx.signal.aborted || tracker.cancelled) return;
          room = service.create(game, ctx.invokerId);
          const screen = await ctx.createScreen({
            id: ctx.invocationId, title: game === 'doom' ? 'DOOM / Freedoom' : 'NES',
            html: gamesHtml(base, room), state: { game },
          });
          if (screen.id !== tracker.id || !screen.instanceId || !screen.channelId || screen.revision !== 0) {
            throw new Error('Unexpected game creation acknowledgement.');
          }
          if (tracker.removed.has(JSON.stringify([screen.instanceId, screen.channelId])) || tracker.cancelled) { service.remove(room); return; }
          if (disposed || ctx.signal.aborted || tracker.overflow) {
            service.remove(room);
            await closeScreen(ctx.serverId, screen);
            return;
          }
          const entry: Active = {
            serverId: ctx.serverId, room, screen,
            timer: setTimeout(() => { void close(entry); }, lifetime),
          };
          entry.timer.unref();
          active.set(key(ctx.serverId, screen.instanceId), entry);
          ctx.reply(message(ctx.locale,
            'Abra o miniapp no palco de voz. Seu amigo pode entrar como jogador 2; os demais podem assistir. A sessão expira em 30 minutos.',
            'Open the miniapp on the voice stage. Your friend can join as player 2; others can watch. The session expires in 30 minutes.'));
        } catch (error: unknown) {
          if (room) service.remove(room);
          console.error('[games] Could not create game.', errorDiagnostic(error));
          if (!disposed && !ctx.signal.aborted && !tracker.cancelled) ctx.reply(message(ctx.locale,
            'Não foi possível abrir o jogo. Verifique os arquivos do bot, a porta MONKY_GAMES_PORT e o acesso à sala de voz.',
            'Could not open the game. Check the bot assets, MONKY_GAMES_PORT and voice room access.'));
        } finally { pending.delete(tracker); }
      });
      creating.add(operation);
      try { await operation; } finally { creating.delete(operation); }
    },
  });
  const action = (event: BotScreenActionEvent & { serverId: string }): void => {
    const entry = active.get(key(event.serverId, event.instanceId));
    if (disposed || !entry || event.screenId !== entry.screen.id || event.channelId !== entry.screen.channelId ||
        event.action !== 'connect' || event.revision !== entry.screen.revision) return;
    const payload = event.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof payload.key !== 'string') return;
    try { service.authorize(entry.room, payload.key, event.userId, event.userNickname); }
    catch (error: unknown) { console.warn('[games] Game authorization rejected.', errorDiagnostic(error)); }
  };
  const removed = (event: BotScreenRemoved & { serverId: string }): void => {
    if (event.reason === 'view_revoked') return;
    const entry = active.get(key(event.serverId, event.instanceId));
    if (entry?.screen.id === event.id && entry.screen.channelId === event.channelId) release(entry);
    for (const tracker of pending) {
      if (tracker.serverId !== event.serverId || tracker.id !== event.id) continue;
      if (tracker.removed.size < 32) tracker.removed.add(JSON.stringify([event.instanceId, event.channelId]));
      else tracker.overflow = true;
    }
  };
  const disconnected = ({ serverId }: { serverId: string }): void => {
    for (const entry of active.values()) if (entry.serverId === serverId) release(entry);
    for (const tracker of pending) if (tracker.serverId === serverId) tracker.cancelled = true;
  };
  const closed = (): void => { void dispose().catch(error => console.error('[games] Shutdown failed.', errorDiagnostic(error))); };
  const dispose = (): Promise<void> => {
    if (disposal) return disposal;
    disposed = true;
    bot.off('screenAction', action);
    bot.off('closed', closed);
    disposal = (async () => {
      try {
        await Promise.all(creating);
        await Promise.all([...active.values()].map(close));
        await service.close();
      } finally {
        bot.off('screenRemoved', removed);
        bot.off('disconnected', disconnected);
      }
    })();
    return disposal;
  };
  bot.on('screenAction', action);
  bot.on('screenRemoved', removed);
  bot.on('disconnected', disconnected);
  bot.once('closed', closed);
  return dispose;
}
