// Live harness regression: requires Node WebSocket and local Chrome.
import assert from 'node:assert/strict';
import {chrome, page} from './browser-cdp.mjs';

const browser = await chrome('');
let tab;
try {
  tab = await page(browser, 'about:blank');
  assert.deepEqual(await tab.evaluate(`(async () => {
    await new Promise(resolve => setTimeout(resolve, 100));
    window.asyncComplete = true;
    return {complete: true};
  })()`), {complete: true});
  assert.equal(await tab.evaluate('window.asyncComplete'), true);
  assert.deepEqual(await tab.evaluate('await Promise.resolve({topLevel: true})'), {topLevel: true});
  assert.deepEqual(await tab.evaluate('({sync: true, values: [1, 2]})'), {sync: true, values: [1, 2]});
  assert.equal(await tab.evaluate('window.value = 12; window.value + 1'), 13);
  assert.equal(await tab.evaluate('undefined'), undefined);
  assert.equal(await tab.evaluate('null'), null);
  await assert.rejects(tab.evaluate('(async () => {await Promise.resolve(); throw Error("async regression");})()'), /async regression/);
  await assert.rejects(tab.evaluate('await Promise.reject(Error("top-level regression"))'), /top-level regression/);
  await assert.rejects(tab.evaluate('throw Error("sync regression")'), /sync regression/);
  console.log('CDP evaluate: async expressions, top-level await, objects, primitives and errors passed');
} finally {
  if (tab) await tab.close();
  await browser.close();
}
