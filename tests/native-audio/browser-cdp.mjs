import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
export const delay = ms=>new Promise(r=>setTimeout(r,ms));
export async function until(fn,timeout=15000) {const end=Date.now()+timeout;while(Date.now()<end){const value=await fn();if(value)return value;await delay(100);}throw Error('condition timed out');}
export async function chrome(wav) {
 const profile=await mkdtemp(join(tmpdir(),'rxa-native-audio-'));
 const process=spawn(globalThis.process.env.CHROME_BIN || 'google-chrome',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--disable-background-networking','--use-fake-device-for-media-stream','--use-file-for-fake-audio-capture='+wav,'--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
 const port=await until(async()=>{try{return (await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];}catch{return false;}},20000);
 const base='http://127.0.0.1:'+port;
 return {base,profile,process,async close(){if(process.exitCode===null){process.kill('SIGTERM');await new Promise(r=>process.once('exit',r));}await rm(profile,{recursive:true,force:true,maxRetries:20,retryDelay:100});}};
}
export async function page(browser,url) {
 const target=await fetch(browser.base+'/json/new?'+encodeURIComponent(url),{method:'PUT'}).then(r=>r.json());
 const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
 let next=0;const pending=new Map(),errors=[];
 ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);};
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;const timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timed out'));},30000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async(expression,userGesture=false)=>{const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,replMode:true,userGesture});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
 await call('Runtime.enable');await call('Page.enable');
 await until(()=>evaluate('document.readyState === "complete" && location.href === '+JSON.stringify(new URL(url).href)));
 return {target,call,evaluate,errors,async close(){ws.close();await fetch(browser.base+'/json/close/'+target.id);}};
}
