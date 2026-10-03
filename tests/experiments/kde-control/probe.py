import ast, json, os, pathlib, re, subprocess, time, tempfile, xml.etree.ElementTree as ET
root=pathlib.Path(tempfile.mkdtemp(prefix='kde-control-probe-'))
print('Evidence directory: '+str(root),flush=True)
children=[]
def run(args,env=None):
    return subprocess.check_output(args,env=env,text=True,stderr=subprocess.DEVNULL,timeout=10).strip()
def bus(method,*args):
    return run(['gdbus','call','--session','--dest','org.freedesktop.DBus','--object-path','/org/freedesktop/DBus','--method','org.freedesktop.DBus.'+method,*args])
try:
    for app in ['kate','kwrite','kate','kwrite']:
        label=app+'-'+str(len(children)); home=root/label
        home.mkdir(mode=0o700); (home/'runtime').mkdir(mode=0o700)
        env=dict(os.environ,HOME=str(home),XDG_CONFIG_HOME=str(home/'config'),XDG_DATA_HOME=str(home/'data'),XDG_CACHE_HOME=str(home/'cache'),XDG_RUNTIME_DIR=str(home/'runtime'),QT_QPA_PLATFORM='xcb')
        log=open(home/'stderr.log','w')
        p=subprocess.Popen([app]+(['--block','--startanon'] if app=='kate' else []),env=env,stdout=log,stderr=log)
        children.append(p)
        service=None
        for _ in range(150):
            assert p.poll() is None, app+' exited'
            names=ast.literal_eval(bus('ListNames'))[0]
            matches=[n for n in names if n.startswith('org.kde.'+app+'-') and int(re.findall(r'\d+',bus('GetConnectionUnixProcessID',n))[-1])==p.pid]
            if len(matches)==1:
                service=matches[0];break
            time.sleep(.1)
        assert service, app+' service missing'
        owner=ast.literal_eval(bus('GetNameOwner',service))[0]
        xml=run(['gdbus','introspect','--session','--dest',owner,'--object-path','/MainApplication','--xml'])
        (home/'main.xml').write_text(xml)
        full=run(['gdbus','introspect','--session','--dest',owner,'--object-path','/','--xml','--recurse'])
        (home/'tree.xml').write_text(full)
        windows=''
        for _ in range(100):
            try:
                windows=run(['xdotool','search','--onlyvisible','--pid',str(p.pid)],env)
                if windows:break
            except subprocess.CalledProcessError: pass
            time.sleep(.1)
        assert windows
        def call(method,*args):
            return run(['gdbus','call','--session','--dest',owner,'--object-path','/MainApplication','--method','org.kde.Kate.Application.'+method,*args])
        file=home/'文档 space.txt';file.write_text('first line\nsecond line\n')
        opened=call('tokenOpenUrl',file.as_uri(),'UTF-8','false');assert 'ERROR' not in opened
        assert 'true' in call('setCursor','1','2')
        def readback():
            run(['xdotool','windowfocus','--sync',windows.splitlines()[0]],env)
            run(['xdotool','key','--clearmodifiers','ctrl+a','ctrl+c'],env)
            time.sleep(.2)
            return run(['xclip','-selection','clipboard','-out','-target','UTF8_STRING'],env)
        assert readback()=='first line\nsecond line'
        assert 'true' in call('openInput','Disposable control probe 文本','UTF-8')
        assert readback()=='Disposable control probe 文本'
        assert file.read_text()=='first line\nsecond line\n'
        after=run(['gdbus','introspect','--session','--dest',owner,'--object-path','/','--xml','--recurse'])
        (home/'after.xml').write_text(after)
        (home/'recursive.txt').write_text(run(['gdbus','introspect','--session','--dest',owner,'--object-path','/','--recurse']))
        descriptor=dict(protocol='dbus',service=service,uniqueName=owner,objectPath='/MainApplication',interface='org.kde.Kate.Application')
        for name in ['application-status.json','connection-status.json']:
            (home/name).write_text(json.dumps(dict(generation=1,revision=1,state='starting')))
        (home/'application-schema.json').write_text('{}')
        (home/'connection-schema.json').write_text(json.dumps(dict(sessionBus=dict(type='json',maxBytes=4096,maxDepth=2,maxItems=2),application=dict(type='json',maxBytes=4096,maxDepth=4,maxItems=32))))
        env['REMOTEXAPP_RUN_MODE']='isolated'
        run([os.environ['KDE_PROBE_STATUS_HELPER'],'--path',str(home/'application-status.json'),'--schema',str(home/'application-schema.json'),'--generation','1','--state','ready','--connection-metadata','--connection-application',json.dumps(descriptor)],env)
        private=json.loads((home/'connection-status.json').read_text());public=json.loads((home/'application-status.json').read_text())
        assert private['details']['application']==descriptor
        assert private['details']['sessionBus']['address']==env['DBUS_SESSION_BUS_ADDRESS']
        assert private['revision']==public['revision'] and service not in json.dumps(public)
        assert (home/'connection-status.json').stat().st_mode & 0o777 == 0o600
        print(json.dumps(dict(app=app,label=label,pid=p.pid,service=service,owner=owner,result='passed',interfaces=[e.attrib['name'] for e in ET.fromstring(xml).findall('interface')],checks=['pid-owned-service','visible-window','tokenOpenUrl-readback','setCursor','openInput-unicode-readback','original-file-unchanged','actual-status-helper-private-submission-no-public-leak'])),flush=True)
    assert len({p.pid for p in children})==4
finally:
    for p in children:
        if p.poll() is None:p.kill()
        p.wait(timeout=10)
