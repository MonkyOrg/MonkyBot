import type { BotClient, BotScreenRemoved } from '@monky/bot-sdk';
import { gameAction, newGame, ticTacToeHtml, type GameState } from '../screens/ticTacToe';
import { translate, type LocalizedCommandDefinition } from './i18n';
import { cliText } from '../cli/i18n';

export const ticTacToeDefinition: Omit<LocalizedCommandDefinition, 'handler'> = {
  name: 'jogo-da-velha',
  description: 'Abre um jogo da velha na sua sala de voz; duas pessoas jogam e as outras assistem.',
  localizations: { en: {
    description: 'Open tic-tac-toe in your voice room; two people play and others watch.',
  } },
  voiceRequirement: 'joined',
};

interface Game {
  serverId: string;
  channelId: string;
  screenId: string;
  state: GameState;
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
  userId: string;
  userNickname: string;
  action: string;
  payload: unknown;
  revision: number;
  actionId: string;
}
function screenState(state: GameState) {
  return { ...state, players: state.players.map((player) => ({ ...player })) };
}

export function registerTicTacToe(bot: BotClient, lifetimeMs = 30 * 60_000): () => Promise<void> {
  const games = new Map<string, Game>();
  const creating = new Set<Promise<void>>();
  const pending = new Map<string, number>();
  const pendingScreens = new Map<string, { serverId: string; removed: boolean }>();
  let disposed = false;
  let disposal: Promise<void> | undefined;
  const keyOf = (serverId: string, screenId: string): string => JSON.stringify([serverId, screenId]);
  const release = (game: Game): boolean => {
    if (game.closed) return false;
    game.closed = true;
    clearTimeout(game.timer);
    games.delete(keyOf(game.serverId, game.screenId));
    return true;
  };
  const close = async (game: Game): Promise<void> => {
    if (!release(game)) return;
    try { await bot.closeScreen(game.serverId, game.screenId); }
    catch { console.error(`[screens] ${cliText('Não foi possível confirmar o encerramento do jogo.', 'Could not confirm game closure.')}`); }
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
      const pendingKey = keyOf(ctx.serverId, ctx.invocationId);
      const pendingScreen = { serverId: ctx.serverId, removed: false };
      pendingScreens.set(pendingKey, pendingScreen);
      const create = (async () => {
        try {
          const state = newGame({ id: ctx.invokerId, nickname: ctx.invokerNickname.slice(0, 80) }, ctx.locale);
          const screen = await ctx.createScreen({
            id: ctx.invocationId,
            title: translate(ctx.locale, 'Jogo da velha', 'Tic-tac-toe'),
            html: ticTacToeHtml,
            state: screenState(state),
          });
          if (pendingScreen.removed) throw new Error('Game removed during creation.');
          if (disposed || ctx.signal.aborted) {
            await bot.closeScreen(ctx.serverId, screen.id);
            return;
          }
          const game: Game = {
            serverId: ctx.serverId, channelId: screen.channelId, screenId: screen.id,
            state, revision: screen.revision, tail: Promise.resolve(), closed: false, pending: 0, actions: new Set(),
            timer: setTimeout(() => { void close(game); }, lifetimeMs),
          };
          game.timer.unref();
          games.set(keyOf(game.serverId, game.screenId), game);
          if (!ctx.signal.aborted) ctx.reply(translate(ctx.locale,
            '🎮 Jogo criado na sua sala de voz! Use o convite para abrir no palco. Você é X; outra pessoa pode entrar como O. Expira em 30 minutos.',
            '🎮 Game created in your voice room! Use the invitation to open it on the stage. You are X; another person can join as O. Expires in 30 minutes.'));
        } catch {
          console.error(`[screens] ${cliText('Não foi possível criar um jogo ativo.', 'Could not create an active game.')}`);
          if (!ctx.signal.aborted) ctx.reply(translate(ctx.locale, 'Não foi possível abrir o jogo. Verifique o acesso ao canal e os limites de telas.', 'Could not open the game. Check channel access and screen limits.'));
        } finally {
          pendingScreens.delete(pendingKey);
          const remaining = (pending.get(ctx.serverId) ?? 1) - 1;
          if (remaining) pending.set(ctx.serverId, remaining);
          else pending.delete(ctx.serverId);
        }
      })();
      creating.add(create);
      try { await create; } finally { creating.delete(create); }
    },
  });
  const onAction = (event: ScreenAction): void => {
    const game = games.get(keyOf(event.serverId, event.screenId));
    if (disposed || !game || game.closed || game.channelId !== event.channelId || game.pending >= 16) return;
    game.pending++;
    game.tail = game.tail.then(async () => {
      if (game.closed || disposed || game.actions.has(event.actionId) || game.revision !== event.revision) return;
      const state = gameAction(game.state, { ...event, revision: game.state.revision });
      if (!state) return;
      const updated = await bot.updateScreen(event.serverId, event.screenId, {
        state: screenState(state), expectedRevision: game.revision,
      });
      if (game.closed) return;
      game.state = state;
      game.revision = updated.revision;
      game.actions.add(event.actionId);
    }).catch(async () => {
      if (game.closed) return;
      // Unknown acknowledgement state cannot safely accept another move.
      console.error(`[screens] ${cliText('Não foi possível confirmar a atualização; encerrando o jogo.',
        'Could not confirm the game update; closing the game.')}`);
      await close(game);
    }).finally(() => { game.pending--; });
  };
  const onRemoved = (event: BotScreenRemoved & { serverId: string }): void => {
    const key = keyOf(event.serverId, event.id);
    const game = games.get(key);
    if (game?.channelId === event.channelId) release(game);
    const pendingScreen = pendingScreens.get(key);
    if (pendingScreen) pendingScreen.removed = true;
  };
  const onDisconnected = ({ serverId }: { serverId: string }): void => {
    for (const game of games.values()) if (game.serverId === serverId) release(game);
    for (const pendingScreen of pendingScreens.values()) {
      if (pendingScreen.serverId === serverId) pendingScreen.removed = true;
    }
  };
  const onClosed = (): void => { void dispose(); };
  const dispose = (): Promise<void> => {
    if (disposal) return disposal;
    disposed = true;
    bot.off('screenAction', onAction);
    bot.off('screenRemoved', onRemoved);
    bot.off('disconnected', onDisconnected);
    bot.off('closed', onClosed);
    disposal = (async () => {
      await Promise.all([...creating]);
      const active = [...games.values()];
      await Promise.all(active.map((game) => close(game)));
      await Promise.all(active.map((game) => game.tail));
    })();
    return disposal;
  };
  bot.on('screenAction', onAction);
  bot.on('screenRemoved', onRemoved);
  bot.on('disconnected', onDisconnected);
  bot.once('closed', onClosed);
  return dispose;
}
