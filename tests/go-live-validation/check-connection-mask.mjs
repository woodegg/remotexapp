// Real browser UI fixtures plus optional disposable live App runs. Never use existing runtimes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assets = new URL('../../cmd/remotexappd/web/assets/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', assets)));
const browser = await chromium.launch({ executablePath:process.env.CHROME_BINARY || '/usr/bin/microsoft-edge', headless:true });
const results=[];
try {
  const page=await browser.newPage({viewport:{width:1000,height:760}});
  await page.route('http://mask.test/**', route => {
    const path=new URL(route.request().url()).pathname;
    if(path==='/') return route.fulfill({contentType:'text/html',body:'<!doctype html><body><input id="outside"><div id="screen" style="width:800px;height:500px"></div></body>'});
    if(path==='/sdk/index.js') return route.fulfill({contentType:'text/javascript',body:`export * from '/assets/${manifest.sdk}';`});
    if(path.startsWith('/assets/') && !path.includes('..')) return route.fulfill({contentType:'text/javascript',body:readFileSync(new URL(path.split('/').at(-1),assets))});
    return route.abort();
  });
  await page.goto('http://mask.test/');
  await page.evaluate(async()=>{
    const {RemoteXAppClient}=await import('/sdk/index.js');
    window.instance={id:'fixture',sessionGeneration:2,sessionState:'running',applicationStatus:{generation:2,state:'ready'}};
    window.client=new RemoteXAppClient({container:'#screen',instance,manager:{getInstance:async()=>instance}});
    client.connectionCurtain.begin();
  });
  const mask=page.locator('[data-remotexapp-connection-mask]');
  await mask.getByRole('heading',{name:'Connecting to your app'}).waitFor();
  assert.equal(await mask.getByRole('button',{name:'Try again'}).isVisible(),false);
  await page.evaluate(()=>{client.state='connected';client.connectionCurtain.connected()});
  await mask.getByText('Preparing your picture…').waitFor();
  await page.evaluate(()=>client.connectionCurtain.frame());
  await mask.waitFor({state:'hidden'});
  await page.evaluate(()=>{client.connectionCurtain.begin(true);client.connectionCurtain.fail()});
  await mask.getByRole('heading',{name:'Couldn’t connect this time'}).waitFor();
  assert.equal(await mask.getByRole('button',{name:'Try again'}).isVisible(),true);
  await page.evaluate(()=>client.setConnectionMaskEnabled(false));await mask.waitFor({state:'hidden'});
  await page.evaluate(()=>client.setConnectionMaskEnabled(true));await mask.waitFor({state:'visible'});
  // Shadow style isolation, small window and reduced motion.
  await page.addStyleTag({content:'button{font-size:90px!important}h2{font-size:90px!important}'});
  assert.equal(await mask.getByRole('heading').evaluate(el=>getComputedStyle(el).fontSize),'20px');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>{document.querySelector('#screen').style.width='260px';document.querySelector('#screen').style.height='220px';client.connectionCurtain.begin(true)});
  assert.equal(await mask.locator('.ring').evaluate(el=>getComputedStyle(el).animationName),'none');
  // Scope mask actions: cancellation must never stop the runtime.
  await mask.getByRole('button',{name:'Cancel connection'}).click();
  assert.equal(await page.evaluate(()=>client.state),'disconnected');
  await mask.waitFor({state:'hidden'});
  await page.evaluate(()=>client.destroy());assert.equal(await mask.count(),0);
  results.push({kind:'browser-fixture',result:'passed',cases:['loading','frame-gate','ready-fade','failure','on/off','host-css','narrow','reduced-motion','cancel','destroy']});
  await page.close();

  if(process.env.RUN_LIVE_MASK==='1') {
    for(const port of [1991,2992]) {
      const base=`http://127.0.0.1:${port}`;
      for(const templateId of ['mousepad','libreoffice','kate','kwrite']) {
        const response=await fetch(`${base}/api/instances`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({templateId,profileRef:`mask-uat-${Date.now()}`})});
        assert.equal(response.status,201);const instance=await response.json();
        const viewer=await browser.newPage();
        const errors=[];viewer.on('pageerror',e=>errors.push(e.message));
        try {
          await viewer.goto(`${base}${instance.viewerUrl}`);
          const curtain=viewer.locator('[data-remotexapp-connection-mask]');
          await curtain.waitFor({state:'attached',timeout:15000});
          await curtain.waitFor({state:'hidden',timeout:50000});
          assert.equal(await viewer.getByRole('checkbox',{name:'Connection mask',exact:true}).isChecked(),true);
          const status=await (await fetch(`${base}/api/instances/${instance.id}`)).json();
          assert.equal(status.applicationStatus.state,'ready');
          const canvas=viewer.locator('canvas').first();assert.ok(await canvas.evaluate(el=>el.width>0&&el.height>0));
          await viewer.getByRole('checkbox',{name:'Connection mask',exact:true}).uncheck();
          await viewer.getByRole('button',{name:'Reconnect',exact:true}).click();
          await viewer.waitForTimeout(1800);assert.equal(await curtain.isVisible(),false);
          await viewer.getByRole('checkbox',{name:'Connection mask',exact:true}).check();
          await curtain.waitFor({state:'hidden',timeout:50000});
          assert.deepEqual(errors,[]);
          results.push({port,templateId,instanceId:instance.id,result:'passed'});
        } finally {
          await viewer.close();
          const stop=await fetch(`${base}/api/instances/${instance.id}/stop`,{method:'POST'});
          assert.ok(stop.ok,`cleanup ${instance.id}: ${stop.status}`);
        }
      }
    }
  }
  console.log(JSON.stringify(results,null,2));
} finally {await browser.close()}
