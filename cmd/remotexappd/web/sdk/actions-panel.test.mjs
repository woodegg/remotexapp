import test from 'node:test';
import assert from 'node:assert/strict';
import {createActionsPanel} from '../console-src/actions-panel.mjs';

// Small DOM contract fixture: real event handlers and asynchronous panel code.
class Node {
 constructor(tag){this.tag=tag;this.children=[];this.style={};this.dataset={};this.events={};this.textContent='';this.value='';this.valid=true;}
 setAttribute(){} append(...nodes){this.children.push(...nodes);if(this.tag==='select'&&!this.value)this.value=this.children[0]?.value||'';}
 replaceChildren(...nodes){this.children=nodes;if(this.tag==='select')this.value=nodes[0]?.value||'';}
 addEventListener(name,fn){this.events[name]=fn} showModal(){this.open=true} close(){this.open=false;this.events.close?.()}
 querySelectorAll(){return this.children.flatMap(n=>[...(n.dataset.parameter?[n]:[]),...n.querySelectorAll()])}
 reportValidity(){return this.valid}
}
const tick=()=>new Promise(r=>setImmediate(r));
const runtime={id:'one',sessionGeneration:1,driverVersion:'1.0.0',sessionState:'running',applicationStatus:{state:'ready'}};
function fixture(){
 const doc={createElement:tag=>new Node(tag),body:new Node('body')};globalThis.window=new Node('window');let calls=[];
 const m={getActions:async id=>({instanceId:id,sessionGeneration:1,ready:true,actions:{test:{parameters:{url:{type:'url',required:true,maxLength:20},mode:{type:'enum',values:['new'],default:'new'},bool:{type:'boolean',default:true},count:{type:'integer',minimum:1,maximum:5,default:2},json:{type:'json',default:{a:1}}}}}}),invokeAction:async(...args)=>{calls.push(args);return{result:{text:'<img onerror=bad>'}}}};
 const panel=createActionsPanel(m,doc),dialog=doc.body.children[0];
 const button=text=>dialog.children.find(n=>n.tag==='button'&&n.textContent===text),fields=()=>dialog.querySelectorAll();
 return{panel,m,calls,dialog,button,fields,output:dialog.children.find(n=>n.tag==='pre')};
}
test('panel renders schema, submits once, displays hostile text literally and clears sensitive values',async()=>{
 const f=fixture();f.panel.open(runtime);await tick();const fields=f.fields();assert.equal(fields.length,5);fields[0].value='https://example.test';
 let finish;f.m.invokeAction=(...args)=>{f.calls.push(args);return new Promise(r=>finish=r)};
 const running=f.button('Invoke').onclick();await f.button('Invoke').onclick();assert.equal(f.calls.length,1);assert(f.button('Invoke').disabled);
 assert.deepEqual(f.calls[0][2],{url:'https://example.test',mode:'new',bool:true,count:2,json:{a:1}});
 finish({result:{html:'<img onerror=bad>'}});await running;assert.match(f.output.textContent,/<img onerror=bad>/);assert.equal(f.output.children.length,0);
 f.button('Close').onclick();assert.equal(f.output.textContent,'');assert.equal(f.fields().length,0);assert.equal(f.dialog.open,false);
});
test('panel drops late results on lifecycle, target change, close and pagehide; cancelling never retries',async()=>{
 for(const transition of ['invalidate','target','close','pagehide','cancel']){
  const f=fixture();f.panel.open(runtime);await tick();let finish;f.m.invokeAction=(...args)=>{f.calls.push(args);return new Promise(r=>finish=r)};
  const running=f.button('Invoke').onclick();const signal=f.calls[0][3].signal;
  if(transition==='invalidate')f.panel.invalidate();if(transition==='target')f.panel.open({...runtime,id:'two'});if(transition==='close')f.button('Close').onclick();if(transition==='pagehide')window.events.pagehide();if(transition==='cancel')f.button('Cancel request').onclick();
  assert(signal.aborted);finish({result:{secret:'old'}});await running;await tick();
  assert.equal(f.output.textContent,'');assert.equal(f.calls.length,1);
 }
});
test('panel handles not-ready, unsupported, stale discovery, input errors, fetch failure and disappeared runtime',async()=>{
 const f=fixture();f.panel.open(null);await tick();assert(f.button('Invoke').disabled);
 for(const value of [{sessionGeneration:1,ready:false,actions:{}},{sessionGeneration:2,ready:true,actions:{}}]){f.m.getActions=async()=>value;f.panel.open(runtime);await tick();assert(f.button('Invoke').disabled)}
 f.m.getActions=async()=>{throw Error('denied')};f.panel.open(runtime);await tick();assert(f.button('Invoke').disabled);f.panel.observe([]);assert.equal(f.fields().length,0);
 const g=fixture();g.panel.open(runtime);await tick();g.fields()[0].valid=false;await g.button('Invoke').onclick();assert.equal(g.calls.length,0);g.fields()[0].valid=true;g.fields().find(x=>x.dataset.type==='json').value='{';await g.button('Invoke').onclick();assert.equal(g.calls.length,0);
 g.fields().find(x=>x.dataset.type==='json').value='{}';g.m.invokeAction=async()=>{throw Error('outcome-unknown')};await g.button('Invoke').onclick();assert.equal(g.output.textContent,'');assert(!g.button('Invoke').disabled);g.button('Refresh').onclick();await tick();g.panel.observe([{...runtime,sessionGeneration:2}]);await tick();assert(g.button('Invoke').disabled);
});
