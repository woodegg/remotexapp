import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manifest = JSON.parse(readFileSync('apps/mousepad/manifest.json'));

test('Mousepad owns the no-control disposable App contract', () => {
  assert.deepEqual([manifest.runMode, manifest.singleton], ['isolated', false]);
  assert.deepEqual(manifest.ports, {});
  assert.deepEqual([manifest.session.activation, manifest.session.vacantTimeout, manifest.session.vacantAction], ['immediate', '60s', 'stop-instance']);
});

test('Mousepad 4.0.1 allows both verified distro identities without wildcard', () => {
  assert.equal(manifest.driverVersion, '4.0.1');
  assert.deepEqual(manifest.input.allowedWmClasses, ['Mousepad', 'Org.xfce.mousepad']);
});
