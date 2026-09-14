const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { getEventListeners } = require('node:events');
const { test, after, beforeEach } = require('node:test');
const root = fs.mkdtempSync(path.join(__dirname, '.update-download-'));
const previousEnv = {};
for (const [key, value] of Object.entries({
  HOME: root, USERPROFILE: root, PM2_HOME: path.join(root, 'pm2'),
  MONKY_BOT_LOCALE: 'pt-BR', MONKYBOT_LOCALE: 'pt-BR',
})) {
  previousEnv[key] = process.env[key];
  process.env[key] = value;
}
after(() => {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
const { downloadUpdate } = require('../dist/cli/updateDownload');
const { createDownloadProgress } = require('../dist/cli/progress');
const { setCliLocale } = require('../dist/cli/i18n');

beforeEach(t => {
  setCliLocale('pt-BR');
  t.mock.method(global, 'fetch', () => assert.fail('Unexpected real network access'));
});

const hash = value => createHash('sha256').update(value).digest('hex');
const data = Buffer.from('abcdefghi');
const asset = {
  version: '6.0.4-beta', htmlUrl: '',
  tgzUrl: 'https://github.com/MonkyOrg/MonkyBot/releases/download/v6.0.4-beta/monky-bot-6.0.4-beta.tgz',
};
function destination(t) {
  const directory = fs.mkdtempSync(path.join(root, 'download-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'package.tgz');
}
function response(chunks, headers = {}) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(Buffer.from(chunk));
      controller.close();
    },
  }), { headers });
}

for (const source of ['release metadata', 'HTTP length', 'both', 'unknown']) {
  test(`update progress reports actual bounded chunk bytes (${source})`, async t => {
    const events = [];
    const output = destination(t);
    const controller = new AbortController();
    const metadata = source === 'release metadata' || source === 'both' ? { size: data.length, sha256: hash(data) } : {};
    const headers = source === 'HTTP length' || source === 'both' ? { 'content-length': String(data.length) } : {};
    t.mock.method(global, 'fetch', async (url, options) => {
      assert.equal(String(url), asset.tgzUrl);
      assert.equal(options.redirect, 'manual');
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(options.headers['Accept-Encoding'], 'identity');
      return response(['ab', 'cde', 'fghi'], headers);
    });
    await downloadUpdate({ ...asset, ...metadata }, output, controller.signal, {
      onProgress: progress => events.push(progress),
      onVerify: () => events.push('verification'),
    });
    assert.equal(fs.readFileSync(output, 'utf8'), data.toString());
    const transfers = events.filter(value => typeof value === 'object');
    assert.deepEqual(transfers.map(value => value.receivedBytes), [0, 2, 5, 9, 9]);
    assert.ok(transfers.every(value => value.totalBytes === (source === 'unknown' ? undefined : 9)));
    assert.equal(transfers.at(-1).done, true);
    assert.equal(events.at(-1), 'verification');
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  });
}

test('only approved GitHub release redirects are followed, without forwarding credentials', async t => {
  const requests = [];
  t.mock.method(global, 'fetch', async (url, options) => {
    requests.push(String(url));
    assert.equal(options.headers.Authorization, undefined);
    return requests.length === 1
      ? new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/fixture/package' } })
      : response([data]);
  });
  await downloadUpdate({ ...asset, size: data.length, sha256: hash(data) }, destination(t), new AbortController().signal);
  assert.deepEqual(requests, [asset.tgzUrl, 'https://release-assets.githubusercontent.com/fixture/package']);
});

for (const url of [
  'http://github.com/file', 'https://attacker.invalid/file', 'https://github.com:444/file',
  'https://user:pass@github.com/file', 'https://github.com/file#fragment',
]) {
  test(`update rejects an unapproved redirect before contacting it (${url})`, async t => {
    const fetch = t.mock.method(global, 'fetch', async () => new Response(null, { status: 302, headers: { location: url } }));
    await assert.rejects(downloadUpdate(asset, destination(t), new AbortController().signal), /origem não autorizada/);
    assert.equal(fetch.mock.callCount(), 1);
  });
}

test('the initial update URL must be the exact package for the selected official version', async t => {
  for (const changed of [
    { tgzUrl: 'https://github.com/other/repository/releases/download/v6.0.4-beta/monky-bot-6.0.4-beta.tgz' },
    { version: '6.0.5-beta' }, { version: '../injected' },
    { tgzUrl: `${asset.tgzUrl}?other=asset` },
  ]) await assert.rejects(downloadUpdate({ ...asset, ...changed }, destination(t), new AbortController().signal), /origem/);
  assert.equal(global.fetch.mock.callCount(), 0);
});

test('redirect loops stop at a bounded number of requests', async t => {
  const fetch = t.mock.method(global, 'fetch', async () =>
    new Response(null, { status: 302, headers: { location: asset.tgzUrl } }));
  await assert.rejects(downloadUpdate(asset, destination(t), new AbortController().signal), /Redirecionamentos demais/);
  assert.equal(fetch.mock.callCount(), 6);
});

for (const [status, error] of [[302, /sem destino/], [403, /HTTP 403/], [404, /HTTP 404/]]) {
  test(`HTTP/redirect failure is surfaced without transfer completion (${status})`, async t => {
    const events = [];
    t.mock.method(global, 'fetch', async () => new Response(null, { status }));
    await assert.rejects(downloadUpdate(asset, destination(t), new AbortController().signal, {
      onProgress: value => events.push(value),
    }), error);
    assert.deepEqual(events, []);
  });
}

