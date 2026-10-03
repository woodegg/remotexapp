import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile} from 'node:fs/promises';
const [base,id]=process.argv.slice(2);assert.equal(new URL(base).hostname,'127.0.0.1');
const profile=await mkdtemp('/tmp/remotexapp-actions-console-'),delay=ms=>new Promise(r=>setTimeout(r,ms));
const browser=spawn('google-chrome',['--headless=new','--disable-background-networking','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
let ws;
try{
 let port;for(let n=0;n<200;n++){try{port=Number((await readFile(profile+'/DevToolsActivePort','utf8')).split('\n')[0]);break}catch{}await delay(100)}assert(port);
 const page=(await(await fetch(`http://127.0.0.1:${port}/json`)).json()).find(x=>x.type==='page');ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})});
 let seq=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result)}});
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value};
 async function wait(expression){for(let n=0;n<300;n++){if(await evaluate(expression))return;await delay(100)}throw Error('Console timeout '+expression+' '+await evaluate('document.body.innerText'))}
 await call('Page.navigate',{url:base+'/sdk/console.html'});
 const card=`document.querySelector('[data-runtime-id="${id}"]')`,dialog=`document.querySelector('dialog[open][aria-label="App actions"]')`;
 await wait(`${card}!==null`);await evaluate(`[...${card}.querySelectorAll('button')].find(b=>b.textContent==='Actions').click()`);
 await wait(`${dialog}?.querySelector('[data-parameter="url"]')!==null && !!${dialog}`);
 await evaluate(`${dialog}.querySelector('[data-parameter="url"]').value=${JSON.stringify(base+'/readyz?console='+id)}`);
 await evaluate(`[...${dialog}.querySelectorAll('button')].find(b=>b.textContent==='Invoke').click()`);
 await wait(`${dialog}.querySelector('pre').textContent.includes('tabId')`);
 const result=await evaluate(`JSON.parse(${dialog}.querySelector('pre').textContent)`);assert.equal(result.instanceId,id);
 await evaluate(`[...${dialog}.querySelectorAll('button')].find(b=>b.textContent==='Close').click()`);assert.equal(await evaluate(`document.querySelector('[aria-label="App actions"] pre').textContent`),'');
 console.log(JSON.stringify({passed:true,check:id.split('-')[0]+'-shipped-Console-schema-input-explicit-SDK-invoke-result-cleared-on-close'}));
}finally{ws?.close();if(browser.exitCode===null)await new Promise(r=>{browser.once('exit',r);browser.kill('SIGTERM')})}
