import type { CommandDefinition } from '@monky/bot-sdk';
import { translate } from './i18n';

export const helpCommand: CommandDefinition = {
  name: 'ajuda',
  description: 'Lista todos os comandos disponíveis do MonkyBot.',
  handler: (ctx) => {
    if (ctx.signal.aborted) return;
    const commands = [
      { name: '/ping', desc: translate(ctx.locale, 'Verifica se o bot está online', 'Check whether the bot is online') },
      { name: '/dado [lados]', desc: translate(ctx.locale, 'Rola um dado de 2 a 100 lados (padrão: 6)', 'Roll a die with 2–100 sides (default: 6)') },
      { name: '/moeda', desc: translate(ctx.locale, 'Cara ou coroa', 'Heads or tails') },
      { name: '/8ball [pergunta]', desc: translate(ctx.locale, 'Pergunte à bola mágica, por texto ou formulário', 'Ask the magic ball using text or a form') },
      { name: '/enquete', desc: translate(ctx.locale, 'Cria uma enquete com um assistente privado', 'Create a poll with a private wizard') },
      { name: '/ajuda', desc: translate(ctx.locale, 'Mostra esta mensagem', 'Show this message') },
    ];

    const lines = commands.map((c) => `**${c.name}** — ${c.desc}`);
    const title = translate(ctx.locale, 'MonkyBot — Comandos', 'MonkyBot — Commands');
    const privacy = translate(ctx.locale,
      'As respostas são privadas. A enquete só é publicada no canal se você escolher essa opção e confirmar.',
      'Replies are private. A poll is only published to the channel if you choose that option and confirm.');
    ctx.reply(`🤖 **${title}**\n\n${lines.join('\n')}\n\n${privacy}`);
  },
};
