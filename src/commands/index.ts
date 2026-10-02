import type { BotCapability, BotClient, CommandDefinition } from '@monky/bot-sdk';
import { pingCommand } from './ping';
import { diceCommand } from './dice';
import { coinCommand } from './coin';
import { eightBallCommand } from './eightball';
import { giveawayCommand, registerScheduledCommands, reminderCommand } from './scheduled';
import { helpCommand } from './help';
import { musicDefinitions, registerMusicCommands } from './music';
import { ticTacToeDefinition, registerTicTacToe } from './ticTacToe';
import { gameDefinitions, registerGames } from './games';
import { cliText } from '../cli/i18n';

const basicCommands: readonly CommandDefinition[] = [
  pingCommand, diceCommand, coinCommand, eightBallCommand, reminderCommand, giveawayCommand, helpCommand,
];
export const requestedCapabilities: BotCapability[] = [
  'commands', 'send_messages', 'publish_voice', 'local_execution', 'miniapps', 'live_actions',
];
export const commands: readonly Omit<CommandDefinition, 'handler'>[] = [
  ...basicCommands, ...musicDefinitions, ticTacToeDefinition, ...Object.values(gameDefinitions),
];

export function registerAllCommands(bot: BotClient): () => Promise<void> {
  for (const command of basicCommands) {
    if (command !== reminderCommand && command !== giveawayCommand) bot.command(command);
  }
  const disposeScheduled = registerScheduledCommands(bot);
  const disposeMusic = registerMusicCommands(bot);
  const disposeGames = registerTicTacToe(bot);
  const disposeLibrary = registerGames(bot);
  console.log(cliText(`📋 ${commands.length} comandos registrados.`, `📋 ${commands.length} commands registered.`));
  return async () => {
    await Promise.all([disposeScheduled(), disposeMusic(), disposeGames(), disposeLibrary()]);
  };
}
