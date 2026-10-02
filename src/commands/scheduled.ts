import { randomInt } from 'node:crypto';
import path from 'node:path';
import type {
  BotClient, BotForm, BotFormValues, BotPublishedMessageContent, CommandContext, LiveAction, LiveActionSubmission,
} from '@monky/bot-sdk';
import { message, translate, type LocalizedCommandDefinition } from './i18n';
import { normalizeCliLocale, cliText } from '../cli/i18n';
import { errorDiagnostic, safeDiagnostic } from '../music/process';
import {
  ScheduledActionsStore, type GiveawayEntrant, type GiveawayRecord, type ScheduledActionsState, type ScheduledLocale,
} from '../scheduled/store';

const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_REMINDER_DURATION_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_TIMER_MS = 2_147_000_000;
const RETRY_INTERVAL_MS = 30_000;
const MAX_ACTIVE_REMINDERS_PER_USER = 20;
const MAX_ACTIVE_GIVEAWAYS_PER_SERVER = 20;
export const SCHEDULED_ACTIONS_PATH = path.resolve(process.cwd(), '.keys', 'scheduled-actions.json');

interface ReminderDraft {
  text: string;
  durationMs: number;
  repeatIntervalMs: number | null;
  totalOccurrences: number;
}
interface GiveawayDraft {
  title: string;
  rules: string;
  durationMs: number;
  winnerCount: number;
  imageAssetRefs: string[];
}
interface ScheduledServiceOptions {
  storePath?: string;
  now?: () => number;
  randomIndex?: (upperExclusive: number) => number;
  retryIntervalMs?: number;
}

const placeholder = async (): Promise<void> => {
  throw new Error('Scheduled command was registered without its lifecycle service.');
};

export const reminderCommand: LocalizedCommandDefinition = {
  name: 'lembrete',
  description: 'Agenda um lembrete persistente no canal atual.',
  localizations: {
    'pt-BR': { name: 'lembrete' },
    en: { name: 'reminder', description: 'Schedule a persistent reminder in the current channel.' },
  },
  handler: placeholder,
};

export const giveawayCommand: LocalizedCommandDefinition = {
  name: 'sorteio',
  description: 'Cria um sorteio persistente com inscrições e vencedores automáticos.',
  localizations: {
    'pt-BR': { name: 'sorteio' },
    en: { name: 'giveaway', description: 'Create a persistent giveaway with entries and automatic winners.' },
  },
  handler: placeholder,
};

function duration(values: BotFormValues, maximum: number): number | null {
  const amount = values.prazo;
  const unit = values.unidade ?? 'minutes';
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 1 ||
      (unit !== 'minutes' && unit !== 'hours' && unit !== 'days')) return null;
  const milliseconds = amount * (unit === 'days' ? 86_400_000 : unit === 'hours' ? 3_600_000 : 60_000);
  return milliseconds <= maximum ? milliseconds : null;
}

function durationFields(locale: CommandContext['locale'], previous: BotFormValues, maximumDays: number): BotForm['fields'] {
  const priorAmount = previous.prazo;
  const priorUnit = previous.unidade;
  return [
    {
      name: 'prazo', type: 'integer', label: translate(locale, 'Prazo', 'Duration'), required: true,
      description: translate(locale, `Número inteiro; no máximo ${maximumDays} dias.`, `Whole number; at most ${maximumDays} days.`),
      min: 1, max: maximumDays * 1_440,
      defaultValue: typeof priorAmount === 'number' && Number.isSafeInteger(priorAmount) &&
        priorAmount >= 1 && priorAmount <= maximumDays * 1_440 ? priorAmount : 10,
    },
    {
      name: 'unidade', type: 'select', label: translate(locale, 'Unidade', 'Unit'), required: true,
      choices: [
        { value: 'minutes', label: translate(locale, 'Minutos', 'Minutes') },
        { value: 'hours', label: translate(locale, 'Horas', 'Hours') },
        { value: 'days', label: translate(locale, 'Dias', 'Days') },
      ],
      defaultValue: priorUnit === 'minutes' || priorUnit === 'hours' || priorUnit === 'days' ? priorUnit : 'minutes',
    },
  ];
}

