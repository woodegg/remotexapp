import assert from 'node:assert/strict';
import test from 'node:test';
import { inferServiceBaseURL, RemoteXAppAPIError, RemoteXAppManager } from './remotexapp-manager.js';

function mockManager() {
  const calls = [];
  const classes = [{ id:'mousepad', name:'Mousepad', display:{}, input:{} }];
  const instances = [{
    id:'mousepad-1', classId:'mousepad', state:'server-ready',
    resources:{control:{kind:'loopback-tcp',address:'127.0.0.1',port:21001}},
    applicationStatus:{generation:2,state:'ready',details:{control:{protocol:'synthetic',address:'127.0.0.1',port:21001}}},
  }];
	const managed = [{ id:'resident-pad', templateId:'mousepad', desiredState:'stopped', observedState:'stopped' }];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/api/classes')) return Response.json(classes);
	if (url.endsWith('/api/templates')) return Response.json(classes);
	if (url.endsWith('/api/managed-instances') && options.method === 'POST') return Response.json({ ...managed[0], ...JSON.parse(options.body) }, { status:201 });
	if (url.endsWith('/api/managed-instances')) return Response.json(managed);
	if (url.endsWith('/api/managed-instances/resident-pad') && options.method === 'PATCH') return Response.json({ ...managed[0], ...JSON.parse(options.body) });
	if (url.includes('/api/managed-instances/resident-pad') && options.method === 'DELETE') return new Response(null, { status:204 });
	if (url.endsWith('/api/managed-instances/resident-pad')) return Response.json(managed[0]);
    if (url.endsWith('/api/instances/mousepad-1/status/environment')) return Response.json({
      instanceId:'mousepad-1', sessionGeneration:2, applicationState:'ready',
      environment:{DISPLAY:':10',XAUTHORITY:'/tmp/test-authority'}, workingDirectory:'/tmp/test-home',
    });
    if (url.endsWith('/api/instances/mousepad-1/status')) return Response.json({ generation:2, revision:3, state:'ready', summary:'Mousepad is ready' });
    if (url.endsWith('/api/instances') && options.method === 'POST') return Response.json({ ...instances[0], ...JSON.parse(options.body) }, { status:201 });
    if (url.endsWith('/api/instances')) return Response.json(instances);
    if (url.endsWith('/api/instances/mousepad-1/stop')) return Response.json({ ...instances[0], state:'stopped' });
    if (url.endsWith('/api/instances/mousepad-1/restart')) return Response.json({ ...instances[0], ...JSON.parse(options.body) });
    if (url.endsWith('/api/operator/service/restart')) return Response.json({ id:'operator-0123456789abcdef01234567', state:'accepted' }, { status:202 });
    if (url.endsWith('/api/operator/operations/operator-0123456789abcdef01234567')) return Response.json({ id:'operator-0123456789abcdef01234567', state:'succeeded' });
    if (url.endsWith('/api/instances/missing')) return Response.json({ error:'instance not found' }, { status:404 });
    return Response.json(instances[0]);
  };
  return { manager:new RemoteXAppManager({ baseURL:'http://manager.test/', fetchImpl }), calls };
}

test('infers a service base path from bundled and source SDK module URLs', () => {
  assert.equal(inferServiceBaseURL('https://example.test/tools/remotexapp/assets/sdk-HASH.js'), '/tools/remotexapp');
  assert.equal(inferServiceBaseURL('https://example.test/tools/remotexapp/sdk/remotexapp-manager.js'), '/tools/remotexapp');
  assert.equal(inferServiceBaseURL('https://example.test/assets/sdk-HASH.js'), '');
  assert.equal(inferServiceBaseURL('file:///workspace/sdk/remotexapp-manager.js'), '');
});

test('explicit base path prefixes API and viewer routes without a trailing slash', async () => {
  const calls = [];
  const manager = new RemoteXAppManager({
    baseURL:'/tools/remotexapp/',
    fetchImpl:async url => { calls.push(url); return Response.json([]); },
  });
  await manager.listTemplates();
  assert.equal(calls[0], '/tools/remotexapp/api/templates');
  assert.equal(manager.viewerURL('desktop-1'), '/tools/remotexapp/remotexapps/desktop-1/kiosk.html');
});

test('lists and caches class catalog', async () => {
  const { manager, calls } = mockManager();
  assert.equal((await manager.listClasses())[0].id, 'mousepad');
  assert.equal((await manager.listClasses())[0].id, 'mousepad');
  assert.equal(calls.length, 1);
  await manager.listClasses({ refresh:true });
  assert.equal(calls.length, 2);
});

