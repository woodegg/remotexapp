// Real SDK recovery workbench skinning on a project-owned disposable fixture.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {api, click, config, delay, open, wait} from './host-browser.mjs';

const checks = [];
const pass = description => { checks.push(description); console.log(description); };
const states = b => b.evaluate('remoteXAppRecoveryWorkbench.snapshot()');
const ready = (b, count) => wait(async () => {
  const rows = await states(b);
  return rows.length === count && rows.every(row => row.displayReady);
});
const card = index => '#views article:nth-of-type(' + (index + 1) + ')';
const action = (index, kind) => card(index) + ' [data-recovery-action="' + kind + '"]';
function select(b, selector, value) {
  return b.evaluate(`(() => {
    const select = document.querySelector(${JSON.stringify(selector)});
    select.value = ${JSON.stringify(value)};
    select.dispatchEvent(new Event('change', {bubbles:true}));
  })()`);
}
async function appearance(b, index) {
  return b.evaluate(`(() => {
    const panel = document.querySelector(${JSON.stringify(card(index) + ' [data-recovery-panel]')});
    const css = getComputedStyle(panel);
    return {lang:panel.lang, label:panel.getAttribute('aria-label'), text:panel.querySelector('strong')?.textContent,
      background:css.backgroundColor, foreground:css.color, size:css.fontSize, hidden:panel.hidden};
  })()`);
}
async function disconnect(b, index) {
  await b.evaluate(`(() => {
    const toolbar = document.querySelector(${JSON.stringify(card(index) + ' .window-toolbar')});
    [...toolbar.querySelectorAll('button')].find(el => el.textContent === '断开此 Viewer').click();
  })()`);
  await wait(async () => (await states(b))[index]?.state === 'attention');
}
function requestCount(b) {
  return b.events.filter(event => event.method === 'Network.requestWillBeSent' &&
    new URL(event.params.request.url).pathname.includes('/api/')).length;
}

