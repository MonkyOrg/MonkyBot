import type { CommandDefinition } from '@monky/bot-sdk';
import { translate } from './i18n';

export const diceCommand: CommandDefinition = {
  name: 'dado',
  description: 'Rola um dado. Padrão: 6 lados.',
  options: [
    {
      name: 'lados',
      description: 'Número de lados do dado (padrão: 6)',
      type: 'integer',
      required: false,
      min: 2,
      max: 100,
    },
  ],
  handler: (ctx) => {
    if (ctx.signal.aborted) return;
    const sides = ctx.args.lados ?? 6;
    if (typeof sides !== 'number' || !Number.isInteger(sides) || sides < 2 || sides > 100) {
      ctx.reply(translate(ctx.locale,
        '⚠️ Escolha um número inteiro de lados entre 2 e 100.',
        '⚠️ Choose a whole number of sides between 2 and 100.'));
      return;
    }
    const result = Math.floor(Math.random() * sides) + 1;
    ctx.reply(translate(ctx.locale,
      `🎲 Rolando d${sides}... **${result}**!`,
      `🎲 Rolling d${sides}... **${result}**!`));
  },
};
