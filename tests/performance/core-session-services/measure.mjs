// Explicit local gate. Uses disposable Managers/runtimes; run live suites serially.
import assert from 'node:assert/strict';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {RemoteXAppManager} from '../../../cmd/remotexappd/web/sdk/remotexapp-manager.js';

const exec = promisify(execFile), sleep = ms => new Promise(r => setTimeout(r, ms));
const baseline = resolve(process.argv[2]), candidate = resolve(process.argv[3] || '.');
const work = await mkdtemp('/tmp/remotexapp-svc-perf-');
const baseURL = 'http://127.0.0.1:21996', api = new RemoteXAppManager({baseURL});
const env = {...process.env, XDG_RUNTIME_DIR:`/run/user/${process.getuid()}`, DBUS_SESSION_BUS_ADDRESS:`unix:path=/run/user/${process.getuid()}/bus`};
const samples = {baseline:[], candidate:[]}, roots = {baseline, candidate};
let manager, active;
async function wait(fn, message, budget=45000) {
  const until = Date.now()+budget;
  while (Date.now()<until) { const value=await fn(); if(value)return value; await sleep(50); }
  throw Error(message);
}
async function start(label) {
  const root=roots[label], dir=join(work,label);
  for (const name of ['state','apps','enabled','legacy']) await mkdir(join(dir,name),{recursive:true});
  await exec(join(root,'scripts/install-shipped-apps.sh'),[join(root,'bin/remotexappd'),join(dir,'apps'),join(dir,'enabled')],{env});
  manager=spawn(join(root,'bin/remotexappd'),['-listen','127.0.0.1:21996','-auth-mode','none','-state-dir',join(dir,'state'),
    '-class-config',join(dir,'legacy'),'-app-package-root',join(dir,'apps'),'-apps-enabled',join(dir,'enabled'),'-expose-internals=true',
    '-gateway-bin',join(root,'bin/novnc-input'),'-status-bin',join(root,'bin/remotexapp-status'),
    '-core-driver-dir',join(root,'drivers/common'),'-ibus-engine',join(root,'components/remote-unicode-engine/engine.py')],{env,stdio:['ignore','ignore','pipe']});
  manager.stderr.on('data',b=>process.stderr.write(b));
  await wait(async()=>{if(manager.exitCode!==null)throw Error('Manager exited');try{return(await fetch(baseURL+'/readyz')).ok}catch{return false}},'Manager timeout');
}
async function stopManager() {
  if(manager && manager.exitCode===null)await new Promise(r=>{manager.once('exit',r);manager.kill('SIGTERM')});
}
async function usage(cgroup) {
  const cpu=Object.fromEntries((await readFile(join(cgroup,'cpu.stat'),'utf8')).trim().split('\n').map(x=>x.split(' ')));
  return {memoryBytes:Number(await readFile(join(cgroup,'memory.current'),'utf8')),cpuUsec:Number(cpu.usage_usec)};
}
async function measure(label, iteration) {
  await start(label);
  const started=performance.now();
  active=await api.createInstance({templateId:'mousepad'});
  const ready=await wait(async()=>{const x=await api.getInstance(active.id);return x.applicationStatus?.state==='ready'&&x},'App not ready');
  const launchMs=performance.now()-started;
  const unit=`remotexapp-${active.id}-session.service`;
  const relative=(await exec('systemctl',['--user','show',unit,'-p','ControlGroup','--value'],{env})).stdout.trim();
  assert(relative.startsWith('/user.slice/'));
  const cgroup=join('/sys/fs/cgroup',relative);
  await sleep(2000);
  const first=await usage(cgroup), idleStart=performance.now();
  await sleep(5000);
  const last=await usage(cgroup), idleMs=performance.now()-idleStart;
  const pids=(await readFile(join(cgroup,'cgroup.procs'),'utf8')).trim().split(/\s+/).map(Number);
  const processes=[];
  for(const pid of pids)try{processes.push((await readFile(`/proc/${pid}/cmdline`,'utf8')).replaceAll('\0',' '))}catch{}
  // AT-SPI also runs a D-Bus daemon in both versions. Count the owned session
  // endpoint separately; retain the total to detect extra activation daemons.
  const serviceCounts={dbus:processes.filter(x=>/dbus-daemon .*session-bus.sock/.test(x)).length,
    allDBus:processes.filter(x=>/dbus-daemon /.test(x)).length,
    ibus:processes.filter(x=>/ibus-daemon /.test(x)).length,
    engine:processes.filter(x=>/python3 .*engine.py/.test(x)).length,
    supervisor:processes.filter(x=>/remotexapp-status --supervise-session/.test(x)).length};
  const warmStarted=performance.now();
  await api.restartInstance(active.id,{sessionGeneration:ready.sessionGeneration,force:true});
  await wait(async()=>{const x=await api.getInstance(active.id);return x.sessionGeneration>ready.sessionGeneration&&x.applicationStatus?.state==='ready'},'warm session not ready');
  const warmRestartMs=performance.now()-warmStarted;
  const stopped=performance.now();await api.stopInstance(active.id,{force:true});active=null;
  await wait(async()=>{try{return !(await readFile(join(cgroup,'cgroup.procs'),'utf8')).trim()}catch(e){if(e.code==='ENOENT')return true;throw e}},'session cgroup leaked',10000);
  const sample={iteration,launchMs,warmRestartMs,memoryBytes:last.memoryBytes,idleCPUPercent:(last.cpuUsec-first.cpuUsec)/(idleMs*10),
    processes:processes.length,serviceCounts,cleanupMs:performance.now()-stopped,appVersion:ready.driverVersion};
  samples[label].push(sample);console.error(label,JSON.stringify(sample));await stopManager();
}
try {
  let occupied=false;try{occupied=(await fetch(baseURL+'/readyz')).ok}catch{}assert(!occupied,'21996 occupied');
  for(let i=0;i<5;i++)for(const label of (i%2 ? ['candidate','baseline'] : ['baseline','candidate']))await measure(label,i);
  const median=xs=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
  const medians=Object.fromEntries(Object.entries(samples).map(([label,rows])=>[label,Object.fromEntries(['launchMs','warmRestartMs','memoryBytes','idleCPUPercent','processes','cleanupMs'].map(key=>[key,median(rows.map(r=>r[key]))]))]));
  const b=medians.baseline,c=medians.candidate;
  const gates={launch:c.launchMs-b.launchMs<=Math.max(1000,b.launchMs*0.2),memory:c.memoryBytes-b.memoryBytes<=16*1024*1024,
    warmRestart:c.warmRestartMs-b.warmRestartMs<=Math.max(1000,b.warmRestartMs*0.2),
    idleCPU:c.idleCPUPercent-b.idleCPUPercent<=0.5,processes:c.processes-b.processes<=1,
    cleanup:samples.candidate.every(r=>r.cleanupMs<=10000),
    serviceCounts:samples.candidate.every(r=>r.serviceCounts.dbus===1&&r.serviceCounts.ibus===1&&r.serviceCounts.engine===1&&r.serviceCounts.supervisor===1&&r.serviceCounts.allDBus<=samples.baseline.find(b=>b.iteration===r.iteration).serviceCounts.allDBus)};
  const passed=Object.values(gates).every(Boolean);
  const identity={};
  for(const [label,root] of Object.entries(roots))identity[label]={version:(await readFile(join(root,'VERSION'),'utf8')).trim(),
    managerSHA256:createHash('sha256').update(await readFile(join(root,'bin/remotexappd'))).digest('hex'),
    supervisorSHA256:createHash('sha256').update(await readFile(join(root,'bin/remotexapp-status'))).digest('hex')};
  const result={experiment:'P16',outcome:passed?'accepted':'rejected',status:passed?'Measured local non-regression gates passed; human UAT is separate.':'A locked resource gate failed.',
    timestamp:new Date().toISOString(),method:'five alternating fresh-runtime/profile Mousepad launches and warm same-runtime session restarts per version; host binary caches warm (no global cache drop); 2 s settle, 5 s idle; session cgroup counters; one host; no other test suites',identity,samples,medians,gates};
  await writeFile(join(work,'result.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({passed,work,medians,gates}));assert(passed,'locked performance threshold failed');
}finally{if(active)try{await api.stopInstance(active.id,{force:true})}catch{}await stopManager()}