let page, held, failure;
const instances = new Set();
try {
  const path = config.ingressURL.replace(/\/$/, '') + '/sdk/recovery.html';
  page = await open(path);
  await page.call('Emulation.setDeviceMetricsOverride', {width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  await page.call('Network.enable');
  await wait(() => page.evaluate("document.querySelector('#version')?.textContent.includes('Core ')"));
  assert.match(await page.evaluate("document.querySelector('#version').textContent"), /Core 0\.17\.3 · SDK 0\.34\.0/);

  await select(page, '#new-appearance [data-appearance="locale"]', 'en');
  await select(page, '#new-appearance [data-appearance="theme"]', 'light');
  await select(page, '#new-appearance [data-appearance="size"]', 'large');
  await page.call('Fetch.enable', {patterns:[{urlPattern:'*/api/instances',requestStage:'Request'}]});
  await click(page, '#create');
  held = await wait(() => page.events.find(event => event.method === 'Fetch.requestPaused' && event.params.request.method === 'POST')?.params.requestId);
  assert.deepEqual(await appearance(page, 0), {lang:'en',label:'Connection recovery',text:'Connecting',
    background:'rgb(243, 246, 251)',foreground:'rgb(20, 35, 56)',size:'15.75px',hidden:false});
  await page.call('Fetch.continueRequest', {requestId:held});
  held = undefined;
  await page.call('Fetch.disable');
  await ready(page, 1);
  instances.add((await states(page))[0].instanceId);
  assert((await appearance(page, 0)).hidden);
  pass('the first connecting paint uses the selected language, size and light palette');

  await select(page, '#new-appearance [data-appearance="locale"]', 'zh-CN');
  await select(page, '#new-appearance [data-appearance="theme"]', 'dark');
  await select(page, '#new-appearance [data-appearance="size"]', 'extra-large');
  await click(page, '#create');
  await ready(page, 2);
  for (const {instanceId} of await states(page)) instances.add(instanceId);
  const initial = await states(page);
  await disconnect(page, 0);
  assert((await states(page))[1].displayReady);
  await disconnect(page, 1);
  assert.equal((await appearance(page, 0)).text, 'Needs attention');
  const second = await appearance(page, 1);
  assert.equal(second.text, '需要处理');
  assert.equal(second.background, 'rgb(32, 36, 50)');
  assert.equal(second.size, '19.25px');
  const snapshots = await states(page), previousRequests = requestCount(page);
  const viewSettings = card(0) + ' [data-appearance=';
  await select(page, viewSettings + '"locale"]', 'zh-CN');
  await select(page, viewSettings + '"theme"]', 'dark');
  await select(page, viewSettings + '"size"]', 'extra-large');
  assert.deepEqual(await states(page), snapshots);
  await delay(250);
  assert.equal(requestCount(page), previousRequests);
  assert.deepEqual(await appearance(page, 1), second);
  assert.equal((await appearance(page, 0)).text, '需要处理');
  assert.equal((await appearance(page, 0)).background, 'rgb(32, 36, 50)');
  pass('two real Viewers switch appearance independently without requests or state revisions');

  await click(page, action(0, 'refresh'));
  await wait(async () => (await states(page))[0].actions.some(action => action.kind === 'restart'));
  await click(page, action(0, 'restart'));
  await wait(async () => (await states(page))[0].confirmation);
  const confirmBefore = (await states(page))[0];
  await page.evaluate(`document.querySelector(${JSON.stringify(action(0, 'cancel'))}).focus()`);
  await select(page, viewSettings + '"locale"]', 'en');
  await select(page, viewSettings + '"theme"]', 'light');
  assert.deepEqual((await states(page))[0], confirmBefore);
  const confirmation = await page.evaluate(`(() => {
    const button = document.querySelector(${JSON.stringify(action(0, 'cancel'))});
    return {focus:document.activeElement === button, text:button.textContent, ring:getComputedStyle(button).boxShadow,
      warning:button.closest('[data-recovery-panel]').querySelector('[role=alert]').textContent};
  })()`);
  assert(confirmation.focus);
  assert.equal(confirmation.text, 'Cancel');
  assert.match(confirmation.ring, /20, 84, 163/);
  assert.match(confirmation.warning, /Unsaved work may be lost/);
  pass('live appearance changes retain the confirmation, warning, focus and configured focus ring');

  await page.call('Emulation.setDeviceMetricsOverride', {width:540,height:780,deviceScaleFactor:1,mobile:false});
  const small = await page.evaluate(`(() => {
    const style = document.createElement('style');
    style.textContent = '.recovery-workbench { zoom:2; }';
    document.head.append(style);
    const panel = document.querySelector(${JSON.stringify(card(0) + ' [data-recovery-panel]')});
    const last = panel.querySelector('[data-recovery-action=confirm]');
    last.scrollIntoView({block:'nearest'});
    const area = panel.getBoundingClientRect(), button = last.getBoundingClientRect();
    return {fits:panel.scrollWidth <= panel.clientWidth + 1,
      visible:button.top >= area.top - 1 && button.bottom <= area.bottom + 1,
      panel:[area.top,area.bottom,panel.clientHeight,panel.scrollHeight,panel.scrollTop],
      button:[button.top,button.bottom]};
  })()`);
  assert(small.fits && small.visible, JSON.stringify(small));
  await page.evaluate("document.head.lastElementChild.remove()");
  await page.call('Emulation.setDeviceMetricsOverride', {width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  await click(page, action(0, 'cancel'));
  const pausedBeforeRetry = new Set(page.events.filter(event => event.method === 'Fetch.requestPaused').map(event => event.params.requestId));
  await page.call('Fetch.enable', {patterns:[{urlPattern:'*/api/instances/' + initial[0].instanceId,requestStage:'Request'}]});
  await click(page, action(0, 'retry'));
  held = await wait(() => page.events.find(event => event.method === 'Fetch.requestPaused' &&
    !pausedBeforeRetry.has(event.params.requestId) && event.params.request.method === 'GET')?.params.requestId);
  const recovering = (await states(page))[0];
  assert.equal(recovering.state, 'recovering');
  await select(page, viewSettings + '"locale"]', 'zh-CN');
  assert.equal((await appearance(page, 0)).text, '正在恢复');
  assert.deepEqual((await states(page))[0], recovering);
  pausedBeforeRetry.add(held);
  await page.call('Fetch.continueRequest', {requestId:held});
  held = undefined;
  await wait(async () => {
    for (const event of page.events.filter(event => event.method === 'Fetch.requestPaused')) {
      const requestId = event.params.requestId;
      if (pausedBeforeRetry.has(requestId)) continue;
      pausedBeforeRetry.add(requestId);
      await page.call('Fetch.continueRequest', {requestId});
    }
    const view = (await states(page))[0];
    assert(!(view.state === 'attention' && !view.busy), JSON.stringify({state:view.state,reason:view.reason}));
    return view.displayReady;
  });
  await page.call('Fetch.disable');
  await click(page, action(1, 'retry'));
  await ready(page, 2);
  assert.deepEqual((await states(page)).map(x => [x.instanceId,x.generation]), initial.map(x => [x.instanceId,x.generation]));
  pass('narrow pane and 2× layout zoom keep controls reachable, and in-place recovery localization preserves both generations');

  await click(page, '#logout');
  await wait(async () => (await states(page)).length === 0);
  assert(!page.events.some(e => e.method === 'Runtime.exceptionThrown'));
} catch (error) {
  failure = error;
  console.error(error.stack);
  if (page) console.error(JSON.stringify((await states(page).catch(() => [])).map(({state,reason,displayReady,busy})=>({state,reason,displayReady,busy}))));
} finally {
  if (page) {
    if (held) await page.call('Fetch.disable').catch(() => {});
    for (const row of await states(page).catch(() => [])) if (row.instanceId) instances.add(row.instanceId);
    await page.close();
  }
  for (const id of instances) {
    const instance = await api('/api/instances/' + id);
    if (instance.state !== 'stopped') await api('/api/instances/' + id + '/stop', {sessionGeneration:instance.sessionGeneration});
  }
  writeFileSync(config.evidenceDirectory + '/recovery-appearance.json', JSON.stringify({result:failure ? 'failed' : 'passed',checks}, null, 2));
}
if (failure) process.exitCode = 1;
