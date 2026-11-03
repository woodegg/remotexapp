// CDP transport for explicitly owned public-host browser fixtures.
export const delay=ms=>new Promise(r=>setTimeout(r,ms));
export async function wait(fn,timeout=45000){const end=Date.now()+timeout;while(Date.now()<end){const value=await fn();if(value)return value;await delay(200)}throw Error('condition timed out')}
export async function open(cdp,url='about:blank'){
 const page=await fetch(cdp+'/json/new?'+encodeURIComponent(url),{method:'PUT'}).then(r=>r.json());
 return attach(cdp,page);
}
export async function attach(cdp,page){
 const address=new URL(page.webSocketDebuggerUrl);address.hostname=new URL(cdp).hostname;
 const ws=new WebSocket(address);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
 const listeners=new Map();let sequence=0;const pending=new Map(),errors=[],wire=[];let sockets=0;const probes=[];
 ws.onmessage=({data})=>{const m=JSON.parse(data);if(!m.id&&listeners.has(m.method))listeners.get(m.method)(m.params).catch(e=>errors.push(e.message));if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}else if(m.method==='Network.webSocketFrameSent'){const f=m.params.response;if(f.opcode===2&&Buffer.from(f.payloadData,'base64').includes(Buffer.from('rx-rtt:')))probes.push(Date.now())}else if(m.method==='Runtime.exceptionThrown'){errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);if(errors.length>20)errors.shift()}else if(m.method==='Network.webSocketCreated')sockets++;else if(m.method==='Network.webSocketHandshakeResponseReceived')wire.push({event:'handshake',status:m.params.response.status});else if(m.method==='Network.webSocketFrameReceived'&&wire.length<20)wire.push({event:'received',opcode:m.params.response.opcode,length:m.params.response.payloadData.length});else if(m.method==='Network.webSocketFrameError')wire.push({event:'error',message:m.params.errorMessage.slice(0,120)})};
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timed out'))},120000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))});
 const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable');if(new URL(cdp).hostname==='127.0.0.1')await call('Page.bringToFront');
 return {page,call,evaluate,errors,wire,probes,on:(name,fn)=>listeners.set(name,fn),sockets:()=>sockets,detach:()=>ws.close(),close:async()=>{ws.close();await fetch(cdp+'/json/close/'+page.id)}};
}
