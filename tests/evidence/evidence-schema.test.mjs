import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEvidence } from '../../scripts/evidence-lib.mjs';

const valid = {
  schemaVersion: 'remotexapp/evidence/v1',
  kind: 'integration',
  runId: 'fixture:1',
  commit: 'a'.repeat(40),
  startedAt: '2026-09-04T12:00:00Z',
  completedAt: '2026-09-04T12:00:01Z',
  result: 'passed',
  toolchain: { go: 'go1.26.8', node: 'v22.19.0' },
  environment: { kind: 'fixture', name: 'unit-test' },
  scenarios: [{ id: 'example', result: 'passed', durationMs: 1 }],
};

test('accepts the prospective evidence v1 envelope', () => {
  assert.equal(validateEvidence(structuredClone(valid)).result, 'passed');
});

test('rejects missing identity, invalid time, duplicate scenarios, and absent candidate artifact', () => {
  for (const mutate of [
    (value) => { delete value.commit; },
    (value) => { value.completedAt = '2026-09-04T11:59:59Z'; },
    (value) => { value.scenarios.push({ ...value.scenarios[0] }); },
    (value) => { value.kind = 'candidate'; },
  ]) {
    const value = structuredClone(valid);
    mutate(value);
    assert.throws(() => validateEvidence(value));
  }
});
