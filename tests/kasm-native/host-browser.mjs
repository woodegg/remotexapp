// Shared live helper: this suite operates only a project-owned disposable host.
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
export const config=JSON.parse(readFileSync(process.argv[2],'utf8'));
assert.equal(config.purpose,'remotexapp-native-host-disposable');
assert.match(config.container,/^remotexapp-host-[a-z0-9-]+$/);
assert.equal(config.projectOwnedDisposable,true);
assert.equal(config.user,'rxhost');
for(const address of [config.managerURL,config.ingressURL,config.cdpURL])assert.equal(new URL(address).hostname,'127.0.0.1');
assert(config.evidenceDirectory.startsWith('/tmp/remotexapp-host-'));
mkdirSync(config.evidenceDirectory,{recursive:true});
export const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function wait(callback,timeout=45000){const until=Date.now()+timeout;while(Date.now()<until){const result=await callback();if(result)return result;await delay(150);}throw Error('wait timed out');}
export async function api(path,body,method){
  const response=await fetch(config.managerURL+path,{method:method || (body?'POST':'GET'),headers:{'Content-Type':'application/json','X-RemoteXApp-Test-User':'alpine-uat'},...(body?{body:JSON.stringify(body)}:{})});
  const value=await response.json();if(!response.ok)throw Object.assign(Error(`${response.status} ${value.code || value.error || 'request failed'}`),{status:response.status,body:value});return value;
}
export function remote(args,input=''){
  // LXC's stream copier can lose output on Node's socket-backed stdio. Python
  // supplies ordinary pipes, as in the existing native browser fixture helper.
  const script='import subprocess,sys,json\np=subprocess.run(["sudo","-n","/snap/bin/lxc","exec","local:"+sys.argv[1],"--"]+json.loads(sys.argv[2]),input=sys.stdin.buffer.read(),capture_output=True,timeout=110)\nif p.returncode:raise RuntimeError(p.stderr.decode(errors="replace")[-1200:])\nsys.stdout.buffer.write(p.stdout)';
  return execFileSync('python3',['-c',script,config.container,JSON.stringify(args)],{input,encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});
}
export async function open(url){
  const page=await fetch(config.cdpURL+'/json/new?'+encodeURIComponent(url),{method:'PUT'}).then(r=>r.json());
  const socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let serial=0;const pending=new Map(),events=[];
  socket.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}else{events.push(m);if(events.length>1000)events.shift();}};
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial,timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timed out'));},120000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async(expression,gesture=false)=>{const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:gesture});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);return result.result.value;};
  await call('Runtime.enable');await call('Page.enable');await call('Page.bringToFront');
  return {page,events,call,evaluate,close:async()=>{socket.close();await fetch(config.cdpURL+'/json/close/'+page.id);}};
}
export async function click(browser,selector){
  const box=await browser.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('control missing');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await browser.call('Input.dispatchMouseEvent',{type:'mousePressed',...box,button:'left',clickCount:1});
  await browser.call('Input.dispatchMouseEvent',{type:'mouseReleased',...box,button:'left',clickCount:1});
}
