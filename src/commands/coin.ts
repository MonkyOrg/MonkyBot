import { CommandDefinition } from '@monky/bot-sdk';

export const coinCommand: CommandDefinition = {
  name: 'moeda',
  description: 'Joga uma moeda — cara ou coroa.',
  handler: (ctx) => {
    const result = Math.random() < 0.5 ? 'Cara' : 'Coroa';
    const emoji = result === 'Cara' ? '🪙' : '👑';
    ctx.reply(`${emoji} **${result}!**`);
  },
};