function reminderForm(locale: CommandContext['locale'], previous: BotFormValues = {}): BotForm {
  return {
    title: translate(locale, 'Agendar lembrete', 'Schedule reminder'),
    description: translate(locale,
      'O lembrete fica salvo no bot e será publicado neste canal quando vencer.',
      'The reminder is saved by the bot and will be posted in this channel when due.'),
    submitLabel: translate(locale, 'Agendar', 'Schedule'),
    fields: [
      {
        name: 'mensagem', type: 'text', label: translate(locale, 'Mensagem', 'Message'),
        required: true, multiline: true, minLength: 1, maxLength: 1_200,
        defaultValue: typeof previous.mensagem === 'string' && previous.mensagem.trim() &&
          previous.mensagem.length <= 1_200 ? previous.mensagem : undefined,
      },
      ...durationFields(locale, previous, 365),
      {
        name: 'repeticao', type: 'select', label: translate(locale, 'Repetição', 'Repeat'), required: true,
        choices: [
          { value: 'once', label: translate(locale, 'Não repetir', 'Do not repeat') },
          { value: 'daily', label: translate(locale, 'Diariamente', 'Daily') },
          { value: 'weekly', label: translate(locale, 'Semanalmente', 'Weekly') },
        ],
        defaultValue: previous.repeticao === 'daily' || previous.repeticao === 'weekly'
          ? previous.repeticao : 'once',
      },
      {
        name: 'repeticoes', type: 'integer', label: translate(locale, 'Quantidade de envios', 'Number of deliveries'),
        description: translate(locale,
          'Use 1 para enviar uma vez; lembretes repetidos aceitam até 30 envios.',
          'Use 1 to send once; repeating reminders allow up to 30 deliveries.'),
        required: true, min: 1, max: 30,
        defaultValue: typeof previous.repeticoes === 'number' && Number.isSafeInteger(previous.repeticoes) &&
          previous.repeticoes >= 1 && previous.repeticoes <= 30 ? previous.repeticoes : 1,
      },
    ],
  };
}

function readReminder(values: BotFormValues): ReminderDraft | null {
  const text = values.mensagem;
  const durationMs = duration(values, MAX_REMINDER_DURATION_MS);
  const repetition = values.repeticao ?? 'once';
  const occurrences = values.repeticoes ?? 1;
  const repeatIntervalMs = repetition === 'daily' ? 86_400_000 :
    repetition === 'weekly' ? 604_800_000 : repetition === 'once' ? null : undefined;
  return typeof text === 'string' && text.trim() && text.length <= 1_200 && durationMs !== null
    && repeatIntervalMs !== undefined && typeof occurrences === 'number' &&
    Number.isSafeInteger(occurrences) && occurrences >= 1 && occurrences <= 30 &&
    (repeatIntervalMs !== null || occurrences === 1)
    ? { text: text.trim(), durationMs, repeatIntervalMs, totalOccurrences: occurrences } : null;
}

function giveawayForm(locale: CommandContext['locale'], previous: BotFormValues = {}): BotForm {
  const winners = previous.vencedores;
  return {
    title: translate(locale, 'Criar sorteio', 'Create giveaway'),
    description: translate(locale,
      'Publica uma live action para inscrições e sorteia automaticamente com aleatoriedade criptográfica.',
      'Publishes a live action for entries and automatically draws winners using cryptographic randomness.'),
    submitLabel: translate(locale, 'Publicar sorteio', 'Publish giveaway'),
    fields: [
      {
        name: 'premio', type: 'text', label: translate(locale, 'Prêmio ou título', 'Prize or title'),
        required: true, minLength: 1, maxLength: 200,
        defaultValue: typeof previous.premio === 'string' && previous.premio.trim() &&
          previous.premio.length <= 200 ? previous.premio : undefined,
      },
      {
        name: 'regras', type: 'text', label: translate(locale, 'Regras (opcional)', 'Rules (optional)'),
        multiline: true, maxLength: 700,
        defaultValue: typeof previous.regras === 'string' && previous.regras.length <= 700 ? previous.regras : undefined,
      },
      {
        name: 'imagens', type: 'image-list',
        label: translate(locale, 'Imagens do sorteio', 'Giveaway images'),
        description: translate(locale,
          'Adicione até 5 imagens para exibir em carrossel na live action.',
          'Add up to 5 images to display as a carousel in the live action.'),
        maxItems: 5,
        presentation: { format: 'banner', fit: 'cover', size: 'regular' },
      },
      ...durationFields(locale, previous, 30),
      {
        name: 'vencedores', type: 'integer', label: translate(locale, 'Quantidade de vencedores', 'Number of winners'),
        required: true, min: 1, max: 10,
        defaultValue: typeof winners === 'number' && Number.isSafeInteger(winners) && winners >= 1 && winners <= 10 ? winners : 1,
      },
    ],
  };
}

