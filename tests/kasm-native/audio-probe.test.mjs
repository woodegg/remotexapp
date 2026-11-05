import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('./uat.html', import.meta.url), 'utf8');
const source = html.match(/<script id="audio-probe">([\s\S]*?)<\/script>/)[1];
const sandbox = {};
vm.runInNewContext(source, sandbox);
const Probe = sandbox.RemoteXAppLocalAudioProbe;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
};
function fixture() {
  const permission = deferred(), events = [], contexts = [], timers = new Map(), frames = new Map();
  let next = 0, now = 0;
  const node = () => ({connect() {}, disconnect() { this.disconnected = true; }, gain:{value:1,setValueAtTime(){},linearRampToValueAtTime(){}}});
  const env = {
    isSecureContext:true,
    navigator:{mediaDevices:{getUserMedia:() => permission.promise}},
    setTimeout(fn, delay) { const id = ++next; timers.set(id, {fn, at:now + delay}); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) { const id=++next;frames.set(id,fn);return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    AudioContext:class {
      constructor() { this.state='running';this.currentTime=0;this.nodes=[];contexts.push(this); }
      resume() { return Promise.resolve(); }
      close() { this.state='closed';this.closed=(this.closed||0)+1;return Promise.resolve(); }
      add(value) { this.nodes.push(value);return value; }
      createMediaStreamSource() { return this.add(node()); }
      createAnalyser() { return this.add({...node(),getFloatTimeDomainData(array){array.fill(.1);}}); }
      createGain() { return this.add(node()); }
      createOscillator() { return this.add({...node(),frequency:{setValueAtTime(){}},start(){this.started=true;},stop(){this.stopped=true;}}); }
    }
  };
  const track = {readyState:'live',stop(){this.readyState='ended';this.stopped=(this.stopped||0)+1;}};
  const stream = {getTracks:()=>[track],getAudioTracks:()=>[track]};
  const probe = new Probe(env, event=>events.push(event));
  function advance(ms) {
    now+=ms;
    for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}
  }
  return {env,probe,permission,events,contexts,timers,frames,track,stream,advance};
}
const last = f => f.events.at(-1);
const released = f => {
  assert.equal(f.probe.job,null);
  assert.equal(f.timers.size,0);
  assert.equal(f.frames.size,0);
  assert.ok(f.contexts.every(c=>c.closed===1));
};

test('construction is inert; missing secure context/API never requests permission', async()=>{
  const f=fixture();assert.equal(f.events.length,0);assert.equal(f.contexts.length,0);
  f.env.isSecureContext=false;await f.probe.microphone();assert.equal(last(f).phase,'unavailable');
  assert.equal(f.contexts.length,0);released(f);
});
for(const reason of ['stopped','panel-closed','page-hidden','page-retired','request-timeout']) {
  test(`pending permission is fenced after ${reason}`, async()=>{
    const f=fixture();const run=f.probe.microphone();
    assert.equal(last(f).phase,'requesting');
    if(reason==='request-timeout')f.advance(15000);else f.probe.stop(reason);
    const count=f.events.length;released(f);
    f.permission.resolve(f.stream);await run;
    assert.equal(f.track.stopped,1);assert.equal(f.events.length,count);released(f);
  });
}
test('denial releases AudioContext without reporting successful capture', async()=>{
  const f=fixture();const run=f.probe.microphone();f.permission.reject({name:'NotAllowedError',message:'private device details'});await run;
  assert.equal(last(f).phase,'denied');assert.ok(!JSON.stringify(f.events).includes('private'));released(f);
});
test('live microphone measures locally through a muted sink and stops after 30 seconds', async()=>{
  const f=fixture();const run=f.probe.microphone();f.permission.resolve(f.stream);await run;
  assert.equal(last(f).phase,'listening');assert.ok(last(f).level>.09);
  assert.equal(f.contexts[0].nodes.at(-1).gain.value,0);
  f.advance(29999);assert.equal(f.track.readyState,'live');f.advance(1);
  assert.equal(last(f).phase,'completed');assert.equal(last(f).level,0);assert.ok(last(f).peak>.09);
  assert.equal(f.track.stopped,1);assert.ok(f.contexts[0].nodes.every(n=>n.disconnected));released(f);
});
test('device loss retires all resources and cannot restart capture', async()=>{
  const f=fixture();const run=f.probe.microphone();f.permission.resolve(f.stream);await run;
  f.track.onended();assert.equal(last(f).reason,'device-lost');assert.equal(f.track.onended,null);released(f);
});
test('late permission for a replaced check does not stop its successor', async()=>{
  const f=fixture();const old=f.probe.microphone();const next=deferred();
  f.env.navigator.mediaDevices.getUserMedia=()=>next.promise;
  const replacement=f.probe.microphone();const newerTrack={readyState:'live',stop(){this.readyState='ended';}};
  next.resolve({getTracks:()=>[newerTrack],getAudioTracks:()=>[newerTrack]});await replacement;
  f.permission.resolve(f.stream);await old;
  assert.equal(f.track.stopped,1);assert.equal(newerTrack.readyState,'live');assert.equal(last(f).phase,'listening');
  f.probe.stop();assert.equal(newerTrack.readyState,'ended');released(f);
});
test('permission resolving before delayed resume is also fenced', async()=>{
  const f=fixture(),resume=deferred();f.env.AudioContext.prototype.resume=()=>resume.promise;
  const run=f.probe.microphone();f.permission.resolve(f.stream);await Promise.resolve();
  f.probe.stop('page-hidden');resume.resolve();await run;
  assert.equal(f.track.stopped,1);assert.equal(last(f).reason,'page-hidden');released(f);
});
test('resume failure releases an acquired stream', async()=>{
  const f=fixture();f.env.AudioContext.prototype.resume=()=>Promise.reject(Error('suspended'));
  const run=f.probe.microphone();f.permission.resolve(f.stream);await run;
  assert.equal(last(f).phase,'failed');assert.equal(f.track.stopped,1);released(f);
});
test('tone expires and produces no automatic heard/pass result', async()=>{
  const f=fixture();await f.probe.tone();assert.equal(last(f).phase,'playing');
  f.advance(1100);assert.equal(last(f).phase,'completed');released(f);
  assert.equal(last(f).observation,undefined);assert.equal(last(f).passed,undefined);
});
test('switching microphone to tone stops capture immediately', async()=>{
  const f=fixture();const run=f.probe.microphone();f.permission.resolve(f.stream);await run;
  await f.probe.tone();assert.equal(f.track.stopped,1);assert.equal(last(f).kind,'tone');
  f.probe.stop();f.probe.stop();released(f);
});
test('unsupported microphone leaves supported speaker check available', async()=>{
  const f=fixture();delete f.env.navigator.mediaDevices;
  await f.probe.microphone();assert.equal(last(f).phase,'unavailable');
  await f.probe.tone();assert.equal(last(f).phase,'playing');f.probe.stop();released(f);
});
