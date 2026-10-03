import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {RemoteXAppManager} from '../../cmd/remotexappd/web/sdk/remotexapp-manager.js';

const [baseURL,id,tokenFile]=process.argv.slice(2);
const manager=new RemoteXAppManager({baseURL});
const instance=await manager.getInstance(id);
const denied=await fetch(baseURL+'/api/instances/'+id+'/connections');
assert.equal(denied.status,200);
assert.equal(denied.headers.get('cache-control'),'no-store');
const info=await manager.getConnections(id,{sessionGeneration:instance.sessionGeneration});
assert.equal(info.environment.display,instance.display);
assert(info.environment.sessionBus);
const names=execFileSync('gdbus',['call','--address',info.environment.sessionBus.address,
 '--dest','org.freedesktop.DBus','--object-path','/org/freedesktop/DBus',
 '--method','org.freedesktop.DBus.ListNames'],{encoding:'utf8',timeout:5000});
assert.match(names,/org.freedesktop.DBus/);
execFileSync('xdotool',['getdisplaygeometry'],{env:{...process.env,DISPLAY:info.environment.display,XAUTHORITY:info.environment.xauthorityPath},timeout:5000});
assert.deepEqual(info.application,instance.applicationStatus.details?.control);
assert.equal(info.environment.sessionBus.scope,instance.effectivePolicy.runMode==='user-home'?'user':'runtime');
const again=await manager.getConnections(id,{});
assert.equal(again.revision,info.revision);
await assert.rejects(manager.getConnections(id,{sessionGeneration:instance.sessionGeneration+1}),error=>error.status===409);
console.log(JSON.stringify({result:'passed',template:instance.templateId,checks:['no-dedicated-token','current-generation','driver-bus-connect','x11-connect','control-projection','stable-revision','reject-stale-generation']}));