function readGiveaway(values: BotFormValues): GiveawayDraft | null {
  const title = values.premio;
  const rules = values.regras ?? '';
  const winnerCount = values.vencedores;
  const images = values.imagens ?? [];
  const durationMs = duration(values, MAX_DURATION_MS);
  return typeof title === 'string' && title.trim() && title.length <= 200 &&
    typeof rules === 'string' && rules.length <= 700 &&
    typeof winnerCount === 'number' && Number.isSafeInteger(winnerCount) && winnerCount >= 1 && winnerCount <= 10 &&
    Array.isArray(images) && images.length <= 5 &&
    images.every(value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) &&
    durationMs !== null
    ? { title: title.trim(), rules: rules.trim(), durationMs, winnerCount, imageAssetRefs: images } : null;
}

function localizedDate(time: number, locale: ScheduledLocale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(time);
}

function liveActionInput(giveaway: GiveawayRecord): Parameters<BotClient['createLiveAction']>[1] {
  const end = localizedDate(giveaway.endsAt, giveaway.locale);
  const rules = giveaway.rules
    ? `\n\n${translate(giveaway.locale, 'Regras', 'Rules')}: ${giveaway.rules}`
    : '';
  return {
    id: giveaway.id,
    channelId: giveaway.channelId,
    invocationId: giveaway.id,
    title: giveaway.title,
    description: `${translate(giveaway.locale,
      `Inscreva-se até ${end}. Uma inscrição por pessoa; novos envios não dão chances extras.`,
      `Enter by ${end}. One entry per person; resubmitting does not add extra chances.`)}${rules}`,
    expiresAt: giveaway.endsAt,
    content: {
      kind: 'form',
      form: {
        title: translate(giveaway.locale, 'Participar do sorteio', 'Enter giveaway'),
        description: translate(giveaway.locale,
          'Confirme sua participação. Sua conta será registrada uma única vez.',
          'Confirm your entry. Your account will be registered only once.'),
        fields: [{
          name: 'participar', type: 'boolean', required: true, defaultValue: true,
          label: translate(giveaway.locale, 'Quero participar', 'I want to enter'),
        }],
        submitLabel: translate(giveaway.locale, 'Confirmar inscrição', 'Confirm entry'),
      },
    },
  };
}

export function selectGiveawayWinners(
  entrants: readonly GiveawayEntrant[], count: number, randomIndex: (upperExclusive: number) => number = randomInt
): GiveawayEntrant[] {
  const pool = entrants.map((entry) => ({ ...entry }));
  const selected = Math.min(count, pool.length);
  for (let index = 0; index < selected; index++) {
    const offset = randomIndex(pool.length - index);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= pool.length - index) {
      throw new Error('Random index source returned an invalid value.');
    }
    const chosen = index + offset;
    [pool[index], pool[chosen]] = [pool[chosen], pool[index]];
  }
  return pool.slice(0, selected);
}

function reminderMessage(record: ScheduledActionsState['reminders'][number]): BotPublishedMessageContent {
  const mention = `@${record.creatorNickname}`;
  return message(record.locale, `⏰ ${mention}, lembrete: ${record.text}`, `⏰ ${mention}, reminder: ${record.text}`);
}

