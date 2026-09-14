import type { BotClient, BotScreenRef, BotScreenRemoved } from '@monky/bot-sdk';
import { gameAction, newGame, ticTacToeHtml, type GameState } from '../screens/ticTacToe';
import { translate, type LocalizedCommandDefinition } from './i18n';
import { cliText } from '../cli/i18n';
import { errorDiagnostic } from '../music/process';

export const ticTacToeDefinition: Omit<LocalizedCommandDefinition, 'handler'> = {
  name: 'jogo-da-velha',
  description: 'Abre um jogo da velha na sua sala de voz; duas pessoas jogam e as outras assistem.',
  localizations: { 'pt-BR': { name: 'jogo-da-velha' }, en: {
    name: 'tic-tac-toe',
    description: 'Open tic-tac-toe in your voice room; two people play and others watch.',
  } },
  voiceRequirement: 'joined',
};

interface Game {
  serverId: string;
  channelId: string;
  ref: BotScreenRef;
  state: GameState | undefined;
  revision: number;
  tail: Promise<void>;
  timer: ReturnType<typeof setTimeout>;
  pending: number;
  closed: boolean;
  actions: Set<string>;
}
interface ScreenAction {
  serverId: string;
  channelId: string;
  screenId: string;
  instanceId: string;
  userId: string;
  userNickname: string;
  action: string;
  payload: unknown;
  revision: number;
  actionId: string;
}
interface PendingScreen {
  serverId: string;
  id: string;
  disconnected: boolean;
  removals: Set<string>;
  overflow: boolean;
}
const MAX_PENDING_REMOVALS = 32;

function screenState(state: GameState) {
  return { ...state, players: state.players.map((player) => ({ ...player })) };
}

