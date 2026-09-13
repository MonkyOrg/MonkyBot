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
      { name: '/play <busca>', desc: translate(ctx.locale, 'Busca por nome ou link, prévia privada e seleção para adicionar à fila', 'Search by name or URL, preview privately, then select to add to queue') },
      { name: '/queue · /nowplaying', desc: translate(ctx.locale, 'Consulta fila e reprodução atual', 'Show queue and current playback') },
      { name: '/pause · /resume · /skip', desc: translate(ctx.locale, 'Pausa, retoma na mesma posição ou pula', 'Pause, resume from the same position, or skip') },
      { name: '/stop · /leave', desc: translate(ctx.locale, 'Para e limpa; /leave também desconecta', 'Stop and clear; /leave also disconnects') },
      { name: '/remove <position> · /clear', desc: translate(ctx.locale, 'Remove uma posição ou todas as próximas faixas', 'Remove an upcoming position or all upcoming tracks') },
      { name: '/jogo-da-velha', desc: translate(ctx.locale, 'Miniapp no palco de voz para 2 jogadores e espectadores', 'Voice-stage miniapp for 2 players and spectators') },
      { name: '/ajuda', desc: translate(ctx.locale, 'Mostra esta mensagem', 'Show this message') },
    ];

    const lines = commands.map((c) => `**${c.name}** — ${c.desc}`);
    const title = translate(ctx.locale, 'MonkyBot — Comandos', 'MonkyBot — Commands');
    const privacy = translate(ctx.locale,
      'As respostas são privadas. Ao enviar o formulário de enquete, a votação é publicada no canal; o resultado aparece ao encerrar. Música exige estar em voz, inclusive busca, prévia e consultas; se o bot estiver em outra sala, entre nela. O jogo aparece por convite no palco, somente para quem está na mesma sala de voz.',
      'Replies are private. Submitting the poll form publishes voting to the channel; results appear when voting closes. Music requires voice membership, including search, preview and queue queries; if the bot is in another room, join it. The game opens by invitation on the stage, only for people in the same voice room.');
    ctx.reply(`🤖 **${title}**\n\n${lines.join('\n')}\n\n${privacy}`);
  },
};
