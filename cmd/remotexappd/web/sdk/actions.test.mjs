import test from 'node:test';
import assert from 'node:assert/strict';
import {RemoteXAppManager} from './remotexapp-manager.js';
import {RemoteXAppClient} from './remotexapp-client.js';

test('actions use SDK base path, exact generation, abort signal, bounded names and no retry',async()=>{
 const calls=[],controller=new AbortController();
 const manager=new RemoteXAppManager({baseURL:'https://host/prefix',fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json(options.method==='POST'?{instanceId:'a/b',sessionGeneration:2,action:'openUrl',result:{tabId:'t'}}:{instanceId:'a/b',sessionGeneration:2,ready:true,actions:{}});}});
 await manager.getActions('a/b',{signal:controller.signal});
 const value=await manager.invokeAction('a/b','openUrl',{url:'https://example.test'},{sessionGeneration:2,signal:controller.signal});
 assert.equal(value.result.tabId,'t');assert.equal(calls[0].url,'https://host/prefix/api/instances/a%2Fb/actions');assert.equal(calls[1].url,calls[0].url+'/openUrl');assert.equal(calls[1].options.signal,controller.signal);
 assert.deepEqual(JSON.parse(calls[1].options.body),{sessionGeneration:2,parameters:{url:'https://example.test'}});
 for(const action of [undefined,null,'../x','x/y','x'.repeat(65)])await assert.rejects(manager.invokeAction('a',action,{}, {sessionGeneration:2}),TypeError);
 for(const generation of [undefined,0,-1,1.5,Infinity])await assert.rejects(manager.invokeAction('a','openUrl',{}, {sessionGeneration:generation}),RangeError);
 for(const params of [undefined,[],null])await assert.rejects(manager.invokeAction('a','openUrl',params,{sessionGeneration:2}),TypeError);
 let attempts=0;manager.fetchImpl=async()=>{attempts++;throw Error('lost response')};await assert.rejects(manager.invokeAction('a','openUrl',{}, {sessionGeneration:2}));assert.equal(attempts,1);
 manager.fetchImpl=async()=>Response.json({instanceId:'a',sessionGeneration:3,action:'openUrl',result:{}});await assert.rejects(manager.invokeAction('a','openUrl',{}, {sessionGeneration:2}),/stale/);
 manager.fetchImpl=async()=>Response.json({actions:[]});await assert.rejects(manager.getActions('a'),/Invalid/);
});

test('bound actions never start a runtime and discard stale cross-window responses',async()=>{
 const c=Object.create(RemoteXAppClient.prototype);let finish,calls=0;
 Object.assign(c,{state:'disconnected',instance:{id:'a',sessionGeneration:2},manager:{invokeAction:()=>{calls++;return new Promise(r=>finish=r)}}});
 await assert.rejects(c.invokeAction('openUrl',{}));assert.equal(calls,0);c.state='connected';
 for(const change of [()=>c.instance={id:'b',sessionGeneration:2},()=>c.instance.sessionGeneration++,()=>c.state='disconnected']){
  c.instance={id:'a',sessionGeneration:2};c.state='connected';const pending=c.invokeAction('openUrl',{});change();finish({result:{}});await assert.rejects(pending,/changed|stale/i);
 }
 c.instance={id:'a',sessionGeneration:2};c.state='connected';const pending=c.invokeAction('openUrl',{});finish({result:{tabId:'ok'}});assert.equal((await pending).result.tabId,'ok');
});