function giveawayResult(record: GiveawayRecord): BotPublishedMessageContent {
  const names = (record.winners ?? []).map((winner, index) => `${index + 1}. @${winner.nickname}`).join('\n');
  const ptResult = names || 'Nenhuma inscrição válida foi recebida.';
  const enResult = names || 'No valid entries were received.';
  return message(record.locale,
    `🎁 **Sorteio encerrado:** ${record.title}\n\n${ptResult}\n\nInscrições válidas: ${record.entrants.length}`,
    `🎁 **Giveaway ended:** ${record.title}\n\n${enResult}\n\nValid entries: ${record.entrants.length}`);
}

export class ScheduledActionsService {
  readonly reminderCommand: LocalizedCommandDefinition;
  readonly giveawayCommand: LocalizedCommandDefinition;
  private readonly store: ScheduledActionsStore;
  private readonly now: () => number;
  private readonly randomIndex: (upperExclusive: number) => number;
  private readonly retryIntervalMs: number;
  private readonly connected = new Set<string>();
  private readonly retryAfter = new Map<string, number>();
  private readonly processing = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private running?: Promise<void>;
  private readonly disposeSubmission: () => void;

  constructor(private readonly bot: BotClient, options: ScheduledServiceOptions = {}) {
    this.store = new ScheduledActionsStore(options.storePath ?? SCHEDULED_ACTIONS_PATH);
    this.now = options.now ?? Date.now;
    this.randomIndex = options.randomIndex ?? randomInt;
    this.retryIntervalMs = options.retryIntervalMs ?? RETRY_INTERVAL_MS;
    this.reminderCommand = { ...reminderCommand, handler: (ctx) => this.createReminder(ctx) };
    this.giveawayCommand = { ...giveawayCommand, handler: (ctx) => this.createGiveaway(ctx) };
    this.disposeSubmission = bot.onLiveActionSubmission((event, context) => {
      void this.recordEntry(context.serverId, event).catch((error: unknown) => {
        console.error('[giveaway] Entry persistence failed:', errorDiagnostic(error));
      });
    });
    bot.on('connected', this.onConnected);
    bot.on('disconnected', this.onDisconnected);
    bot.once('closed', this.onClosed);
  }

  register(): void {
    this.bot.command(this.reminderCommand);
    this.bot.command(this.giveawayCommand);
  }

  snapshot(): ScheduledActionsState {
    return this.store.snapshot();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.connected.clear();
    this.disposeSubmission();
    this.bot.off('connected', this.onConnected);
    this.bot.off('disconnected', this.onDisconnected);
    this.bot.off('closed', this.onClosed);
    await this.running?.catch(() => {});
    await this.store.flush();
  }

  private readonly onConnected = ({ serverId }: { serverId: string }): void => {
    this.connected.add(serverId);
    void this.recover(serverId).then(() => this.runDue()).catch((error: unknown) => {
      console.error('[scheduled] Recovery failed:', safeDiagnostic(serverId), errorDiagnostic(error));
      this.schedule();
    });
  };

  private readonly onDisconnected = ({ serverId }: { serverId: string }): void => {
    this.connected.delete(serverId);
    this.schedule();
  };

  private readonly onClosed = (): void => {
    void this.dispose();
  };

