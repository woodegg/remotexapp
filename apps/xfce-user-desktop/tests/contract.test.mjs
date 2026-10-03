import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manifest = JSON.parse(readFileSync('apps/xfce-user-desktop/manifest.json'));
const session = readFileSync('apps/xfce-user-desktop/session.sh', 'utf8');

test('XFCE user-home desktop owns its locked dedicated-account contract', () => {
  assert.deepEqual([manifest.runMode, manifest.singleton], ['user-home', true]);
  assert.deepEqual([manifest.server.displayMode, manifest.server.display, manifest.server.geometry], ['fixed', 1, '1280x720']);
  assert.equal(manifest.server.allowClientResize, false);
  assert.deepEqual(manifest.overrides.allowed, []);
  assert.equal(manifest.session.vacantAction, 'stop-session');
});

test('XFCE cold profile has a bounded window-manager readiness budget', () => {
  assert.equal(manifest.driverVersion, '3.0.1');
  assert.equal(manifest.session.readinessTimeout, '75s');
  assert.match(session, /for _ in \$\(seq 1 300\); do/);
  assert.match(session, /XFCE window manager did not become ready/);
});
