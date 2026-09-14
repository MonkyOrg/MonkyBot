import { translate, type LocalizedCommandDefinition } from './i18n';

export const coinCommand: LocalizedCommandDefinition = {
  name: 'moeda',
  description: 'Joga uma moeda — cara ou coroa.',
  localizations: { en: { description: 'Flip a coin — heads or tails.' } },
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