  private async createReminder(ctx: CommandContext): Promise<void> {
    if (ctx.signal.aborted) return;
    let previous: BotFormValues = {};
    let draft: ReminderDraft | null = null;
    while (!ctx.signal.aborted) {
      const values = await ctx.prompt(reminderForm(ctx.locale, previous));
      if (values === null || ctx.signal.aborted) return;
      draft = readReminder(values);
      if (draft) break;
      previous = values;
      ctx.reply(message(ctx.locale,
        '⚠️ Informe uma mensagem e um prazo inteiro entre 1 minuto e 365 dias.',
        '⚠️ Enter a message and a whole-number duration from 1 minute to 365 days.'));
    }
    if (!draft || ctx.signal.aborted) return;
    const createdAt = this.now();
    const outcome = await this.store.transact(state => {
      const active = state.reminders.filter(record => record.serverId === ctx.serverId &&
        record.creatorId === ctx.invokerId && record.status === 'pending').length;
      if (active >= MAX_ACTIVE_REMINDERS_PER_USER) return false;
      state.reminders.push({
        id: ctx.invocationId, serverId: ctx.serverId, channelId: ctx.channelId,
        creatorId: ctx.invokerId, creatorNickname: ctx.invokerNickname.slice(0, 128),
        locale: normalizeCliLocale(ctx.locale), text: draft!.text, dueAt: createdAt + draft!.durationMs,
        createdAt, repeatIntervalMs: draft!.repeatIntervalMs, totalOccurrences: draft!.totalOccurrences,
        sentOccurrences: 0, status: 'pending',
      });
      return true;
    });
    if (!outcome) {
      ctx.reply(message(ctx.locale,
        `⚠️ Você já possui ${MAX_ACTIVE_REMINDERS_PER_USER} lembretes pendentes neste servidor.`,
        `⚠️ You already have ${MAX_ACTIVE_REMINDERS_PER_USER} pending reminders on this server.`));
      return;
    }
    this.schedule();
    ctx.reply(message(ctx.locale,
      `⏰ Lembrete agendado para ${localizedDate(createdAt + draft.durationMs, normalizeCliLocale(ctx.locale))}.`,
      `⏰ Reminder scheduled for ${localizedDate(createdAt + draft.durationMs, normalizeCliLocale(ctx.locale))}.`));
  }

  private async createGiveaway(ctx: CommandContext): Promise<void> {
    if (ctx.signal.aborted) return;
    let previous: BotFormValues = {};
    let draft: GiveawayDraft | null = null;
    while (!ctx.signal.aborted) {
      const values = await ctx.prompt(giveawayForm(ctx.locale, previous));
      if (values === null || ctx.signal.aborted) return;
      draft = readGiveaway(values);
      if (draft) break;
      previous = values;
      ctx.reply(message(ctx.locale,
        '⚠️ Revise o título, o prazo inteiro de 1 minuto a 30 dias, as regras e a quantidade de 1 a 10 vencedores.',
        '⚠️ Check the title, whole-number duration from 1 minute to 30 days, rules, and 1–10 winners.'));
    }
    if (!draft || ctx.signal.aborted) return;
    const createdAt = this.now();
    const locale = normalizeCliLocale(ctx.locale);
    const record: GiveawayRecord = {
      id: ctx.invocationId, serverId: ctx.serverId, channelId: ctx.channelId,
      creatorId: ctx.invokerId, creatorNickname: ctx.invokerNickname.slice(0, 128),
      locale, title: draft.title, rules: draft.rules, endsAt: createdAt + draft.durationMs,
      winnerCount: draft.winnerCount, createdAt, status: 'creating', entrants: [],
    };
    const saved = await this.store.transact(state => {
      const active = state.giveaways.filter(item => item.serverId === ctx.serverId && item.status !== 'closed').length;
      if (active >= MAX_ACTIVE_GIVEAWAYS_PER_SERVER) return false;
      state.giveaways.push(record);
      return true;
    });
    if (!saved) {
      ctx.reply(message(ctx.locale,
        `⚠️ Este servidor já possui ${MAX_ACTIVE_GIVEAWAYS_PER_SERVER} sorteios ativos ou sendo publicados.`,
        `⚠️ This server already has ${MAX_ACTIVE_GIVEAWAYS_PER_SERVER} active or publishing giveaways.`));
      return;
    }

    let action: LiveAction | undefined;
    try {
      action = await ctx.createLiveAction({
        id: record.id, title: record.title, description: liveActionInput(record).description,
        content: liveActionInput(record).content, expiresAt: record.endsAt,
        imageAssetRefs: draft.imageAssetRefs,
        imagePresentation: { format: 'banner', fit: 'cover', size: 'regular' },
      });
    } catch (error: unknown) {
      console.error('[giveaway] Live action creation failed:', errorDiagnostic(error));
      try {
        action = (await this.bot.listLiveActions(ctx.serverId)).find(item => item.id === record.id);
      } catch (listError: unknown) {
        console.error('[giveaway] Creation confirmation failed:', errorDiagnostic(listError));
      }
      if (!action) {
        await this.store.transact(state => {
          state.giveaways = state.giveaways.filter(item => item.id !== record.id || item.serverId !== record.serverId);
        });
        ctx.reply(message(ctx.locale,
          '❌ Não foi possível publicar a live action do sorteio. Confira as permissões do bot e de quem executou o comando.',
          '❌ The giveaway live action could not be published. Check the bot and command caller permissions.'));
        return;
      }
    }
    await this.store.transact(state => {
      const item = state.giveaways.find(candidate => candidate.id === record.id && candidate.serverId === record.serverId);
      if (item) item.status = 'open';
    });
    this.schedule();
    const rulesPt = record.rules ? `\nRegras: ${record.rules}` : '';
    const rulesEn = record.rules ? `\nRules: ${record.rules}` : '';
    ctx.publish(message(ctx.locale,
      `🎁 **Sorteio:** ${record.title}\nInscreva-se pela live action até ${localizedDate(record.endsAt, 'pt-BR')}.${rulesPt}`,
      `🎁 **Giveaway:** ${record.title}\nEnter through the live action by ${localizedDate(record.endsAt, 'en')}.${rulesEn}`));
    ctx.reply(message(ctx.locale, '✅ Sorteio publicado.', '✅ Giveaway published.'));
  }

