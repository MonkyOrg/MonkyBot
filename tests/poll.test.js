const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const { pollCommand, pollResult, registerPollCommand } = require('../dist/commands/poll');
const { botFormSchema, validateBotFormValues } = createRequire(require.resolve('@monky/bot-sdk'))('@monky/shared');

const valid = { pergunta: ' Lunch? ', opcoes: [' Rice, beans ', 'Pasta'], duracao: 1, unidade: 'minutes' };
const flush = () => new Promise((resolve) => setImmediate(resolve));

function invocation(values = valid, locale = 'en') {
  const forms = [];
  const created = [];
  const replies = [];
  const controller = new AbortController();
  const ctx = {
    invocationId: 'invocation-id', channelId: 'channel', invokerId: 'caller', serverId: 'server',
    locale, signal: controller.signal, args: {},
    reply: (content) => replies.push(content),
    publish: () => assert.fail('Polls must use the durable selector API'),
    prompt: async (form) => { forms.push(form); return forms.length === 1 ? values : null; },
    createSelector: async (input) => { created.push(input); return selector(input); },
  };
  return { ctx, forms, created, replies, controller };
}

function selector(patch = {}) {
  return {
    id: 'poll-id', botId: 'bot', messageId: 'message', channelId: 'channel',
    title: 'Lunch?', choices: [{ label: 'Rice, beans', value: '1' }, { label: 'Pasta', value: '2' }],
    presentation: 'buttons', responder: 'any', allowChange: true, invokerId: 'caller',
    createdAt: 1, expiresAt: 60_001, closedAt: null, maxResponders: 3,
    responses: {}, resultMessageId: null, metadata: { kind: 'poll', locale: 'en' },
    ...patch,
  };
}

function lifecycle(t, polls = []) {
  const bot = new EventEmitter();
  const calls = [];
  const listed = [];
  let tick;
  let cleared = false;
  t.mock.method(global, 'setInterval', (callback, delay) => {
    assert.equal(delay, 30_000);
    tick = callback;
    return { unref() {} };
  });
  t.mock.method(global, 'clearInterval', () => { cleared = true; });
  const errors = t.mock.method(console, 'error', () => {});
  bot.command = (command) => assert.equal(command, pollCommand);
  bot.listSelectors = async (serverId) => { listed.push(serverId); return polls; };
  bot.finalizeSelector = async (serverId, id, content) => {
    calls.push({ serverId, id, content });
    const poll = polls.find((item) => item.id === id);
    if (poll) poll.resultMessageId = 'result-id';
    return poll;
  };
  const dispose = registerPollCommand(bot);
  t.after(dispose);
  return { bot, calls, listed, errors, dispose, tick: () => tick(), cleared: () => cleared };
}

for (const locale of ['pt-BR', 'en']) {
  test(`one private poll form immediately creates public changeable voting (${locale})`, async () => {
    const state = invocation(valid, locale);
    const before = Date.now();
    await pollCommand.handler(state.ctx);
    assert.equal(state.forms.length, 1);
    assert.equal(botFormSchema.safeParse(state.forms[0]).success, true);
    assert.equal(validateBotFormValues(state.forms[0], valid).success, true);
    assert.equal(state.forms[0].title, locale === 'en' ? 'Create a poll' : 'Criar enquete');
    assert.equal(state.forms[0].submitLabel, locale === 'en' ? 'Publish poll' : 'Publicar enquete');
    assert.equal(state.forms[0].fields.some((field) => field.name === 'visibilidade'), false);
    const options = state.forms[0].fields.find((field) => field.name === 'opcoes');
    assert.equal(options.type, 'string-list');
    assert.equal(options.minItems, 2);
    assert.equal(options.maxItems, 10);
    assert.equal(options.maxLength, 80);
    assert.equal(state.created.length, 1);
    const created = state.created[0];
    assert.equal(created.id, 'invocation-id');
    assert.equal(created.title, 'Lunch?');
    assert.deepEqual(created.choices, [{ label: 'Rice, beans', value: '1' }, { label: 'Pasta', value: '2' }]);
    assert.deepEqual(created.metadata, { kind: 'poll', locale });
    assert.equal(created.presentation, 'buttons');
    assert.equal(created.responder, 'any');
    assert.equal(created.allowChange, true);
    assert.ok(created.expiresAt >= before + 60_000 && created.expiresAt <= Date.now() + 60_000);
    assert.equal(state.replies.length, 1);
    assert.match(state.replies[0], locale === 'en' ? /Poll published/ : /Enquete publicada/);
  });

  test(`results show counts, percentages, winner, tie, and no votes (${locale})`, () => {
    const metadata = { kind: 'poll', locale };
    const winner = pollResult(selector({ metadata, closedAt: 5, responses: { a: '1', b: '1', c: '2' } }));
    assert.match(winner, locale === 'en' ? /Rice, beans — 2 \(66\.7%\)/ : /Rice, beans — 2 \(66,7%\)/);
    assert.match(winner, locale === 'en' ? /Winning option: 1/ : /Opção vencedora: 1/);
    assert.match(winner, locale === 'en' ? /Total votes: 3/ : /Total de votos: 3/);
    const tie = pollResult(selector({ metadata, closedAt: 5, responses: { a: '1', b: '2' } }));
    assert.match(tie, locale === 'en' ? /Tie between options: 1, 2/ : /Empate entre as opções: 1, 2/);
    const empty = pollResult(selector({ metadata, closedAt: 5 }));
    assert.match(empty, locale === 'en' ? /No votes were cast/ : /Nenhum voto foi registrado/);
    assert.doesNotMatch(empty, /NaN|Infinity|🏆|🤝/);
  });
}

