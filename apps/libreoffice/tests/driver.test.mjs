import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';

const manifest = JSON.parse(readFileSync('apps/libreoffice/manifest.json'));

test('LibreOffice owns its file, UNO, and destructive lifecycle contract', () => {
  assert.equal(manifest.parameters.filePath.type, 'file');
  assert.equal(manifest.parameters.filePath.required, undefined);
  assert.equal(manifest.driver.config.protocol, 'libreoffice-uno');
  assert.deepEqual([manifest.runMode, manifest.singleton, manifest.session.vacantTimeout], ['isolated', false, '60s']);
  const session = readFileSync('apps/libreoffice/session.sh', 'utf8');
  const shutdown = readFileSync('apps/libreoffice/shutdown.sh', 'utf8');
  for (const required of ['acquire_document_lease', 'remove_document_lock', 'profile-seed', 'os.O_NOFOLLOW', 'fuser']) {
    assert.match(session, new RegExp(required.replace('.', '\\.')));
  }
  assert.match(shutdown, /kill -KILL/);
  assert.doesNotMatch(shutdown, /ctrl\+s|xdotool|Alt\+F4/i);
});

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

async function waitForFile(path, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = readFileSync(path, 'utf8').trim();
      if (value) return value;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${path}`);
}

test('the LibreOffice profile seed is minimal and portable', () => {
  const seedRoot = 'apps/libreoffice/profile-seed';
  const userRoot = join(seedRoot, 'user');
  const names = readdirSync(userRoot);
  assert.deepEqual(names, ['registrymodifications.xcu']);
  const path = join(userRoot, names[0]);
  assert.equal(statSync(path).isFile(), true);
  assert.equal(statSync(path).mode & 0o022, 0);
  const content = readFileSync(path, 'utf8');
  for (const required of ['ooLocale', 'ooSetupInstCompleted']) assert.match(content, new RegExp(required));
  for (const forbidden of ['/home/', '/tmp/', 'file:///', 'javasettings', 'buildid', '.~lock.']) {
    assert.equal(content.includes(forbidden), false, `profile seed contains ${forbidden}`);
  }
});

test('destructive LibreOffice shutdown kills without saving and removes the document lock', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'remotexapp-libreoffice-shutdown-'));
  const document = join(root, 'unsaved document.odt');
  const parameters = join(root, 'parameters.json');
  const pidPath = join(root, 'libreoffice-process.pid');
  const lockPath = join(root, `.~lock.${basename(document)}#`);
  writeFileSync(document, 'original', { mode: 0o600 });
  writeFileSync(parameters, JSON.stringify({ filePath: document }), { mode: 0o600 });
  writeFileSync(lockPath, 'stale lock', { mode: 0o600 });

  const wrapper = spawn('/bin/sh', ['-c', 'sleep 60 & child=$!; printf "%s\\n" "$child" > "$1"; wait "$child"', 'sh', pidPath], {
    stdio: 'ignore',
  });
  t.after(() => wrapper.kill('SIGKILL'));
  await waitForFile(pidPath);

  const started = Date.now();
  const shutdown = spawn('/bin/sh', ['apps/libreoffice/shutdown.sh'], {
    env: { ...process.env, REMOTEXAPP_PARAMETERS: parameters, REMOTEXAPP_RUNTIME: root },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const result = await waitForExit(shutdown);
  assert.deepEqual(result, { code: 0, signal: null });
  assert.ok(Date.now() - started < 3000, 'destructive shutdown exceeded three seconds');
  assert.equal(readFileSync(document, 'utf8'), 'original');
  assert.throws(() => statSync(lockPath), { code: 'ENOENT' });
});
