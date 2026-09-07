import type { CommandDefinition } from '@monky/bot-sdk';
import { translate } from './i18n';

export const pingCommand: CommandDefinition = {
  name: 'ping',
  description: 'Verifica se o bot está respondendo.',
  handler: (ctx) => {
    if (ctx.signal.aborted) return;
    ctx.reply(translate(ctx.locale,
      '🏓 **Pong!** MonkyBot está online.',
      '🏓 **Pong!** MonkyBot is online.'));
  },
};
