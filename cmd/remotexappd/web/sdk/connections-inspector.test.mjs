import test from 'node:test';
import assert from 'node:assert/strict';
import {ConnectionInspector} from '../console-src/connections-model.mjs';
const runtime = {id:'app',sessionGeneration:1,state:'server-ready',sessionState:'running'};
const descriptor = {instanceId:'app',sessionGeneration:1,environment:{ibus:{address:'unix:path=/example/ibus.sock',scope:'runtime'}}};
const token = 'a'.repeat(64);
const fixture = () => {const calls=[]; const m={getInstance:async()=>runtime,getConnections:async(id,o)=>{calls.push(o);return descriptor}};return {m,calls,view:new ConnectionInspector(m)};};
test('inspector reads without a dedicated token, supports copy denial and clears on close',async()=>{
 const {view,calls}=fixture();view.open(runtime);await view.refresh();assert.equal(calls.length,1);assert.deepEqual(view.value,descriptor);assert.equal(calls[0].token,undefined);assert(!JSON.stringify(view).includes(token));
 assert.equal(await view.copy('value',async()=>{throw Error('denied')},()=>true),false);
 let copied;assert.equal(await view.copy('value',async v=>{copied=v},()=>true),true);assert.equal(copied,'value');
 view.close();assert.equal(view.value,null);view.open(runtime);await view.refresh();assert.equal(calls.length,2);
});
test('late results cannot resurrect descriptors after close, selection, lifecycle or newer refresh',async()=>{
 for(const action of ['close','selection','generation','invalidate','refresh']){
  const {view,m}=fixture();let resolve; m.getConnections=()=>new Promise(r=>{resolve=r});view.open(runtime);const pending=view.refresh(token);await Promise.resolve();
  if(action==='close')view.close();if(action==='selection')view.open({...runtime,id:'other'});if(action==='generation')view.observe({...runtime,sessionGeneration:2});if(action==='invalidate')view.invalidate();if(action==='refresh'){m.getConnections=async()=>({...descriptor,revision:'new'});await view.refresh();}
  resolve(descriptor);await pending;assert.equal(view.value?.revision,action==='refresh'?'new':undefined);if(action!=='refresh')assert.equal(view.value,null);
 }
});
test('errors are sanitized, Manager denial is retained, and changed snapshots cannot be copied',async()=>{
 const {view,m}=fixture();view.open(runtime);m.getConnections=async()=>{throw Object.assign(Error(token),{status:403})};await view.refresh(token);assert(!view.message.includes(token));await view.refresh();assert.match(view.message,/denied/);
 let n=0;m.getInstance=async()=>({...runtime,sessionGeneration:++n});m.getConnections=async()=>descriptor;await view.refresh(token);assert.equal(view.value,null);
 view.open(null);await view.refresh(token);assert.equal(view.value,null);
});
