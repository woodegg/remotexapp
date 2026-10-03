import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const base = { pid:4242, private:false, low_memory:true, memory_limit_mib:384,
  configured_memory_kill_threshold_mib:3072, memory_kill_threshold_mib:3072,
  memory_protection_enabled:true, engine_state:'ready', web_process_generation:1,
  uri:'about:blank', title:'fixture', loading:false, load_error:null };
const appRoot = process.env.REMOTEXAPP_LIGHTVIEW_TEST_SOURCE || resolve('apps/lightview');

async function run(t, { state={}, command='open', raw, mutate, unsafeDirectory=false }={}) {
  const runtime=mkdtempSync(join(tmpdir(),'lv-policy-'));
  const directory=join(runtime,'lightview');mkdirSync(directory,{mode:0o700});
  if(unsafeDirectory)chmodSync(directory,0o755);
  const socket=join(directory,'control.sock'), commands=[];
  const current={...base,...state};
  writeFileSync(join(runtime,'lightview-process.pid'),'4242\n');
  const server=net.createServer(c=>{
    c.on('error',()=>{});
    let text='';c.on('data',chunk=>{
      text+=chunk;if(!text.includes('\n'))return;
      const request=JSON.parse(text);commands.push(request.command);
      if(request.command==='open')current.uri=request.uri;
      if(mutate)mutate(current,commands);
      c.end(raw===undefined?JSON.stringify({ok:true,result:request.command==='status'?current:{}})+'\n':raw);
    });
  });
  await new Promise((r,j)=>{server.once('error',j);server.listen(socket,r);});
  try {
    const args=command==='open'?[join(appRoot,'open-url.py')]:
      [join(appRoot,'control.py'),socket,'4242',command==='cli-open'?'open':command,
        ...(command==='cli-open'?['http://localhost:8765/review.html']:[])];
    const result=await new Promise((r,j)=>{
      const child=spawn('/usr/bin/python3',args,{env:{...process.env,REMOTEXAPP_RUNTIME:runtime,PYTHONDONTWRITEBYTECODE:'1'},timeout:5000});
      let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
      child.on('error',j);child.on('close',code=>r({code,stdout,stderr}));
      child.stdin.end(JSON.stringify({parameters:{url:'http://localhost:8765/review.html'},
        connections:{application:{protocol:'lightview-json-v1',transport:'unix',socketPath:socket}}}));
    });
    return {...result,commands};
  } finally { await new Promise(r=>server.close(r));rmSync(runtime,{recursive:true,force:true}); }
}

test('memory policy choices do not block ready navigation or startup probe',async t=>{
  for(const state of [{},{memory_kill_threshold_mib:0,memory_protection_enabled:false},
    {memory_kill_threshold_mib:4096,configured_memory_kill_threshold_mib:4096},
    {low_memory:false,memory_limit_mib:1024}]){
    for(const command of ['open','status']){
      const r=await run(t,{state,command});assert.equal(r.code,0,r.stderr);
      if(command==='open'){assert.deepEqual(r.commands,['status','open','status']);assert.equal(JSON.parse(r.stdout).currentUri,'http://localhost:8765/review.html');}
    }
  }
});

test('policy toggling between navigation probes does not create a false failure',async t=>{
  const r=await run(t,{mutate:(state,commands)=>{if(commands.includes('open')){state.memory_protection_enabled=false;state.memory_kill_threshold_mib=0;}}});
  assert.equal(r.code,0,r.stderr);assert.deepEqual(r.commands,['status','open','status']);
});

test('hibernated engine wakes through open and may recover before becoming ready',async t=>{
  for(const command of ['open','cli-open']){
    let postOpenStatus=0;
    const r=await run(t,{command,state:{engine_state:'suspended',uri:'',title:'',
      web_process_generation:1,memory_protection_enabled:false,memory_kill_threshold_mib:0},
    mutate:(state,commands)=>{
      if(commands.at(-1)==='open')state.engine_state='recovering';
      if(commands.at(-1)==='status'&&commands.includes('open')&&++postOpenStatus===2){
        state.engine_state='ready';state.web_process_generation=2;
      }
    }});
    assert.equal(r.code,0,r.stderr);
    assert.deepEqual(r.commands,command==='open'?['status','open','status','status']:[ 'status','open' ]);
    if(command==='open')assert.equal(JSON.parse(r.stdout).currentUri,'http://localhost:8765/review.html');
  }
});

test('hibernation does not weaken the ready-state or identity gates',async t=>{
  for(const state of [{engine_state:'failed'}, {engine_state:'suspended',pid:4243},
    {engine_state:'suspended',private:true}]){
    const r=await run(t,{state});
    assert.notEqual(r.code,0);assert(!r.commands.includes('open'));
  }
  const status=await run(t,{command:'status',state:{engine_state:'suspended'}});
  assert.notEqual(status.code,0);assert.deepEqual(status.commands,['status']);
  const failedWake=await run(t,{state:{engine_state:'suspended'},
    mutate:(state,commands)=>{if(commands.includes('open'))state.engine_state='failed';}});
  assert.notEqual(failedWake.code,0);assert(failedWake.commands.includes('open'));
});

