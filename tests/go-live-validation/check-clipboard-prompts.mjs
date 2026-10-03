// Served-SDK UI regression. Transfer I/O is stubbed; pair with check-clipboard-client.
// PLAYWRIGHT_MODULE must point to an installed Playwright ES module.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ executablePath:process.env.CHROME_BINARY || '/usr/bin/google-chrome', headless:true });
const results = [];
try {
  for (const port of [1991, 2992]) {
    const base = `http://127.0.0.1:${port}`;
    const assets = new URL('../../cmd/remotexappd/web/assets/', import.meta.url);
    const manifest = JSON.parse(readFileSync(new URL('manifest.json', assets)));
    for (const asset of [manifest.sdk, manifest.console]) {
      const response = await fetch(`${base}/assets/${asset}`);
      assert.equal(response.status, 200);
      const sha = bytes => createHash('sha256').update(bytes).digest('hex');
      assert.equal(sha(Buffer.from(await response.arrayBuffer())), sha(readFileSync(new URL(asset, assets))));
    }
    const page = await browser.newPage();
    await page.goto(`${base}/healthz`);
    await page.evaluate(async () => {
      const sdk = await import('/sdk/index.js');
      window.testSDK = sdk;
      window.buildPrompt = async (direction, width, zoom, rich = true) => {
        const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), c => c.charCodeAt(0));
        const items = [{type:'text/plain', data:'中文 <script>unsafe</script> sample'}];
        if (rich) items.push({type:'image/png', data:png}, {type:'text/html', data:'<script>window.injected=true</script>'});
        const writes = [];
        const client = { instanceId:'fixture', instance:{sessionGeneration:1}, _emit(){}, focus(){}, container:document.createElement('div'), manager:{
          async getClipboardCapabilities(){ return {consistencyVersion:1,sequence:0}; },
          async sendClipboardOffer(){ writes.push('remote'); return {id:'sent'}; },
          async acceptClipboardOffer(_instance, offerId){ return {offerId,items}; },
        }};
        const c = new sdk.RemoteXAppClipboard(client); client.clipboard = c;
        c._readLocalClipboard = async () => items;
        c._writeLocalClipboard = async content => { writes.push('local'); return {types:content.map(i=>i.type),items:content}; };
        c.config = {toRemote:'prompt',toLocal:'prompt',checkOnFocus:false}; c.inputActive = true;
        Object.assign(client.container.style, {position:'relative',width:`${width}px`,height:'400px',zoom:String(zoom)});
        document.body.replaceChildren(client.container);
        const ui = new sdk.RemoteXAppClipboardPrompts(client);
        let id;
        if (direction === 'toRemote') {
          await c._offerLocal(items,'fixture'); id = c._pendingDirection(direction).id;
        } else {
          id = 'remote';
          c.pending.set(id,{id,direction,generation:1,sequence:0,expiresAt:new Date(Date.now()+60000).toISOString()});
          ui.add(c.pending.get(id));
        }
        window.fixture = {c,ui,id,writes};
      };
    });
    const cases = [];
    for (const direction of ['toRemote','toLocal']) {
      for (const [width,zoom] of [[800,1],[220,1],[220,2]]) {
        await page.evaluate(args => window.buildPrompt(...args), [direction,width,zoom]);
        await page.waitForFunction(() => !document.querySelector('[role=status]').textContent.includes('Loading preview'));
        await page.waitForFunction(() => document.querySelector('[role=status] img')?.naturalWidth === 1);
        const pending = await page.evaluate(() => {
          const bar = document.querySelector('[role=status]'), [yes,x] = bar.querySelectorAll('button');
          return {text:bar.textContent, writes:fixture.writes.length, width:bar.clientWidth, scroll:bar.scrollWidth,
            yes:yes.getAttribute('aria-label'), x:x.getAttribute('aria-label'), title:yes.title,
            icon:getComputedStyle(bar.firstChild).backgroundImage,
            size:getComputedStyle(bar.firstChild).backgroundSize,
            matched:yes.getBoundingClientRect().width === x.getBoundingClientRect().width && yes.getBoundingClientRect().height === x.getBoundingClientRect().height,
            scripts:bar.querySelectorAll('script').length, injected:Boolean(window.injected)};
        });
        assert.equal(pending.writes,0);
        assert.match(pending.text,/Plain text.*B.*PNG image.*1 × 1 px/);
        assert.match(pending.text,/中文 <script>unsafe<\/script> sample/);
        assert.equal(pending.scripts,0); assert.equal(pending.injected,false);
        assert.equal(pending.title,pending.yes); assert.match(pending.x,/Dismiss/);
        assert.equal(pending.matched,true); assert.equal(pending.size,'19.6px 19.6px');
        assert(pending.scroll <= pending.width, 'prompt overflows narrow viewport');
        assert.match(decodeURIComponent(pending.icon), direction === 'toRemote' ? /M12 21V3/ : /M12 3v18/);
        if (process.env.PROMPT_EVIDENCE_DIR) {
          await page.locator('[role=status]').screenshot({path:`${process.env.PROMPT_EVIDENCE_DIR}/${port}-${direction}-${width}-${zoom}.png`});
        }
        await page.locator('button').first().focus();
        assert.equal(await page.locator('button').first().evaluate(el=>getComputedStyle(el).outlineStyle),'solid');
        await page.keyboard.press('Tab');
        assert.equal(await page.locator('button').nth(1).evaluate(el=>el===document.activeElement),true);
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Space');
        await page.waitForFunction(() => document.querySelector('[data-state=success]'));
        assert.equal(await page.locator('[role=status] button').count(),0);
        assert.equal(await page.evaluate(()=>fixture.writes.length),1);
        assert.equal(await page.evaluate(()=>fixture.ui.previews.size),0);
        await page.waitForTimeout(1600);
        assert.equal(await page.locator('[data-state=success]').count(),1);
        await page.waitForFunction(()=>!document.querySelector('[role=status]'),{},{timeout:2500});
        await page.evaluate(()=>{fixture.ui.destroy();fixture.c.destroy();});
        cases.push({direction,width,zoom,result:'passed'});
      }
    }
    // Deferred preview must never repaint a terminal bar or another offer.
    const lifecycle = await page.evaluate(async () => {
      const {RemoteXAppClipboardPrompts} = testSDK;
      const clipboard = new EventTarget();
      const reads = new Map(); let approvals = 0; let dismissals = 0;
      clipboard._previewOffer = (id,{signal}) => new Promise(resolve=>reads.set(id,{resolve,signal}));
      clipboard.approve = async()=>{approvals++;throw new Error('write denied');};
      clipboard.dismiss = ()=>{dismissals++;};
      const container = document.createElement('div'); document.body.replaceChildren(container);
      const ui = new RemoteXAppClipboardPrompts({container,clipboard,focus(){}});
      ui.add({id:'late',direction:'toRemote',types:['text/plain'],totalBytes:4});
      const bar = ui.nodes.get('late');
      await bar.querySelector('button').onclick();
      reads.get('late').resolve({summary:{types:['text/plain'],preview:'MUST NOT APPEAR'},thumbnail:null});
      await new Promise(r=>setTimeout(r,0));
      const failed = {state:bar.dataset.state,text:bar.textContent,disabled:bar.querySelector('button').disabled,aborted:reads.get('late').signal.aborted};
      bar.querySelectorAll('button')[1].click();
      ui.add({id:'expired',direction:'toLocal'}); ui.expire({id:'expired',direction:'toLocal'});
      reads.get('expired').resolve({summary:{types:['text/plain'],preview:'MUST NOT APPEAR'},thumbnail:null});
      await new Promise(r=>setTimeout(r,0));
      const expired = ui.nodes.get('expired');
      const expiredState = {text:expired.textContent,disabled:[...expired.querySelectorAll('button')].every(b=>b.disabled)};
      ui.add({id:'destroyed',direction:'toLocal'}); ui.destroy();
      reads.get('destroyed').resolve({summary:{types:[],preview:'MUST NOT APPEAR'},thumbnail:null});
      await new Promise(r=>setTimeout(r,0));
      const cleared = {resources:ui.previews.size,nodes:container.childElementCount,aborted:reads.get('destroyed').signal.aborted};
      clipboard._previewOffer = async()=>{throw new Error('permission denied');};
      const unavailableUI = new RemoteXAppClipboardPrompts({container,clipboard,focus(){}});
      unavailableUI.add({id:'unavailable',direction:'toLocal',types:['text/plain'],totalBytes:4});
      await new Promise(r=>setTimeout(r,0));
      const unavailable = container.textContent;
      let finish;
      clipboard.approve = ()=>new Promise(resolve=>{finish=resolve;});
      const pendingBar = unavailableUI.nodes.get('unavailable');
      const operation = pendingBar.querySelector('button').onclick();
      const inFlightDisabled = [...pendingBar.querySelectorAll('button')].every(b=>b.disabled);
      finish({summary:{types:['text/plain'],preview:'done'}}); await operation;
      unavailableUI.destroy();
      return {failed,expiredState,approvals,dismissals,...cleared,unavailable,inFlightDisabled};
    });
    assert.equal(lifecycle.failed.state,'failure');
    assert.equal(lifecycle.failed.disabled,false); assert.equal(lifecycle.failed.aborted,true);
    assert.doesNotMatch(lifecycle.failed.text,/MUST NOT APPEAR/);
    assert.doesNotMatch(lifecycle.expiredState.text,/MUST NOT APPEAR/);
    assert.equal(lifecycle.expiredState.disabled,true);
    assert.equal(lifecycle.approvals,1); assert.equal(lifecycle.dismissals,1);
    assert.equal(lifecycle.resources,0); assert.equal(lifecycle.nodes,0); assert.equal(lifecycle.aborted,true);
    assert.match(lifecycle.unavailable,/Plain text · 4 B.*Preview unavailable/);
    assert.equal(lifecycle.inFlightDisabled,true);
    results.push({port,cases,lifecycle});
    await page.close();
  }
  if (process.env.RUN_CONSOLE_PREVIEW === '1') {
    const base = 'http://127.0.0.1:1991';
    const request = async (path, body) => {
      const response = await fetch(base+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
      assert(response.ok, `${path}: HTTP ${response.status}`); return response.json();
    };
    const before = await request('/api/instances');
    const instance = await request('/api/instances',{templateId:'mousepad',profileRef:`prompt-console-${Date.now()}`});
    assert(!before.some(item=>item.id===instance.id),'refuse to mutate an existing runtime');
    const page = await browser.newPage();
    try {
      await page.goto(`${base}/sdk/console.html`);
      await page.waitForFunction(()=>window.remoteXApp?.openViewer);
      await page.evaluate(instance=>window.remoteXApp.openViewer(instance),instance);
      await page.waitForFunction(()=>window.remoteXApp.client?.state==='connected');
      await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:base});
      await page.evaluate(async()=>{
        const client=window.remoteXApp.client;
        client.clipboard.configure({toRemote:'prompt',toLocal:'manual',checkOnFocus:false}); client.focus();
        await navigator.clipboard.writeText('Console pre-consent sample');
        await client.clipboard._reconcileLocal('console-preview-validation');
      });
      await page.waitForFunction(()=>[...document.querySelectorAll('.remotexapp-clipboard-prompts [role=status]')].some(bar=>bar.textContent.includes('“Console pre-consent sample”')));
      const bar = page.locator('.remotexapp-clipboard-prompts [data-direction=toRemote]').last();
      assert.match(await bar.textContent(),/Plain text · 26 B/);
      assert.equal(await bar.locator('button').count(),2);
      if(process.env.PROMPT_EVIDENCE_DIR) await bar.screenshot({path:`${process.env.PROMPT_EVIDENCE_DIR}/console-preview.png`});
      await bar.locator('button').nth(1).click();
      assert.equal(await bar.count(),0);
      results.push({console:true,port:1991,result:'passed',checks:['actual-console-client-local-read-preview','dismiss-without-sync']});
    } finally {
      await page.close();
      await request(`/api/instances/${instance.id}/stop`,{force:true});
    }
  }
  console.log(JSON.stringify({result:'passed',scope:'served SDK UI; transfer I/O stubbed',results},null,2));
} finally { await browser.close(); }
