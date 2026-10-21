import assert from 'node:assert/strict';
import test from 'node:test';
import {recoverySummary} from '../console-src/recovery-model.mjs';

test('operator recovery summary displays wait, block and successful health', () => {
  assert.equal(recoverySummary(null),'');
  assert.equal(recoverySummary({}), '');
  const pending=recoverySummary({recovery:{phase:'blocked',message:'Application processes remain',attempts:3,nextAttemptAt:'2026-10-21T00:00:00Z'}});
  assert.match(pending,/blocked.*Application processes remain.*attempts 3.*next/);
  assert.match(recoverySummary({recovery:{phase:'healthy',message:'Session health is confirmed',attempts:0,lastSuccessAt:'2026-10-21T00:00:00Z'}}),/healthy.*last healthy/);
});
