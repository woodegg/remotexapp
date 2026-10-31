// Two real editors on an owned managed desktop; no remote input injection.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {config, instance, open, ready, delay, key, ctrl, x} from './browser-fixture.mjs';

const targets = config.desktopTargets;
assert.equal(targets.length, 2);
for (const target of targets) {
  assert.match(target.windowId, /^\d+$/);
  assert.ok(target.file.startsWith('/home/' + config.user + '/documents/'));
}
const c = await open('about:blank');
const result = {};
try {
  await c.call('Page.addScriptToEvaluateOnNewDocument', {source:
    `window.fixtureInputErrors=[];addEventListener('error',e=>fixtureInputErrors.push(e.message));
     addEventListener('unhandledrejection',e=>fixtureInputErrors.push(String(e.reason)));`});
  await c.call('Page.navigate', {url:config.ingressURL + config.basePath + instance.viewerUrl});
  await ready(c);
  // Arrange windows only. All tested focus changes and keys come from the browser.
  for (const [i, target] of targets.entries()) {
    x(['xdotool', 'windowsize', target.windowId, '590', '500']);
    x(['xdotool', 'windowmove', target.windowId, String(5 + i * 655), '80']);
  }
  async function select(index) {
    const target = targets[index];
    const geometry = Object.fromEntries(x(['xdotool', 'getwindowgeometry', '--shell', target.windowId])
      .trim().split('\n').map(line => line.split('=')));
    const sx = Number(geometry.X) + 120, sy = Number(geometry.Y) + 170;
    const point = await c.evaluate(`(()=>{
      const cv=document.querySelector('canvas'),r=cv.getBoundingClientRect();
      return {x:r.x+${sx}*r.width/cv.width,y:r.y+${sy}*r.height/cv.height};
    })()`);
    await c.call('Input.dispatchMouseEvent', {type:'mouseMoved', ...point});
    await c.call('Input.dispatchMouseEvent', {type:'mousePressed', ...point, button:'left', clickCount:1});
    await c.call('Input.dispatchMouseEvent', {type:'mouseReleased', ...point, button:'left', clickCount:1});
    await delay(150);
    assert.equal(x(['xdotool', 'getactivewindow']).trim(), target.windowId);
  }
  const beforeB = x(['cat', targets[1].file]);
  await select(0);
  await ctrl(c, 'a', 'KeyA', 65);
  // Enter is a physical key. insertText models composition commits, not a
  // programmatic multiline-text API (which this checkpoint does not provide).
  for (const [i, line] of ['ABCD', 'EFGH', 'IJKL'].entries()) {
    if (i) await key(c, 'Enter', 'Enter', 13);
    await c.call('Input.insertText', {text:line});
  }
  await ctrl(c, 'Home', 'Home', 36);
  await key(c, 'ArrowRight', 'ArrowRight', 39);
  await key(c, 'ArrowRight', 'ArrowRight', 39);
  await key(c, 'ArrowDown', 'ArrowDown', 40);
  await c.call('Input.insertText', {text:'Z'});
  await key(c, 'ArrowUp', 'ArrowUp', 38);
  await c.call('Input.insertText', {text:'Y'});
  await ctrl(c, 'End', 'End', 35);
  await key(c, 'ArrowLeft', 'ArrowLeft', 37);
  await key(c, 'ArrowLeft', 'ArrowLeft', 37);
  await c.call('Input.insertText', {text:'X'});
  await ctrl(c, 's', 'KeyS', 83);
  await delay(400);
  const expectedA = 'ABCYD\nEFZGH\nIJXKL';
  assert.equal(x(['cat', targets[0].file]), expectedA);
  assert.equal(x(['cat', targets[1].file]), beforeB);
  await select(1);
  await ctrl(c, 'a', 'KeyA', 65);
  await c.call('Input.insertText', {text:'target B changed'});
  await ctrl(c, 's', 'KeyS', 83);
  await delay(400);
  assert.equal(x(['cat', targets[1].file]), 'target B changed');
  assert.equal(x(['cat', targets[0].file]), expectedA);
  assert.deepEqual(await c.evaluate('fixtureInputErrors'), []);
  Object.assign(result, {clickFocusTwoWindows:true, fourArrowKeys:true,
    savedFileReadback:true, unselectedWindowUnchanged:true, browserExceptions:0});
  console.log('Managed desktop pointer focus and four-arrow saved-file readback passed');
} finally {
  writeFileSync(config.evidenceDirectory + '/desktop-pointer-results.json', JSON.stringify(result, null, 2));
  c.close();
  await fetch(config.cdpURL + '/json/close/' + c.page.id);
}
