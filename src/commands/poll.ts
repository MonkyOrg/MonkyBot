import { CommandDefinition } from '@monky/bot-sdk';

export const pollCommand: CommandDefinition = {
  name: 'enquete',
  description: 'Cria uma enquete rápida. Separe opções com vírgula.',
  options: [
    {
      name: 'pergunta',
      description: 'A pergunta da enquete',
      type: 'string',
      required: true,
    },
    {
      name: 'opcoes',
      description: 'Opções separadas por vírgula (ex.: Sim, Não, Talvez)',
      type: 'string',
      required: false,
    },
  ],
  handler: (ctx) => {
    const question = ctx.args.pergunta;
    const optionsRaw = ctx.args.opcoes || 'Sim, Não';
    const options = optionsRaw.split(',').map((o) => o.trim()).filter(Boolean);

    if (options.length < 2) {
      ctx.replyEphemeral('⚠️ Informe pelo menos 2 opções separadas por vírgula.');
      return;
    }

    if (options.length > 10) {
      ctx.replyEphemeral('⚠️ Máximo de 10 opções.');
      return;
    }

    const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
    const lines = options.map((opt, i) => `${emojis[i]} ${opt}`);

    ctx.reply(`📊 **Enquete:** ${question}\n\n${lines.join('\n')}\n\n_Reaja para votar!_`);
  },
};
