import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const commit = 'b'.repeat(40);

function fixture(toolchain = 'go1.27.1') {
  const root = mkdtempSync(join(tmpdir(), 'remotexapp-evidence-test-'));
  const archive = join(root, 'remotexapp-test-linux-amd64.tar.gz');
  const evidence = join(root, 'candidate-evidence.json');
  writeFileSync(archive, 'candidate bytes');
  const sha256 = createHash('sha256').update('candidate bytes').digest('hex');
  writeFileSync(evidence, `${JSON.stringify({
    schemaVersion: 'remotexapp/evidence/v1',
    kind: 'candidate',
    runId: 'fixture:candidate',
    commit,
    startedAt: '2026-09-04T12:00:00Z',
    completedAt: '2026-09-04T12:00:01Z',
    result: 'passed',
    toolchain: { go: toolchain },
    environment: { kind: 'fixture', name: 'candidate-verifier' },
    artifact: { name: 'remotexapp-test-linux-amd64.tar.gz', sha256 },
    scenarios: [{ id: 'release-ci', result: 'passed' }],
    details: { version: 'test', sdkVersion: 'test' },
  }, null, 2)}\n`);
  return { root, archive, evidence };
}

test('candidate verifier binds evidence to exact bytes and commit', (t) => {
  const value = fixture();
  t.after(() => rmSync(value.root, { recursive: true, force: true }));
  assert.doesNotThrow(() => execFileSync(process.execPath, [
    'scripts/verify-candidate-evidence.mjs', value.evidence, value.archive, commit,
  ]));
  assert.throws(() => execFileSync(process.execPath, [
    'scripts/verify-candidate-evidence.mjs', value.evidence, value.archive, 'c'.repeat(40),
  ], { stdio: 'ignore' }));
  writeFileSync(value.archive, 'tampered bytes');
  assert.throws(() => execFileSync(process.execPath, [
    'scripts/verify-candidate-evidence.mjs', value.evidence, value.archive, commit,
  ], { stdio: 'ignore' }));
});

test('candidate verifier rejects the previous release toolchain', (t) => {
  const value = fixture('go1.26.8');
  t.after(() => rmSync(value.root, { recursive: true, force: true }));
  assert.throws(() => execFileSync(process.execPath, [
    'scripts/verify-candidate-evidence.mjs', value.evidence, value.archive, commit,
  ], { stdio: 'ignore' }));
});