test('duration accepts minutes/hours/days and either or both closing conditions', async () => {
  for (const [duration, unit, ms] of [[1, 'minutes', 60_000], [2, 'hours', 7_200_000], [30, 'days', 2_592_000_000], [43_200, 'minutes', 2_592_000_000]]) {
    const state = invocation({ ...valid, duracao: duration, unidade: unit, max_voters: 10_000 });
    const before = Date.now();
    await pollCommand.handler(state.ctx);
    assert.equal(state.created[0].maxResponders, 10_000);
    assert.ok(state.created[0].expiresAt >= before + ms && state.created[0].expiresAt <= Date.now() + ms);
  }
  const voterOnly = invocation({ pergunta: 'Vote?', opcoes: ['A', 'B'], max_voters: 1 });
  await pollCommand.handler(voterOnly.ctx);
  assert.equal(voterOnly.created[0].maxResponders, 1);
  assert.equal(voterOnly.created[0].expiresAt, undefined);
});

test('invalid or missing limits and invalid questions/options never publish', async () => {
  const invalid = [
    { duracao: undefined }, { duracao: 0 }, { duracao: -1 }, { duracao: 0.5 }, { duracao: '1' },
    { duracao: NaN }, { duracao: Infinity }, { duracao: 31, unidade: 'days' }, { duracao: 721, unidade: 'hours' },
    { duracao: 43_201 }, { unidade: 'weeks' }, { duracao: null },
    ...[0, -1, 10_001, 1.5, '1', true, NaN, Infinity, null].map((max_voters) => ({ max_voters })),
    { pergunta: '' }, { pergunta: ' ' }, { pergunta: 1 }, { pergunta: 'x'.repeat(201) },
    { opcoes: 'A,B' }, { opcoes: ['A'] }, { opcoes: [' A ', 'a'] }, { opcoes: ['A', ' '] },
    { opcoes: ['A', 2] }, { opcoes: ['x'.repeat(81), 'B'] },
    { opcoes: Array.from({ length: 11 }, (_, index) => String(index)) },
  ];
  for (const patch of invalid) {
    const state = invocation({ ...valid, ...patch });
    await pollCommand.handler(state.ctx);
    assert.equal(state.created.length, 0, JSON.stringify(patch));
    assert.equal(state.forms.length, 2);
    assert.equal(botFormSchema.safeParse(state.forms[1]).success, true, 'Retry defaults must remain valid field definitions.');
    assert.match(state.replies[0], /Check/);
  }
});

