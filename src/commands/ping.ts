import { translate, type LocalizedCommandDefinition } from './i18n';

export const pingCommand: LocalizedCommandDefinition = {
  name: 'ping',
  description: 'Verifica se o bot está respondendo.',
  localizations: {
    'pt-BR': { name: 'ping' },
    en: { name: 'ping', description: 'Check whether the bot is responding.' },
  },
  handler: (ctx) => {
    if (ctx.signal.aborted) return;
    ctx.reply(translate(ctx.locale,
      '🏓 **Pong!** MonkyBot está online.',
      '🏓 **Pong!** MonkyBot is online.'));
  },
};
