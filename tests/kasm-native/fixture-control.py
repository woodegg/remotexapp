import json,subprocess,pathlib,urllib.request,urllib.error,time,sys,hashlib,os
# Run only against a newly provisioned, project-owned disposable fixture.
# Configuration and private evidence must remain outside the repository.
config=json.loads(pathlib.Path(sys.argv[1]).read_text())
assert config['purpose']=='remotexapp-d1-disposable'
C=config['container'];assert C.startswith('remotexapp-d1-')
backend=config['backend'];assert backend in ['systemd','standalone']
action=sys.argv[2];user=config['user'];uid=config['uid'];assert uid>0
home=config['home'];state=config['stateDir'];assert home.startswith('/home/') and state.startswith(home+'/')
base=config['managerURL'].rstrip('/')
assert base.startswith('http://127.0.0.1:')
out=pathlib.Path(config['evidenceDirectory']);out.mkdir(parents=True,exist_ok=True)
managed=config['managedId']
def remote(*args):
 p=subprocess.run(['/snap/bin/lxc','exec',C,'--',*map(str,args)],text=True,capture_output=True)
 if p.returncode:raise RuntimeError('remote command failed: '+p.stderr[-1200:])
 return p.stdout
def asuser(*args):return remote('runuser','-u',user,'--','env','XDG_RUNTIME_DIR=/run/user/'+str(uid),'DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/'+str(uid)+'/bus','sh','-c','cd "$1"; shift; exec "$@"','sh',home,*args)
def api(path,body=None,method=None):
 r=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json',config['identityHeader']:config['identity']},method=method)
 with urllib.request.urlopen(r,timeout=110) as response:return json.load(response)
def wait(f,timeout=45):
 end=time.monotonic()+timeout
 while time.monotonic()<end:
  try:
   x=f()
   if x:return x
  except (ConnectionError,urllib.error.URLError):pass
  time.sleep(.25)
 raise AssertionError('condition timed out')
def desk():return api('/api/managed-instances/'+managed)['runtime']
def read(path):return remote('cat',path)
def record(x):return json.loads(read(state+'/runtime-manifests/'+x['id']+'.json'))
def services(x):return json.loads(read(state+'/instances/'+x['id']+'/session-services.json'))
def bus():return asuser('dbus-send','--session','--print-reply','--dest=org.freedesktop.DBus','/org/freedesktop/DBus','org.freedesktop.DBus.GetId').strip().splitlines()[-1]
def desired(s,force=False):return api('/api/managed-instances/'+managed,{'desiredState':s,'force':force},'PATCH')
def prepare():
 x=desk();return api('/remotexapps/'+x['id']+'/native/prepare',{'sessionGeneration':x['sessionGeneration'],'componentDigest':x['displayComponentDigest']})
def identity(pid):
 s=read('/proc/'+str(pid)+'/stat');f=s[s.rfind(')')+1:].split();return {'pid':pid,'start':f[19],'state':f[0]}
def alive(i):
 try:r=identity(i['pid']);return r['start']==i['start'] and r['state'] not in ['Z','X']
 except RuntimeError:return False
def emit(data):
 data={'backend':backend,**data};(out/(action+'.json')).write_text(json.dumps(data,indent=2));print(json.dumps(data))
if action=='snapshot':
 x=desk();r=record(x);(out/'snapshot-private.json').write_text(json.dumps({'runtime':x,'record':r,'services':services(x),'boot':read('/proc/sys/kernel/random/boot_id')}))
 emit({'saved':True,'core':x['versions']['current']['core'],'componentDigest':x['displayComponentDigest']})
elif action=='start':
 desired('running');x=prepare();emit({'started':x['sessionState']=='running'})
elif action=='adoption':
 x=desk();r=record(x);s=services(x);b=bus()
 if backend=='systemd':asuser(*config['managerRestart'])
 else:asuser(*config['managerRestart'])
 wait(lambda: api('/readyz'))
 y=desk();assert y['sessionGeneration']==x['sessionGeneration'];assert record(y)['components']==r['components'];assert services(y)==s;assert bus()==b;assert record(y)['runtime']['homePath']==r['runtime']['homePath']
 emit({'adopted':True,'pinsGenerationHomeAndProcessIdentitiesUnchanged':True,'borrowedBusPreserved':True})
