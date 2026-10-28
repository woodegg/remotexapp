import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readVideoEncoders } from '../server-messages.mjs';

class ReceiveQueue {
  constructor(bytes) { this.bytes = Uint8Array.from(bytes); this.at = 1; }
  get rQlen() { return this.bytes.length - this.at; }
  rQslice(start) { return this.bytes.subarray(this.at + start); }
  rQwait(_label, size, rewind = 0) {
    if (this.rQlen >= size) return false;
    this.at -= rewind;
    return true;
  }
  rQskipBytes(count) { this.at += count; }
  rQshift8() { return this.bytes[this.at++]; }
  rQshift32() { const value = new DataView(this.bytes.buffer).getUint32(this.at); this.at += 4; return value; }
  rQshiftBytes(count) { const value = this.bytes.subarray(this.at, this.at + count); this.at += count; return value; }
  rQshiftStr(count) { return new TextDecoder().decode(this.rQshiftBytes(count)); }
}
const u32 = value => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
const message = [190, 2, ...u32(7), ...u32(1), ...u32(100), 2, ...u32(11), ...u32(12), ...u32(8), ...u32(0), ...u32(90), 1, ...u32(21)];
const expected = { codecs:[7,8], configurations:{ 7:{ minQuality:1,maxQuality:100,presets:[11,12] }, 8:{ minQuality:0,maxQuality:90,presets:[21] } } };

test('every payload split rewinds the message type and commits only the complete message', () => {
  for (let split = 1; split < message.length; split++) {
    const sock = new ReceiveQueue(message.slice(0,split));
    assert.equal(readVideoEncoders(sock), null);
    assert.equal(sock.at, 0, `rewind at ${split}`);
    sock.bytes = Uint8Array.from([...message, 2]);
    sock.rQshift8();
    assert.deepEqual(readVideoEncoders(sock), expected);
    assert.equal(sock.rQshift8(), 2, 'following message remains intact');
    assert.equal(sock.rQlen, 0);
  }
});

test('empty and maximum-byte count fields remain bounded by the protocol', () => {
  const empty = new ReceiveQueue([190,0,2]);
  assert.deepEqual(readVideoEncoders(empty), { codecs:[], configurations:{} });
  assert.equal(empty.rQshift8(),2);
  const bytes = [190,255];
  for (let i=0;i<255;i++) bytes.push(...u32(i), ...u32(0), ...u32(100),255,...Array(255*4).fill(0));
  const sock = new ReceiveQueue(bytes);
  assert.equal(readVideoEncoders(sock).codecs.length,255);
  assert.equal(sock.rQlen,0);
});

// Exercise the actual patched upstream methods during a component build.
// Source is supplied explicitly; ordinary CI does not download upstream code.
const sourceRoot = process.env.KASM_CLIENT_SOURCE;
function upstreamMethod(name, next) {
  const source = readFileSync(`${sourceRoot}/core/rfb.js`, 'utf8');
  const start = source.indexOf(`    ${name}() {`), end = source.indexOf(`    ${next}() {`, start);
  assert(start >= 0 && end > start);
  return new Function('readVideoEncoders', 'CustomEvent', 'Log', `return {${source.slice(start,end)}};`)(readVideoEncoders, CustomEvent, { Info(){}, Warn(){} })[name];
}
test('completed upstream control handlers drain coalesced messages', {skip:!sourceRoot}, () => {
  const encoders = upstreamMethod('_handleServerVideoEncoders','_handleForceGameMode');
  const sock = new ReceiveQueue([...message,2]);
  const target = { _sock:sock, dispatchEvent(){} };
  assert.equal(encoders.call(target),true);
  assert.equal(sock.rQshift8(),2);
  for (let split=1;split<message.length;split++) {
    const queue = new ReceiveQueue(message.slice(0,split));
    assert.equal(encoders.call({_sock:queue,dispatchEvent(){}}),false);
    assert.equal(queue.at,0);
  }
  const subscribe = upstreamMethod('_handleSubscribeUnixRelay','_handleUnixRelay');
  const response = new ReceiveQueue([182,0,2,111,107,2]);
  assert.equal(subscribe.call({_sock:response}),true);
  assert.equal(response.rQshift8(),2);
  const relay = upstreamMethod('_handleUnixRelay','_handleServerVideoEncoders');
  const data = new ReceiveQueue([183,1,120,...u32(1),99,2]);
  let received=0;
  assert.equal(relay.call({_sock:data,_unixRelays:{x(bytes){received+=bytes.length;}}}),true);
  assert.equal(received,1);
  assert.equal(data.rQshift8(),2);
});