test('uses preferred template endpoint', async () => {
	const { manager, calls } = mockManager();
	assert.equal((await manager.listTemplates())[0].id, 'mousepad');
	assert.ok(calls[0].url.endsWith('/api/templates'));
});

test('launches, filters, and stops instances', async () => {
  const { manager, calls } = mockManager();
  const launched = await manager.launch({ classId:'mousepad', profileRef:'test-profile', parameters:{ documentName:'notes' } });
  assert.equal(launched.profileRef, 'test-profile');
  assert.equal(launched.resources.control.port, 21001);
  assert.equal(launched.applicationStatus.details.control.protocol, 'synthetic');
  assert.deepEqual(JSON.parse(calls[0].options.body).parameters, { documentName:'notes' });
  assert.equal((await manager.listInstances({ classId:'mousepad', states:'server-ready' })).length, 1);
  assert.equal((await manager.stopInstance('mousepad-1')).state, 'stopped');
	await manager.stopInstance('mousepad-1', { force:true });
	assert.deepEqual(JSON.parse(calls.at(-1).options.body), { force:true });
  assert.equal(manager.viewerURL(launched), 'http://manager.test/remotexapps/mousepad-1/kiosk.html');
});

test('restarts a runtime with its exact session generation', async () => {
  const { manager, calls } = mockManager();
  const restarted = await manager.restartInstance('mousepad-1', { sessionGeneration:2, force:true });
  assert.equal(restarted.id, 'mousepad-1');
  assert.deepEqual(JSON.parse(calls[0].options.body), { sessionGeneration:2, force:true });
  assert.throws(() => manager.restartInstance('mousepad-1', { sessionGeneration:-1 }), /non-negative integer/);
});

test('requests and follows the separately authorized manager service restart', async () => {
  const { manager, calls } = mockManager();
  const accepted = await manager.restartManagerService();
  assert.equal(accepted.state, 'accepted');
  assert.equal(calls[0].options.headers['X-RemoteXApp-Operator-Request'], 'console-v1');
  const completed = await manager.waitForOperatorOperation(accepted.id, { timeout:100, interval:1 });
  assert.equal(completed.state, 'succeeded');
  assert.throws(() => manager.getOperatorOperation('../../unit'), /invalid operator operation ID/);
});

test('manages persistent instance registrations', async () => {
	const { manager, calls } = mockManager();
	assert.equal((await manager.listManagedInstances())[0].id, 'resident-pad');
	const created = await manager.createManagedInstance({
	  id:'resident-pad', templateId:'mousepad', desiredState:'stopped',
	  parameters:{ documentName:'resident' },
	  overrides:{ idleAction:'keep', workspaceMode:'persistent' },
	});
	assert.equal(created.templateId, 'mousepad');
	assert.deepEqual(created.parameters, { documentName:'resident' });
	assert.equal((await manager.setManagedInstanceState('resident-pad', 'running')).desiredState, 'running');
	await manager.setManagedInstanceState('resident-pad', 'stopped', { force:true });
	assert.deepEqual(JSON.parse(calls.at(-1).options.body), { desiredState:'stopped', force:true });
	assert.equal(await manager.deleteManagedInstance('resident-pad', { purge:true }), null);
});

test('retrieves and waits for application status snapshots', async () => {
  const { manager } = mockManager();
  assert.equal((await manager.getApplicationStatus('mousepad-1')).generation, 2);
  const status = await manager.waitForApplicationState('mousepad-1', 'ready', { generation:2, timeout:100 });
  assert.equal(status.summary, 'Mousepad is ready');
});

test('retrieves the generation-qualified complete application environment', async () => {
  const { manager, calls } = mockManager();
  const result = await manager.getApplicationEnvironment('mousepad-1', { sessionGeneration:2 });
  assert.equal(result.environment.DISPLAY, ':10');
  assert.equal(result.workingDirectory, '/tmp/test-home');
  assert.ok(calls[0].url.endsWith('/api/instances/mousepad-1/status/environment'));
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), { sessionGeneration:2 });
  assert.throws(
    () => manager.getApplicationEnvironment('mousepad-1', { sessionGeneration:0 }),
    /positive integer/,
  );
});

test('surfaces structured manager errors', async () => {
  const { manager } = mockManager();
  await assert.rejects(manager.getInstance('missing'), error => {
    assert.ok(error instanceof RemoteXAppAPIError);
    assert.equal(error.status, 404);
    assert.equal(error.message, 'instance not found');
    return true;
  });
});

