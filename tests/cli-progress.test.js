const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createDownloadProgress, downloadProgressLine } = require('../dist/cli/progress');

test('download percentages and bars use received bytes, without rounding up to completion', () => {
  assert.equal(downloadProgressLine('Download', { receivedBytes: 256, totalBytes: 1024 }, true),
    'Download: [=====---------------] 25% (256 B / 1.0 KiB)');
  assert.match(downloadProgressLine('Download', { receivedBytes: 1023, totalBytes: 1024 }), /99%/);
  assert.match(downloadProgressLine('Download', { receivedBytes: 1024, totalBytes: 1024 }), /100%/);
  assert.equal(downloadProgressLine('Download', { receivedBytes: 2 * 1024 * 1024 }),
    'Download: 2.0 MiB');
});

test('invalid or unbounded byte counts never produce a misleading percentage', () => {
  for (const progress of [
    { receivedBytes: -1 }, { receivedBytes: NaN }, { receivedBytes: Infinity },
    { receivedBytes: 1.5 }, { receivedBytes: 0, totalBytes: 0 },
    { receivedBytes: 0, totalBytes: Infinity }, { receivedBytes: 5, totalBytes: 4 },
  ]) assert.throws(() => downloadProgressLine('Download', progress), RangeError);
});

for (const isTTY of [false, true]) {
  test(`progress is rate-limited and always reports actual final bytes (TTY=${isTTY})`, () => {
    const writes = [];
    let time = 0;
    const progress = createDownloadProgress('Download', { isTTY, write: value => writes.push(value) }, () => time);
    progress.update({ receivedBytes: 0, totalBytes: 100 });
    progress.update({ receivedBytes: 30, totalBytes: 100 });
    assert.equal(writes.length, 1);
    time = isTTY ? 100 : 5000;
    progress.update({ receivedBytes: 30, totalBytes: 100 });
    progress.update({ receivedBytes: 100, totalBytes: 100 });
    progress.update({ receivedBytes: 100, totalBytes: 100, done: true });
    assert.equal(writes.length, 3);
    assert.match(writes[1], /30%/);
    assert.match(writes[2], /100%/);
    progress.finish();
    const count = writes.length;
    progress.finish();
    assert.equal(writes.length, count, 'Finishing twice must not add blank lines.');
    if (isTTY) {
      assert.match(writes[0], /^\r\u001b\[2K/);
      assert.equal(writes.at(-1), '\n');
    } else {
      assert.doesNotMatch(writes.join(''), /[\u001b\r]/, 'Pipes and log files do not get terminal control codes.');
    }
  });
}

test('unknown-size downloads finish with real bytes and no invented percentage or total', () => {
  const writes = [];
  const progress = createDownloadProgress('Package', { write: value => writes.push(value) }, () => 0);
  progress.update({ receivedBytes: 0 });
  progress.update({ receivedBytes: 42 });
  progress.update({ receivedBytes: 42, done: true });
  progress.finish();
  assert.deepEqual(writes, ['Package: 0 B\n', 'Package: 42 B\n']);
  assert.doesNotMatch(writes.join(''), /%/);
});

test('cancellation closes a terminal line without claiming completion', () => {
  const writes = [];
  const progress = createDownloadProgress('Download', { isTTY: true, write: value => writes.push(value) });
  progress.update({ receivedBytes: 8, totalBytes: 100 });
  progress.finish();
  assert.equal(writes.at(-1), '\n');
  assert.doesNotMatch(writes.join(''), /100%/);
});
