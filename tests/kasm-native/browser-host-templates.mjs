import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {config,api,remote,open,wait,delay} from './host-browser.mjs';

const results=[],before=new Set((await api('/api/instances')).map(i=>i.id));
remote(['python3','-c','from pathlib import Path;import sys;Path("/tmp/host-control-probe.py").write_text(sys.stdin.read())'],readFileSync(new URL('./host-control-probe.py',import.meta.url),'utf8'));
const b=await open(config.ingressURL+'/rx/sdk/host.html');
await wait(()=>b.evaluate("document.querySelector('#template')?.options.length===8"));
await b.evaluate("(async()=>{const sdk=await import('./index.js');window.qHost=new sdk.RemoteXAppHost({baseURL:'/rx',scope:'formal-template-qualification'});window.qDisplay=document.createElement('div');qDisplay.style='position:fixed;inset:20px;z-index:100;background:#111';document.body.append(qDisplay);})()");
const apps=['mousepad','kate','kwrite','libreoffice','edge','firefox-esr','lightview','xfce-user-desktop'];
try {
  for(const template of apps){
    let sessionId;
    try {
      const browser=['edge','firefox-esr','lightview'].includes(template),desktop=template==='xfce-user-desktop';
      const path='/home/rxhost/documents/template-'+template+(template==='libreoffice'?'.odt':'.txt');
      if(!browser && !desktop){
        const textPath=path.replace(/\.odt$/,'.txt');
        remote(['runuser','-u',config.user,'--','python3','-c','from pathlib import Path;import sys;Path(sys.argv[1]).write_text("Native document\\n")',textPath]);
        if(template==='libreoffice')remote(['runuser','-u',config.user,'--','env','HOME=/home/rxhost','PWD=/home/rxhost','sh','-c','cd /home/rxhost && exec libreoffice "$@"','host-convert','-env:UserInstallation=file:///tmp/host-document-conversion','--headless','--convert-to','odt','--outdir','/home/rxhost/documents',textPath]);
      }
      if(desktop){
        const existing=(await api('/api/managed-instances')).find(m=>m.id==='host-desktop');
        if(existing)await api('/api/managed-instances/host-desktop',{desiredState:'running'},'PATCH');
        else await api('/api/managed-instances',{id:'host-desktop',templateId:template,desiredState:'running'});
      }
      const options=desktop?{managedId:'host-desktop'}:{templateId:template,parameters:browser?{startUrl:'http://127.0.0.1:1988/'}:{filePath:path}};
      const outcome=await b.evaluate(`(async()=>{window.qSession=await qHost.open(${JSON.stringify(options)});window.qViewer=await qSession.attach(qDisplay);return {id:qSession.id,generation:qSession.generation,stats:qViewer.getStats(),instance:qSession.instance}})()`);
      sessionId=outcome.id;assert.equal(outcome.stats.state,'ready');assert(outcome.stats.renderedFrames>0);
      assert.equal(outcome.instance.displayProvider,'kasm');
      if(browser){
        const reused=await b.evaluate(`(async()=>{const another=await qHost.open(${JSON.stringify(options)});const same=another.id===qSession.id && another.generation===qSession.generation;await another.release();return same})()`);
        assert(reused);
        await b.evaluate(`qSession.invoke('openUrl',{url:'http://127.0.0.1:1988/?action=${template}'})`);
        await delay(600);
      }
      const descriptor=await b.evaluate('qSession.connections()');
      const control=JSON.parse(remote(['runuser','-u',config.user,'--','python3','/tmp/host-control-probe.py',JSON.stringify(descriptor),template]));
      if(['mousepad','kate','kwrite'].includes(template)){
        await b.evaluate("qViewer.sendKey('a',{modifiers:['Control']});qViewer.sendText('Native document 中文 saved');qViewer.sendKey('s',{modifiers:['Control']})");
        await wait(()=>['Native document 中文 saved','Native document 中文 saved\n'].includes(remote(['cat',path])),10000);
      }
      await assert.rejects(api('/api/instances/'+sessionId+'/connections?sessionGeneration='+(outcome.generation+1)),e=>e.status===409);
      const pinned={core:outcome.instance.versions?.current?.core?.sha256,app:outcome.instance.versions?.current?.app,component:outcome.instance.displayComponentDigest};
      results.push({template,status:'passed',protocol:control.protocol,currentGeneration:true,paint:true,sharedReuse:browser,controlReadback:true,pins:pinned});
      console.log(template+' passed');
    } catch(error){results.push({template,status:'failed',error:error.message});console.error(template+': '+error.message);}
    finally {
      await b.evaluate('(async()=>{await qSession?.release();qSession=null;qViewer=null})()').catch(()=>{});
      if(template==='xfce-user-desktop')await api('/api/managed-instances/host-desktop',{desiredState:'stopped',force:true},'PATCH').catch(()=>{});
      if(sessionId){const current=await api('/api/instances/'+sessionId);if(current.state!=='stopped')await api('/api/instances/'+sessionId+'/stop',{force:true,sessionGeneration:current.sessionGeneration});}
    }
  }
} finally {
  await b.evaluate('qHost.dispose()').catch(()=>{});await b.close();
  for(const item of await api('/api/instances'))if(!before.has(item.id) && item.state!=='stopped')await api('/api/instances/'+item.id+'/stop',{force:true,sessionGeneration:item.sessionGeneration});
  writeFileSync(config.evidenceDirectory+'/host-templates.json',JSON.stringify({schemaVersion:1,results,humanAcceptance:'not-evaluated'},null,2));
}
assert.equal(results.filter(r=>r.status==='passed').length,8,'all formal templates must pass');
