import assert from 'node:assert/strict';
import test from 'node:test';

import { managedPrimaryAction, standaloneRuntimes } from '../console-src/navigation-model.mjs';

test('managed child runtimes never appear in standalone navigation', () => {
  const runtimes = [
    { id:'temporary-1' },
    { id:'managed-runtime-1', managedInstanceId:'desktop' },
    { id:'temporary-2', managedInstanceId:'' },
  ];
  assert.deepEqual(standaloneRuntimes(runtimes).map(item => item.id), ['temporary-1', 'temporary-2']);
});

test('managed primary actions distinguish start from existing-runtime connection', () => {
  assert.deepEqual(managedPrimaryAction({ desiredState:'stopped', runtime:null }), {
    kind:'start-and-connect', label:'Start and connect',
  });
  assert.deepEqual(managedPrimaryAction({ desiredState:'running', runtime:{ state:'server-ready' } }), {
    kind:'connect', label:'Connect',
  });
  assert.deepEqual(managedPrimaryAction({ desiredState:'running', runtime:{ state:'starting' } }), {
    kind:'waiting', label:'Starting…',
  });
});
