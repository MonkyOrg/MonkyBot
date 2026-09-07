import { CommandDefinition } from '@monky/bot-sdk';

export const diceCommand: CommandDefinition = {
  name: 'dado',
  description: 'Rola um dado. Padrão: 6 lados.',
  options: [
    {
      name: 'lados',
      description: 'Número de lados do dado (padrão: 6)',
      type: 'string',
      required: false,
    },
  ],
  handler: (ctx) => {
    const sides = Math.max(2, Math.min(100, parseInt(ctx.args.lados, 10) || 6));
    const result = Math.floor(Math.random() * sides) + 1;
    ctx.reply(`🎲 Rolando d${sides}... **${result}**!`);
  },
};
