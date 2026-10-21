// Explicit live check against a disposable managed recovery fixture.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
const [base,id,output]=process.argv.slice(2);assert.equal(new URL(base).hostname,'127.0.0.1');
const profile=await mkdtemp('/tmp/remotexapp-recovery-console-'),delay=ms=>new Promise(r=>setTimeout(r,ms));
// This browser represents the remote client, not an App in the failed desktop.
// Avoid portal/session-bus calls into the account whose desktop is being killed.
const browser=spawn('google-chrome',['--headless=new','--ozone-platform=headless','--disable-gpu','--disable-dev-shm-usage','--disable-background-networking','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{env:{...process.env,DISPLAY:'',XAUTHORITY:'',DBUS_SESSION_BUS_ADDRESS:'unix:path=/dev/null',DBUS_SYSTEM_BUS_ADDRESS:'unix:path=/dev/null'},stdio:['ignore','ignore','pipe']});
let browserErrors='';browser.stderr.on('data',chunk=>{browserErrors=(browserErrors+chunk).slice(-6000)});
let socket;
try{
 let port;for(let attempt=0;attempt<150;attempt++){try{port=Number((await readFile(profile+'/DevToolsActivePort','utf8')).split('\n')[0]);break}catch{}await delay(100)}assert(port,'Chrome debug port unavailable: '+browserErrors);
 const page=(await(await fetch(`http://127.0.0.1:${port}/json`)).json()).find(x=>x.type==='page');
 socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})});
 let sequence=0,reply;const pending=new Map();
 socket.addEventListener('message',event=>{const message=JSON.parse(event.data),request=pending.get(message.id);if(request){pending.delete(message.id);message.error?request.reject(Error(JSON.stringify(message.error))):request.resolve(message.result)}if(message.method==='Network.responseReceived'&&message.params.response.url.endsWith('/recovery-retry'))reply=message.params.response});
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;const timeout=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method))},5000);pending.set(id,{resolve:value=>{clearTimeout(timeout);resolve(value)},reject:error=>{clearTimeout(timeout);reject(error)}});socket.send(JSON.stringify({id,method,params}))});
 const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value};
 await call('Network.enable');await call('Page.navigate',{url:base+'/sdk/console.html'});
 const card=`document.querySelector('[data-managed-id="test-desktop"]')`;
 for(let attempt=0;attempt<100;attempt++){if(await evaluate(`${card}?.querySelector('[data-recovery-retry="${id}"]')!==null && ${card}?.querySelector('[data-recovery-status]')?.textContent.includes('Recovery:')`))break;await delay(100)}
 assert(await evaluate(`${card}?.querySelector('[data-recovery-status]')?.textContent.includes('attempts')`),'Console omitted recovery diagnostic');
 await evaluate(`${card}.querySelector('[data-recovery-retry="${id}"]').click()`);
 for(let attempt=0;attempt<60&&!reply;attempt++)await delay(100);
 assert.equal(reply?.status,202,'Console did not use the guarded recovery SDK method');
 if(output){const screenshot=await call('Page.captureScreenshot',{format:'png'});await writeFile(output,Buffer.from(screenshot.data,'base64'))}
 console.log(JSON.stringify({passed:true,check:'served-Console-recovery-diagnostic-and-explicit-generation-guarded-SDK-recheck'}));
}catch(error){console.error('Recovery Console browser check failed:',error.message,browserErrors);throw error}finally{socket?.close();if(browser.exitCode===null&&browser.signalCode===null)await new Promise(resolve=>{const timeout=setTimeout(()=>{browser.kill('SIGKILL')},2000);browser.once('exit',()=>{clearTimeout(timeout);resolve()});browser.kill('SIGTERM')})}