  private async recordEntry(serverId: string, event: LiveActionSubmission): Promise<void> {
    if (this.disposed || event.values.participar !== true) return;
    await this.store.transact(state => {
      const giveaway = state.giveaways.find(item => item.serverId === serverId && item.id === event.id);
      if (!giveaway || giveaway.status !== 'open' || giveaway.channelId !== event.channelId ||
          giveaway.endsAt <= this.now() || giveaway.entrants.length >= 100_000 ||
          giveaway.entrants.some(entry => entry.userId === event.userId)) return;
      giveaway.entrants.push({ userId: event.userId, nickname: event.userNickname.slice(0, 128) });
    });
  }

  private async recover(serverId: string): Promise<void> {
    if (this.disposed || !this.connected.has(serverId)) return;
    const actions = await this.bot.listLiveActions(serverId);
    const ids = new Set(actions.map(action => action.id));
    await this.store.transact(state => {
      state.giveaways = state.giveaways.filter(giveaway => {
        if (giveaway.serverId !== serverId) return true;
        if (giveaway.status === 'open' && giveaway.endsAt > this.now() && !ids.has(giveaway.id)) {
          console.error(`[giveaway] ${cliText('A live action persistida não foi encontrada no servidor.', 'The persisted live action was not found on the server.')}`,
            safeDiagnostic(`${serverId}:${giveaway.id}`));
          return true;
        }
        if (giveaway.status !== 'creating') return true;
        if (ids.has(giveaway.id)) {
          giveaway.status = 'open';
          return true;
        }
        console.error(`[giveaway] ${cliText('Descartando criação não confirmada.', 'Discarding unconfirmed creation.')}`,
          safeDiagnostic(`${serverId}:${giveaway.id}`));
        return false;
      });
    });
  }

  private schedule(): void {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    const now = this.now();
    let next = Number.POSITIVE_INFINITY;
    const state = this.store.snapshot();
    for (const reminder of state.reminders) {
      if (reminder.status !== 'pending' || !this.connected.has(reminder.serverId)) continue;
      next = Math.min(next, Math.max(reminder.dueAt, this.retryAfter.get(`reminder:${reminder.serverId}:${reminder.id}`) ?? 0));
    }
    for (const giveaway of state.giveaways) {
      if ((giveaway.status !== 'open' && giveaway.status !== 'closing') || !this.connected.has(giveaway.serverId)) continue;
      next = Math.min(next, Math.max(giveaway.endsAt, this.retryAfter.get(`giveaway:${giveaway.serverId}:${giveaway.id}`) ?? 0));
    }
    if (!Number.isFinite(next)) return;
    this.timer = setTimeout(() => void this.runDue(), Math.min(MAX_TIMER_MS, Math.max(0, next - now)));
    this.timer.unref();
  }

  private runDue(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.processDue().finally(() => {
      this.running = undefined;
      this.schedule();
    });
    return this.running;
  }