export function registerTicTacToe(bot: BotClient, lifetimeMs = 30 * 60_000): () => Promise<void> {
  const games = new Map<string, Game>();
  const creating = new Set<Promise<void>>();
  const pending = new Map<string, number>();
  const pendingScreens = new Set<PendingScreen>();
  let disposed = false;
  let disposal: Promise<void> | undefined;
  const keyOf = (serverId: string, ref: BotScreenRef): string => JSON.stringify([serverId, ref.id, ref.instanceId]);
  const removalKey = (screen: { instanceId: string; channelId: string }): string =>
    JSON.stringify([screen.instanceId, screen.channelId]);
  const release = (game: Game): boolean => {
    if (game.closed) return false;
    game.closed = true;
    clearTimeout(game.timer);
    game.state = undefined;
    game.actions.clear();
    const key = keyOf(game.serverId, game.ref);
    if (games.get(key) === game) games.delete(key);
    return true;
  };
  const closeRef = async (serverId: string, ref: BotScreenRef): Promise<void> => {
    try { await bot.closeScreen(serverId, ref); }
    catch (error: unknown) {
      console.error(`[screens] ${cliText('Não foi possível confirmar o encerramento do jogo.', 'Could not confirm game closure.')} ${errorDiagnostic(error)}`);
    }
  };
  const close = async (game: Game): Promise<void> => {
    if (release(game)) await closeRef(game.serverId, game.ref);
  };
  bot.command({
    ...ticTacToeDefinition,
    handler: async (ctx) => {
      if (ctx.signal.aborted || disposed) return;
      const count = [...games.values()].filter((game) => game.serverId === ctx.serverId).length + (pending.get(ctx.serverId) ?? 0);
      if (count >= 16 || games.size + creating.size >= 128) {
        ctx.reply(translate(ctx.locale, 'Limite de jogos ativos atingido. Aguarde o encerramento de um jogo.', 'Active game limit reached. Wait for a game to close.'));
        return;
      }
      pending.set(ctx.serverId, (pending.get(ctx.serverId) ?? 0) + 1);
      const pendingScreen: PendingScreen = {
        serverId: ctx.serverId, id: ctx.invocationId, disconnected: false, removals: new Set(), overflow: false,
      };
      pendingScreens.add(pendingScreen);
      // Track the promise before invoking SDK/user callbacks that can synchronously close the bot.
      const create = Promise.resolve().then(async () => {
        try {
          if (disposed || ctx.signal.aborted || pendingScreen.disconnected) return;
          const state = newGame({ id: ctx.invokerId, nickname: ctx.invokerNickname.slice(0, 80) }, ctx.locale);
          const screen = await ctx.createScreen({
            id: ctx.invocationId,
            title: translate(ctx.locale, 'Jogo da velha', 'Tic-tac-toe'),
            html: ticTacToeHtml,
            state: screenState(state),
          });
          if (screen.id !== pendingScreen.id || !screen.instanceId) throw new Error('Unexpected game creation acknowledgement.');
          if (pendingScreen.disconnected || pendingScreen.removals.has(removalKey(screen))) return;
          const ref: BotScreenRef = { id: screen.id, instanceId: screen.instanceId };
          if (disposed || ctx.signal.aborted) {
            await closeRef(ctx.serverId, ref);
            return;
          }
          if (pendingScreen.overflow) {
            await closeRef(ctx.serverId, ref);
            throw new Error('Pending game removal tracking exceeded its limit.');
          }
          const key = keyOf(ctx.serverId, ref);
          if (games.has(key)) throw new Error('Duplicate game instance acknowledgement.');
          const game: Game = {
            serverId: ctx.serverId, channelId: screen.channelId, ref,
            state, revision: screen.revision, tail: Promise.resolve(), closed: false, pending: 0, actions: new Set(),
            timer: setTimeout(() => { void close(game); }, lifetimeMs),
          };
          game.timer.unref();
          games.set(key, game);
          if (!ctx.signal.aborted) ctx.reply(translate(ctx.locale,
            '🎮 Jogo criado na sua sala de voz! Use o convite para abrir no palco. Você é X; outra pessoa pode entrar como O. Expira em 30 minutos.',
            '🎮 Game created in your voice room! Use the invitation to open it on the stage. You are X; another person can join as O. Expires in 30 minutes.'));
        } catch (error: unknown) {
          if (ctx.signal.aborted || disposed || pendingScreen.disconnected) return;
          console.error(`[screens] ${cliText('Não foi possível criar um jogo ativo.', 'Could not create an active game.')} ${errorDiagnostic(error)}`);
          ctx.reply(translate(ctx.locale, 'Não foi possível abrir o jogo. Verifique o acesso ao canal e os limites de telas.', 'Could not open the game. Check channel access and screen limits.'));
        } finally {
          pendingScreens.delete(pendingScreen);
          pendingScreen.removals.clear();
          const remaining = (pending.get(ctx.serverId) ?? 1) - 1;
          if (remaining) pending.set(ctx.serverId, remaining);
          else pending.delete(ctx.serverId);
        }
      });
      creating.add(create);
      try { await create; } finally { creating.delete(create); }
    },
  });
  const onAction = (event: ScreenAction): void => {
    const game = games.get(keyOf(event.serverId, { id: event.screenId, instanceId: event.instanceId }));
    if (disposed || !game || game.closed || game.channelId !== event.channelId || game.pending >= 16) return;
    game.pending++;
    game.tail = game.tail.then(async () => {
      if (game.closed || disposed || !game.state || game.actions.has(event.actionId) || game.revision !== event.revision) return;
      const state = gameAction(game.state, { ...event, revision: game.state.revision });
      if (!state) return;
      const updated = await bot.updateScreen(event.serverId, game.ref, {
        state: screenState(state), expectedRevision: game.revision,
      });
      if (game.closed || disposed || games.get(keyOf(game.serverId, game.ref)) !== game) return;
      if (updated.id !== game.ref.id || updated.instanceId !== game.ref.instanceId || updated.channelId !== game.channelId) {
        throw new Error('Unexpected game update acknowledgement.');
      }
      game.state = state;
      game.revision = updated.revision;
      game.actions.add(event.actionId);
    }).catch(async (error: unknown) => {
      if (game.closed) return;
      // Unknown acknowledgement state cannot safely accept another move.
      console.error(`[screens] ${cliText('Não foi possível confirmar a atualização; encerrando o jogo.',
        'Could not confirm the game update; closing the game.')} ${errorDiagnostic(error)}`);
      await close(game);
    }).finally(() => { game.pending--; });
  };
  const onRemoved = (event: BotScreenRemoved & { serverId: string }): void => {
    if (event.reason === 'view_revoked') return;
    const game = games.get(keyOf(event.serverId, event));
    if (game?.channelId === event.channelId) release(game);
    for (const pendingScreen of pendingScreens) {
      if (pendingScreen.serverId !== event.serverId || pendingScreen.id !== event.id) continue;
      const key = removalKey(event);
      if (pendingScreen.removals.has(key)) continue;
      if (pendingScreen.removals.size < MAX_PENDING_REMOVALS) pendingScreen.removals.add(key);
      else pendingScreen.overflow = true;
    }
  };
  const onDisconnected = ({ serverId }: { serverId: string }): void => {
    for (const game of games.values()) if (game.serverId === serverId) release(game);
    for (const pendingScreen of pendingScreens) {
      if (pendingScreen.serverId === serverId) pendingScreen.disconnected = true;
    }
  };
  const onClosed = (): void => { void dispose(); };
  const dispose = (): Promise<void> => {
    if (disposal) return disposal;
    disposed = true;
    bot.off('screenAction', onAction);
    bot.off('closed', onClosed);
    disposal = (async () => {
      try {
        await Promise.all([...creating]);
        const active = [...games.values()];
        await Promise.all(active.map((game) => close(game)));
        await Promise.all(active.map((game) => game.tail));
      } finally {
        bot.off('screenRemoved', onRemoved);
        bot.off('disconnected', onDisconnected);
      }
    })();
    return disposal;
  };
  bot.on('screenAction', onAction);
  bot.on('screenRemoved', onRemoved);
  bot.on('disconnected', onDisconnected);
  bot.once('closed', onClosed);
  return dispose;
}
