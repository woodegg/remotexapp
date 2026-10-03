import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const manifest = JSON.parse(readFileSync('apps/edge/manifest.json'));
const session = readFileSync('apps/edge/session.sh', 'utf8');
const probe = readFileSync('apps/edge/probe.py', 'utf8');
const shutdown = readFileSync('apps/edge/shutdown.sh', 'utf8');
const profileLocks = readFileSync('apps/edge/profile-locks.py', 'utf8');

test('Edge owns the locked persistent CDP contract', () => {
  assert.deepEqual([manifest.id, manifest.name, manifest.driverVersion], ['edge', 'Microsoft Edge', '2.0.4']);
  assert.deepEqual([manifest.runMode, manifest.singleton, manifest.profileRef], ['shared', true, 'default']);
  assert.deepEqual(
    [manifest.server.displayMode, manifest.server.geometry, manifest.server.depth, manifest.server.frameRate, manifest.server.allowClientResize],
    ['dynamic', '1280x720', 16, 5, true],
  );
  assert.deepEqual([manifest.session.activation, manifest.session.vacantTimeout, manifest.session.vacantAction], ['on-attach', '6h', 'stop-instance']);
  assert.match(session, /--remote-debugging-address="\$control_address"/);
  assert.match(session, /--remote-debugging-port="\$control_port"/);
  assert.match(session, /xdotool search --onlyvisible --class microsoft-edge/);
  assert.match(session, /REMOTEXAPP_SESSION_DEADLINE_MS - 5000/);
  assert.match(session, /time\.time_ns\(\) \/\/ 1000000/);
  assert.doesNotMatch(session, /date \+%s%3N/);
  assert.match(session, /session_status_report --state error --summary "Edge readiness failed"/);
  assert.match(probe, /\/json\/version/);
  assert.match(probe, /Browser\.getVersion/);
  assert.match(probe, /webSocketDebuggerUrl/);
  assert.equal(session.includes('application=edge-browser'), false);
  assert.match(session, /profile-locks\.py/);
  assert.match(shutdown, /profile-locks\.py/);
  assert.match(profileLocks, /SingletonLock/);
  assert.match(profileLocks, /SingletonSocket/);
  assert.match(profileLocks, /SingletonCookie/);
  assert.match(profileLocks, /--user-data-dir=/);
  assert.match(profileLocks, /MAX_QUARANTINES = 4/);
});

test('Edge CDP probe errors are bounded and do not print tracebacks', () => {
  const result = spawnSync('/usr/bin/python3', ['apps/edge/probe.py', '127.0.0.1', '1'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /allocated loopback port/);
  assert.doesNotMatch(result.stderr, /Traceback|File "/);
});
