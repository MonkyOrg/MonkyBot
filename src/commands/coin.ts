import type { CommandDefinition } from '@monky/bot-sdk';
import { translate } from './i18n';

export const coinCommand: CommandDefinition = {
  name: 'moeda',
  description: 'Joga uma moeda — cara ou coroa.',
  handler: (ctx) => {
    if (ctx.signal.aborted) return;
    const heads = Math.random() < 0.5;
    const result = heads
      ? translate(ctx.locale, 'Cara', 'Heads')
      : translate(ctx.locale, 'Coroa', 'Tails');
    const emoji = heads ? '🪙' : '👑';
    ctx.reply(`${emoji} **${result}!**`);
  },
};