elif action in ['driver-loss','supervisor-loss']:
 x=desk();assert x['sessionState']=='running';s=services(x);b=bus();r=record(x);leader=s['driver' if action=='driver-loss' else 'supervisor'];cg=read('/proc/'+str(leader['pid'])+'/cgroup').strip().split('::')[1]
 code='''import subprocess,os
cg=%r
uid=%d
def prepare():
 open(cg+'/cgroup.procs','w').write(str(os.getpid()))
 os.setgroups([]);os.setgid(uid);os.setuid(uid)
env=dict(os.environ,HOME=%r,DISPLAY=%r,XAUTHORITY=%r,XDG_RUNTIME_DIR=%r,DBUS_SESSION_BUS_ADDRESS=%r)
p=subprocess.Popen(['mousepad','--disable-server'],env=env,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True,preexec_fn=prepare)
print(p.pid)
'''%('/sys/fs/cgroup'+cg,uid,home,x['display'],home+'/.Xauthority','/run/user/'+str(uid),'unix:path=/run/user/'+str(uid)+'/bus')
 helper=int(remote('python3','-c',code));time.sleep(1);h=identity(helper);assert read('/proc/'+str(helper)+'/comm').strip()=='mousepad';assert alive(h)
 assert identity(leader['pid'])['start']==leader['startTime'];remote('kill','-KILL',leader['pid'])
 if action=='supervisor-loss':
  time.sleep(3);assert alive(h)
  if backend=='systemd':asuser(*config['managerRestart'])
  else:asuser(*config['managerRestart'])
  wait(lambda:api('/readyz'))
 y=wait(lambda: (v:=desk())['sessionState']=='failed' and v) if action=='driver-loss' else wait(lambda: ((v:=desk()).get('recovery',{}).get('reason')=='session-populated-or-unknown' or 'incomplete adoption health' in v.get('error','')) and v);assert alive(h);assert y['sessionGeneration']==x['sessionGeneration'];assert bus()==b
 (wait(lambda: desk().get('recovery',{}).get('reason')=='session-populated-or-unknown') if action=='driver-loss' else None);time.sleep(3);assert alive(h);assert desk()['sessionGeneration']==x['sessionGeneration']
 (out/(action+'-private.json')).write_text(json.dumps({'helper':h,'record':r,'services':s,'bus':b}))
 emit({'liveEditorRetained':True,'replacementBlocked':True,'generationUnchanged':True,'borrowedBusPreserved':True,'unhealthyCheckedAfterManagerRestart':action=='supervisor-loss','reportedHealth':('populated-recovery-blocked' if y.get('recovery',{}).get('reason')=='session-populated-or-unknown' else 'incomplete-adoption-health')})
elif action=='empty-recovery':
 x=desk();r=record(x);b=bus();unit=r['runtime']['sessionUnit'];cg=read('/proc/'+str(json.loads((out/'driver-loss-private.json').read_text())['helper']['pid'])+'/cgroup').strip().split('::')[1]
 # Explicit fault injection into the already-proven disposable component only.
 remote('python3','-c',"from pathlib import Path; Path(%r).write_text('1')"%('/sys/fs/cgroup'+cg+'/cgroup.kill'))
 y=wait(lambda:(v:=desk())['sessionGeneration']>x['sessionGeneration'] and v['sessionState']=='running' and v,timeout=100)
 assert y['applicationStatus']['state']=='ready';assert record(y)['components']==r['components'];assert bus()==b
 emit({'eligibleEmptySessionRecoveredWithoutNewViewer':True,'generationAdvanced':True,'pinsAndBorrowedBusPreserved':True,'oldViewerCount':y['attachedClients']})
elif action=='stop':
 x=desk();r=record(x);b=bus();desired('stopped',True);y=api('/api/instances/'+x['id']);assert y['state']=='stopped';assert api('/api/managed-instances/'+managed)['desiredState']=='stopped';assert bus()==b
 for unit in [r['runtime'].get(k) for k in ['sessionUnit','gatewayUnit','serverUnit','vncUnit']]:
  if not unit:continue
  cg=config['sessionCgroupRoot'].rstrip('/')+'/'+unit
  assert remote('python3','-c',"from pathlib import Path;p=Path(%r);print(not p.exists() or 'populated 0' in p.read_text())"%(cg+'/cgroup.events')).strip()=='True'
 emit({'explicitStop':True,'allOwnedComponentsEmpty':True,'borrowedBusPreserved':True})
else:raise SystemExit('unknown action')
