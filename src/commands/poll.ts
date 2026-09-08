import type {
  BotClient, BotForm, BotFormValues, BotSelector, CommandContext, CommandDefinition,
} from '@monky/bot-sdk';
import { translate } from './i18n';

const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const RETRY_INTERVAL_MS = 30_000;

interface PollDraft {
  question: string;
  options: string[];
  durationMs?: number;
  maxVoters?: number;
}

function pollForm(locale: CommandContext['locale'], previous: BotFormValues = {}): BotForm {
  const question = previous.pergunta;
  const options = previous.opcoes;
  const duration = previous.duracao;
  const maxVoters = previous.max_voters;
  const unit = previous.unidade;
  const validOptions = Array.isArray(options) && options.length >= 2 && options.length <= 10 &&
    options.every((option) => typeof option === 'string' && option.trim() && option.length <= 80) &&
    new Set(options.map((option) => option.trim().toLowerCase())).size === options.length;
  return {
    title: translate(locale, 'Criar enquete', 'Create a poll'),
    description: translate(locale,
      'Ao enviar, a enquete será publicada no canal. Informe duração, limite de votantes ou ambos; encerra no primeiro limite.',
      'Submitting publishes the poll to the channel. Set a duration, voter limit, or both; the first limit closes voting.'),
    submitLabel: translate(locale, 'Publicar enquete', 'Publish poll'),
    fields: [
      {
        name: 'pergunta', type: 'text',
        label: translate(locale, 'Pergunta', 'Question'),
        required: true, minLength: 1, maxLength: 200,
        defaultValue: typeof question === 'string' && question.trim() && question.length <= 200 ? question : undefined,
      },
      {
        name: 'opcoes', type: 'string-list',
        label: translate(locale, 'Opções', 'Options'),
        description: translate(locale, 'De 2 a 10 opções diferentes, sem separar por vírgula.', '2–10 different options, not comma-separated.'),
        required: true, minItems: 2, maxItems: 10, maxLength: 80,
        defaultValue: validOptions ? [...options] : [translate(locale, 'Sim', 'Yes'), translate(locale, 'Não', 'No')],
      },
      {
        name: 'duracao', type: 'integer',
        label: translate(locale, 'Duração (opcional)', 'Duration (optional)'),
        description: translate(locale, 'Número inteiro; mínimo de 1 minuto e máximo de 30 dias.', 'Whole number; at least 1 minute and at most 30 days.'),
        min: 1, max: 43_200,
        defaultValue: typeof duration === 'number' && Number.isSafeInteger(duration) && duration >= 1 && duration <= 43_200
          ? duration : undefined,
      },
      {
        name: 'unidade', type: 'select',
        label: translate(locale, 'Unidade da duração', 'Duration unit'),
        choices: [
          { value: 'minutes', label: translate(locale, 'Minutos', 'Minutes') },
          { value: 'hours', label: translate(locale, 'Horas', 'Hours') },
          { value: 'days', label: translate(locale, 'Dias', 'Days') },
        ],
        defaultValue: unit === 'minutes' || unit === 'hours' || unit === 'days' ? unit : 'minutes',
      },
      {
        name: 'max_voters', type: 'integer',
        label: translate(locale, 'Limite de votantes (opcional)', 'Voter limit (optional)'),
        description: translate(locale, 'De 1 a 10.000 pessoas diferentes.', '1–10,000 distinct people.'),
        min: 1, max: 10_000,
        defaultValue: typeof maxVoters === 'number' && Number.isSafeInteger(maxVoters) && maxVoters >= 1 && maxVoters <= 10_000
          ? maxVoters : undefined,
      },
    ],
  };
}

function readDraft(values: BotFormValues): PollDraft | null {
  const { pergunta: question, opcoes: options, duracao: duration, max_voters: maxVoters } = values;
  const unit = values.unidade ?? 'minutes';
  if (typeof question !== 'string' || !question.trim() || question.length > 200 ||
      !Array.isArray(options) || options.length < 2 || options.length > 10 ||
      options.some((option) => typeof option !== 'string' || !option.trim() || option.length > 80) ||
      (unit !== 'minutes' && unit !== 'hours' && unit !== 'days')) return null;

  const trimmedOptions = options.map((option) => option.trim());
  if (new Set(trimmedOptions.map((option) => option.toLowerCase())).size !== trimmedOptions.length) return null;
  if (duration === undefined && maxVoters === undefined) return null;
  let durationMs: number | undefined;
  if (duration !== undefined) {
    if (typeof duration !== 'number' || !Number.isSafeInteger(duration) || duration < 1) return null;
    durationMs = duration * (unit === 'days' ? 86_400_000 : unit === 'hours' ? 3_600_000 : 60_000);
    if (durationMs > MAX_DURATION_MS) return null;
  }
  if (maxVoters !== undefined &&
      (typeof maxVoters !== 'number' || !Number.isSafeInteger(maxVoters) || maxVoters < 1 || maxVoters > 10_000)) return null;
  return { question: question.trim(), options: trimmedOptions, durationMs, maxVoters };
}

