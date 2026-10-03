import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('deployment capability checks cover positive and negative host fixtures', () => {
  const result = spawnSync('python3', ['-I', 'tests/host-dependencies/test_check.py'], {
    encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
