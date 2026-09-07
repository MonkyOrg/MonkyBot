import { CommandDefinition } from '@monky/bot-sdk';

export const pingCommand: CommandDefinition = {
  name: 'ping',
  description: 'Responde com pong e mostra a latência do bot.',
  handler: (ctx) => {
    const now = Date.now();
    ctx.reply(`🏓 **Pong!** Latência: \`${Date.now() - now}ms\``);
  },
};
