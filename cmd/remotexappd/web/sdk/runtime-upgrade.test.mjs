import assert from 'node:assert/strict';
import test from 'node:test';
import { RemoteXAppManager } from './remotexapp-manager.js';
import { RemoteXAppClient } from './remotexapp-client.js';
import { runtimeVersionLabel, runtimeVersionSummary } from '../console-src/navigation-model.mjs';

globalThis.CustomEvent = class extends Event { constructor(type,options={}) { super(type);this.detail=options.detail; } };
const revision = 'a'.repeat(64);

test('upgrade SDK guards, base path, abort signal and exactly one POST on network failure', async () => {
  const calls=[]; const controller=new AbortController();
  const manager=new RemoteXAppManager({baseURL:'https://example.test/prefix',fetchImpl:async(url,options)=>{calls.push({url,options});return Response.json({versions:{targetRevision:revision}});}});
  await manager.getRuntimeVersions('a/b');
  assert.equal(calls[0].url,'https://example.test/prefix/api/instances/a%2Fb/upgrade-and-restart');
  await manager.upgradeAndRestartInstance('a/b',{sessionGeneration:7,targetRevision:revision,force:true,signal:controller.signal});
  assert.deepEqual(JSON.parse(calls[1].options.body),{sessionGeneration:7,targetRevision:revision,force:true});
  assert.equal(calls[1].options.signal,controller.signal);
  for(const value of [undefined,-1,1.5,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>manager.upgradeAndRestartInstance('a',{sessionGeneration:value,targetRevision:revision}));
  assert.throws(()=>manager.upgradeAndRestartInstance('a',{sessionGeneration:7,targetRevision:'wrong'}));
  let posts=0;manager.fetchImpl=async()=>{posts++;throw Error('lost response');};
  await assert.rejects(manager.upgradeAndRestartInstance('a',{sessionGeneration:7,targetRevision:revision}));
  assert.equal(posts,1);
});

function boundClient(upgrade) {
  // Exercise the bound operation against real state/event methods, without DOM.
  const client=Object.create(RemoteXAppClient.prototype);
  Object.assign(client,{destroyed:false,viewOnly:false,instanceId:'editor-1',instance:{id:'editor-1',sessionGeneration:7},generation:1,
    manager:{upgradeAndRestartInstance:upgrade,classCache:['old']},diagnostics:{},events:[],connects:0,
    clipboard:{config:{toRemote:'prompt',toLocal:'prompt'},configure(value){this.config=value;}},
    disconnect(){this.generation++;this.intentionalDisconnect=true;this.clipboard.configure({toRemote:'off',toLocal:'off'});},
    async connect(instance){this.connects++;this.instance=instance;this.intentionalDisconnect=false;},
    _emit(type,detail){this.events.push({type,detail});},
  });return client;
}

test('bound upgrade reconnects once with new instance and preserves clipboard configuration',async()=>{
  let requests=0;
  const client=boundClient(async(id,options)=>{requests++;assert.equal(options.sessionGeneration,7);return{id,sessionGeneration:9,state:'server-ready'};});
  const result=await client.upgradeAndRestart({targetRevision:revision});
  assert.equal(result.sessionGeneration,9);assert.equal(client.connects,1);assert.equal(requests,1);
  assert.equal(client.manager.classCache,null);assert.equal(client.clipboard.config.toRemote,'prompt');assert.equal(client.upgradePending,false);
});

test('bound upgrade never reconnects or retries after lost response, cancellation, explicit disconnect or destruction',async()=>{
  for(const action of ['error','abort','disconnect','destroy']){
    let resolve,reject,requests=0;const controller=new AbortController();
    const client=boundClient(()=>{requests++;return new Promise((r,j)=>{resolve=r;reject=j;});});
    const pending=client.upgradeAndRestart({targetRevision:revision,signal:controller.signal});
    await assert.rejects(client.upgradeAndRestart({targetRevision:revision}),/already pending/);
    if(action==='error'){reject(Error('lost response'));await assert.rejects(pending,/lost response/);}
    else {if(action==='abort')controller.abort();if(action==='disconnect')client.disconnect();if(action==='destroy')client.destroyed=true;resolve({id:'editor-1',sessionGeneration:8});await pending;}
    assert.equal(client.connects,0,action);assert.equal(requests,1);assert.equal(client.upgradePending,false);
  }
});

test('Console distinguishes pinned runtime identity, selected release, and no runtime',()=>{
 const old={core:{version:'0.6.0',commit:'abcdef123456789'},app:{id:'kate',version:'1.0.0'}};
 const available={core:{version:'0.7.0',commit:'next'},app:{id:'kate',version:'1.0.0'}};
 assert.match(runtimeVersionLabel(old),/Core 0.6.0 \(abcdef123456\).*App kate 1.0.0/);
 const text=runtimeVersionSummary({versions:{current:old,available},upgrade:{phase:'blocked',errorCode:'shutdown-blocked'}});
 assert.match(text,/Current runtime version: Core 0.6.0/);assert.match(text,/Available version: Core 0.7.0/);assert.match(text,/Upgrade: blocked/);
 assert.match(runtimeVersionSummary(null,available),/Current runtime version: none/);
 assert.match(runtimeVersionLabel({app:{}}),/unknown/);
});
