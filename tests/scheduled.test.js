const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const {
  ScheduledActionsService, selectGiveawayWinners,
} = require('../dist/commands/scheduled');
const { ScheduledActionsStore } = require('../dist/scheduled/store');
const { botMessageText } = require('./helpers/bot-message');
const { botFormSchema, liveActionCreateSchema } = createRequire(require.resolve('@monky/bot-sdk'))('@monky/shared');

const flush = () => new Promise(resolve => setImmediate(resolve));

class Bot extends EventEmitter {
  constructor() {
    super();
    this.commands = new Map();
    this.actions = [];
    this.messages = [];
    this.closedActions = [];
  }
  command(definition) {
    this.commands.set(definition.name, definition);
    return this;
  }
  onLiveActionSubmission(listener) {
    const handler = (event, context) => listener(event, context);
    this.on('submission', handler);
    return () => this.off('submission', handler);
  }
  async listLiveActions(serverId) {
    return this.actions.filter(action => action.serverId === serverId && !this.closedActions.includes(action.id));
  }
  async closeLiveAction(serverId, id) {
    this.closedActions.push(id);
  }
  async sendMessage(serverId, channelId, content) {
    const sent = { id: `message-${this.messages.length + 1}`, serverId, channelId, content };
    this.messages.push(sent);
    return sent;
  }
}

function workspace(t) {
  const directory = path.resolve(__dirname, '..', 'release', `scheduled-test-${randomUUID()}`);
  fs.mkdirSync(directory, { recursive: true });
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'state.json');
}

function context({ values, locale = 'en', createLiveAction } = {}) {
  const forms = [];
  const replies = [];
  const published = [];
  return {
    forms, replies, published,
    ctx: {
      invocationId: `invocation-${randomUUID()}`, commandName: 'test',
      botId: 'bot', serverId: 'server', channelId: 'channel',
      invokerId: 'creator', invokerSessionId: 'session', invokerNickname: 'Creator Name',
      invokerVoiceChannelId: null, getVoiceChannel: async () => null,
      locale, settings: {}, args: {}, signal: new AbortController().signal,
      reply: content => replies.push(botMessageText(content, locale)),
      replyEphemeral: content => replies.push(botMessageText(content, locale)),
      publish: content => published.push(botMessageText(content, locale)),
      prompt: async form => { forms.push(form); return forms.length === 1 ? values : null; },
      createLiveAction: createLiveAction ?? (async () => assert.fail('Unexpected live action')),
    },
  };
}

test('reminders use a localized private form and survive a process restart', async t => {
  const file = workspace(t);
  let now = 1_000_000;
  const bot = new Bot();
  const first = new ScheduledActionsService(bot, { storePath: file, now: () => now });
  const state = context({ values: { mensagem: ' Check backups ', prazo: 2, unidade: 'hours' }, locale: 'en' });
  await first.reminderCommand.handler(state.ctx);
  assert.equal(state.forms.length, 1);
  assert.equal(botFormSchema.safeParse(state.forms[0]).success, true);
  assert.equal(state.forms[0].title, 'Schedule reminder');
  assert.match(state.replies[0], /Reminder scheduled/);
  const pending = first.snapshot().reminders[0];
  assert.equal(pending.text, 'Check backups');
  assert.equal(pending.dueAt, now + 7_200_000);
  await first.dispose();

  now = pending.dueAt;
  const restartedBot = new Bot();
  const restarted = new ScheduledActionsService(restartedBot, { storePath: file, now: () => now });
  restarted.connected.add('server');
  await restarted.runDue();
  assert.equal(restartedBot.messages.length, 1);
  assert.match(botMessageText(restartedBot.messages[0].content, 'en'), /@Creator Name, reminder: Check backups/);
  assert.equal(restarted.snapshot().reminders[0].status, 'sent');
  assert.equal(new ScheduledActionsStore(file).snapshot().reminders[0].messageId, 'message-1');
  await restarted.dispose();
});

test('repeating reminders persist their remaining deliveries and skip missed intervals', async t => {
  const file = workspace(t);
  let now = 1_000;
  const bot = new Bot();
  const service = new ScheduledActionsService(bot, { storePath: file, now: () => now });
  const state = context({
    values: {
      mensagem: 'Daily check', prazo: 1, unidade: 'minutes',
      repeticao: 'daily', repeticoes: 3,
    },
  });
  await service.reminderCommand.handler(state.ctx);
  service.connected.add('server');
  now += 60_000;
  await service.runDue();
  let reminder = service.snapshot().reminders[0];
  assert.equal(reminder.status, 'pending');
  assert.equal(reminder.sentOccurrences, 1);
  assert.equal(reminder.dueAt, now + 86_400_000);
  await service.dispose();

  now += 10 * 86_400_000;
  const restartedBot = new Bot();
  const restarted = new ScheduledActionsService(restartedBot, { storePath: file, now: () => now });
  restarted.connected.add('server');
  await restarted.runDue();
  reminder = restarted.snapshot().reminders[0];
  assert.equal(reminder.sentOccurrences, 2);
  assert.equal(reminder.status, 'pending');
  assert.equal(reminder.dueAt, now + 86_400_000);
  now = reminder.dueAt;
  await restarted.runDue();
  assert.equal(restarted.snapshot().reminders[0].status, 'sent');
  assert.equal(restartedBot.messages.length, 2);
  await restarted.dispose();
});