for (const locale of ['pt-BR', 'en']) {
  test(`cross-field failures preserve every valid input for correction (${locale})`, async () => {
    const state = invocation(valid, locale);
    const entries = [
      { pergunta: ' Keep my question ', opcoes: ['Game A, complete', 'Game B'], unidade: 'days' },
      { pergunta: ' Keep my question ', opcoes: ['Game A, complete', 'Game B'], duracao: 31, unidade: 'days', max_voters: 7 },
      { pergunta: ' Keep my question ', opcoes: ['Game A, complete', 'Game B'], duracao: 721, unidade: 'hours', max_voters: 7 },
      { pergunta: ' Keep my question ', opcoes: ['Game A, complete', 'Game B'], duracao: 2, unidade: 'hours', max_voters: 7 },
    ];
    state.ctx.prompt = async (form) => {
      state.forms.push(form);
      assert.equal(botFormSchema.safeParse(form).success, true);
      return entries[state.forms.length - 1] ?? null;
    };
    await pollCommand.handler(state.ctx);
    assert.equal(state.forms.length, 4);
    for (let index = 1; index < state.forms.length; index++) {
      const defaults = Object.fromEntries(state.forms[index].fields.map((field) => [field.name, field.defaultValue]));
      assert.equal(defaults.pergunta, entries[index - 1].pergunta);
      assert.deepEqual(defaults.opcoes, entries[index - 1].opcoes);
      assert.equal(defaults.duracao, entries[index - 1].duracao);
      assert.equal(defaults.unidade, entries[index - 1].unidade);
      assert.equal(defaults.max_voters, entries[index - 1].max_voters);
    }
    assert.equal(state.created.length, 1, 'Only the corrected form publishes; no review step is introduced.');
    assert.equal(state.created[0].title, 'Keep my question');
    assert.equal(state.created[0].maxResponders, 7);
    assert.deepEqual(state.created[0].choices.map((choice) => choice.label), entries[3].opcoes);
    assert.equal(state.replies.length, 4, 'Each invalid submission shows a private error before retrying.');
    assert.match(state.replies[0], locale === 'en' ? /Check/ : /Revise/);
  });
}

test('cancelled/aborted forms do not create polls and creation errors propagate', async () => {
  const cancelled = invocation(null);
  await pollCommand.handler(cancelled.ctx);
  assert.equal(cancelled.created.length + cancelled.replies.length, 0);
  const aborted = invocation();
  aborted.ctx.prompt = async () => { aborted.controller.abort(); return valid; };
  await pollCommand.handler(aborted.ctx);
  assert.equal(aborted.created.length + aborted.replies.length, 0);
  const failed = invocation();
  failed.ctx.createSelector = async () => { throw new Error('publication failed'); };
  await assert.rejects(pollCommand.handler(failed.ctx), /publication failed/);
  assert.equal(failed.replies.length, 0);
});

test('tallies use the latest distinct-user responses and stay within message limits', () => {
  const poll = selector({ closedAt: 5, responses: { alice: '1', bob: '2' } });
  poll.responses.alice = '2';
  assert.match(pollResult(poll), /Rice, beans — 0 \(0\.0%\)/);
  assert.match(pollResult(poll), /Pasta — 2 \(100\.0%\)/);
  assert.match(pollResult(poll), /Total votes: 2/);
  for (const locale of ['en', 'pt-BR']) {
    const largest = selector({
      title: 'Q'.repeat(200), metadata: { kind: 'poll', locale },
      choices: Array.from({ length: 10 }, (_, index) => ({ label: String(index).repeat(80), value: String(index) })),
      responses: Object.fromEntries(Array.from({ length: 10_000 }, (_, index) => [`user-${index}`, String(index % 10)])),
    });
    assert.ok(pollResult(largest).length <= 2000);
  }
});

test('selector updates finalize only closed polls and only once while in flight', async (t) => {
  const state = lifecycle(t);
  let resolve;
  state.bot.finalizeSelector = async (...args) => {
    state.calls.push(args);
    return new Promise((done) => { resolve = done; });
  };
  for (const poll of [
    selector(), selector({ metadata: { kind: 'other' }, closedAt: 5 }),
    selector({ closedAt: 5, resultMessageId: 'already-published' }),
  ]) state.bot.emit('selectorUpdate', { serverId: 'server', selector: poll });
  assert.equal(state.calls.length, 0);
  const closed = selector({ closedAt: 5, responses: { alice: '2' } });
  state.bot.emit('selectorUpdate', { serverId: 'server', selector: closed });
  state.bot.emit('selectorUpdate', { serverId: 'server', selector: closed });
  assert.equal(state.calls.length, 1);
  assert.match(state.calls[0][2], /Winning option: 2/);
  resolve(closed);
  await flush();
});

