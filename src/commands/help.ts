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
      { name: '/8ball <pergunta>', desc: translate(ctx.locale, 'Pergunte à bola mágica (pergunta obrigatória)', 'Ask the magic ball (question required)') },
      { name: '/enquete', desc: translate(ctx.locale, 'Publica uma enquete com votos e encerramento automático', 'Publish a poll with voting and automatic closing') },
      { name: '/ajuda', desc: translate(ctx.locale, 'Mostra esta mensagem', 'Show this message') },
    ];

    const lines = commands.map((c) => `**${c.name}** — ${c.desc}`);
    const title = translate(ctx.locale, 'MonkyBot — Comandos', 'MonkyBot — Commands');
    const privacy = translate(ctx.locale,
      'As respostas são privadas. Ao enviar o formulário de enquete, a votação é publicada no canal; o resultado aparece ao encerrar.',
      'Replies are private. Submitting the poll form publishes voting to the channel; results appear when voting closes.');
    ctx.reply(`🤖 **${title}**\n\n${lines.join('\n')}\n\n${privacy}`);
  },
};
