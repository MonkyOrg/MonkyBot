const assert = require('node:assert/strict');
const fs = require('node:fs');
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
    const root = fs.mkdtempSync(path.join(__dirname, '.music-cli-'));
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
      env: { ...process.env, HOME: root, USERPROFILE: root, TEMP: root, TMP: root, NODE_OPTIONS: '', NODE_PATH: '' },
    });
    if (result.error) throw result.error;
    const output = result.stdout + result.stderr;
    assert.equal(result.status, status, output);
    assert.match(output, expected);
    assert.doesNotMatch(output, /UNEXPECTED_PROVISIONING/);
    assert.deepEqual(fs.readdirSync(root), []);
  });
}

for (const locale of ['pt-BR', 'en']) {
  test(`CLI explains unsupported music links without native work or input disclosure (${locale})`, t => {
    const root = fs.mkdtempSync(path.join(__dirname, '.music-cli-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
    const cli = path.resolve(__dirname, '..', 'dist', 'cli.js');
    const checks = path.resolve(__dirname, '..', 'dist', 'music', 'toolChecks.js');
    const runner = `
      global.fetch = () => { throw new Error('UNEXPECTED_NETWORK'); };
      require(${JSON.stringify(checks)}).checkMusicTool = () => { throw new Error('UNEXPECTED_TOOL'); };
      process.argv = [process.execPath, ${JSON.stringify(cli)}, 'music-diagnose', '--url',
        'https://www.youtube.com/playlist?list=fixture-sensitive-value'];
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
    assert.match(output, locale === 'en' ? /Error: Only public individual YouTube videos/ : /Erro: Apenas vídeos individuais públicos do YouTube/);
    assert.doesNotMatch(output, /unsupported: unsupported|fixture-sensitive|UNEXPECTED_|https?:\/\//);
    assert.deepEqual(fs.readdirSync(root), []);
  });

  test(`CLI classifies the reported YouTube challenge without publishing authentication hints (${locale})`, t => {
    const root = fs.mkdtempSync(path.join(__dirname, '.music-cli-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
    const cli = path.resolve(__dirname, '..', 'dist', 'cli.js');
    const musicProcess = path.resolve(__dirname, '..', 'dist', 'music', 'process.js');
    const errors = path.resolve(__dirname, '..', 'dist', 'music', 'errors.js');
    const video = 'https://www.youtube.com/watch?v=x5A9Aa-WU5E';
    const native = "ERROR: [youtube] x5A9Aa-WU5E: Sign in to confirm you're not a bot. " +
      'Use --cookies-from-browser or --cookies for the authentication https://example.invalid/?token=fixture-sensitive';
    const runner = `
      global.fetch = () => { throw new Error('UNEXPECTED_NETWORK'); };
      const { MusicError } = require(${JSON.stringify(errors)});
      require(${JSON.stringify(musicProcess)}).capture = async (_executable, args) => {
        if (args.includes('--version')) return args.length === 1 ? 'v24.20.0' : '2026.08.19';
        if (args.includes('-encoders')) return ' A....D libopus Opus';
        if (!args.includes('--skip-download') || !args.includes('--no-playlist') ||
          args.at(-1) !== ${JSON.stringify(video)}) throw new Error('UNEXPECTED_MEDIA_OPERATION');
        throw new MusicError('unavailable', ${JSON.stringify(native)});
      };
      process.argv = [process.execPath, ${JSON.stringify(cli)}, 'music-diagnose', '--url', ${JSON.stringify(video)}];
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
    assert.match(output, /stage=resolve, providerCause=YOUTUBE_BOT_CHALLENGE/);
    assert.match(output, locale === 'en' ? /YouTube returned an anti-bot challenge/ : /O YouTube respondeu com um desafio anti-bot/);
    assert.match(output, /Sign in to confirm/);
    assert.doesNotMatch(output, /UNRESOLVED|UNEXPECTED_|result=accepted|--cookies|--proxy|fixture-sensitive|https?:\/\//);
    assert.deepEqual(fs.readdirSync(root), []);
  });
}
