import { MonkyBot } from '@monky/bot-sdk';
import { pingCommand } from './ping';
import { diceCommand } from './dice';
import { coinCommand } from './coin';
import { eightBallCommand } from './eightball';
import { pollCommand } from './poll';
import { helpCommand } from './help';

/**
 * Registers all bot commands on the given MonkyBot instance.
 */
export function registerAllCommands(bot: MonkyBot): void {
  bot.command(pingCommand);
  bot.command(diceCommand);
  bot.command(coinCommand);
  bot.command(eightBallCommand);
  bot.command(pollCommand);
  bot.command(helpCommand);

  console.log(`📋 ${6} comandos registrados.`);
}
