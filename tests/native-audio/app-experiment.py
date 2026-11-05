#!/usr/bin/env python3
"""Real X11 test application, private Pulse, synthetic waveform; no user desktop."""
import argparse, importlib.util, json, os, secrets, subprocess, tempfile, time
from pathlib import Path
spec=importlib.util.spec_from_file_location('domain_experiment',Path(__file__).with_name('domain-experiment.py'))
domains=importlib.util.module_from_spec(spec);spec.loader.exec_module(domains)

def wait(fn,seconds=8):
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        result=fn()
        if result:return result
        time.sleep(.05)
    raise RuntimeError('X11 audio application condition timed out')

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--binary',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    before=domains.account_state();checks=[];children=[]
    with tempfile.TemporaryDirectory(prefix='rxa-app-') as temp:
        root=Path(temp);domain=domains.Domain(root,'audio')
        try:
            display=next(n for n in range(194,220)if not Path(f'/tmp/.X{n}-lock').exists()and not Path(f'/tmp/.X11-unix/X{n}').exists())
            auth=root/'xauth';auth.touch(mode=0o600)
            subprocess.run(['xauth','-f',str(auth),'add',f':{display}','MIT-MAGIC-COOKIE-1',secrets.token_hex(16)],check=True,capture_output=True)
            env=dict(domain.env,DISPLAY=f':{display}',XAUTHORITY=str(auth))
            x=subprocess.Popen(['Xvfb',f':{display}','-screen','0','1000x540x24','-nolisten','tcp','-auth',str(auth)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);children.append(x)
            wait(lambda:subprocess.run(['xdpyinfo'],env=env,capture_output=True).returncode==0)
            app=subprocess.Popen([str(args.binary)],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);children.append(app)
            def window():
                result=subprocess.run(['xdotool','search','--onlyvisible','--pid',str(app.pid)],env=env,capture_output=True,text=True)
                return result.stdout.strip().splitlines()[0]if result.returncode==0 else None
            wid=wait(window)
            def status():
                raw=subprocess.check_output(['xprop','-notype','-id',wid,'_REMOTEXAPP_AUDIO_TEST_STATUS'],env=env,text=True)
                try:return json.loads(json.loads(raw.split(' = ',1)[1]))
                except (ValueError,IndexError):return None
            wait(status);checks.append('real X11 application publishes content-free status')
            def click(index):subprocess.run(['xdotool','mousemove','--window',wid,str(28+index*166+70),'150','click','1'],env=env,check=True,capture_output=True)
            def record_speaker(action):
                path=root/'speaker.pcm'
                with path.open('wb')as out:
                    capture=subprocess.Popen(['parec','--raw','--format=s16le','--rate=48000','--channels=1','--latency-msec=20','--device=rx_speaker.monitor'],env=env,stdout=out,stderr=subprocess.DEVNULL);children.append(capture)
                    time.sleep(.2);action();time.sleep(2.5);capture.terminate();capture.wait(timeout=3)
                import array,math,sys
                samples=array.array('h');samples.frombytes(path.read_bytes())
                if sys.byteorder!='little':samples.byteswap()
                amplitudes={}
                for f in [440,880]:
                    peak=0
                    for start in range(0,len(samples)-4800,2400):
                        block=samples[start:start+4800]
                        re=sum(v*math.cos(2*math.pi*f*i/48000)for i,v in enumerate(block));im=sum(v*math.sin(2*math.pi*f*i/48000)for i,v in enumerate(block))
                        peak=max(peak,2*math.hypot(re,im)/4800)
                    amplitudes[f]=peak
                return amplitudes
            assert record_speaker(lambda:click(0))[440]>3000;checks.append('remote Play button produces real 440 Hz Pulse output')
            wave=root/'mic.pcm';wave.write_bytes(domains.pcm(880,4))
            with wave.open('rb')as source:
                inject=subprocess.Popen(['pacat','--playback','--raw','--format=s16le','--rate=48000','--channels=1','--latency-msec=20','--device=rx_mic_in'],env=env,stdin=source,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);children.append(inject)
                click(2);observed=wait(lambda:(s if (s:=status())and s['samples']==144000 and s['mode']=='idle'else None),7)
                inject.wait(timeout=5)
            assert observed['tone880']>3000;checks.append('remote Record reads exactly three seconds and detects injected 880 Hz')
            assert record_speaker(lambda:click(3))[880]>3000;checks.append('remote Replay returns recorded waveform through its speaker')
            click(1);time.sleep(.15);click(4);assert wait(lambda:status()['mode']=='idle');checks.append('Stop cancels owned playback')
            app.terminate();app.wait(timeout=3);checks.append('graceful App exit completes')
        finally:
            for child in reversed(children):
                if child.poll()is None:child.terminate()
                child.wait(timeout=5)
            domain.stop()
    assert before==domains.account_state()
    result={'schema':1,'checks':checks,'passed':True,'cleanup':{'ownedProcessesReaped':True,'privateFilesRemoved':not root.exists(),'accountAudioPreserved':True},'notQualified':['browser/WAN','physical devices','full Manager lifecycle']}
    args.output.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'passed':True,'checks':len(checks),'cleanup':result['cleanup']}))
if __name__=='__main__':main()
