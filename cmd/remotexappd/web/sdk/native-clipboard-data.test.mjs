import test from 'node:test';
import assert from 'node:assert/strict';
import {clipboardFormats,richBrowserClipboard,validateClipboard,readClipboard,writeClipboard,sendClipboard} from './native-clipboard-data.js';
import {clipboardPayload,textPayload,payloadText,sameClipboard} from '../../../../third_party/kasm/clipboard-payload.mjs';
const caps={clipboard:true,clipboardRich:true,clipboardMaxBytes:2097152};
function browser(t){
 const old=Object.fromEntries(['navigator','ClipboardItem'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 class Item{constructor(values){this.values=values;this.types=Object.keys(values);}getType(type){return Promise.resolve(this.values[type]);}static supports(){return true;}}
 const io={items:[],text:'plain',written:[]};
 const nav={clipboard:{read:async()=>io.items,readText:async()=>io.text,write:async items=>io.written.push(items),writeText:async text=>{io.text=text;}}};
 Object.defineProperty(globalThis,'navigator',{value:nav,configurable:true});Object.defineProperty(globalThis,'ClipboardItem',{value:Item,configurable:true});
 t.after(()=>{for(const [key,value]of Object.entries(old)){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}});
 return {io,nav,Item};
}
test('read and write preserve canonical representations and validate aggregate byte count',async t=>{
 const {io,Item}=browser(t);
 io.items=[new Item({'text/html':new Blob(['<b>中文</b>']),'text/plain':new Blob(['中文']),'image/png':new Blob([Uint8Array.of(137,80,78,71)])})];
 const payload=await readClipboard(caps);assert.equal(payload.bytes,23);assert.deepEqual(payload.items.map(i=>i.type),['text/plain','text/html','image/png']);
 await writeClipboard(payload,caps);assert.equal(io.written.length,1);assert.deepEqual(io.written[0][0].types,['text/plain','text/html','image/png']);
 const sent=[];sendClipboard({sendClipboard:items=>sent.push(items)},payload,caps);assert(sameClipboard(clipboardPayload(sent[0]),payload));
 assert.equal(payloadText(payload),'中文');assert.equal(payloadText(clipboardPayload([{type:'image/png',data:Uint8Array.of(1)}])),undefined);
 assert(!sameClipboard(payload,textPayload('different')));assert(!sameClipboard(textPayload('a'),textPayload('b')));
});
test('multiple browser items, unsupported types, aggregate oversize and malformed text reject atomically',async t=>{
 const {io,Item}=browser(t);
 for(const items of [[new Item({'text/plain':new Blob(['a'])}),new Item({'text/plain':new Blob(['b'])})],[new Item({'text/uri-list':new Blob(['file:///example'])})],[new Item({'text/plain':new Blob(['a']),'text/html':new Blob(['x'.repeat(2097152)])})],[new Item({'text/html':new Blob([Uint8Array.of(255)])})]]) {
  io.items=items;await assert.rejects(readClipboard(caps));assert.equal(io.written.length,0);
 }
 io.items=[];assert.equal((await readClipboard(caps)).bytes,0);
 io.items=[new Item({})];assert.equal((await readClipboard(caps)).bytes,0);
 for(const value of [null,{items:[]},{items:[{type:'text/plain',data:'not bytes'}]},'\ud800','embedded\0nul','x'.repeat(2097153)]) assert.throws(()=>validateClipboard(value,caps));
 assert.throws(()=>clipboardPayload([{type:'text/plain',data:Uint8Array.of(97)},{type:'text/plain',data:Uint8Array.of(98)}]));
});
test('rich browser capability and text-only fallback never silently drop a rich remote representation',async t=>{
 const {io,nav,Item}=browser(t);assert(richBrowserClipboard());assert.equal(clipboardFormats(caps).length,3);
 Item.supports=type=>type!=='image/png';assert(!richBrowserClipboard());assert.deepEqual(clipboardFormats(caps),['text/plain']);
 assert.equal(payloadText(await readClipboard(caps)),'plain');await writeClipboard(textPayload('manual fallback'),caps);assert.equal(io.text,'manual fallback');
 assert.throws(()=>writeClipboard(clipboardPayload([{type:'text/html',data:Uint8Array.of(97)}]),caps),{code:'clipboard-format'});
 assert.deepEqual(clipboardFormats({clipboard:false}),[]);delete nav.clipboard.read;
 const old={clipboard:true,clipboardMaxBytes:65536};const sent=[];sendClipboard({sendClipboardText:text=>sent.push(text)},textPayload('legacy'),old);assert.deepEqual(sent,['legacy']);
 assert.throws(()=>validateClipboard('x'.repeat(65537),old),{code:'clipboard-size'});
});
