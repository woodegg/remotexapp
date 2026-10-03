import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=new URL('../',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',root)));
test('kate package has its own no-save optional-document contract',()=>{
 assert.equal(manifest.id,'kate');assert.equal(manifest.singleton,false);assert.equal(manifest.runMode,'isolated');
 assert.equal(manifest.parameters.filePath.required,undefined);
 assert.equal(manifest.server.depth,16);assert.equal(manifest.server.frameRate,10);assert.equal(manifest.server.geometry,'1280x720');assert.equal(manifest.server.allowClientResize,true);
 assert.equal(manifest.session.activation,'immediate');assert.equal(manifest.session.vacantTimeout,'60s');assert.equal(manifest.session.vacantAction,'stop-instance');
 assert.equal(manifest.session.status.privateDetails.application.type,'json');
 const script=readFileSync(new URL('session.sh',root),'utf8'),shutdown=readFileSync(new URL('shutdown.sh',root),'utf8');
 assert.match(script,/kate --block --startanon/);

 assert.match(script,/kill -KILL/);assert.match(shutdown,/kill -KILL/);assert.doesNotMatch(shutdown,/xdotool.*ctrl\+s/);
 assert.match(script,/--connection-application/);
 for(const path of ['server.sh','session.sh','shutdown.sh'])assert.equal(spawnSync('sh',['-n',fileURLToPath(new URL(path,root))]).status,0);
});
test('kate probe validates PID, signatures, window, stable bus owner and blank initialization',()=>{
 const source=`import contextlib,io,json,os,runpy,subprocess,sys,time
probe,app,scenario=sys.argv[1:]
pid=os.getpid()
sys.argv=[probe,str(pid),app,""]
service="org.kde."+app+"-"+str(pid)
elapsed=[0]
time.monotonic=lambda:elapsed[0]
time.sleep=lambda seconds:elapsed.__setitem__(0,elapsed[0]+21)
xml='<node><interface name="org.kde.Kate.Application">'
for method,types in [("tokenOpenUrl","ssb"),("setCursor","ii"),("openInput","ss")]:
 xml+='<method name="'+method+'">'+''.join('<arg type="'+t+'" direction="in"/>' for t in types)+'</method>'
xml+='</interface></node>'
owners=[0]
def run(args,**kw):
 if "ListNames" in args[-1]:return repr(([service],))
 if "GetNameOwner" in " ".join(args):
  owners[0]+=1
  return repr((":1.99" if scenario=="owner-change" and owners[0]>1 else ":1.7",))
 if "GetConnectionUnixProcessID" in " ".join(args):return "(uint32 "+str(pid+1 if scenario=="wrong-pid" else pid)+",)"
 if "introspect" in args:return xml.replace('type="b"','type="s"') if scenario=="wrong-signature" else xml
 if args[0]=="xdotool":return "" if scenario=="no-window" else "123"
 if args[-3]=="org.kde.Kate.Application.openInput":return "(false,)" if scenario=="blank-failed" else "(true,)"
 return "()"
subprocess.check_output=run
out=io.StringIO()
with contextlib.redirect_stdout(out):runpy.run_path(probe,run_name="__main__")
value=json.loads(out.getvalue())
assert value["service"]==service and value["uniqueName"]==":1.7"
assert value["capabilities"]==["tokenOpenUrl","setCursor","openInput"]
`;
 for(const scenario of ['success','wrong-pid','wrong-signature','no-window','owner-change','blank-failed']){
   const result=spawnSync('python3',['-c',source,fileURLToPath(new URL('probe.py',root)),'kate',scenario],{encoding:'utf8',timeout:5000});
   if(scenario==='success')assert.equal(result.status,0,result.stderr);
   else assert.notEqual(result.status,0,scenario);
 }
});
