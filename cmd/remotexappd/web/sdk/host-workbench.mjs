import {RemoteXAppHost, SDK_VERSION} from './index.js';
import {parameterValue,rateSnapshot,latencyText} from './host-workbench-model.mjs';

const $=selector=>document.querySelector(selector);
const baseURL=location.pathname.slice(0,location.pathname.lastIndexOf('/sdk/'));
const host=new RemoteXAppHost({baseURL,scope:'native-host-workbench-v1'});
const windows=new Map(),tasks=new Map(),records=[];
let workspace=1,selected=null,sequence=0,templates=[];
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const button=(text,action,cls)=>{const n=node('button',text,cls);n.type='button';n.addEventListener('click',()=>perform(text,()=>action(n),n));return n;};
function report(operation,status='ok',code) {
  records.push({at:new Date().toISOString(),operation,status,...(code?{code:String(code)}:{})});
  if(records.length>200)records.shift();
  const entry=node('li',`${new Date().toLocaleTimeString()} · ${operation} · ${status}${code?` (${code})`:''}`);
  $('#journal').prepend(entry);while($('#journal').children.length>50)$('#journal').lastChild.remove();
}
function notice(text,error=false){$('#notice').textContent=text;$('#notice').classList.toggle('error',error);}
async function perform(label,action,control){
  if(control)control.disabled=true;
  try {const result=await action();report(label);return result;}
  catch(error){const raw=error.code || (error.status?`HTTP-${error.status}`:error.name==='AbortError'?'cancelled':error.message);
    const code=typeof raw==='string' && /^[a-zA-Z0-9_-]{1,64}$/.test(raw)?raw:'operation-failed';
    notice(`${label}：${code || '操作失败'}`,true);report(label,'failed',code);}
  finally{if(control)control.disabled=false;}
}
function parameters(container,definitions,values={}) {
  container.replaceChildren();const inputs=new Map();
  for(const [name,definition] of Object.entries(definitions || {})){
    const label=node('label',`${name}${definition.required?' *':''}`);
    const input=node(definition.type==='enum'?'select':definition.type==='json'?'textarea':'input');
    if(definition.type==='enum')for(const value of definition.values || [])input.append(new Option(value,value));
    if(definition.type==='boolean')input.type='checkbox';
    else if(definition.type==='integer')input.type='number';
    const value=values[name] ?? definition.default;
    if(definition.type==='boolean')input.checked=!!value;
    else if(value!==undefined)input.value=typeof value==='object'?JSON.stringify(value):String(value);
    if(definition.maxLength)input.maxLength=definition.maxLength;
    if(definition.required)input.required=true;
    input.dataset.parameter=name;label.append(input);container.append(label);inputs.set(name,{input,definition});
  }
  return ()=>Object.fromEntries([...inputs].map(([name,{input,definition}])=>[name,parameterValue(definition,definition.type==='boolean'?input.checked:input.value)]).filter(([,value])=>value!==undefined));
}
let launchParameters=()=>({});
function templateSelected(){
  const template=templates.find(t=>t.id===$('#template').value);
  if(!template){$('#launch-button').disabled=true;return;}
  $('#launch-button').disabled=false;
  $('#template-info').textContent=`${template.runMode} · ${template.singleton?'共享单例':'独立实例'} · ${template.sessionActivation} · ${template.display.allowClientResize?'可调整远端尺寸':'固定远端尺寸'}`;
  launchParameters=parameters($('#parameters'),template.parameters);
}
async function refresh(){
  const [catalog,instances,managed,version]=await Promise.all([host.templates({refresh:true}),host.manager.listInstances(),host.manager.listManagedInstances(),host.manager.getVersion()]);
  const previous=$('#template').value;templates=catalog;
  $('#template').replaceChildren(...catalog.map(t=>new Option(t.name,t.id)));
  if(catalog.some(t=>t.id===previous))$('#template').value=previous;
  templateSelected();$('#version').textContent=`Core ${version.version} · SDK ${SDK_VERSION}`;
  $('#existing').replaceChildren(node('small','已有运行时 · Existing'));
  for(const instance of instances.filter(i=>i.displayProvider==='kasm' && ['ready','server-ready'].includes(i.state)))
    $('#existing').append(button(`${instance.templateId} · ${instance.id.slice(-8)} · ${instance.sessionState}`,()=>open({instanceId:instance.id})));
  $('#managed').replaceChildren(node('small','托管应用 · Managed'));
  for(const item of managed){const row=node('div'),b=button(`${item.id} · ${item.observedState}`,()=>open({managedId:item.id}));
    b.disabled=item.desiredState!=='running' || item.observedState!=='running';row.append(b);
    row.append(button(item.desiredState==='running'?'停止托管应用':'启动托管应用',async()=>{
      const desired=item.desiredState==='running'?'stopped':'running';
      if(desired==='stopped' && !await confirmStop())return;
      await host.manager.setManagedInstanceState(item.id,desired);await refresh();
    }));
    if(item.runtime?.recovery)row.append(button('重试恢复',async()=>{
      await host.manager.retryRecovery(item.runtime.id,{sessionGeneration:item.runtime.sessionGeneration});await refresh();
    }));
    $('#managed').append(row);}
  notice(`已加载 ${catalog.length} 个模板。选择应用开始测试。`);
}
function show(){
  const visible=[...windows.values()].filter(w=>w.workspace===workspace);
  if(!visible.some(w=>w.key===selected))selected=visible[0]?.key || null;
  for(const w of windows.values()){
    const active=w.workspace===workspace && w.key===selected;
    w.element.hidden=!active;w.tab.hidden=w.workspace!==workspace;w.tab.setAttribute('aria-selected',String(active));
    if(!active)w.viewer?.blur();
  }
  $('#empty').hidden=visible.length>0;$('#window-count').textContent=`${visible.length} 个窗口 · 共 ${windows.size} 个`;
  document.querySelectorAll('[data-workspace]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.workspace)===workspace)));
}
function section(parent,title){const d=node('details'),s=node('summary',title);d.append(s);parent.append(d);return d;}
function checkbox(parent,label,action){const row=node('label',undefined,'check'),input=node('input');input.type='checkbox';row.append(input,document.createTextNode(label));parent.append(row);
  input.addEventListener('change',()=>{const wanted=input.checked;perform(label,async()=>{try{return await action(wanted);}catch(error){input.checked=!wanted;throw error;}},input);});return input;}
function select(parent,label,choices,action){const row=node('label',label),input=node('select');for(const [value,text] of choices)input.append(new Option(text,value));row.append(input);parent.append(row);
  input.addEventListener('change',()=>perform(label,()=>action(input.value),input));return input;}
function viewerCall(w,action){if(!w.viewer)throw Error('viewer-unloaded');return action(w.viewer);}
async function attach(w){
  w.display.replaceChildren(node('div','连接应用…','display-message'));
  try {
    const viewer=await w.session.attach(w.display,{readOnly:w.readOnly});
    if(!windows.has(w.key)){viewer.dispose();return;}
    w.viewer=viewer;w.previous=null;w.status.dataset.state=viewer.state;
    w.resizeToggle.checked=viewer.capabilities.remoteResize===true;
    w.resizeToggle.disabled=!viewer.capabilities.remoteResize;
    w.udpToggle.checked=viewer.capabilities.udp===true;
    w.udpToggle.disabled=!viewer.capabilities.udp;
    viewer.addEventListener('statechange',()=>update(w));
    viewer.addEventListener('clipboardstatechange',()=>update(w));
    update(w);notice('应用已就绪：已确认应用状态与实际画面。');
  } catch(error){w.display.replaceChildren(node('div','连接未完成；可重试或关闭窗口。','display-message'));throw error;}
}
async function open(options){
  const session=await host.open({...options,keepAlive:options.keepAlive ?? $('#launch-keepalive').checked});
  const key=++sequence,w={key,session,workspace,readOnly:$('#launch-readonly').checked,viewer:null,audio:null};
  w.element=node('article',undefined,'window-layout');w.element.dataset.window=key;
  const stage=node('section',undefined,'stage'),toolbar=node('div',undefined,'window-toolbar');
  w.display=node('div',undefined,'display');w.display.dataset.testid='native-display';stage.append(toolbar,w.display);
  w.tab=button(`${session.instance.templateId} · ${key}`,()=>{selected=key;show();},'window-tab');w.tab.setAttribute('role','tab');
  const inspector=node('aside',undefined,'inspector');w.element.append(stage,inspector);
  w.status=node('div',undefined,'state');w.status.append(node('span',undefined,'dot'),w.stateText=node('span','连接中'));inspector.append(w.status);
  inspector.append(node('small',`窗口 ${key} · 代际 ${session.generation}${w.readOnly?' · 只读':''}`,'muted'));
  const metrics=node('div',undefined,'metrics');w.metrics={};
  for(const [id,label] of [['transport','画面协议'],['fps','画面 FPS'],['download','下行 kb/s'],['upload','上行 kb/s'],['wss','WSS RTT'],['udp','UDP RTT'],['loss','UDP block loss'],['resolution','分辨率']]){
    const metric=node('div',undefined,'metric'),value=node('strong','—');metric.append(node('small',label),value);metrics.append(metric);w.metrics[id]=value;
  }
  inspector.append(metrics,button('测量延迟 · Ping',()=>viewerCall(w,v=>v.measureLatency())),node('p','带宽为有效载荷；静止画面 FPS 可为 0。UDP loss 是显示块统计，不是 IP 包丢失率。','note'));
  toolbar.append(button('再开一个窗口',()=>open({instanceId:session.id})),button('移到另一工作区',()=>{w.workspace=workspace===1?2:1;show();}),
    button('卸载 / 恢复画面',async()=>{if(w.viewer){w.viewer.dispose();w.viewer=null;w.display.replaceChildren(node('div','画面已卸载；运行时和音频仍由此窗口持有。','display-message'));update(w);}else await attach(w);}),
    button('重连',()=>viewerCall(w,v=>v.reconnect())),button('关闭窗口',()=>close(w)),button('停止应用',()=>stop(w),'danger'));
  const life=section(inspector,'生命周期 · Ownership');
  const keep=checkbox(life,'此窗口保持运行',enabled=>session.setKeepAlive(enabled));keep.checked=session.handle.keepAlive;
  life.append(button('持有后台任务',()=>task(w)),node('p','关闭只释放此窗口；后台任务独立持有运行时。隐藏工作区保留连接。','note'));
  const display=section(inspector,'画面与输入 · Display & input');
  w.resizeToggle=checkbox(display,'调整远端尺寸',enabled=>viewerCall(w,v=>v.configureDisplay({scale:true,resize:enabled})));
  w.resizeToggle.checked=!w.readOnly && session.instance.effectivePolicy?.display?.allowClientResize===true;
  w.udpToggle=checkbox(display,'优先使用 UDP',enabled=>viewerCall(w,v=>v.configureTransport(enabled)));
  select(display,'输入法快捷键', [['unknown','选择本机平台'],['windows','Windows'],['mac','macOS'],['gnome','Linux GNOME'],['fcitx','Linux Fcitx']],profile=>viewerCall(w,v=>v.configureKeyboard({profile,mode:'local'})));
  const text=node('textarea');text.placeholder='原生文字输入；最大 4096 UTF-8 字节';text.setAttribute('aria-label','原生文字输入');display.append(text);
  display.append(button('发送文字',()=>viewerCall(w,v=>{const receipt=v.sendText(text.value);notice(`已发送 ${receipt.count} 个字符；请检查应用内容。`);})),
    button('发送 Ctrl+S',()=>viewerCall(w,v=>v.sendKey('s',{modifiers:['Control']}))),button('发送 ←',()=>viewerCall(w,v=>v.sendKey('ArrowLeft'))));
  const clip=section(inspector,'剪贴板 · Clipboard');const modes=[['off','关闭'],['manual','手动'],['auto','自动']];
  const applyClip=()=>viewerCall(w,v=>{v.focus();return v.configureClipboard({toRemote:toRemote.value,toLocal:toLocal.value});});
  const toRemote=select(clip,'本地 → 远端',modes,applyClip),toLocal=select(clip,'远端 → 本地',modes,applyClip);
  clip.append(button('授权自动剪贴板',()=>viewerCall(w,v=>{v.focus();return v.requestClipboardPermission();})),
    button('本地 → 远端',()=>viewerCall(w,v=>{v.focus();return v.copyClipboardToRemote();})),
    button('远端 → 本地',()=>viewerCall(w,v=>{v.focus();return v.copyClipboardToLocal();})));
  w.clipState=node('output');clip.append(w.clipState,node('p','文本 / HTML / PNG，合计 2 MiB；不支持文件和文件夹。重连后重新启用。','note'));
  const audio=section(inspector,'声音 · Speaker & microphone');w.audioState=node('output','未持有音频');
  audio.append(button('准备音频控制',async()=>{w.audio=await session.audio();update(w);}));
  w.speakerToggle=checkbox(audio,'远程播放 · Speaker',enabled=>{if(!w.audio)throw Error('prepare-audio-first');return w.audio.setSpeaker(enabled);});
  w.micToggle=checkbox(audio,'麦克风 · Microphone',enabled=>{if(!w.audio)throw Error('prepare-audio-first');return w.audio.setMicrophone(enabled);});
  audio.append(button('接管麦克风',()=>{if(!w.audio)throw Error('prepare-audio-first');return w.audio.setMicrophone(true,{takeover:true});}),w.audioState,
    node('p','先准备控制，再明确启用；仅持有引用不会打开音频通道。同一会话的开关在标签页间共享。','note'));
  const actions=section(inspector,'应用动作与控制 · Actions');
  const actionForm=node('div');actions.append(button('读取可用动作',async()=>{
    const available=await session.actions();actionForm.replaceChildren();
    for(const [name,definition] of Object.entries(available.actions)){
      const fields=node('div'),read=parameters(fields,definition.parameters);actionForm.append(node('strong',name),fields,
        button(`执行 ${name}`,async()=>{await session.invoke(name,read());notice(`${name} 已完成；请检查应用结果。`);}));
    }
  }),actionForm,button('检查控制接口',async()=>{const descriptor=await session.connections();notice(`控制接口：${descriptor.application?.protocol || '环境描述'} · 当前代际 ${descriptor.sessionGeneration}。接口仅供服务端本地执行器使用。`);}));
  windows.set(key,w);$('#windows').append(w.element);$('#window-tabs').append(w.tab);selected=key;show();
  session.addEventListener('invalidated',()=>{update(w);notice('应用代际已结束；旧窗口不会自动控制新实例。',true);});
  await attach(w);return w;
}
async function task(w){const session=await host.open({instanceId:w.session.id,keepAlive:true}),key=++sequence;
  const row=node('div',undefined,'task');row.append(node('small',`后台任务 ${key} · ${session.instance.templateId}`),button('释放',async()=>{await session.release();tasks.delete(key);row.remove();}));
  tasks.set(key,{session,row});$('#tasks').append(row);notice('后台任务已独立持有运行时；可以关闭原窗口。');}
async function close(w){windows.delete(w.key);w.element.remove();w.tab.remove();await w.session.release();show();}
async function confirmStop(){const dialog=$('#confirm');dialog.returnValue='cancel';dialog.showModal();return await new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='stop'),{once:true}));}
async function stop(w){if(!await confirmStop())return;
  if(w.session.instance.managedInstanceId)await host.manager.setManagedInstanceState(w.session.instance.managedInstanceId,'stopped');
  else await w.session.stop();notice('已请求正常停止应用。');await refresh();}
