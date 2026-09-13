const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

for (const [args, expected, status] of [
  [['--help'], /music-setup/, 0],
  [['--version'], /monkybot \d+\.\d+\.\d+/, 0],
  [['config'], /configuração/i, 0],
  [['music-check'], /monkybot music-setup/, 1],
  [['music-check', '--unexpected'], /Uso: monkybot music-check/, 1],
  [['music-setup', '--unexpected'], /Uso: monkybot music-setup/, 1],
]) {
  test(`read-only or invalid CLI invocation never provisions tools: ${args.join(' ')}`, t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monky-music-cli-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
    const cli = path.resolve(__dirname, '..', 'dist', 'cli.js');
    const runner = `
      global.fetch = () => { throw new Error('UNEXPECTED_PROVISIONING'); };
      const { MusicError } = require(${JSON.stringify(path.resolve(__dirname, '..', 'dist', 'music', 'errors.js'))});
      require(${JSON.stringify(path.resolve(__dirname, '..', 'dist', 'music', 'process.js'))}).capture = async () => {
        throw new MusicError('tools', 'fixture missing executable');
      };
      process.argv = [process.execPath, ${JSON.stringify(cli)}, ...${JSON.stringify(args)}];
      require(${JSON.stringify(cli)});
    `;
    const result = spawnSync(process.execPath, ['-e', runner], {
      encoding: 'utf8', timeout: 15000,
      env: { ...process.env, HOME: root, USERPROFILE: root, NODE_OPTIONS: '', NODE_PATH: '' },
    });
    if (result.error) throw result.error;
    const output = result.stdout + result.stderr;
    assert.equal(result.status, status, output);
    assert.match(output, expected);
    assert.doesNotMatch(output, /UNEXPECTED_PROVISIONING/);
    assert.deepEqual(fs.readdirSync(root), []);
  });
}