test('invalid reminder and giveaway values reopen valid forms without publishing', async t => {
  const bot = new Bot();
  const service = new ScheduledActionsService(bot, { storePath: workspace(t) });
  const reminder = context({ values: { mensagem: 'x', prazo: 366, unidade: 'days' } });
  await service.reminderCommand.handler(reminder.ctx);
  assert.equal(reminder.forms.length, 2);
  assert.equal(botFormSchema.safeParse(reminder.forms[1]).success, true);
  assert.match(reminder.replies[0], /whole-number duration/);
  const giveaway = context({ values: { premio: 'Prize', prazo: 31, unidade: 'days', vencedores: 1 } });
  await service.giveawayCommand.handler(giveaway.ctx);
  assert.equal(giveaway.forms.length, 2);
  assert.equal(botFormSchema.safeParse(giveaway.forms[1]).success, true);
  assert.equal(service.snapshot().giveaways.length, 0);
  await service.dispose();
});

test('giveaways persist distinct user IDs, recover, close, and reuse one cryptographic draw', async t => {
  const file = workspace(t);
  let now = 2_000_000;
  const bot = new Bot();
  const service = new ScheduledActionsService(bot, { storePath: file, now: () => now, randomIndex: () => 1 });
  const state = context({
    values: { premio: 'A useful prize', regras: 'Members only', prazo: 1, unidade: 'minutes', vencedores: 2 },
    createLiveAction: async input => {
      const parsed = liveActionCreateSchema.parse({ ...input, channelId: 'channel', invocationId: state.ctx.invocationId });
      const action = {
        ...parsed, id: parsed.id, serverId: 'server', botId: 'bot', creatorUserId: 'creator',
        createdAt: now, revision: 0,
      };
      bot.actions.push(action);
      return action;
    },
  });
  await service.giveawayCommand.handler(state.ctx);
  assert.equal(state.forms[0].title, 'Create giveaway');
  assert.deepEqual(state.forms[0].fields.find(field => field.name === 'imagens').presentation,
    { format: 'banner', fit: 'cover', size: 'regular' });
  assert.equal(state.published.length, 1);
  assert.deepEqual(bot.actions[0].imagePresentation, { format: 'banner', fit: 'cover', size: 'regular' });
  assert.equal(service.snapshot().giveaways[0].status, 'open');
  const id = state.ctx.invocationId;
  for (const [userId, userNickname] of [['alice', 'Alice'], ['alice', 'Alice again'], ['bob', 'Bob'], ['carol', 'Carol']]) {
    bot.emit('submission', {
      id, submissionId: randomUUID(), channelId: 'channel', userId, userNickname,
      expectedRevision: 0, locale: 'en', values: { participar: true },
    }, { serverId: 'server' });
  }
  await service.store.flush();
  assert.deepEqual(service.snapshot().giveaways[0].entrants.map(entry => entry.userId), ['alice', 'bob', 'carol']);
  now += 60_000;
  bot.emit('submission', {
    id, submissionId: randomUUID(), channelId: 'channel', userId: 'late', userNickname: 'Late',
    expectedRevision: 0, locale: 'en', values: { participar: true },
  }, { serverId: 'server' });
  await service.store.flush();
  assert.equal(service.snapshot().giveaways[0].entrants.some(entry => entry.userId === 'late'), false);
  await service.dispose();

  const restartedBot = new Bot();
  restartedBot.actions = bot.actions;
  const restarted = new ScheduledActionsService(restartedBot, { storePath: file, now: () => now, randomIndex: () => 1 });
  restarted.connected.add('server');
  await restarted.runDue();
  const closed = restarted.snapshot().giveaways[0];
  assert.equal(closed.status, 'closed');
  assert.deepEqual(closed.winners.map(entry => entry.userId), ['bob', 'carol']);
  assert.deepEqual(restartedBot.closedActions, [id]);
  assert.equal(restartedBot.messages.length, 1);
  assert.match(botMessageText(restartedBot.messages[0].content, 'en'), /@Bob[\s\S]*@Carol/);
  assert.match(botMessageText(restartedBot.messages[0].content, 'en'), /Valid entries: 3/);
  await restarted.dispose();
});

test('winner selection is unique, bounded, and rejects a broken randomness source', () => {
  const entrants = Array.from({ length: 5 }, (_, index) => ({ userId: String(index), nickname: `User ${index}` }));
  const winners = selectGiveawayWinners(entrants, 10, upper => upper - 1);
  assert.equal(winners.length, entrants.length);
  assert.equal(new Set(winners.map(entry => entry.userId)).size, entrants.length);
  assert.throws(() => selectGiveawayWinners(entrants, 1, upper => upper), /invalid value/);
});

test('corrupt scheduled state fails closed instead of silently discarding jobs', t => {
  const file = workspace(t);
  fs.writeFileSync(file, '{"version":1,"reminders":"lost","giveaways":[]}');
  assert.throws(() => new ScheduledActionsStore(file), /Could not load scheduled actions/);
});
