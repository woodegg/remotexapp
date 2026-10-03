// Live browser regression: prime the document's module cache with an obsolete
// SDK entry, then load the current Console. Only GETs reach the fixture Manager.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const upstream = new URL(process.argv[2]);
const id = process.argv[3];
assert.equal(upstream.hostname, '127.0.0.1');
assert(id);
const assets = new URL('../../cmd/remotexappd/web/assets/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', assets)));
if (process.argv.includes('--require-deployed-assets')) {
  for (const name of [manifest.console, manifest.sdk]) {
    const result = await fetch(new URL(upstream.pathname.replace(/\/$/, '') + '/assets/' + name, upstream));
    assert.equal(result.status, 200);
    assert.equal(await result.text(), await readFile(new URL(name, assets), 'utf8'),
      'regression must exercise the exact deployed candidate assets');
  }
}
const exec = promisify(execFile);
for (const prefix of ['', '/remote/nested']) {
  let staleReads = 0, connectionsReads = 0, sdkReads = 0;
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.method, 'GET');
      const url = new URL(request.url, 'http://localhost');
      assert(url.pathname.startsWith(prefix + '/'));
      const path = url.pathname.slice(prefix.length);
      response.setHeader('Cache-Control', 'no-store');
      if (path === '/sdk/console.html') {
        response.setHeader('Content-Type', 'text/html');
        response.end(`<main id="remotexapp-console"></main><script type="module">
          await import('${prefix}/sdk/index.js');
          await import('${prefix}/console/index.js');
        </script>`);
      } else if (path === '/sdk/index.js') {
        staleReads++;
        response.setHeader('Content-Type', 'text/javascript');
        response.end(`export const SDK_VERSION='0.24.0';
          export class RemoteXAppManager { constructor() { throw Error('obsolete cached SDK used'); } }`);
      } else if (path === '/console/index.js') {
        response.setHeader('Content-Type', 'text/javascript');
        response.end(`import '../assets/${manifest.console}';`);
      } else if ([manifest.console, manifest.sdk, manifest.novnc].some(name => path === '/assets/' + name)) {
        if (path === '/assets/' + manifest.sdk) sdkReads++;
        response.setHeader('Content-Type', 'text/javascript');
        response.end(await readFile(new URL(path.slice('/assets/'.length), assets)));
      } else if (path.startsWith('/api/') || path === '/healthz' || path === '/readyz') {
        if (path.includes('/connections')) connectionsReads++;
        const result = await fetch(new URL(upstream.pathname.replace(/\/$/, '') + path + url.search, upstream));
        response.statusCode = result.status;
        response.setHeader('Content-Type', 'application/json');
        response.end(await result.text());
      } else { response.statusCode = 404; response.end(); }
    } catch { response.statusCode = 500; response.end('fixture request failed'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}${prefix}`;
    const result = await exec(process.execPath, [fileURLToPath(new URL('./check-console-connections.mjs', import.meta.url)), base, id, 'unused'], {timeout:60000});
    assert.equal(JSON.parse(result.stdout).passed, true);
    assert.equal(staleReads, 1, 'obsolete entry was primed and cached');
    assert.equal(sdkReads, 1, 'Console requested its matching hashed SDK');
    assert(connectionsReads >= 1);
    console.log(JSON.stringify({passed:true,prefix,staleReads,sdkReads,connectionsReads}));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
