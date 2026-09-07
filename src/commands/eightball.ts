import { CommandDefinition } from '@monky/bot-sdk';

const responses = [
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
];

export const eightBallCommand: CommandDefinition = {
  name: '8ball',
  description: 'A bola mágica responde sua pergunta.',
  options: [
    {
      name: 'pergunta',
      description: 'Sua pergunta para a bola mágica',
      type: 'string',
      required: true,
    },
  ],
  handler: (ctx) => {
    const answer = responses[Math.floor(Math.random() * responses.length)];
    ctx.reply(`🎱 *"${ctx.args.pergunta}"*\n\n**${answer}**`);
  },
};
