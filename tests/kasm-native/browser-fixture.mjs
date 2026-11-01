// Live fixture helper. Requires a dedicated browser and owned disposable container.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
export const config=JSON.parse(readFileSync(process.argv[2],'utf8'));
assert.equal(config.purpose,'remotexapp-d2-disposable');
assert.match(config.container,/^remotexapp-d2-/);
for(const url of [config.cdpURL,config.managerURL,config.ingressURL]) assert.equal(new URL(url).hostname,'127.0.0.1');
assert.ok(config.documentFile.startsWith('/home/'+config.user+'/documents/'));
export const delay=ms=>new Promise(r=>setTimeout(r,ms));
export async function connect(page){
 const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});let serial=0;const pending=new Map(),events=[];
 ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}else events.push(m);};
 const call=(method,params={})=>{const id=++serial;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timed out'));},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});};
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 await call('Runtime.enable');await call('Network.enable');await call('Page.enable');
 return {page,events,call,evaluate,close:()=>ws.close()};
}
export async function open(url){const page=await fetch(config.cdpURL+'/json/new?'+encodeURIComponent(url),{method:'PUT'}).then(r=>r.json());return connect(page);}
export async function wait(fn,timeout=35000){const until=Date.now()+timeout;while(Date.now()<until){const r=await fn();if(r)return r;await delay(150);}throw Error('wait timed out');}
export async function ready(c){await c.call('Page.bringToFront');await wait(async()=>{const status=await c.evaluate("document.querySelector('#status')?.textContent");if(status?.startsWith('failed'))throw Error(status);return status?.startsWith('Ready');});}
export async function key(c,key,code,virtualKey,modifiers=0,text){await c.call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:virtualKey,nativeVirtualKeyCode:virtualKey,modifiers,...(text?{text}: {})});await c.call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:virtualKey,nativeVirtualKeyCode:virtualKey,modifiers});}
export async function ctrl(c,keyName,code,virtualKey){await c.call('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Control',code:'ControlLeft',windowsVirtualKeyCode:17,modifiers:2});await key(c,keyName,code,virtualKey,2);await c.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Control',code:'ControlLeft',windowsVirtualKeyCode:17});}
export async function api(path,options={}){const r=await fetch(config.managerURL+path,{...options,headers:{[config.identityHeader]:config.identity,'Content-Type':'application/json',...options.headers}});const data=await r.json();if(!r.ok)throw Error(r.status+' '+JSON.stringify(data));return data;}

export const instance=JSON.parse(readFileSync(config.instanceFile));
export async function current(){const p=(await fetch(config.cdpURL+'/json/list').then(r=>r.json())).find(p=>p.type==='page'&&p.url.includes(instance.id));return connect(p);}
export function remote(args,input=''){return execFileSync('python3',['-c',`import subprocess,sys,json\np=subprocess.run(['/snap/bin/lxc','exec',json.loads(sys.argv[2]),'--']+json.loads(sys.argv[1]),input=sys.stdin.read(),capture_output=True,text=True,timeout=12)\nif p.returncode:raise RuntimeError(p.stderr)\nprint(p.stdout,end='')`,JSON.stringify(args),JSON.stringify(config.container)],{input,encoding:'utf8',timeout:16000});}
export function x(args,input=''){return remote(['runuser','-u',config.user,'--','env','DISPLAY='+instance.display,'XAUTHORITY='+config.xauthority,...args],input);}
export async function click(c,selector){const r=await c.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView();const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);await c.call('Input.dispatchMouseEvent',{type:'mousePressed',...r,button:'left',clickCount:1});await c.call('Input.dispatchMouseEvent',{type:'mouseReleased',...r,button:'left',clickCount:1});}
export async function focus(c){await c.call('Page.bringToFront');const r=await c.evaluate(`(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return {x:r.x+150,y:r.y+180};})()`);await c.call('Input.dispatchMouseEvent',{type:'mousePressed',...r,button:'left',clickCount:1});await c.call('Input.dispatchMouseEvent',{type:'mouseReleased',...r,button:'left',clickCount:1});await delay(80);}
export async function text(c,s){await c.call('Input.imeSetComposition',{text:'zhongwen',selectionStart:8,selectionEnd:8});await c.call('Input.insertText',{text:s});await delay(150);}
export async function save(c){await ctrl(c,'s','KeyS',83);await delay(300);return remote(['cat',config.documentFile]);}