test('clipboard requests use multipart bodies, generation headers, and non-consuming multipart accepts', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/accept')) {
      const form = new FormData();
      form.append('item', new Blob(['remote'], { type:'text/plain' }), 'clipboard');
      return new Response(form);
    }
    return Response.json({ id:'clp_'+'a'.repeat(32), direction:'toRemote', state:'owned' }, { status:201 });
  };
  const manager = new RemoteXAppManager({ baseURL:'/tools/remotexapp', fetchImpl });
  const sent = await manager.sendClipboardOffer('runtime-a', {
    sessionGeneration:4, viewerId:'viewer_abcdefgh', action:'set', expectedSequence:0,
    items:[{ type:'text/plain', data:'local' }],
  });
  assert.equal(sent.state, 'owned');
  assert.ok(calls[0].options.body instanceof FormData);
  assert.equal(calls[0].options.headers['X-RemoteXApp-Session-Generation'], '4');
  assert.equal(calls[0].options.headers['X-RemoteXApp-Viewer-ID'], 'viewer_abcdefgh');
  assert.equal(calls[0].options.headers['X-RemoteXApp-Clipboard-Sequence'], '0');
  await assert.rejects(manager.sendClipboardOffer('runtime-a', { sessionGeneration:4, viewerId:'viewer_abcdefgh', items:[{type:'text/plain',data:'x'}], expectedSequence:-1 }), /non-negative safe integer/);
  assert.equal(calls[0].options.headers['Content-Type'], undefined);
  const accepted = await manager.acceptClipboardOffer('runtime-a', 'clp_'+'b'.repeat(32), { sessionGeneration:4 });
  assert.equal(new TextDecoder().decode(accepted.items[0].data), 'remote');
  assert.throws(() => manager.listClipboardOffers('runtime-a', { sessionGeneration:0 }), /positive integer/);
});
test('connections use ordinary Manager authentication without a dedicated token', async () => {
  const calls = [];
  const token = 'a'.repeat(64);
  const manager = new RemoteXAppManager({baseURL:'/prefix',fetchImpl:async (url,options)=>{
    calls.push({url,options});
    return new Response(JSON.stringify({schemaVersion:1,instanceId:'app',sessionGeneration:3,revision:'hash',state:'ready',environment:{display:':1',xauthorityPath:'/private'}}));
  }});
  const abort = new AbortController();
  const result = await manager.getConnections('app',{token,sessionGeneration:3,signal:abort.signal});
  assert.equal(result.environment.display,':1');
  assert.equal(calls[0].url,'/prefix/api/instances/app/connections?sessionGeneration=3');
  assert.equal(calls[0].options.headers['X-RemoteXApp-Connections-Token'],undefined);
  assert.equal(calls[0].options.signal,abort.signal);
  assert.equal(calls[0].options.cache,'no-store');
  await manager.getInstance('app');
  assert.equal(calls[1].options.headers['X-RemoteXApp-Connections-Token'],undefined);
  await manager.getConnections('app');
  await assert.rejects(manager.getConnections('app',{token,sessionGeneration:0}),RangeError);
  await assert.rejects(manager.getConnections('app',{token,sessionGeneration:4}),/stale/);
  const denied = new RemoteXAppManager({fetchImpl:async()=>new Response('{"error":"denied"}',{status:403})});
  await assert.rejects(denied.getConnections('app',{token}),error=>error.status===403);
});

test('connections validate additive IBus fields and accept legacy absence',async()=>{
 const base={schemaVersion:1,instanceId:'app',sessionGeneration:3,revision:'r',state:'ready',environment:{display:':1',xauthorityPath:'/private'}};
 let value=base;
 const manager=new RemoteXAppManager({fetchImpl:async()=>new Response(JSON.stringify(value))});
 const read=()=>manager.getConnections('app',{token:'a'.repeat(64)});
 await read();
 value={...base,environment:{...base.environment,ibus:{address:'unix:path=/private/ibus.sock',scope:'runtime'}}};await read();
 for(const ibus of [null,{address:'tcp:host=localhost',scope:'runtime'},{address:'unix:path=/p',scope:'user'}]){value={...base,environment:{...base.environment,ibus}};await assert.rejects(read,e=>e.status===409);}
 value={...base,unavailable:['ibus'],unavailableReasons:{ibus:'metadata-missing'}};await read();
 for(const unavailable of [undefined,{},[],['sessionBus']]){value={...base,unavailable,unavailableReasons:{ibus:'not-running'}};await assert.rejects(read,e=>e.status===409);}
 value={...base,unavailable:['ibus'],unavailableReasons:{ibus:'invented'}};await assert.rejects(read,e=>e.status===409);
});
