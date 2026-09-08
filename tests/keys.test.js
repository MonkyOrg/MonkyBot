const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const keyModule = path.resolve(__dirname, '..', 'dist', 'utils', 'keys.js');

function fixture(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'monkybot-identity-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  return cwd;
}

function loadKeys(cwd) {
  const result = spawnSync(process.execPath, [
    '-e', `require(${JSON.stringify(keyModule)}).loadOrGenerateKeys();`,
  ], { cwd, encoding: 'utf8', timeout: 10000 });
  if (result.error) throw result.error;
  return result;
}

test('restarting reuses the identity kept alongside marketplace registrations', (t) => {
  const cwd = fixture(t);
  assert.equal(loadKeys(cwd).status, 0);
  const directory = path.join(cwd, '.keys');
  const publicKey = fs.readFileSync(path.join(directory, 'public.hex'), 'utf8');
  const privateKey = fs.readFileSync(path.join(directory, 'private.pem'), 'utf8');
  fs.writeFileSync(path.join(directory, 'registrations.json'), '{}');
  assert.equal(loadKeys(cwd).status, 0);
  assert.equal(fs.readFileSync(path.join(directory, 'public.hex'), 'utf8'), publicKey);
  assert.equal(fs.readFileSync(path.join(directory, 'private.pem'), 'utf8'), privateKey);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(directory, 'private.pem')).mode & 0o777, 0o600);
});

test('partial keys are not replaced with a new identity', (t) => {
  const cwd = fixture(t);
  const directory = path.join(cwd, '.keys');
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'public.hex'), 'existing-public-key');
  const result = loadKeys(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /identidade do bot est/);
  assert.equal(fs.readFileSync(path.join(directory, 'public.hex'), 'utf8'), 'existing-public-key');
  assert.equal(fs.existsSync(path.join(directory, 'private.pem')), false);
});

test('saved registrations without keys require restoring the matching identity', (t) => {
  const cwd = fixture(t);
  const directory = path.join(cwd, '.keys');
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'registrations.json'), '{}');
  const result = loadKeys(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /mesmo backup/);
  assert.deepEqual(fs.readdirSync(directory), ['registrations.json']);
});
