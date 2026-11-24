import argparse, contextlib, json, re, struct, subprocess, time
from pathlib import Path
from playwright.sync_api import sync_playwright

parser=argparse.ArgumentParser()
parser.add_argument('fixture',type=Path)
args=parser.parse_args()
config=json.loads(args.fixture.read_text())
assert config['projectOwnedDisposable'] is True
assert re.fullmatch(r'local:remotexapp-host-[a-z0-9-]+',config['container'])
assert config['origin'].startswith('https://127.0.0.1:')
root=args.fixture.resolve().parent
origin=config['origin']
expected=config['expectedCommit']
fixture=config['container']
state=config['state']
results={}
ids=[]

def emit(name,**details):
    row={'status':'passed',**details}
    results[name]=row
    print(json.dumps({'case':name,**row}),flush=True)

def owned(*args,stdin=None,timeout=10):
    p=subprocess.run(['sudo','-n','lxc','exec',fixture,'--','runuser','-u','rxhost','--',*args],
        input=stdin,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
    if p.returncode:raise RuntimeError('fixture command failed: '+p.stderr.decode(errors='replace').split('\n')[0][:240])
    return p.stdout

def click(p,button):
    p.evaluate('integrationUAT.reply=null')
    p.locator('#'+button).click()
    p.wait_for_function('integrationUAT.reply!==null',timeout=26000)
    assert p.evaluate('integrationUAT.reply.ok'),(button,p.evaluate('integrationUAT.reply'))

def poll(p,expression,ms=18000):
    return p.wait_for_function(expression,timeout=ms,polling=120)

def api(context,path,data=None):
    r=(context.request.get(origin+path,timeout=14000) if data is None
        else context.request.post(origin+path,data=data,timeout=20000))
    assert r.ok,(path,r.status)
    return r.json()

def app(p):
    return p.evaluate('integrationUAT.view.session.id')

def open_page(context,runtime=None):
    p=context.new_page()
    p.goto(origin+'/integration.html'+('?instance='+runtime if runtime else ''))
    poll(p,'typeof integrationUAT==="object"')
    if not runtime:click(p,'open')
    poll(p,'integrationUAT.view?.viewer?.getStats()?.renderedFrames>0 && !!integrationUAT.interest')
    if not runtime:ids.append(app(p))
    return p

def snap(p):
    return p.evaluate("""()=>{
      const a=integrationUAT,v=a.view.viewer,d=v.getStats(),h=a.host.getAudioState();
      const r=h.routes.find(x=>x.runtime===a.view.session.id)||{};
      return {epoch:d.connectionEpoch,paint:d.renderedFrames,display:d.state,transport:d.transport,
        config:v.getClipboardState(),speaker:!!r.actualSpeaker,mic:!!r.actualMic,wantsMic:!!r.mic,
        sent:h.sentBytes||0,audio:h.connectionId,channels:h.connection,requests:a.requests,peak:a.peak,
        generation:a.view.session.generation};
    }""")

def wait_audio(p,old=None):
    condition="""(()=>{
      const a=integrationUAT,s=a.host.getAudioState();
      const r=s.routes.find(r=>r.runtime===a.view.session.id);
      return !!r && r.actualMic && r.actualSpeaker && s.sentBytes>0"""
    if old is not None:condition+=' && s.connectionId!=='+json.dumps(old)
    poll(p,condition+';})()',27000)

def fault(context,name,runtime=''):
    r=context.request.post(origin+'/fixture',params={'action':name,'runtime':runtime},timeout=21000)
    assert r.status==204,(name,r.status,r.text())

def domain(runtime):
    manifest=json.loads(owned('cat',state+'/runtime-manifests/'+runtime+'.json'))['runtime']
    sp=json.loads(owned('cat',manifest['runtimePath']+'/session-services.json'))
    assert sp['audio']['root'].startswith('/run/user/1004/remotexappd/')
    return sp['audio']['root'],sp['audio']['pid']

def mic_peak(runtime):
    path,_=domain(runtime)
    code="""import subprocess, sys
p=subprocess.Popen(['parec','--device=rx_mic','--raw','--format=s16le','--rate=48000','--channels=1','--latency-msec=40'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
try:
 sys.stdout.buffer.write(p.stdout.read(48000))
finally:
 p.terminate()
 p.wait(timeout=2)
"""
    raw=owned('env','PULSE_SERVER=unix:'+path+'/run/native','PULSE_COOKIE='+path+'/cookie','PULSE_CLIENTCONFIG='+path+'/config/client.conf',
        'python3','-c',code,timeout=6)
    assert len(raw)>=12000,len(raw)
    return max(abs(n) for n, in struct.iter_unpack('<h',raw))

def x11_target(context,runtime):
    display=api(context,'/api/instances/'+runtime)['display']
    assert re.fullmatch(r':\d+',display)
    path=owned('python3','-c',"""from pathlib import Path
import os,sys
for p in Path('/proc').glob('[0-9]*/cmdline'):
 try:
  if p.stat().st_uid!=os.getuid():continue
  a=p.read_bytes().split(bytes([0]))
  if Path(os.fsdecode(a[0])).name=='Xkasmvnc' and os.fsencode(sys.argv[1]) in a:
   print(os.fsdecode(a[a.index(b'-auth')+1]));break
 except (FileNotFoundError,PermissionError):pass
""",display).decode().strip()
    assert path.startswith('/home/rxhost/')
    return display,path

def send_x11(context,runtime,text):
    display,path=x11_target(context,runtime)
    code="""import subprocess,sys
subprocess.run(['xclip','-selection','clipboard','-in','-target','UTF8_STRING','-silent'],input=sys.stdin.buffer.read(),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True,timeout=3)
"""
    owned('env','DISPLAY='+display,'XAUTHORITY='+path,'python3','-c',code,stdin=text.encode())

def clipboard_ready(p):
    p.bring_to_front()
    p.evaluate('integrationUAT.view.viewer.focus()')
    poll(p,'integrationUAT.view.viewer.getClipboardState().active && integrationUAT.view.viewer.getClipboardState().effective.toLocal==="auto"')

def clip_roundtrip(p,context,runtime,value):
    clipboard_ready(p)
    send_x11(context,runtime,value)
    deadline=time.monotonic()+10
    while time.monotonic()<deadline:
        if p.evaluate('navigator.clipboard.readText()')==value:
            break
        time.sleep(.12)
    else:
        raise AssertionError('remote clipboard did not reach the local browser')
    assert snap(p)['config']['phase']=='copied-to-local'
    local=value+' local-to-remote'
    p.evaluate('value=>navigator.clipboard.writeText(value)',local)
    display,authority=x11_target(context,runtime)
    deadline=time.monotonic()+10
    while time.monotonic()<deadline:
        remote=owned('env','DISPLAY='+display,'XAUTHORITY='+authority,'xclip','-selection','clipboard','-out',timeout=3).decode()
        if remote==local:
            break
        time.sleep(.12)
    else:
        raise AssertionError('local clipboard did not reach the remote X11 selection')

    if snap(p)['speaker']:
        click(p,'tone')
        poll(p,'integrationUAT.peak>.02')

def test():
 with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/google-chrome',headless=True,
        args=['--ignore-certificate-errors-spki-list='+(root/'loopback.spki').read_text().strip(),'--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',
        '--use-file-for-fake-audio-capture='+str(root/'mic-880.wav')])
    context=browser.new_context(ignore_https_errors=True,permissions=['microphone','clipboard-read','clipboard-write'],viewport={'width':1320,'height':980})
    try:
        version=api(context,'/api/version')
        assert version['commit']==expected[:12],version
        assert not any(i['state']!='stopped' for i in api(context,'/api/instances'))
        p=open_page(context); runtime=app(p); generation=snap(p)['generation']
        p.evaluate("navigator.clipboard.writeText('initial fixture baseline')")
        click(p,'clipboard');clip_roundtrip(p,context,runtime,'远程文本🙂 initial')
        click(p,'speaker-on');click(p,'mic-on');wait_audio(p)
        click(p,'tone');poll(p,'integrationUAT.peak>.02')
        mic=mic_peak(runtime);assert mic>250,mic
        assert snap(p)['requests']==1 and snap(p)['config']['maxBytes']==10485760
        emit('real-wss-baseline',commit=version['commit'],browser=browser.version,speakerPeak=snap(p)['peak'],remoteMicrophonePeak=mic,clipboardMaxBytes=10485760)

        old=snap(p)
        fault(context,'cut-viewer',runtime)
        poll(p,'integrationUAT.view.viewer.getStats().state==="ready" && integrationUAT.view.viewer.getStats().connectionEpoch>'+str(old['epoch']))
        resumed=snap(p)
        assert resumed['generation']==generation and resumed['audio']==old['audio'] and resumed['mic']
        assert resumed['config']['requested']=={'toLocal':'auto','toRemote':'auto'}
        clip_roundtrip(p,context,runtime,'画面重连后的新剪贴板🙂')
        emit('viewer-cut-keeps-audio-and-rebinds-clipboard',generation=generation,sameAudioConnection=True,noNewConsent=True)

        p2=open_page(context,runtime)
        p.bring_to_front()
        old=snap(p)
        fault(context,'cut-audio',runtime)
        wait_audio(p,old['audio'])
        assert snap(p)['epoch']==old['epoch'] and snap(p)['requests']==1
        assert snap(p2)['requests']==0 and snap(p2)['audio']==snap(p)['audio']
        assert mic_peak(runtime)>250
        emit('audio-cut-preserves-owner-and-reuses-live-mic',newAudioConnection=True,oldDisplayPreserved=True,secondTabCaptureRequests=0)
        p2.close();p.bring_to_front()

        old=snap(p);prev_domain=domain(runtime)
        fault(context,'manager-restart',runtime)
        deadline=time.monotonic()+24
        while time.monotonic()<deadline:
            try:
                version=api(context,'/api/version')
                if version['commit']==expected[:12]:break
            except (AssertionError,Exception):time.sleep(.25)
        poll(p,'integrationUAT.view.viewer.getStats().state==="ready" && integrationUAT.view.viewer.getStats().connectionEpoch>'+str(old['epoch']),26000)
        wait_audio(p,old['audio'])
        assert snap(p)['requests']==1 and domain(runtime)==prev_domain and snap(p)['generation']==generation
        assert snap(p)['config']['requested']=={'toRemote':'auto','toLocal':'auto'}
        clip_roundtrip(p,context,runtime,'Manager重启后的新内容')
        assert mic_peak(runtime)>250
        emit('manager-restart-restores-all-three',sameGeneration=True,pulseDomainPreserved=True,microphoneRequests=1)

        fault(context,'audio-block')
        fault(context,'cut-audio',runtime)
        poll(p,"!integrationUAT.host.getAudioState().routes.find(r=>r.runtime===integrationUAT.view.session.id)?.mic",19000)
        assert snap(p)['requests']==1
        fault(context,'audio-unblock')
        poll(p,"integrationUAT.host.getAudioState().routes.some(r=>r.actualSpeaker) && !integrationUAT.host.getAudioState().routes.some(r=>r.actualMic)",28000)
        assert snap(p)['requests']==1 and not snap(p)['mic']
        request=p.evaluate('integrationUAT.host.getAudioState().routes[0].requested')
        assert request=={'speaker':True,'microphone':True},request
        assert p.evaluate('integrationUAT.host.getAudioState().routes[0].microphoneActionRequired')
        emit('extended-outage-expires-mic-keeps-intent',speakerRecovered=True,captureRequests=1)

        # All scopes use ordinary ingress-authorized access without a login header.
        click(p,'mic-on');wait_audio(p)
        old=snap(p)
        fault(context,'cut-viewer',runtime);fault(context,'cut-audio',runtime)
        wait_audio(p,old['audio'])
        poll(p,'integrationUAT.view.viewer.getStats().state==="ready" && integrationUAT.view.viewer.getStats().connectionEpoch>'+str(old['epoch']))
        clip_roundtrip(p,context,runtime,'combined transport recovery')
        assert snap(p)['requests']==2
        emit('combined-cuts-recover-all-three',microphoneRequests=2,remoteMicrophonePeak=mic_peak(runtime))

        old=snap(p)
        fault(context,'lease-once',runtime)
        time.sleep(25)
        assert snap(p)['epoch']==old['epoch']
        clip_roundtrip(p,context,runtime,'transient renewal retained viewer')
        emit('one-viewer-renewal-503',sameViewer=True)

        fault(context,'audio-block');fault(context,'cut-audio',runtime)
        poll(p,"integrationUAT.host.getAudioState().connection==='recovering'")
        click(p,'speaker-off');click(p,'mic-off')
        fault(context,'audio-unblock')
        time.sleep(6)
        assert not snap(p)['speaker'] and not snap(p)['mic']
        assert p.evaluate('integrationUAT.host.getAudioState().routes[0].requested')=={'speaker':False,'microphone':False}
        emit('explicit-off-during-outage-cancels-recovery',newCapture=False)

        click(p,'speaker-on');click(p,'mic-on');wait_audio(p)
        context.set_offline(True)
        time.sleep(3)
        context.set_offline(False)
        wait_audio(p)
        poll(p,'integrationUAT.view.viewer.getStats().state==="ready"')
        clip_roundtrip(p,context,runtime,'browser online recovery')
        emit('browser-offline-online',speakerPeak=snap(p)['peak'],remoteMicrophonePeak=mic_peak(runtime))

        # Hold both transports and renewal requests beyond the initial retry budget.
        click(p,'mic-off')
        fault(context,'network-block')
        old=snap(p)
        fault(context,'cut-viewer',runtime);fault(context,'cut-audio',runtime)
        time.sleep(38)
        assert snap(p)['config']['requested']=={'toLocal':'auto','toRemote':'auto'}
        fault(context,'network-unblock')
        poll(p,'integrationUAT.view.viewer.getStats().state==="ready" && integrationUAT.view.viewer.getStats().connectionEpoch>'+str(old['epoch']),70000)
        poll(p,'integrationUAT.host.getAudioState().routes[0].actualSpeaker')
        clip_roundtrip(p,context,runtime,'long combined network recovery')
        emit('long-combined-network-outage',heldSeconds=38,sameGeneration=snap(p)['generation']==generation)
        click(p,'mic-on');wait_audio(p)

        p.evaluate("document.dispatchEvent(new Event('freeze'))")
        poll(p,'!integrationUAT.host.getAudioState().routes[0].actualMic')
        p.evaluate("document.dispatchEvent(new Event('resume'))")
        assert p.evaluate('integrationUAT.host.getAudioState().routes[0].requested.microphone')
        assert p.evaluate('integrationUAT.host.getAudioState().routes[0].microphoneActionRequired')
        assert snap(p)['requests']==4
        emit('suspend-requires-action-keeps-intent',automaticCaptureRequests=0)

        before_worker=snap(p)['audio']
        debug=browser.new_browser_cdp_session()
        workers=debug.send('Target.getTargets')['targetInfos']
        target=next(t['targetId'] for t in workers if t['type']=='shared_worker' and t['url']==origin+'/sdk/audio-worker.js')
        assert debug.send('Target.closeTarget',{'targetId':target})['success']
        poll(p,'integrationUAT.host.getAudioState().routes[0]?.actualSpeaker && integrationUAT.host.getAudioState().connectionId!=='+json.dumps(before_worker),24000)
        assert p.evaluate('integrationUAT.host.getAudioState().routes[0].requested.microphone')
        assert not snap(p)['mic'] and snap(p)['requests']==4
        clip_roundtrip(p,context,runtime,'worker replacement preserves integrations')
        emit('shared-worker-termination-restores-speaker',automaticCaptureRequests=0)
        debug.detach()

        p.evaluate('integrationUAT.view.viewer.disconnect()')
        time.sleep(3)
        assert snap(p)['display']!='ready'
        emit('explicit-viewer-disconnect-stays-disconnected')
        p.evaluate('integrationUAT.host.logout()')
        poll(p,'integrationUAT.interest.released')
        assert not snap(p)['speaker'] and not snap(p)['mic']
        emit('explicit-logout-retires-integrations')
    finally:
        with contextlib.suppress(Exception):fault(context,'network-unblock')
        with contextlib.suppress(Exception):fault(context,'audio-unblock')
        for p in context.pages:
            with contextlib.suppress(Exception):p.close()
        for runtime in ids:
            with contextlib.suppress(Exception):
                d=api(context,'/api/instances/'+runtime)
                if d['state']!='stopped':api(context,'/api/instances/'+runtime+'/stop',{'sessionGeneration':d['sessionGeneration'],'force':True})
        browser.close()

try:test()
except BaseException as err:
    results['failure']={'status':'failed','type':type(err).__name__,'detail':str(err)[:420]}
    raise
finally:
    (root/'integration-results.json').write_text(json.dumps(results,indent=2)+'\n')
