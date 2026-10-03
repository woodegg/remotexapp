import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const manifest = JSON.parse(readFileSync('apps/firefox-esr/manifest.json'));
const session = readFileSync('apps/firefox-esr/session.sh', 'utf8');

test('Firefox owns its persistent WebDriver BiDi contract', () => {
  assert.equal(manifest.driverVersion, '3.0.1');
  assert.deepEqual([manifest.runMode, manifest.singleton, manifest.profileRef], ['shared', true, 'default']);
  assert.deepEqual([manifest.server.geometry, manifest.server.depth, manifest.server.frameRate, manifest.server.allowClientResize], ['1280x720', 16, 5, true]);
  assert.deepEqual([manifest.session.activation, manifest.session.vacantTimeout, manifest.session.vacantAction], ['on-attach', '6h', 'stop-instance']);
  assert.deepEqual([manifest.driver.config.protocol, manifest.driver.config.path], ['webdriver-bidi', '/session']);
  assert.match(session, /REMOTEXAPP_RESOURCES/);
  assert.match(session, /session\.status/);
  assert.match(session, /--detail-json/);
  assert.doesNotMatch(session, /REMOTEXAPP_CONTROL_/);
});

test('Firefox preserves native IME focus without disabling BiDi recommended preferences', () => {
  const preferences = session.match(/cat >"\$profile_dir\/user.js" <<'EOF'\n([\s\S]*?)\nEOF/)[1];
  assert.match(preferences, /user_pref\("focusmanager\.testmode", false\);/);
  assert.doesNotMatch(preferences, /user_pref\("remote\.prefs\.recommended", false\)/);
  assert.ok(session.indexOf('focusmanager.testmode') < session.indexOf('--remote-debugging-port'));
  assert.match(session, /--remote-debugging-port "\$control_port"/);
  assert.match(session, /select\(\. == "127\.0\.0\.1"\)/);
});

test('Firefox rewrites stale test-mode preferences on every profile launch', () => {
  const profile = mkdtempSync(join(tmpdir(), 'firefox-prefs-test-'));
  try {
    const block = session.match(/cat >"\$profile_dir\/user.js" <<'EOF'\n[\s\S]*?\nEOF/)[0];
    for (const previous of ['', 'user_pref("focusmanager.testmode", true);\n']) {
      writeFileSync(join(profile, 'user.js'), previous);
      execFileSync('/bin/sh', ['-eu', '-c', block], { env:{ ...process.env, profile_dir:profile } });
      const actual = readFileSync(join(profile, 'user.js'), 'utf8');
      assert.match(actual, /user_pref\("focusmanager\.testmode", false\);/);
      assert.doesNotMatch(actual, /user_pref\("focusmanager\.testmode", true\);/);
    }
  } finally {
    rmSync(profile, { recursive:true, force:true });
  }
});
