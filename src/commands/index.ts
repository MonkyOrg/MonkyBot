import type { BotClient, CommandDefinition } from '@monky/bot-sdk';
import { pingCommand } from './ping';
import { diceCommand } from './dice';
import { coinCommand } from './coin';
import { eightBallCommand } from './eightball';
import { pollCommand } from './poll';
import { helpCommand } from './help';

export const commands: readonly CommandDefinition[] = [
  pingCommand, diceCommand, coinCommand, eightBallCommand, pollCommand, helpCommand,
];

export function registerAllCommands(bot: BotClient): void {
  for (const command of commands) bot.command(command);
  console.log(`📋 ${commands.length} comandos registrados.`);
}
