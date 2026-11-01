import assert from 'node:assert/strict';
import test from 'node:test';
import {pathToFileURL} from 'node:url';

const source = process.env.KASM_CLIENT_SOURCE;
test('applied native transport counts exact payload bytes once per connection without retaining payloads', {skip:!source}, async () => {
  globalThis.window = {console};
  globalThis.WebSocket ||= class {static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;};
  const {default:Websock} = await import(pathToFileURL(`${source}/core/websock.js`));
  const sock=new Websock();sock.init();
  let sends=0;const raw={readyState:1,bufferedAmount:7,send(bytes){sends++;assert.equal(bytes.length,3);}};
  sock._websocket=raw;
  for(const bytes of [[1,2],[3],[]])sock._recvMessage({data:Uint8Array.from(bytes).buffer});
  assert.equal(sock.trafficStats.receivedBytes,3);
  sock.rQskipBytes(3);assert.equal(sock.trafficStats.receivedBytes,3);
  sock.send([4,5,6]);sock.flush();assert.equal(sends,1);
  assert.deepEqual(sock.trafficStats,{receivedBytes:3,sentBytes:3,bufferedBytes:7});
  raw.send=()=>{throw Error('send failed');};
  assert.throws(()=>sock.send([7,8,9]),/send failed/);assert.equal(sock.trafficStats.sentBytes,3);
  const other=new Websock();other.init();assert.deepEqual(other.trafficStats,{receivedBytes:0,sentBytes:0,bufferedBytes:0});
  const snapshot=sock.trafficStats;snapshot.sentBytes=999;assert.equal(sock.trafficStats.sentBytes,3);
  sock.init();assert.deepEqual(sock.trafficStats,{receivedBytes:0,sentBytes:0,bufferedBytes:0});
});