for (const metadata of [
  { size: 0 }, { size: -1 }, { size: 1.5 }, { size: Number.MAX_SAFE_INTEGER },
  { sha256: 'invalid' }, { sha256: `sha256:${hash(data)}` },
]) {
  test(`invalid published update metadata is rejected before download (${JSON.stringify(metadata)})`, async t => {
    await assert.rejects(downloadUpdate({ ...asset, ...metadata }, destination(t), new AbortController().signal),
      /metadados.*inválidos/);
    assert.equal(global.fetch.mock.callCount(), 0);
  });
}

for (const [headers, metadata, chunks, error] of [
  [{ 'content-length': '0' }, {}, [], /limite/],
  [{ 'content-length': 'not-a-number' }, {}, ['abc'], /limite/],
  [{ 'content-length': String(351 * 1024 * 1024) }, {}, [], /limite/],
  [{ 'content-length': '8' }, { size: 9 }, ['abcdefghi'], /tamanho\/checksum/],
  [{ 'content-encoding': 'gzip' }, {}, ['abc'], /metadados/],
  [{ 'content-length': '3' }, {}, ['ab', 'cd'], /limite/],
  [{ 'content-length': '5' }, {}, ['abc'], /tamanho\/checksum/],
  [{}, { size: 3, sha256: hash('abc') }, ['abd'], /tamanho\/checksum/],
  [{}, {}, [], /tamanho\/checksum/],
]) {
  test(`malformed/truncated/oversized/corrupt update is not accepted (${JSON.stringify({ headers, metadata, chunks })})`, async t => {
    const events = [];
    t.mock.method(global, 'fetch', async () => response(chunks, headers));
    const controller = new AbortController();
    await assert.rejects(downloadUpdate({ ...asset, ...metadata }, destination(t), controller.signal, {
      onProgress: value => events.push(value),
    }), error);
    assert.ok(events.every(value => value.totalBytes === undefined || value.receivedBytes <= value.totalBytes));
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  });
}

test('an existing package file is not overwritten or downloaded into', async t => {
  const output = destination(t);
  fs.writeFileSync(output, 'keep this file');
  await assert.rejects(downloadUpdate(asset, output, new AbortController().signal), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(output, 'utf8'), 'keep this file');
  assert.equal(global.fetch.mock.callCount(), 0);
});

test('partial filesystem writes are completed before reporting downloaded bytes', async t => {
  const open = fs.promises.open;
  let writes = 0;
  t.mock.method(fs.promises, 'open', async (...args) => {
    const file = await open(...args);
    return {
      write: (buffer, offset, length) => { writes++; return file.write(buffer, offset, Math.min(1, length)); },
      sync: () => file.sync(), close: () => file.close(),
    };
  });
  t.mock.method(global, 'fetch', async () => response(['abc']));
  const output = destination(t);
  const events = [];
  await downloadUpdate({ ...asset, size: 3, sha256: hash('abc') }, output, new AbortController().signal, {
    onProgress: value => events.push(value),
  });
  assert.equal(writes, 3);
  assert.deepEqual(events.map(value => value.receivedBytes), [0, 3, 3]);
  assert.equal(fs.readFileSync(output, 'utf8'), 'abc');
});

test('cancellation releases an in-flight reader, closes the file and does not invent completion', async t => {
  const controller = new AbortController();
  let cancelled = false;
  let started;
  const reading = new Promise(resolve => { started = resolve; });
  t.mock.method(global, 'fetch', async () => new Response(new ReadableStream({
    cancel() { cancelled = true; },
  })));
  const output = destination(t);
  const lines = [];
  const progress = createDownloadProgress('Package', { write: value => lines.push(value) });
  const pending = downloadUpdate({ ...asset, size: 99 }, output, controller.signal, {
    onProgress: value => { progress.update(value); started(); },
  });
  const rejection = assert.rejects(pending, /fixture cancellation/);
  await reading;
  controller.abort(new Error('fixture cancellation'));
  await rejection;
  progress.finish();
  assert.equal(cancelled, true);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assert.doesNotMatch(lines.join(''), /100%/);
  fs.unlinkSync(output);
});

test('English update errors use the shared CLI language choice', async t => {
  setCliLocale('en');
  t.mock.method(global, 'fetch', async () => new Response(null, { status: 403 }));
  await assert.rejects(downloadUpdate(asset, destination(t), new AbortController().signal),
    /Could not download the update \(HTTP 403\)/);
});

test('cancellation while closing a completed update download is not reported as a successful download', async t => {
  const controller = new AbortController();
  const open = fs.promises.open;
  t.mock.method(fs.promises, 'open', async (...args) => {
    const file = await open(...args);
    return {
      write: (...writeArgs) => file.write(...writeArgs),
      sync: () => file.sync(),
      close: async () => {
        controller.abort(new Error('fixture cancellation during close'));
        await file.close();
      },
    };
  });
  t.mock.method(global, 'fetch', async () => response(['abc']));
  const output = destination(t);
  await assert.rejects(downloadUpdate({ ...asset, size: 3, sha256: hash('abc') }, output, controller.signal),
    /fixture cancellation during close/);
  fs.unlinkSync(output);
});
