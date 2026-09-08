import type { BotClient, CommandDefinition } from '@monky/bot-sdk';
import { pingCommand } from './ping';
import { diceCommand } from './dice';
import { coinCommand } from './coin';
import { eightBallCommand } from './eightball';
import { pollCommand, registerPollCommand } from './poll';
import { helpCommand } from './help';

export const commands: readonly CommandDefinition[] = [
  pingCommand, diceCommand, coinCommand, eightBallCommand, pollCommand, helpCommand,
];

export function registerAllCommands(bot: BotClient): () => void {
  for (const command of commands) {
    if (command !== pollCommand) bot.command(command);
  }
  const dispose = registerPollCommand(bot);
  console.log(`📋 ${commands.length} comandos registrados.`);
  return dispose;
}
