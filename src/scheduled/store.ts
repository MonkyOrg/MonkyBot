import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export type ScheduledLocale = 'pt-BR' | 'en';

export interface ReminderRecord {
  id: string;
  serverId: string;
  channelId: string;
  creatorId: string;
  creatorNickname: string;
  locale: ScheduledLocale;
  text: string;
  dueAt: number;
  createdAt: number;
  repeatIntervalMs: number | null;
  totalOccurrences: number;
  sentOccurrences: number;
  status: 'pending' | 'sent';
  sentAt?: number;
  messageId?: string;
}

export interface GiveawayEntrant {
  userId: string;
  nickname: string;
}

export interface GiveawayRecord {
  id: string;
  serverId: string;
  channelId: string;
  creatorId: string;
  creatorNickname: string;
  locale: ScheduledLocale;
  title: string;
  rules: string;
  endsAt: number;
  winnerCount: number;
  createdAt: number;
  status: 'creating' | 'open' | 'closing' | 'closed';
  entrants: GiveawayEntrant[];
  winners?: GiveawayEntrant[];
  closedAt?: number;
  messageId?: string;
}

export interface ScheduledActionsState {
  version: 1;
  reminders: ReminderRecord[];
  giveaways: GiveawayRecord[];
}

const emptyState = (): ScheduledActionsState => ({ version: 1, reminders: [], giveaways: [] });
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown, max = 128): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;
const timestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const locale = (value: unknown): value is ScheduledLocale => value === 'pt-BR' || value === 'en';

function entrant(value: unknown): value is GiveawayEntrant {
  return object(value) && string(value.userId) && typeof value.nickname === 'string' && value.nickname.length <= 128;
}

function reminder(value: unknown): value is ReminderRecord {
  return object(value) && string(value.id) && string(value.serverId) && string(value.channelId) &&
    string(value.creatorId) && typeof value.creatorNickname === 'string' && value.creatorNickname.length <= 128 &&
    locale(value.locale) && string(value.text, 1_200) && timestamp(value.dueAt) && timestamp(value.createdAt) &&
    (value.repeatIntervalMs === null || timestamp(value.repeatIntervalMs) && value.repeatIntervalMs >= 60_000) &&
    typeof value.totalOccurrences === 'number' && Number.isSafeInteger(value.totalOccurrences) &&
    value.totalOccurrences >= 1 && value.totalOccurrences <= 30 &&
    typeof value.sentOccurrences === 'number' && Number.isSafeInteger(value.sentOccurrences) &&
    value.sentOccurrences >= 0 && value.sentOccurrences <= value.totalOccurrences &&
    (value.status === 'pending' || value.status === 'sent') &&
    (value.sentAt === undefined || timestamp(value.sentAt)) &&
    (value.messageId === undefined || string(value.messageId));
}

function giveaway(value: unknown): value is GiveawayRecord {
  return object(value) && string(value.id) && string(value.serverId) && string(value.channelId) &&
    string(value.creatorId) && typeof value.creatorNickname === 'string' && value.creatorNickname.length <= 128 &&
    locale(value.locale) && string(value.title, 200) && typeof value.rules === 'string' && value.rules.length <= 700 &&
    timestamp(value.endsAt) && timestamp(value.createdAt) && typeof value.winnerCount === 'number' &&
    Number.isSafeInteger(value.winnerCount) && value.winnerCount >= 1 && value.winnerCount <= 10 &&
    ['creating', 'open', 'closing', 'closed'].includes(String(value.status)) &&
    Array.isArray(value.entrants) && value.entrants.length <= 100_000 && value.entrants.every(entrant) &&
    new Set(value.entrants.map((entry) => entry.userId)).size === value.entrants.length &&
    (value.winners === undefined || Array.isArray(value.winners) && value.winners.length <= 10 && value.winners.every(entrant)) &&
    (value.closedAt === undefined || timestamp(value.closedAt)) &&
    (value.messageId === undefined || string(value.messageId));
}

export function parseScheduledActionsState(value: unknown): ScheduledActionsState {
  if (!object(value) || value.version !== 1 || !Array.isArray(value.reminders) ||
      !Array.isArray(value.giveaways) || !value.reminders.every(reminder) || !value.giveaways.every(giveaway)) {
    throw new Error('Invalid scheduled actions state.');
  }
  return value as unknown as ScheduledActionsState;
}

export class ScheduledActionsStore {
  private state: ScheduledActionsState;
  private queue: Promise<void> = Promise.resolve();

  constructor(readonly filePath: string) {
    if (!fs.existsSync(filePath)) {
      this.state = emptyState();
      return;
    }
    try {
      this.state = parseScheduledActionsState(JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown);
    } catch (error: unknown) {
      throw new Error(`Could not load scheduled actions from ${filePath}.`, { cause: error });
    }
  }

  snapshot(): ScheduledActionsState {
    return structuredClone(this.state);
  }

  transact<T>(mutate: (state: ScheduledActionsState) => T): Promise<T> {
    let result!: T;
    const operation = this.queue.then(async () => {
      const next = structuredClone(this.state);
      result = mutate(next);
      parseScheduledActionsState(next);
      if (isDeepStrictEqual(next, this.state)) return;
      await this.write(next);
      this.state = next;
    });
    this.queue = operation.catch(() => {});
    return operation.then(() => result);
  }

  flush(): Promise<void> {
    return this.queue;
  }

  private async write(state: ScheduledActionsState): Promise<void> {
    const directory = path.dirname(this.filePath);
    await fs.promises.mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.next`;
    try {
      await fs.promises.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      await fs.promises.rename(temporary, this.filePath);
    } finally {
      await fs.promises.rm(temporary, { force: true }).catch(() => {});
    }
  }
}
