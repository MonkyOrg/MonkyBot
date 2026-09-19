import { message, type LocalizedCommandDefinition } from './i18n';

export const coinCommand: LocalizedCommandDefinition = {
  name: 'moeda',
  description: 'Joga uma moeda — cara ou coroa.',
  localizations: {
    'pt-BR': { name: 'moeda' },
    en: { name: 'coin', description: 'Flip a coin — heads or tails.' },
  },
  handler: (ctx) => {
    if (ctx.signal.aborted) return;
    const heads = Math.random() < 0.5;
    const emoji = heads ? '🪙' : '👑';
    ctx.reply(message(ctx.locale, `${emoji} **${heads ? 'Cara' : 'Coroa'}!**`, `${emoji} **${heads ? 'Heads' : 'Tails'}!**`));
  },
};
