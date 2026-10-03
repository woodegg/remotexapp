// Real shipped Console token-free connection inspection.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
const [base,id,tokenFile]=process.argv.slice(2);
assert(new URL(base).hostname==='127.0.0.1');
const secret='unused-legacy-test-token';
const delay=ms=>new Promise(r=>setTimeout(r,ms)),profile=await mkdtemp('/tmp/remotexapp-connection-console-');
const browser=spawn('google-chrome',['--headless=new','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
let socket;
try {
 let port;
 for(let n=0;n<200;n++){try{port=Number((await readFile(profile+'/DevToolsActivePort','utf8')).split('\n')[0]);break;}catch{}await delay(100);}
 assert(port);
 let page;
 for(let n=0;n<100;n++){page=(await(await fetch(`http://127.0.0.1:${port}/json`)).json()).find(x=>x.type==='page');if(page)break;await delay(100);}
 assert(page);socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
 let seq=0;const pending=new Map(), browserErrors=[];
 socket.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error('CDP command failed')):p.resolve(m.result);}});
 socket.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')browserErrors.push((m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text).replaceAll(secret,'[redacted]'));});
 const command=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error('Console evaluation failed');return r.result.value;};
 const wait=async expression=>{for(let n=0;n<200;n++){if(await evaluate(expression))return;await delay(100);}throw Error('Console condition timed out; '+browserErrors.join('\n'));};
 await command('Runtime.enable');await command('Page.navigate',{url:base+'/sdk/console.html'});
 const card=`document.querySelector('[data-runtime-id="${id}"]')`;
 const click=text=>evaluate(`([...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent===${JSON.stringify(text)})).click()`);
 await wait(`${card} !== null`);
 const before=await(await fetch(base+'/api/instances/'+id)).json();
 await evaluate(`[...${card}.querySelectorAll('button')].find(b=>b.textContent==='Connection info').click()`);
 await wait(`!!document.querySelector('dialog[open]')`);
 assert.equal(await evaluate(`document.querySelectorAll('dialog[open] input[type=password]').length`),0);
 await click('Refresh');
 await wait(`document.querySelector('dialog[open] pre').textContent.includes('"ibus"')`);
 const descriptor=await evaluate(`JSON.parse(document.querySelector('dialog[open] pre').textContent)`);assert.equal(descriptor.instanceId,id);
 if(process.argv[5]==='legacy'){assert.equal(descriptor.environment.ibus,undefined);assert.equal(descriptor.unavailableReasons.ibus,'metadata-missing');}else assert.equal(descriptor.environment.ibus.scope,'runtime');
 if(process.argv[5]==='hostile-text')assert.equal(descriptor.application?.testLabel,'<img src=x onerror="window.connectionXSS=true">');
 if(descriptor.application?.testLabel){assert.equal(await evaluate(`document.querySelectorAll('dialog[open] img').length`),0);assert.equal(await evaluate('window.connectionXSS === true'),false);assert((await evaluate(`document.querySelector('dialog[open]').textContent`)).includes(descriptor.application.testLabel));}
 // Explicit copy actions, including permission denial; mocks avoid changing the
 // test operator's real clipboard while exercising the shipped button handlers.
 await evaluate(`window.confirm=()=>true;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied')}}})`);
 await click('Copy JSON');await wait(`document.querySelector('dialog[open]').textContent.includes('copy failed')`);
 await evaluate(`navigator.clipboard.writeText=async text=>{window.connectionTestCopied=text}`);
 await click('Copy JSON');assert.deepEqual(await evaluate(`JSON.parse(window.connectionTestCopied)`),descriptor);
 await click('Copy field');assert.equal(await evaluate('window.connectionTestCopied'),String(descriptor.schemaVersion));
 const leaked=await evaluate(`JSON.stringify({local:{...localStorage},session:{...sessionStorage},url:location.href,body:document.body.innerText}).includes(${JSON.stringify(secret)})`);assert.equal(leaked,false);
 const screenshot=await command('Page.captureScreenshot',{format:'png'});await writeFile(profile+'/panel.png',Buffer.from(screenshot.data,'base64'));
 await click('Close');await evaluate(`[...${card}.querySelectorAll('button')].find(b=>b.textContent==='Connection info').click()`);

 assert.equal(await evaluate(`document.querySelector('dialog[open] pre').textContent`),'');
 await click('Refresh');await wait(`document.querySelector('dialog[open] pre').textContent.includes('"ibus"')`);
 const after=await(await fetch(base+'/api/instances/'+id)).json();assert.equal(after.sessionGeneration,before.sessionGeneration);assert.equal(after.sessionState,before.sessionState);
 console.log(JSON.stringify({passed:true,checks:['actual-console-no-token-success','generic-ibus-descriptor','copy-permission-denial-and-success','no-token-storage-url-body-copy-leak','close-clears-descriptor','no-runtime-mutation'],screenshot:profile+'/panel.png'}));
} finally {
 socket?.close();if(browser.exitCode===null)await new Promise(r=>{browser.once('exit',r);browser.kill('SIGTERM');});
}
