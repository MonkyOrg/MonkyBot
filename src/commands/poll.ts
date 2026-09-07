import type { BotForm, BotFormValues, CommandContext, CommandDefinition } from '@monky/bot-sdk';
import { translate } from './i18n';

interface PollDraft {
  question: string;
  options: string[];
  visibility: 'private' | 'public';
}

function pollForm(locale: CommandContext['locale'], draft: PollDraft): BotForm {
  return {
    title: translate(locale, 'Criar enquete', 'Create a poll'),
    description: translate(locale,
      'Preencha cada opção em seu próprio campo. Você poderá revisar e editar antes de concluir.',
      'Enter each option in its own field. You can review and edit before finishing.'),
    submitLabel: translate(locale, 'Revisar enquete', 'Review poll'),
    fields: [
      {
        name: 'pergunta',
        type: 'text',
        label: translate(locale, 'Pergunta', 'Question'),
        placeholder: translate(locale, 'O que você quer perguntar?', 'What would you like to ask?'),
        required: true,
        minLength: 1,
        maxLength: 200,
        defaultValue: draft.question,
      },
      {
        name: 'opcoes',
        type: 'string-list',
        label: translate(locale, 'Opções', 'Options'),
        description: translate(locale, 'De 2 a 10 opções diferentes, sem separar por vírgula.', '2–10 different options, not comma-separated.'),
        placeholder: translate(locale, 'Digite uma opção', 'Enter an option'),
        required: true,
        minItems: 2,
        maxItems: 10,
        maxLength: 80,
        defaultValue: draft.options,
      },
      {
        name: 'visibilidade',
        type: 'select',
        label: translate(locale, 'Onde mostrar o resultado?', 'Where should the result appear?'),
        choices: [
          { value: 'private', label: translate(locale, 'Somente para mim', 'Only for me') },
          { value: 'public', label: translate(locale, 'Publicar no canal após confirmar', 'Publish to the channel after confirmation') },
        ],
        defaultValue: draft.visibility,
      },
    ],
  };
}

function readDraft(values: BotFormValues): PollDraft | null {
  const question = values.pergunta;
  const options = values.opcoes;
  const visibility = values.visibilidade ?? 'private';
  if (typeof question !== 'string' || !question.trim() || question.length > 200 ||
      !Array.isArray(options) || options.length < 2 || options.length > 10 ||
      options.some((option) => typeof option !== 'string' || !option.trim() || option.length > 80) ||
      (visibility !== 'private' && visibility !== 'public')) {
    return null;
  }
  const trimmedOptions = options.map((option) => option.trim());
  if (new Set(trimmedOptions.map((option) => option.toLowerCase())).size !== trimmedOptions.length) return null;
  return { question: question.trim(), options: trimmedOptions, visibility };
}

function pollContent(locale: CommandContext['locale'], draft: PollDraft): string {
  const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
  const options = draft.options.map((option, index) => `${emojis[index]} ${option}`).join('\n');
  return `📊 **${translate(locale, 'Enquete', 'Poll')}:** ${draft.question}\n\n${options}`;
}

export const pollCommand: CommandDefinition = {
  name: 'enquete',
  description: 'Cria uma enquete passo a passo em um formulário privado.',
  handler: async (ctx) => {
    let draft: PollDraft = {
      question: '',
      options: [translate(ctx.locale, 'Sim', 'Yes'), translate(ctx.locale, 'Não', 'No')],
      visibility: 'private',
    };

    while (!ctx.signal.aborted) {
      const values = await ctx.prompt(pollForm(ctx.locale, draft));
      if (values === null || ctx.signal.aborted) return;
      const nextDraft = readDraft(values);
      if (!nextDraft) {
        ctx.reply(translate(ctx.locale,
          '⚠️ Revise a pergunta e informe de 2 a 10 opções diferentes.',
          '⚠️ Check the question and enter 2–10 different options.'));
        continue;
      }
      draft = nextDraft;
      const content = pollContent(ctx.locale, draft);
      ctx.reply(`📝 **${translate(ctx.locale, 'Prévia privada', 'Private preview')}**\n\n${content}`);

      const confirmation = await ctx.prompt({
        title: translate(ctx.locale, 'Confirmar enquete', 'Confirm poll'),
        description: draft.visibility === 'public'
          ? translate(ctx.locale,
            'A prévia ainda é privada. Confirmar publicará esta enquete no canal para os demais participantes.',
            'The preview is still private. Confirming will publish this poll to the channel for other participants.')
          : translate(ctx.locale,
            'O resultado continuará privado, visível somente para você.',
            'The result will stay private, visible only to you.'),
        submitLabel: translate(ctx.locale, 'Continuar', 'Continue'),
        fields: [{
          name: 'acao',
          type: 'select',
          label: translate(ctx.locale, 'O que deseja fazer?', 'What would you like to do?'),
          required: true,
          choices: [
            {
              value: 'confirm',
              label: draft.visibility === 'public'
                ? translate(ctx.locale, 'Confirmar e publicar no canal', 'Confirm and publish to the channel')
                : translate(ctx.locale, 'Confirmar resultado privado', 'Confirm private result'),
            },
            { value: 'edit', label: translate(ctx.locale, 'Editar enquete', 'Edit poll') },
          ],
          defaultValue: 'confirm',
        }],
      });
      if (confirmation === null || ctx.signal.aborted) return;
      if (confirmation.acao === 'edit') continue;
      if (confirmation.acao !== 'confirm') return;
      if (draft.visibility === 'public') ctx.publish(content);
      else ctx.reply(content);
      return;
    }
  },
};
