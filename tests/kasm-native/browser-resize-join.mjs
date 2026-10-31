// Force a real resize between ServerInit and SetEncodings on an owned display.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {config, instance, open, ready, wait, delay} from './browser-fixture.mjs';

const pages = [], results = [];
const hook = `window.fixtureHeld=false;window.fixtureReleased=false;
window.WebSocket=new Proxy(WebSocket,{construct(Target,args){
 const ws=new Target(...args),send=ws.send.bind(ws),queue=[];
 ws.send=data=>{
  const b=data instanceof ArrayBuffer?new Uint8Array(data):new Uint8Array(data.buffer,data.byteOffset,data.byteLength);
  const encoding=b[0]===2&&b.length>4&&b.length===4+4*((b[2]<<8)|b[3]);
  if(!fixtureReleased&&(fixtureHeld||encoding)){queue.push(b.slice());fixtureHeld=true;return;}
  send(data);
 };
 window.fixtureRelease=mode=>{
  fixtureReleased=true;
  if(ws.readyState!==WebSocket.OPEN)return false;
  for(let b of queue){
   if(mode==='omitted'&&b[0]===2)continue;
   if(mode==='unsupported'&&b[0]===2){
    const view=new DataView(b.buffer,b.byteOffset,b.byteLength),enc=[];
    for(let i=4;i<b.length;i+=4){const n=view.getInt32(i);if(n!==-223&&n!==-308)enc.push(n);}
    b=new Uint8Array(4+4*enc.length);b[0]=2;b[2]=enc.length>>8;b[3]=enc.length;
    const out=new DataView(b.buffer);enc.forEach((n,i)=>out.setInt32(4+4*i,n));
   }
   send(b);
  }
  queue.length=0;return true;
 };
 return ws;
}});`;
try {
  const healthy = await open(config.ingressURL + config.basePath + instance.viewerUrl);
  pages.push(healthy);
  await ready(healthy);
  for (const [index, mode] of ['supported', 'unsupported', 'omitted'].entries()) {
    const joining = await open('about:blank');
    pages.push(joining);
    await joining.call('Page.addScriptToEvaluateOnNewDocument', {source:hook});
    await joining.call('Page.navigate', {url:config.ingressURL + config.basePath + instance.viewerUrl});
    await wait(() => joining.evaluate('window.fixtureHeld'));
    const before = await healthy.evaluate('document.querySelector("canvas").width');
    await healthy.call('Page.bringToFront');
    await healthy.call('Emulation.setDeviceMetricsOverride', {
      width:[1130, 1310, 1150][index], height:850, deviceScaleFactor:1, mobile:false
    });
    await wait(async () => (await healthy.evaluate('document.querySelector("canvas").width')) !== before);
    await delay(200);
    const stillOpen = await joining.evaluate(`fixtureRelease(${JSON.stringify(mode)})`);
    assert.equal(stillOpen, true, 'joining Viewer disconnected before its capabilities arrived');
    if (mode !== 'supported') {
      await wait(async () => /^(failed|disconnected)/.test(await joining.evaluate('document.querySelector("#status").textContent')));
    } else {
      await ready(joining);
    }
    assert.equal(await healthy.evaluate('document.querySelector("#status").textContent'), 'Ready · WSS');
    results.push({name:mode === 'supported' ? 'resize waits for delayed initial capabilities and Viewer paints' :
      mode === 'unsupported' ? 'negotiated lack of resize support still rejected' :
      'omitted SetEncodings uses default capabilities on first update request', status:'passed'});
    console.log(results.at(-1).name);
    joining.close();
    await fetch(config.cdpURL + '/json/close/' + joining.page.id);
  }
} catch (error) {
  results.push({status:'failed', error:error.message});
  throw error;
} finally {
  writeFileSync(config.evidenceDirectory + '/resize-join-results.json', JSON.stringify(results, null, 2));
  for (const page of pages) {
    page.close();
    await fetch(config.cdpURL + '/json/close/' + page.page.id);
  }
}
