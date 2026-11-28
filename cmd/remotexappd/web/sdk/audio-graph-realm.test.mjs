import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioGraphRealm} from './audio-graph-realm.js';

function fixture(){
  const f={frames:[],calls:[],env:{}};
  const document={body:{append(frame){frame.isConnected=true;f.calls.push('append');}},createElement(tag){
    assert.equal(tag,'iframe');
    const frame={isConnected:false,attributes:{},setAttribute(k,v){this.attributes[k]=v;},remove(){this.isConnected=false;f.calls.push('remove');},contentWindow:{document:{},
      AudioContext:class{constructor(options){this.options=options;f.calls.push('context');}},
      AudioWorkletNode:class{constructor(...args){this.args=args;f.calls.push('node');}}}};
    f.frames.push(frame);return frame;
  }};
  f.env={document,AudioContext:class{constructor(){assert.fail('parent constructor is not the graph realm');}}};return f;
}

test('graph construction is synchronous and uses child-realm Context and node constructors',()=>{
  const f=fixture(),realm=new AudioGraphRealm(f.env),context=realm.context({sampleRate:48000}),node=realm.node(context,'test',{numberOfInputs:1});
  assert.deepEqual(f.calls,['append','context','node']);assert.equal(node.args[0],context);
  assert.equal(f.frames[0].hidden,true);assert.equal(f.frames[0].allow,'autoplay');assert.equal(f.frames[0].src,undefined);
  assert.equal(f.frames[0].attributes['aria-hidden'],'true');assert.equal(realm.retired,false);
  realm.retire();realm.retire();assert.deepEqual(f.calls,['append','context','node','remove']);
  assert.equal(realm.retired,true);assert.throws(()=>realm.context({}),/realm-unavailable/);
});

test('realm access or policy failure removes only the newly owned frame',()=>{
  const f=fixture(),create=f.env.document.createElement;
  f.env.document.createElement=tag=>{const frame=create(tag);Object.defineProperty(frame,'contentWindow',{get(){throw new DOMException('blocked','SecurityError');}});return frame;};
  assert.throws(()=>new AudioGraphRealm(f.env),/realm-unavailable/);assert.equal(f.frames.length,1);assert.equal(f.frames[0].isConnected,false);
});

test('a failed realm removal remains owned and retryable instead of being reported retired',()=>{
  const f=fixture(),realm=new AudioGraphRealm(f.env),frame=f.frames[0];frame.remove=()=>{};
  assert.throws(()=>realm.retire(),/retirement-incomplete/);assert.equal(realm.retired,false);
  frame.remove=()=>{frame.isConnected=false;};realm.retire();assert.equal(realm.retired,true);
});

test('a document without a body uses its root, and missing DOM support fails explicitly',()=>{
  const f=fixture();f.env.document.documentElement=f.env.document.body;delete f.env.document.body;
  const realm=new AudioGraphRealm(f.env);assert.equal(f.frames[0].isConnected,true);realm.retire();
  assert.throws(()=>new AudioGraphRealm({}),/realm-unavailable/);
});

test('a removed or navigated graph document is no longer live even if its WindowProxy remains',()=>{
 const f=fixture(),realm=new AudioGraphRealm(f.env);assert.equal(realm.live,true);
 f.frames[0].contentWindow.document={};assert.equal(realm.live,false);assert.throws(()=>realm.context({}),/unavailable/);
 realm.retire();assert.equal(realm.document,null);assert.equal(realm.live,false);
});