test('quit needs verified identity but not page readiness or memory policy',async t=>{
  for(const engine_state of ['ready','recovering','failed']){
    const r=await run(t,{command:'quit',state:{engine_state,web_process_generation:0,
      memory_protection_enabled:false,memory_kill_threshold_mib:0,loading:true,load_error:'page unavailable'}});
    assert.equal(r.code,0,r.stderr);assert.deepEqual(r.commands,['status','quit']);
  }
});

test('navigation still rejects unready engines and invalid status',async t=>{
  for(const state of [{engine_state:'recovering'},{pid:4243},{private:true},{web_process_generation:0},
    {web_process_generation:true},{uri:42},{title:null},{loading:0},{load_error:42}]){
    const r=await run(t,{state});assert.notEqual(r.code,0);assert(!r.commands.includes('open'));
  }
});

test('quit and open retain identity, framing and private-socket checks',async t=>{
  for(const command of ['quit','open']){
    for(const options of [{state:{pid:4243}},{state:{private:true}},{unsafeDirectory:true},
      {raw:'not json\n'},{raw:'{}\n{}\n'},{raw:'{"ok":false,"error":"rejected"}\n'},
      {raw:'x'.repeat(4*1024*1024+2)+'\n'}]){
      const r=await run(t,{...options,command});assert.notEqual(r.code,0);assert(!r.commands.includes(command));
    }
  }
});

test('real session and shutdown Drivers accept protection off, including recovering quit',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'lv-start-'));
  const bin=join(directory,'bin'), control=join(directory,'lightview');
  mkdirSync(bin);mkdirSync(control,{mode:0o700});
  const manifest=JSON.parse(readFileSync(join(appRoot,'manifest.json')));
  writeFileSync(join(directory,'parameters.json'),JSON.stringify({startUrl:'about:blank'}));
  writeFileSync(join(directory,'config.json'),JSON.stringify(manifest.driver.config));
  const executable=(name,source)=>writeFileSync(join(bin,name),'#!/bin/sh\n'+source,{mode:0o755});
  executable('lightview','printf "%s\\n" "$$" > "$TEST_PID"\nexec /bin/sleep 3600\n');
  executable('matchbox-window-manager','exit 0\n');
  executable('xdotool','printf "123\\n"\n');
  executable('status-helper','printf "%s\\n" "$@" >> "$TEST_REPORTS"\n');
  const env={...process.env,PATH:`${bin}:/usr/bin:/bin`,HOME:directory,REMOTEXAPP_RUNTIME:directory,
    REMOTEXAPP_PARAMETERS:join(directory,'parameters.json'),REMOTEXAPP_DRIVER_CONFIG:join(directory,'config.json'),
    REMOTEXAPP_CORE_DRIVER_DIR:resolve('drivers/common'),REMOTEXAPP_SESSION_SERVICES:'core-v1',
    REMOTEXAPP_SESSION_GENERATION:'1',REMOTEXAPP_STATUS_PATH:join(directory,'status.json'),
    REMOTEXAPP_STATUS_SCHEMA:join(directory,'schema.json'),REMOTEXAPP_STATUS_HELPER:join(bin,'status-helper'),
    REMOTEXAPP_SHUTDOWN_GRACE_SECONDS:'5',TEST_PID:join(directory,'fixture.pid'),TEST_REPORTS:join(directory,'reports')};
  let recovering=false;const commands=[];
  const server=net.createServer(c=>{c.on('error',()=>{});c.once('data',data=>{
    const command=JSON.parse(data).command;commands.push(command);
    const pid=Number(readFileSync(env.TEST_PID,'utf8'));
    c.end(JSON.stringify({ok:true,result:command==='status'?{...base,pid,memory_protection_enabled:false,
      memory_kill_threshold_mib:0,engine_state:recovering?'recovering':'ready'}:{}})+'\n');
    if(command==='quit')process.kill(pid,'SIGTERM');
  });});
  await new Promise((r,j)=>{server.once('error',j);server.listen(join(control,'control.sock'),r);});
  const child=spawn('/bin/sh',[join(appRoot,'session.sh')],{env,stdio:['ignore','ignore','pipe']});
  const closed=new Promise(r=>child.once('close',r));let stderr='';child.stderr.on('data',b=>stderr+=b);
  try {
    let ready=false;
    for(let i=0;i<100;i++){
      try{ready=readFileSync(env.TEST_REPORTS,'utf8').includes('--state\nready\n');}catch{}
      if(ready||child.exitCode!==null)break;
      await new Promise(r=>setTimeout(r,100));
    }
    assert(ready,stderr||'session never reported ready with disabled protection');
    recovering=true;
    const quit=spawn('/bin/sh',[join(appRoot,'shutdown.sh')],{env,stdio:['ignore','ignore','pipe']});
    let error='';quit.stderr.on('data',b=>error+=b);
    assert.equal(await new Promise(r=>quit.once('close',r)),0,error);
    await closed;assert(commands.includes('quit'));
  } finally {
    if(child.exitCode===null){child.kill('SIGTERM');await closed;}
    await new Promise(r=>server.close(r));rmSync(directory,{recursive:true,force:true});
  }
});
