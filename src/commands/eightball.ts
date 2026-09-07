import type { CommandDefinition } from '@monky/bot-sdk';
import { translate } from './i18n';

const responses = {
  'pt-BR': [
    'É certo.',
    'Decididamente sim.',
    'Sem dúvida.',
    'Sim, definitivamente.',
    'Pode confiar nisso.',
    'Como eu vejo, sim.',
    'Provavelmente.',
    'As perspectivas são boas.',
    'Sim.',
    'Os sinais apontam que sim.',
    'Resposta nebulosa, tente novamente.',
    'Pergunte novamente mais tarde.',
    'Melhor não te contar agora.',
    'Não consigo prever agora.',
    'Concentre-se e pergunte novamente.',
    'Não conte com isso.',
    'Minha resposta é não.',
    'Minhas fontes dizem que não.',
    'As perspectivas não são tão boas.',
    'Muito duvidoso.',
  ],
  en: [
    'It is certain.',
    'It is decidedly so.',
    'Without a doubt.',
    'Yes, definitely.',
    'You may rely on it.',
    'As I see it, yes.',
    'Most likely.',
    'Outlook good.',
    'Yes.',
    'Signs point to yes.',
    'Reply hazy, try again.',
    'Ask again later.',
    'Better not tell you now.',
    'Cannot predict now.',
    'Concentrate and ask again.',
    "Don't count on it.",
    'My reply is no.',
    'My sources say no.',
    'Outlook not so good.',
    'Very doubtful.',
  ],
};

export const eightBallCommand: CommandDefinition = {
  name: '8ball',
  description: 'A bola mágica responde sua pergunta.',
  options: [
    {
      name: 'pergunta',
      description: 'Sua pergunta para a bola mágica',
      type: 'string',
      required: false,
    },
  ],
  handler: async (ctx) => {
    if (ctx.signal.aborted) return;
    let question = ctx.args.pergunta;
    if (question === undefined || question === '') {
      const values = await ctx.prompt({
        title: translate(ctx.locale, 'Pergunte à bola mágica', 'Ask the magic ball'),
        description: translate(ctx.locale, 'Sua pergunta e a resposta ficam só no seu chat.', 'Your question and the answer stay in your chat.'),
        submitLabel: translate(ctx.locale, 'Perguntar', 'Ask'),
        fields: [{
          name: 'pergunta',
          type: 'text',
          label: translate(ctx.locale, 'Sua pergunta', 'Your question'),
          placeholder: translate(ctx.locale, 'O que você gostaria de saber?', 'What would you like to know?'),
          required: true,
          minLength: 1,
          maxLength: 200,
        }],
      });
      if (values === null || ctx.signal.aborted) return;
      const submitted = values.pergunta;
      if (typeof submitted !== 'string') return;
      question = submitted;
    }
    if (typeof question !== 'string' || !question.trim() || question.length > 200) {
      ctx.reply(translate(ctx.locale,
        '⚠️ Escreva uma pergunta com até 200 caracteres.',
        '⚠️ Enter a question with up to 200 characters.'));
      return;
    }
    const choices = responses[ctx.locale];
    const answer = choices[Math.floor(Math.random() * choices.length)];
    ctx.reply(`🎱 *"${question.trim()}"*\n\n**${answer}**`);
  },
};