test('restart recovery finalizes expired/threshold-closed polls, including zero votes', async (t) => {
  const polls = [
    selector({ closedAt: 60_001 }),
    selector({ id: 'threshold', closedAt: 4, responses: { alice: '1', bob: '2', charlie: '2' } }),
    selector({ id: 'still-open' }),
    selector({ id: 'done', closedAt: 3, resultMessageId: 'published' }),
  ];
  const state = lifecycle(t, polls);
  state.bot.emit('connected', { serverId: 'server' });
  await flush();
  assert.deepEqual(state.calls.map((call) => call.id), ['poll-id', 'threshold']);
  assert.match(state.calls[0].content, /No votes were cast/);
  state.tick();
  await flush();
  assert.equal(state.calls.length, 2);
});

test('failed lists and publications are logged and retried periodically', async (t) => {
  const closed = selector({ closedAt: 5 });
  const state = lifecycle(t, [closed]);
  const originalList = state.bot.listSelectors;
  state.bot.listSelectors = async () => { throw new Error('list offline'); };
  state.bot.emit('connected', { serverId: 'server' });
  await flush();
  assert.equal(state.errors.mock.callCount(), 1);
  assert.match(state.errors.mock.calls[0].arguments[0], /Failed to list/);
  state.bot.listSelectors = originalList;
  const originalFinalize = state.bot.finalizeSelector;
  state.bot.finalizeSelector = async () => { throw new Error('publication offline'); };
  state.tick();
  await flush();
  assert.equal(state.errors.mock.callCount(), 2);
  assert.match(state.errors.mock.calls[1].arguments[0], /Failed to finalize/);
  state.bot.finalizeSelector = originalFinalize;
  state.tick();
  await flush();
  assert.equal(state.calls.length, 1);
  assert.equal(closed.resultMessageId, 'result-id');
});

test('lost finalize acknowledgment recovers without publishing a duplicate result', async (t) => {
  const closed = selector({ closedAt: 5 });
  const state = lifecycle(t, [closed]);
  const publish = state.bot.finalizeSelector;
  state.bot.finalizeSelector = async (...args) => {
    await publish(...args);
    throw new Error('acknowledgment lost');
  };
  state.bot.emit('connected', { serverId: 'server' });
  await flush();
  state.tick();
  await flush();
  assert.equal(state.calls.length, 1);
  assert.equal(state.errors.mock.callCount(), 1);
});

test('recovery serializes lists, isolates server IDs, and stops on disconnect/close', async (t) => {
  const state = lifecycle(t);
  let resolve;
  state.bot.listSelectors = async (serverId) => {
    state.listed.push(serverId);
    if (serverId === 'first') return new Promise((done) => { resolve = done; });
    return [selector({ closedAt: 5 })];
  };
  state.bot.emit('connected', { serverId: 'first' });
  state.tick();
  state.bot.emit('connected', { serverId: 'second' });
  await flush();
  assert.deepEqual(state.listed, ['first', 'second']);
  assert.equal(state.calls[0].serverId, 'second');
  state.bot.emit('disconnected', { serverId: 'first' });
  resolve([selector({ closedAt: 5 })]);
  await flush();
  assert.equal(state.calls.length, 1, 'Disconnected recovery must not publish');
  state.bot.emit('closed');
  assert.equal(state.cleared(), true);
  for (const event of ['connected', 'disconnected', 'selectorUpdate', 'closed']) {
    assert.equal(state.bot.listenerCount(event), 0);
  }
  state.tick();
  await flush();
  assert.deepEqual(state.listed, ['first', 'second']);
});

test('explicit disposal prevents pending recovery from publishing', async (t) => {
  const state = lifecycle(t);
  let resolve;
  state.bot.listSelectors = () => new Promise((done) => { resolve = done; });
  state.bot.emit('connected', { serverId: 'server' });
  state.dispose();
  state.dispose();
  resolve([selector({ closedAt: 5 })]);
  await flush();
  assert.equal(state.calls.length, 0);
});