export const pollCommand: CommandDefinition = {
  name: 'enquete',
  description: 'Publica uma enquete com votação e encerramento automático.',
  handler: async (ctx) => {
    if (ctx.signal.aborted) return;
    let previous: BotFormValues = {};
    let draft: PollDraft | null = null;
    while (!ctx.signal.aborted) {
      const values = await ctx.prompt(pollForm(ctx.locale, previous));
      if (values === null || ctx.signal.aborted) return;
      draft = readDraft(values);
      if (draft) break;
      previous = values;
      ctx.reply(translate(ctx.locale,
        '⚠️ Revise a pergunta, informe de 2 a 10 opções diferentes e uma duração inteira de 1 minuto a 30 dias e/ou limite de 1 a 10.000 votantes.',
        '⚠️ Check the question, enter 2–10 different options and a whole-number duration of 1 minute to 30 days and/or a limit of 1–10,000 voters.'));
    }
    if (!draft || ctx.signal.aborted) return;
    await ctx.createSelector({
      id: ctx.invocationId,
      title: draft.question,
      choices: draft.options.map((label, index) => ({ label, value: String(index + 1) })),
      presentation: 'buttons',
      responder: 'any',
      allowChange: true,
      ...(draft.durationMs === undefined ? {} : { expiresAt: Date.now() + draft.durationMs }),
      ...(draft.maxVoters === undefined ? {} : { maxResponders: draft.maxVoters }),
      metadata: { kind: 'poll', locale: ctx.locale },
    });
    if (!ctx.signal.aborted) {
      ctx.reply(translate(ctx.locale,
        '📊 Enquete publicada! Cada pessoa tem um voto e pode alterá-lo até o encerramento.',
        '📊 Poll published! Each person has one vote and can change it until voting closes.'));
    }
  },
};

export function pollResult(selector: BotSelector): string {
  const locale = selector.metadata?.locale === 'en' ? 'en' : 'pt-BR';
  const counts = new Map(selector.choices.map((choice) => [choice.value, 0]));
  for (const value of Object.values(selector.responses)) {
    if (counts.has(value)) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const percentage = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const lines = selector.choices.map((choice, index) => {
    const count = counts.get(choice.value) ?? 0;
    return `${index + 1}. ${choice.label} — ${count} (${percentage.format(total ? count / total * 100 : 0)}%)`;
  });
  const highest = Math.max(...counts.values());
  const winners = selector.choices.flatMap((choice, index) => counts.get(choice.value) === highest ? [index + 1] : []);
  const outcome = total === 0
    ? translate(locale, 'Nenhum voto foi registrado.', 'No votes were cast.')
    : winners.length === 1
      ? translate(locale, `🏆 Opção vencedora: ${winners[0]}.`, `🏆 Winning option: ${winners[0]}.`)
      : translate(locale, `🤝 Empate entre as opções: ${winners.join(', ')}.`, `🤝 Tie between options: ${winners.join(', ')}.`);
  return `📊 **${translate(locale, 'Enquete encerrada', 'Poll closed')}:** ${selector.title}\n\n${lines.join('\n')}\n\n${translate(locale, 'Total de votos', 'Total votes')}: ${total}\n${outcome}`;
}

export function registerPollCommand(bot: BotClient): () => void {
  bot.command(pollCommand);
  const servers = new Set<string>();
  const recovering = new Set<string>();
  const finalizing = new Set<string>();
  let disposed = false;

  const finalize = async (serverId: string, selector: BotSelector): Promise<void> => {
    if (disposed || selector.metadata?.kind !== 'poll' || selector.closedAt === null || selector.resultMessageId !== null) return;
    const key = JSON.stringify([serverId, selector.id]);
    if (finalizing.has(key)) return;
    finalizing.add(key);
    try {
      // The server makes this idempotent, including across restarts and lost acknowledgments.
      await bot.finalizeSelector(serverId, selector.id, pollResult(selector));
    } catch (error: unknown) {
      console.error(`[poll] Failed to finalize ${selector.id} on ${serverId}; retrying on recovery.`, error);
    } finally {
      finalizing.delete(key);
    }
  };
  const recover = async (serverId: string): Promise<void> => {
    if (disposed || recovering.has(serverId)) return;
    recovering.add(serverId);
    try {
      const selectors = await bot.listSelectors(serverId);
      for (const selector of selectors) {
        if (disposed || !servers.has(serverId)) break;
        await finalize(serverId, selector);
      }
    } catch (error: unknown) {
      console.error(`[poll] Failed to list polls on ${serverId}; retrying on recovery.`, error);
    } finally {
      recovering.delete(serverId);
    }
  };
  const onConnected = ({ serverId }: { serverId: string }): void => {
    servers.add(serverId);
    void recover(serverId);
  };
  const onDisconnected = ({ serverId }: { serverId: string }): void => {
    servers.delete(serverId);
  };
  const onUpdate = ({ serverId, selector }: { serverId: string; selector: BotSelector }): void => {
    void finalize(serverId, selector);
  };
  const timer = setInterval(() => {
    for (const serverId of servers) void recover(serverId);
  }, RETRY_INTERVAL_MS);
  timer.unref();
  const dispose = (): void => {
    disposed = true;
    clearInterval(timer);
    servers.clear();
    bot.off('connected', onConnected);
    bot.off('disconnected', onDisconnected);
    bot.off('selectorUpdate', onUpdate);
    bot.off('closed', dispose);
  };
  bot.on('connected', onConnected);
  bot.on('disconnected', onDisconnected);
  bot.on('selectorUpdate', onUpdate);
  bot.once('closed', dispose);
  return dispose;
}
