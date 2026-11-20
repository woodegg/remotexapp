import {RemoteXAppHost,SDK_VERSION} from './index.js';
import {rateSnapshot} from './host-workbench-model.mjs';
const $=s=>document.querySelector(s),node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
const baseURL=location.pathname.slice(0,location.pathname.lastIndexOf('/sdk/'));
const host=new RemoteXAppHost({baseURL,scope:'native-recovery-workbench'}),views=new Set();
$('#version').textContent=`SDK ${SDK_VERSION}`;
const notify=text=>{$('#notice').textContent=text;};
const perform=fn=>Promise.resolve().then(fn).catch(e=>notify(`操作未完成：${e.code || e.status || 'unavailable'}`));
const labels={retry:'重试连接',refresh:'刷新状态',recheck:'重新检查恢复',reattach:'连接已恢复的应用',restart:'重启应用…',authenticate:'重新登录',help:'诊断信息'};
function renderStats(record,advance=false){
  const s=record.view.viewer?.getStats(),rate=rateSnapshot(record.previous,s);if(advance)record.previous=s;
  record.stats.textContent=s?`${s.transport || '—'} · ${s.state} · ${s.available?s.width+' × '+s.height:'—'} · FPS ${rate?rate.fps.toFixed(1):'—'} · ↓ ${rate?rate.download.toFixed(1):'—'} kbps`:'尚未获得画面统计';
}
function button(text,fn){const n=node('button',text);n.type='button';n.addEventListener('click',()=>perform(fn));return n;}
// Only presentation: action admission, target validation and confirmation live in SDK.
function customPanel(parent,view,snapshot){
  parent.replaceChildren(node('p',`${snapshot.state} · ${snapshot.reason || '—'}`));
  if(snapshot.confirmation){
    parent.append(node('p','重启影响此应用的所有窗口，未保存内容可能丢失。请先保存工作。'),
      button('取消',()=>view.cancelConfirmation()),button('确认重启',()=>view.confirm(snapshot.confirmation.id)));
  }else for(const action of snapshot.actions)parent.append(button(labels[action.kind],()=>view.run(action.id)));
}
async function open(target){
  const custom=$('#custom').checked,card=node('article'),toolbar=node('div'),display=node('div'),stats=node('output'),controls=node('div');
  card.style.cssText='border:1px solid #40536d;border-radius:12px;margin:18px 0;overflow:hidden;background:#172232';
  toolbar.className='window-toolbar';display.style.cssText='height:520px;min-height:320px';
  stats.style.cssText='display:block;padding:12px;font-variant-numeric:tabular-nums';controls.style.cssText='padding:12px;display:flex;gap:8px;flex-wrap:wrap';
  card.append(toolbar,stats,display,controls);$('#views').append(card);
  const view=host.mount(display,target,{panel:!custom}),record={view,card,stats,previous:null};views.add(record);
  const badge=node('strong','连接中');toolbar.append(badge,
    button('同一应用再开窗口',()=>{if(!view.session)throw Error('not-ready');return open({instanceId:view.session.id});}),
    button('隐藏 / 显示画面',()=>{display.hidden=!display.hidden;if(display.hidden)view.viewer?.blur();}),
    button('断开此 Viewer',()=>view.viewer?.disconnect()),
    button('关闭窗口',async()=>{await view.release();views.delete(record);card.remove();}));
  const update=()=>{const snapshot=view.getState();badge.textContent=snapshot.state;renderStats(record);if(custom)customPanel(controls,view,snapshot);};
  view.addEventListener('change',update);view.addEventListener('attached',()=>{record.previous=null;});
  view.addEventListener('request',e=>notify(e.detail.kind==='authenticate'?'请通过宿主的正常登录入口重新登录，再打开窗口。':'请使用管理员 Console 检查；本页不会操作系统服务。'));
  update();return view;
}
async function refresh(){
  const entries=await host.manager.listInstances();$('#existing').replaceChildren();
  for(const item of entries.filter(x=>x.displayProvider==='kasm')){
    const option=node('option',`${item.templateId} · ${item.id.slice(-8)} · ${item.sessionState}`);option.value=item.id;$('#existing').append(option);
  }
  notify('应用列表已刷新。测试故障必须在隔离测试环境中注入。');
}
$('#attach').addEventListener('click',()=>perform(()=>{const id=$('#existing').value;if(!id)throw Error('no-application');return open({instanceId:id});}));
$('#create').addEventListener('click',()=>perform(()=>open({templateId:'mousepad'})));
$('#refresh').addEventListener('click',()=>perform(refresh));
$('#logout').addEventListener('click',()=>perform(async()=>{await host.logout();views.clear();$('#views').replaceChildren();notify('本页引用已释放；重新加载可继续。');}));
const timer=setInterval(()=>{
  if(document.hidden || host.closed)return;
  for(const r of views)renderStats(r,true);
},1000);
addEventListener('pagehide',()=>{clearInterval(timer);host.dispose().catch(()=>{});},{once:true});
Object.defineProperty(window,'remoteXAppRecoveryWorkbench',{value:{snapshot:()=>[...views].map(r=>r.view.getState())}});
perform(refresh);
