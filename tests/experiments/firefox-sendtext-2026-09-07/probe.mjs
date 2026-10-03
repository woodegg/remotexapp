import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function rpc(url){
 const ws=new WebSocket(url); await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});let n=0;const pending=new Map();
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id)}};
 return {ws,call:(method,params={})=>new Promise((resolve,reject)=>{const id=++n;const timer=setTimeout(()=>reject(Error(method+' timeout')),15000);pending.set(id,m=>{clearTimeout(timer);m.error?reject(Error(JSON.stringify(m))):resolve(m.result)});ws.send(JSON.stringify({id,method,params}))})};
}
const pages=await fetch('http://127.0.0.1:9247/json').then(r=>r.json());
const cdp=await rpc(pages.find(p=>p.type==='page'&&p.url.includes('firefox-esr-af9376d8c1b0')).webSocketDebuggerUrl);
async function local(expression){const r=await cdp.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
for(let i=0;i<100;i++){if(await local("window.remoteXApp?.client?.state==='connected'"))break;await sleep(300)}
console.log('client',await local("({state:window.remoteXApp?.client?.state,sendText:typeof window.remoteXApp?.client?.sendText,sendtext:typeof window.remoteXApp?.client?.sendtext})"));
const bidi=await rpc('ws://127.0.0.1:'+(process.env.BIDI_PORT||21000)+'/session');
console.log('bidi',await bidi.call('session.new',{capabilities:{}}));
const tree=await bidi.call('browsingContext.getTree',{});const context=tree.contexts[0].context;
async function remote(expression){return bidi.call('script.evaluate',{expression,target:{context},awaitPromise:true})}
const html='<html><body><input id="plain"><textarea id="area"></textarea><input id="pass" type="password"><div id="edit" contenteditable="true"> </div><button id="button">button</button></body></html>';
await bidi.call('browsingContext.navigate',{context,url:'data:text/html,'+encodeURIComponent(html),wait:'complete'});
await bidi.call('browsingContext.activate',{context});
const results=[];
for(const field of ['plain','area','edit']){
 const pos=await remote(`(()=>{const e=document.getElementById('${field}');e.focus();const r=e.getBoundingClientRect();return JSON.stringify({x:mozInnerScreenX+r.x+Math.min(20,r.width/2),y:mozInnerScreenY+r.y+r.height/2})})()`);
 const p=JSON.parse(pos.result.value);
 if (!process.env.VALIDATION_XAUTHORITY) throw Error('VALIDATION_XAUTHORITY is required');
 execFileSync('xdotool',['mousemove',String(Math.round(p.x)),String(Math.round(p.y)),'click','1'],{env:{...process.env,DISPLAY:':10',XAUTHORITY:process.env.VALIDATION_XAUTHORITY}});
 await sleep(700);
 await local("(()=>{const c=window.remoteXApp.client;c.sendKey(120,'KeyX',true);c.sendKey(120,'KeyX',false);return true})()");await sleep(300);
 console.log('raw-control',field,JSON.stringify(await remote('JSON.stringify({focus:document.hasFocus(),active:document.activeElement.id,value:document.activeElement.value??document.activeElement.textContent})')));
 for(const text of ['AsciiProbe','中文测试']){
 const ack=await local(`window.remoteXApp.client.sendText(${JSON.stringify(text)}).then(value=>({ok:true,value}),error=>({ok:false,error:error.message}))`);
 await sleep(400);
 const state=await remote(`JSON.stringify({active:document.activeElement.id,value:document.activeElement.value??document.activeElement.textContent})`);
 const result={field,text,ack,state};results.push(result);console.log(JSON.stringify(result));
 }
}
writeFileSync(process.env.RESULT_FILE||'/tmp/remotexapp-sendtext-results.json',JSON.stringify(results,null,2));
await bidi.call('session.end');bidi.ws.close();cdp.ws.close();
