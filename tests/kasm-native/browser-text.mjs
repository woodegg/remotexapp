import {config} from './browser-fixture.mjs';
import assert from'node:assert/strict';import{current,click,focus,save,x,text,remote,instance}from'./browser-fixture.mjs';import{ctrl,key,delay,wait,open,ready}from'./browser-fixture.mjs';import{writeFileSync}from'node:fs';
const results=[];const pass=name=>{results.push({name,status:'passed'});console.log(name)};const c=await current();let b;
const status=()=>c.evaluate('document.querySelector("#clipboard-status").textContent');
const localWrite=async s=>{await c.call('Runtime.evaluate',{expression:`navigator.clipboard.writeText(${JSON.stringify(s)})`,awaitPromise:true,userGesture:true});};
try{
 await ready(c);await c.call('Browser.setPermission',{permission:{name:'clipboard-read',allowWithoutSanitization:true},setting:'granted',origin:config.ingressURL});
 await c.evaluate('document.querySelector("details").open=true');if(!await c.evaluate('document.querySelector("#clipboard-enable").checked'))await click(c,'#clipboard-enable');await delay(500);
 const sample='双向剪贴板\n第二行 😀 café';await localWrite(sample);await click(c,'#clipboard-upload');await delay(400);assert.equal(x(['xclip','-selection','clipboard','-o']),sample);
 await focus(c);await ctrl(c,'a','KeyA',65);await ctrl(c,'v','KeyV',86);await delay(700);assert.equal(await save(c),sample);pass('local text -> native clipboard -> real App paste/save');
 await ctrl(c,'a','KeyA',65);await text(c,'远程复制验证 😀');await ctrl(c,'a','KeyA',65);await ctrl(c,'c','KeyC',67);await wait(async()=>(await status()).startsWith('Remote text available'));
 assert.equal(await c.evaluate('navigator.clipboard.readText()'),sample);pass('remote offer does not change local OS clipboard');
 await click(c,'#clipboard-download');await wait(async()=>await status()==='copied-to-local');assert.equal(await c.evaluate('navigator.clipboard.readText()'),'远程复制验证 😀');pass('real App copy -> native offer -> explicit local readback');
 await localWrite('');await click(c,'#clipboard-upload');await wait(async()=>await status()==='empty-noop');assert.equal(x(['xclip','-selection','clipboard','-o']),'远程复制验证 😀');pass('empty local read preserves remote clipboard');
 await click(c,'#clipboard-clear');await wait(async()=>await status()==='submitted');await delay(400);await focus(c);await ctrl(c,'a','KeyA',65);await text(c,'clear sentinel');await ctrl(c,'v','KeyV',86);await delay(500);assert.equal(await save(c),'clear sentinel');pass('explicit clear prevents old text from pasting');
 const large='界'.repeat(21845)+'A';assert.equal(Buffer.byteLength(large),65536);await localWrite(large);await click(c,'#clipboard-upload');await wait(async()=>await status()==='submitted');await delay(400);assert.equal(x(['xclip','-selection','clipboard','-o']),large);pass('64 KiB UTF-8 boundary real server readback');
 await localWrite(large+'B');await click(c,'#clipboard-upload');await wait(async()=>await status()==='clipboard-size');assert.equal(x(['xclip','-selection','clipboard','-o']),large);pass('64 KiB+1 rejected before remote mutation');
 await c.call('Browser.setPermission',{permission:{name:'clipboard-read',allowWithoutSanitization:true},setting:'denied',origin:config.ingressURL});await click(c,'#clipboard-upload');await wait(async()=>await status()==='clipboard-denied');pass('browser permission denied gives explicit failure');await c.call('Browser.setPermission',{permission:{name:'clipboard-read',allowWithoutSanitization:true},setting:'granted',origin:config.ingressURL});
 await localWrite('local sentinel');await click(c,'#clipboard-enable');await focus(c);await ctrl(c,'a','KeyA',65);await text(c,'禁用期间');await ctrl(c,'a','KeyA',65);await ctrl(c,'c','KeyC',67);await delay(500);await click(c,'#clipboard-enable');await click(c,'#clipboard-download');await wait(async()=>await status()==='clipboard-empty');assert.equal(await c.evaluate('navigator.clipboard.readText()'),'local sentinel');pass('disabled-period offer is not cached on re-enable');
 for(const profile of ['windows','mac','gnome','fcitx']){
  await c.evaluate(`document.querySelector('#keyboard-profile').value='${profile}';document.querySelector('#keyboard-profile').dispatchEvent(new Event('change'))`);
  await focus(c);await ctrl(c,'a','KeyA',65);await text(c,'前');
  const meta=['windows','gnome'].includes(profile),mod=meta?4:2,k=meta?'Meta':'Control',code=meta?'MetaLeft':'ControlLeft',vk=meta?91:17;
  await c.call('Input.dispatchKeyEvent',{type:'rawKeyDown',key:k,code,windowsVirtualKeyCode:vk,modifiers:mod});await key(c,' ','Space',32,mod);await c.call('Input.dispatchKeyEvent',{type:'keyUp',key:k,code,windowsVirtualKeyCode:vk});await text(c,'后');assert.equal(await save(c),'前后');
 }pass('four OS shortcut profiles suppress terminal Space, ordinary Ctrl+A/S preserved');
 for(let i=0;i<10;i++){
  await c.evaluate(`if(!document.querySelector('#outside')){const t=document.createElement('textarea');t.id='outside';document.querySelector('header').append(t)};document.querySelector('#outside').focus()`);await c.call('Input.insertText',{text:'outside English'});await focus(c);await ctrl(c,'a','KeyA',65);await text(c,'返回中文'+i);assert.equal(await save(c),'返回中文'+i);
 }pass('ten outside/inside focus cycles with synthetic composition and file readback');
 b=await open(config.ingressURL+config.basePath+instance.viewerUrl);await ready(b);assert.equal(await b.evaluate('document.querySelector("#clipboard-enable").checked'),false);await c.call('Page.bringToFront');await click(c,'#disconnect');assert.equal(await c.evaluate('document.querySelector("#clipboard-enable").checked'),false);await b.call('Page.bringToFront');await focus(b);await ctrl(b,'a','KeyA',65);await text(b,'独立 Viewer B');assert.equal(await save(b),'独立 Viewer B');pass('two Viewers have independent consent and disconnect');
 await c.call('Page.bringToFront');await click(c,'#reconnect');await ready(c);assert.equal(await c.evaluate('document.querySelector("#clipboard-enable").checked'),false);pass('reconnect resets consent');
}finally{writeFileSync(config.evidenceDirectory+'/text-results.json',JSON.stringify(results,null,2));c.close();if(b){b.close();await fetch(config.cdpURL+'/json/close/'+b.page.id);}}
