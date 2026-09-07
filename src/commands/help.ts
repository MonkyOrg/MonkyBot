import { CommandDefinition } from '@monky/bot-sdk';

export const helpCommand: CommandDefinition = {
  name: 'ajuda',
  description: 'Lista todos os comandos disponíveis do Monky Bot.',
  handler: (ctx) => {
    const commands = [
      { name: '/ping', desc: 'Responde com pong e mostra a latência' },
      { name: '/dado [lados]', desc: 'Rola um dado (padrão: 6 lados)' },
      { name: '/moeda', desc: 'Cara ou coroa' },
      { name: '/8ball <pergunta>', desc: 'A bola mágica responde' },
      { name: '/enquete <pergunta> [opções]', desc: 'Cria uma enquete rápida' },
      { name: '/ajuda', desc: 'Mostra esta mensagem' },
    ];

    const lines = commands.map((c) => `**${c.name}** — ${c.desc}`);
    ctx.reply(`🤖 **Monky Bot — Comandos**\n\n${lines.join('\n')}`);
  },
};
