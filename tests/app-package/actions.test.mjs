import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

for(const app of ['edge','firefox-esr'])test(app+' action declaration and package-owned endpoint/response guards',()=>{
 const manifest=JSON.parse(readFileSync(`apps/${app}/manifest.json`));assert.equal(manifest.actions.openUrl.handler,'open-url.py');assert.equal(manifest.actions.openUrl.timeout,'15s');assert.deepEqual(manifest.actions.openUrl.parameters.url.allowedSchemes,['http','https']);
 execFileSync('/usr/bin/python3',['-B','-c',`
import sys,runpy,json,io,tempfile,os
sys.path.insert(0,'apps/${app}')
d=runpy.run_path('apps/${app}/open-url.py')
class Socket:
 def __init__(self, frames): self.frames=iter(frames); self.sent=[]
 def send_frame(self,op,data): self.sent.append((op,data))
 def read_frame(self): return next(self.frames)
s=Socket([(9,b'ping'),(1,b'{"id":99,"result":{}}'),(1,b'{"id":1,"result":{"ok":true}}')])
assert d['call'](s,1,'test',{})=={'ok':True}
assert s.sent[1]==(10,b'ping')
for frames in [[(8,b'')],[(1,b'{"id":1,"error":"denied"}')],[(1,b'{"id":99}')]*128]:
 try: d['call'](Socket(frames),1,'test',{})
 except RuntimeError: pass
 else: raise AssertionError('accepted invalid response')
with tempfile.TemporaryDirectory() as work:
 path=work+'/resources.json'
 with open(path,'w') as f: json.dump({'control':{'address':'127.0.0.1','port':23456}},f)
 os.environ['REMOTEXAPP_RESOURCES']=path
 def payload(url='https://example.test',port=23456,address='127.0.0.1'):
  return {'parameters':{'url':url,'disposition':'new-tab'},'connections':{'application':{'address':address,'port':port}}}
 for p in [payload('file:///tmp/a'),payload(port=23457),payload(address='192.0.2.1')]:
  sys.stdin=io.TextIOWrapper(io.BytesIO(json.dumps(p).encode()))
  try: d['inputs']()
  except ValueError: pass
  else: raise AssertionError('accepted unowned endpoint or URL')
 sys.stdin=io.TextIOWrapper(io.BytesIO(json.dumps(payload()).encode()))
 assert d['inputs']()[0]=='https://example.test'
`],{stdio:'pipe'});
});
