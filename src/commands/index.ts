import type { BotClient, CommandDefinition } from '@monky/bot-sdk';
import { pingCommand } from './ping';
import { diceCommand } from './dice';
import { coinCommand } from './coin';
import { eightBallCommand } from './eightball';
import { pollCommand, registerPollCommand } from './poll';
import { helpCommand } from './help';
import { musicDefinitions, registerMusicCommands } from './music';
import { ticTacToeDefinition, registerTicTacToe } from './ticTacToe';

const basicCommands: readonly CommandDefinition[] = [
  pingCommand, diceCommand, coinCommand, eightBallCommand, pollCommand, helpCommand,
];
export const commands: readonly Omit<CommandDefinition, 'handler'>[] = [
  ...basicCommands, ...musicDefinitions, ticTacToeDefinition,
];

export function registerAllCommands(bot: BotClient): () => Promise<void> {
  for (const command of basicCommands) {
    if (command !== pollCommand) bot.command(command);
  }
  const disposePoll = registerPollCommand(bot);
  const disposeMusic = registerMusicCommands(bot);
  const disposeGames = registerTicTacToe(bot);
  console.log(`📋 ${commands.length} comandos registrados.`);
  return async () => {
    disposePoll();
    await Promise.all([disposeMusic(), disposeGames()]);
  };
}
