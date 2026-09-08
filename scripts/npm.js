const { spawnSync } = require('node:child_process');

function runNpm(args, options = {}) {
  const npmCli = process.env.npm_execpath;
  let command;
  let argv;
  if (npmCli?.endsWith('.js')) {
    command = process.execPath;
    argv = [npmCli, ...args];
  } else if (process.platform === 'win32') {
    command = process.env.ComSpec || 'cmd.exe';
    argv = ['/d', '/s', '/c', `npm ${args.map((arg) => `"${arg.replace(/"/g, '""')}"`).join(' ')}`];
  } else {
    command = 'npm';
    argv = args;
  }
  const result = spawnSync(command, argv, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsVerbatimArguments: process.platform === 'win32' && !npmCli?.endsWith('.js'),
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`npm ${args[0]} failed:\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

module.exports = { runNpm };
