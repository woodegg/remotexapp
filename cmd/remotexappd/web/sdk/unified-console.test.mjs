import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../console-src/index.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../console.html', import.meta.url), 'utf8');

test('one unified console source owns operator, launch, and viewer modes', () => {
  assert.match(source, /mode = viewerMatch \? 'viewer'/);
  assert.match(source, /startViewer/);
  assert.match(source, /startConsole/);
  assert.match(shell, /\/console\/index[.]js/);
  assert.equal(existsSync(new URL('./console.html', import.meta.url)), false);
  assert.equal(existsSync(new URL('./minimal.html', import.meta.url)), false);
  assert.equal(existsSync(new URL('../index.html', import.meta.url)), false);
});

test('the unified shell resolves root and reverse-prefixed compatibility loaders', async () => {
  const inline = shell.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(inline, 'console loader script is missing');
  const executable = inline.replace(
    'await import(resolveConsoleEntry(location.pathname));',
    'return resolveConsoleEntry(location.pathname);',
  );
  const resolve = path => new Function('location', `return (async () => {${executable}})();`)({ pathname:path });
  for (const [path, expected] of [
    ['/', '/console/index.js'],
    ['/sdk/console.html', '/console/index.js'],
    ['/sdk/minimal.html', '/console/index.js'],
    ['/remotexapps/fixture/kiosk.html', '/console/index.js'],
    ['/tools/remotexapp/', '/tools/remotexapp/console/index.js'],
    ['/tools/remotexapp/sdk/console.html', '/tools/remotexapp/console/index.js'],
    ['/tools/remotexapp/remotexapps/fixture/kiosk.html', '/tools/remotexapp/console/index.js'],
  ]) {
    assert.equal(await resolve(path), expected, path);
  }
});

test('unified console stays App-neutral and never automatically retrieves the complete environment', () => {
  for (const forbidden of [
    'edge-browser', 'firefox-esr', 'libreoffice', 'mousepad', 'xfce-desktop',
    'getApplicationEnvironment', '/status/environment', 'localStorage', 'sessionStorage',
  ]) {
    assert.equal(source.includes(forbidden), false, `console contains forbidden coupling ${forbidden}`);
  }
  assert.match(source, /template[.]parameters/);
  assert.match(source, /template[.]overrides/);
  assert.match(source, /item[.]resources/);
  assert.match(source, /item[.]applicationStatus/);
});

test('operator navigation renders managed ownership once with explicit lifecycle verbs', () => {
  assert.match(source, /Managed applications/);
  assert.match(source, /Standalone runtimes/);
  assert.match(source, /standaloneRuntimes\(items\)/);
  assert.match(source, /Runtime details/);
  assert.match(source, /Open standalone and connect/);
  assert.match(source, /Create managed application and connect/);
  assert.match(source, /Start and connect/);
  assert.match(source, /text:primary[.]label/);
  assert.doesNotMatch(source, />Launch type<|>Managed registrations<|>Application runtimes</);
});

test('viewer mode exposes reconnect and diagnostics without lifecycle or service controls', () => {
  const viewerStart = source.indexOf('async function startViewer');
  const operatorStart = source.indexOf('async function startConsole');
  const viewer = source.slice(viewerStart, operatorStart);
  assert.match(viewer, /Reconnect/);
  assert.match(viewer, /Diagnostics/);
  assert.doesNotMatch(viewer, /stopInstance|restartInstance|restartManagerService|managed-instances/);
});

test('unified console validates clipboard modes only through the public SDK surface', () => {
  for (const mode of ['off', 'manual', 'prompt', 'auto']) assert.match(source, new RegExp(`['\"]${mode}['\"]`));
  assert.match(source, /client[.]clipboard[.]configure/);
  assert.match(source, /client[.]clipboard[.]syncToRemote/);
  assert.match(source, /client[.]clipboard[.]syncToLocal/);
  assert.match(source, /client[.]clipboard[.]checkAccess/);
  assert.match(source, /client[.]clipboard[.]requestReadAccess/);
  assert.match(source, /RemoteXAppClipboardPrompts/);
  assert.doesNotMatch(source, /clipboardMode=|clipboardToRemote=|clipboardToLocal=/);
});

test('operator console owns independent movable Viewer windows without coupling close to runtime stop', () => {
  assert.match(source, /const viewerWindows = new Map\(\)/);
  assert.match(source, /async function openViewer\(instance\)/);
  assert.match(source, /data-viewer-window/);
  assert.match(source, /Connect in new window/);
  assert.match(source, /entry[.]client[.]focus\(\)/);
  assert.match(source, /entry[.]client[.]destroy\(\)/);
  assert.match(source, /Ctrl\+F6|event[.]key !== 'F6'/);
  assert.match(source, /resize:both/);
  assert.match(source, /installWindowDrag/);
  assert.match(source, /node[.]classList[.]add\('minimized'\)/);
  const closeStart = source.indexOf('function closeViewer');
  const dragStart = source.indexOf('function installWindowDrag');
  assert.ok(closeStart >= 0 && dragStart > closeStart);
  assert.doesNotMatch(source.slice(closeStart, dragStart), /stopInstance|stopRuntime/);
});

test('operator console exposes one Client and clipboard surface per Viewer window', () => {
  assert.match(source, /new RemoteXAppClient\(\{ manager, instance, container:screen/);
  assert.match(source, /installClipboardControls\(client, clipboardHost, screen/);
  assert.match(source, /get clients\(\)/);
  assert.match(source, /get windows\(\)/);
});
