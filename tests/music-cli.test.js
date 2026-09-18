const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

for (const locale of ['pt-BR', 'en']) {
  for (const command of ['music-check', 'music-setup', 'music-diagnose']) {
    test(`retired CLI command cannot provision tools or leak its arguments (${command}, ${locale})`, t => {
      const root = fs.mkdtempSync(path.join(__dirname, '.music-cli-'));
      t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
      const cli = path.resolve(__dirname, '..', 'dist', 'cli.js');
      const runner = `
        const unexpected = () => { throw new Error('UNEXPECTED_SIDE_EFFECT'); };
        global.fetch = unexpected;
        const child = require('node:child_process');
        for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'execSync']) child[name] = unexpected;
        require('node:readline').createInterface = unexpected;
        process.argv = [process.execPath, ${JSON.stringify(cli)}, ${JSON.stringify(command)},
          '--url', 'https://example.invalid/?token=fixture-sensitive-value'];
        require(${JSON.stringify(cli)});
      `;
      const result = spawnSync(process.execPath, ['-e', runner], {
        encoding: 'utf8', timeout: 15000,
        env: {
          ...process.env, HOME: root, USERPROFILE: root, TEMP: root, TMP: root, NODE_OPTIONS: '', NODE_PATH: '',
          MONKY_BOT_LOCALE: locale, MONKYBOT_LOCALE: locale, MONKY_LANG: '', CI: '1',
        },
      });
      assert.ifError(result.error);
      const output = result.stdout + result.stderr;
      assert.equal(result.status, 1, output);
      assert.match(output, locale === 'en' ? /commands were removed/ : /comandos.*foram removidos/);
      assert.match(output, locale === 'en' ? /Monky client/ : /cliente Monky/);
      assert.doesNotMatch(output, /fixture-sensitive|UNEXPECTED_|https?:\/\//);
      assert.deepEqual(fs.readdirSync(root), []);
    });
  }
}