  private async processDue(): Promise<void> {
    if (this.disposed) return;
    const now = this.now();
    const state = this.store.snapshot();
    for (const reminder of state.reminders) {
      if (reminder.status === 'pending' && reminder.dueAt <= now && this.connected.has(reminder.serverId)) {
        await this.deliverReminder(reminder);
      }
    }
    for (const giveaway of state.giveaways) {
      if ((giveaway.status === 'open' || giveaway.status === 'closing') &&
          giveaway.endsAt <= now && this.connected.has(giveaway.serverId)) {
        await this.finishGiveaway(giveaway);
      }
    }
  }

  private async deliverReminder(record: ScheduledActionsState['reminders'][number]): Promise<void> {
    const key = `reminder:${record.serverId}:${record.id}`;
    if (this.processing.has(key) || (this.retryAfter.get(key) ?? 0) > this.now()) return;
    this.processing.add(key);
    try {
      const sent = await this.bot.sendMessage(record.serverId, record.channelId, reminderMessage(record));
      await this.store.transact(state => {
        const current = state.reminders.find(item => item.serverId === record.serverId && item.id === record.id);
        if (current && current.status === 'pending') {
          current.sentAt = this.now();
          current.messageId = sent.id;
          current.sentOccurrences += 1;
          if (current.sentOccurrences >= current.totalOccurrences || current.repeatIntervalMs === null) {
            current.status = 'sent';
          } else {
            current.dueAt = Math.max(current.dueAt + current.repeatIntervalMs, this.now() + current.repeatIntervalMs);
          }
        }
      });
      this.retryAfter.delete(key);
    } catch (error: unknown) {
      this.retryAfter.set(key, this.now() + this.retryIntervalMs);
      console.error(`[reminder] ${cliText('Falha ao publicar; nova tentativa agendada.', 'Failed to publish; retry scheduled.')}`,
        safeDiagnostic(`${record.serverId}:${record.id}`), errorDiagnostic(error));
    } finally {
      this.processing.delete(key);
    }
  }

  private async finishGiveaway(record: GiveawayRecord): Promise<void> {
    const key = `giveaway:${record.serverId}:${record.id}`;
    if (this.processing.has(key) || (this.retryAfter.get(key) ?? 0) > this.now()) return;
    this.processing.add(key);
    try {
      const current = await this.store.transact(state => {
        const item = state.giveaways.find(candidate => candidate.serverId === record.serverId && candidate.id === record.id);
        if (!item || item.status === 'closed') return undefined;
        if (item.status === 'open') {
          item.winners = selectGiveawayWinners(item.entrants, item.winnerCount, this.randomIndex);
          item.status = 'closing';
        }
        return structuredClone(item);
      });
      if (!current) return;
      try {
        await this.bot.closeLiveAction(current.serverId, current.id);
      } catch (error: unknown) {
        console.error(`[giveaway] ${cliText('Não foi possível confirmar o fechamento da live action.', 'Could not confirm live action closure.')}`,
          safeDiagnostic(`${current.serverId}:${current.id}`), errorDiagnostic(error));
      }
      const sent = await this.bot.sendMessage(current.serverId, current.channelId, giveawayResult(current));
      await this.store.transact(state => {
        const item = state.giveaways.find(candidate => candidate.serverId === current.serverId && candidate.id === current.id);
        if (item && item.status === 'closing') {
          item.status = 'closed';
          item.closedAt = this.now();
          item.messageId = sent.id;
        }
      });
      this.retryAfter.delete(key);
    } catch (error: unknown) {
      this.retryAfter.set(key, this.now() + this.retryIntervalMs);
      console.error(`[giveaway] ${cliText('Falha ao publicar o resultado; nova tentativa agendada.', 'Failed to publish result; retry scheduled.')}`,
        safeDiagnostic(`${record.serverId}:${record.id}`), errorDiagnostic(error));
    } finally {
      this.processing.delete(key);
    }
  }
}

export function registerScheduledCommands(bot: BotClient): () => Promise<void> {
  const service = new ScheduledActionsService(bot);
  service.register();
  return () => service.dispose();
}
