import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('App Package artifacts are deterministic and exclude source-only files', () => {
  const first = mkdtempSync(join(tmpdir(), 'remotexapp-app-artifact-a-'));
  const second = mkdtempSync(join(tmpdir(), 'remotexapp-app-artifact-b-'));
  const env = {...process.env};
  delete env.SOURCE_DATE_EPOCH;
  const archiveA = execFileSync('scripts/package-app.sh', ['apps/edge', first], {env, encoding: 'utf8'}).trim();
  const archiveB = execFileSync('scripts/package-app.sh', ['apps/edge', second], {env, encoding: 'utf8'}).trim();
  assert.deepEqual(readFileSync(archiveA), readFileSync(archiveB));
  const names = execFileSync('tar', ['-tzf', archiveA], {encoding: 'utf8'}).trim().split('\n');
  assert.ok(names.includes('./manifest.json'));
  assert.ok(names.includes('./LICENSE'));
  assert.equal(names.some((name) => name === './README.md' || name.startsWith('./tests/')), false);
});

test('App Package archives exclude local Python bytecode caches', () => {
  const work = mkdtempSync(join(tmpdir(), 'remotexapp-app-bytecode-'));
  const source = join(work, 'source');
  cpSync('apps/lightview', source, { recursive:true });
  mkdirSync(join(source, '__pycache__'), { recursive:true });
  writeFileSync(join(source, '__pycache__', 'control.cpython-312.pyc'), 'untracked bytecode');
  const archive = execFileSync('scripts/package-app.sh', [source, join(work, 'dist')], { encoding:'utf8' }).trim();
  const names = execFileSync('tar', ['-tzf', archive], { encoding:'utf8' }).trim().split('\n');
  assert.equal(names.some(name => name.includes('__pycache__') || name.endsWith('.pyc')), false);
});
