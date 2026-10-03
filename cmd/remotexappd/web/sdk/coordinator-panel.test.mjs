import test from 'node:test';
import assert from 'node:assert/strict';
import {createCoordinatorPanel, coordinatorRows} from '../console-src/coordinator-panel.mjs';

test('runtime rows distinguish leader, observation, attached and expiring leases', () => {
  const base={instanceId:'app-1',sessionGeneration:0,leaderId:'tab',isLeader:true,keepAlive:true,localHandles:2,remoteInterests:1,nextRenewalInMs:2100};
  const row=coordinatorRows({runtimes:[base]})[0];
  assert.match(row[0],/generation 0/); assert.equal(row[2],'2 local / 1 remote'); assert.equal(row[6],'In 3s');
  assert.match(coordinatorRows({runtimes:[{...base,lease:{outcome:'attached',expiresAt:null}}]})[0][5],/no timed deadline/);
  assert.match(coordinatorRows({runtimes:[{...base,lease:{outcome:'renewed',expiresAt:'expiry'}}]})[0][5],/server expiry expiry/);
  assert.equal(coordinatorRows({runtimes:[{...base,keepAlive:false,isLeader:false}]})[0][3],'Observe only');
});

test('panel opens once, renders text safely, refreshes and stops its timer on close', t => {
  class Node extends EventTarget {
    constructor(tag) {super();this.tag=tag;this.children=[];this.textContent='';}
    append(...nodes){this.children.push(...nodes)}
    replaceChildren(...nodes){this.children=nodes}
    setAttribute(){}
    focus(){doc.activeElement=this}
  }
  const doc={createElement:tag=>new Node(tag),body:new Node('body'),defaultView:new EventTarget(),activeElement:null};
  const timers=new Set();let serial=0, reads=0;
  t.mock.method(globalThis,'setInterval',()=>{timers.add(++serial);return serial});
  t.mock.method(globalThis,'clearInterval',id=>timers.delete(id));
  const state={mode:'local',scope:'<img onerror=alert(1)>',ownerId:'me',serverKey:'http://test',localHandles:0,policy:{heartbeatMs:2000,leaderTimeoutMs:6000,interestRetentionMs:300000},peers:[],runtimes:[],events:[]};
  const panel=createCoordinatorPanel(()=>({getDiagnostics(){reads++;return state}}),doc);
  assert.equal(reads,0); assert.equal(doc.body.children[0].hidden,true);
  panel.open(); panel.open(); assert.equal(timers.size,1); assert.equal(doc.body.children.length,1);
  const text=node=>node.textContent+node.children.map(text).join(' ');
  assert.match(text(doc.body), /<img onerror=alert\(1\)>/);
  assert.match(text(doc.body), /does not keep apps alive/);
  doc.defaultView.dispatchEvent(new Event('pagehide'));assert.equal(timers.size,0);
  doc.defaultView.dispatchEvent(new Event('pageshow'));assert.equal(timers.size,1);
  panel.close();assert.equal(timers.size,0);assert.equal(doc.body.children[0].hidden,true);
});