function update(w){
  const stats=w.viewer?.getStats(),rate=rateSnapshot(w.previous,stats);w.previous=stats;
  w.stateText.textContent=w.session.state==='active'?(stats?.state || '画面已卸载'):w.session.state;w.status.dataset.state=stats?.state || '';
  for(const [id,value] of Object.entries({transport:stats?.transport || '—',fps:rate?rate.fps.toFixed(1):'—',download:rate?rate.download.toFixed(1):'—',upload:rate?rate.upload.toFixed(1):'—',
    wss:latencyText(stats?.latency?.wss),udp:latencyText(stats?.latency?.udp),loss:stats?.udpLoss?.state==='ready'?`${(stats.udpLoss.ratio*100).toFixed(2)}%`:'—',
    resolution:stats?.available?`${stats.width}×${stats.height}`:'—'}))w.metrics[id].textContent=value;
  const clipboard=w.viewer?.getClipboardState();w.clipState.textContent=clipboard?`${clipboard.phase} · ${clipboard.effective.toRemote} / ${clipboard.effective.toLocal}`:'未连接';
  const audio=host.getAudioState(),route=audio.routes?.find(r=>r.runtime===w.session.id && r.generation===w.session.generation);
  if(!w.speakerToggle.disabled)w.speakerToggle.checked=!!route?.speaker;
  if(!w.micToggle.disabled)w.micToggle.checked=!!route?.mic;
  w.audioState.textContent=`${audio.connection} · 播放 ${route?.actualSpeaker?'开':'关'} · 麦克风 ${route?.actualMic?'开':'关'}${route?.reason?` · ${route.reason}`:''}`;
}
$('#template').addEventListener('change',templateSelected);
$('#launch').addEventListener('submit',event=>{event.preventDefault();perform('打开应用',()=>open({templateId:$('#template').value,parameters:launchParameters(),profileRef:$('#profile').value || undefined}),$('#launch-button'));});
$('#refresh').addEventListener('click',()=>perform('刷新目录',refresh,$('#refresh')));
document.querySelectorAll('[data-workspace]').forEach(b=>b.addEventListener('click',()=>{workspace=Number(b.dataset.workspace);show();report('切换工作区');}));
$('#logout').addEventListener('click',()=>perform('退出并释放',async()=>{await host.logout();windows.clear();tasks.clear();$('#windows').replaceChildren();$('#window-tabs').replaceChildren();$('#tasks').replaceChildren();show();notice('本页已释放；应用遵循自身空闲策略。重新加载页面可继续。');},$('#logout')));
$('#export').addEventListener('click',()=>{const data={schemaVersion:1,sdk:SDK_VERSION,kind:'host-workbench-observations',acceptance:'not-evaluated',records};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=node('a');a.href=url;a.download='remotexapp-host-observations.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
const timer=setInterval(()=>{if(document.hidden || host.closed)return;for(const w of windows.values())if(!w.element.hidden)update(w);
  const d=host.diagnostics();$('#ownership').textContent=`${d.localHandles} 个引用 · ${d.runtimes.length} 个运行时 · ${d.mode}`;},1000);
addEventListener('pagehide',()=>{clearInterval(timer);host.dispose().catch(()=>{});},{once:true});
// Observation-only harness surface. Normal operations above use public SDK APIs.
Object.defineProperty(window,'remoteXAppHostWorkbench',{value:{snapshot:()=>({sdk:SDK_VERSION,workspace,windows:[...windows.values()].map(w=>({key:w.key,workspace:w.workspace,instanceId:w.session.id,generation:w.session.generation,state:w.session.state,stats:w.viewer?.getStats()})),diagnostics:host.diagnostics(),audio:host.getAudioState(),records:[...records]})}});
perform('加载工作台',refresh);
