import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import test from 'node:test';

const expectedIds = [
  'edge',
  'firefox-esr',
  'kate',
  'kwrite',
  'libreoffice',
  'lightview',
  'mousepad',
  'xfce-user-desktop',
];

function read(path) {
  return readFileSync(path, 'utf8');
}

function manifest(id) {
  return JSON.parse(read(`apps/${id}/manifest.json`));
}

test('the shipped catalog consists only of independently packageable Apps', () => {
  const ids = readdirSync('apps')
    .filter((name) => statSync(`apps/${name}`).isDirectory())
    .sort();
  assert.deepEqual(ids, expectedIds);
  for (const id of ids) {
    const app = manifest(id);
    assert.equal(app.apiVersion, 'remotexapp/v1');
    assert.equal(app.id, id);
    assert.equal(app.session.services, 'core-v1');
    assert.equal(app.input.lifecycle, 'session');
    assert.match(app.driverVersion, /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/);
    assert.equal(Object.hasOwn(app, 'control'), false);
    assert.ok(app.ports && typeof app.ports === 'object');
    assert.ok(app.driver?.config && typeof app.driver.config === 'object');
    assert.ok(Array.isArray(app.overrides?.allowed));
    assert.ok(Array.isArray(app.dependencies?.executables));
    assert.ok(Array.isArray(app.dependencies?.pythonModules));
    assert.match(app.server.readinessTimeout, /^[0-9]+s$/);
    assert.match(app.session.readinessTimeout, /^[0-9]+s$/);
    assert.equal(statSync(`apps/${id}/LICENSE`).isFile(), true);
    for (const driver of [app.server.driver, app.session.driver, app.session.shutdownDriver]) {
      if (!driver) continue;
      assert.equal(driver.includes('/') || driver.startsWith('.'), false);
      assert.equal(statSync(`apps/${id}/${driver}`).isFile(), true);
    }
    const session = read(`apps/${id}/${app.session.driver}`);
    assert.match(session, /REMOTEXAPP_CORE_DRIVER_DIR/);
    assert.match(session, /session_status_report/);
    assert.doesNotMatch(session, /session_input_|session-input\.sh|session-(?:dbus|ibus|engine)\.(?:pid|sock)/);
    assert.doesNotMatch(session, /REMOTEXAPP_CONTROL_(ADDRESS|PORT|PROTOCOL|PATH)/);
    if (Object.hasOwn(app.ports, 'control')) {
      assert.equal(app.ports.control.kind, 'loopback-tcp');
      assert.equal(app.ports.control.port, 0);
      assert.equal(app.session.status.details.control.type, 'json');
      assert.match(session, /REMOTEXAPP_RESOURCES/);
      assert.match(session, /--detail-json/);
    }
  }
});

test('core production policy contains no shipped template branch', () => {
  const policy = read('cmd/remotexappd/policy.go');
  for (const id of expectedIds) assert.equal(policy.includes(id), false, `core policy names ${id}`);
  assert.doesNotMatch(policy, /template\.ID\s*==/);
});

test('core capability tests do not load shipped App Packages', () => {
  for (const file of ['cmd/remotexappd/main_test.go', 'cmd/remotexappd/security_test.go', 'cmd/remotexappd/runtime_manifest_test.go']) {
    const source = read(file);
    assert.equal(source.includes('loadRepositoryAppPackage'), false, `${file} loads a shipped package`);
    for (const id of expectedIds) assert.equal(source.includes(`"${id}"`), false, `${file} names ${id}`);
  }
});
