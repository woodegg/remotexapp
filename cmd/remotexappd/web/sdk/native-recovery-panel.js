const labels = {
  connecting:'连接中 · Connecting',ready:'已就绪 · Ready',recovering:'正在恢复 · Recovering',
  attention:'需要处理 · Needs attention',closed:'已关闭 · Closed',
  retry:'重试连接 · Retry connection',refresh:'刷新状态 · Refresh status',recheck:'重新检查恢复 · Recheck recovery',
  reattach:'连接已恢复的应用 · Reattach',restart:'重启应用… · Restart App…',
  authenticate:'重新登录 · Sign in',help:'诊断信息 · Help',
};
const explanations = {
  'runtime-invalidated':'原会话已结束或发生变化。刷新状态后再选择操作。',
  'stale-generation':'目标会话已变化。旧窗口不能继续操作它，请刷新状态。',
  'operation-uncertain':'请求结果不确定。请刷新状态确认；系统不会重复执行重启。',
  'launch-uncertain':'启动结果不确定。请检查已有应用；系统不会再次创建应用。',
  'operation-refused':'服务端拒绝此次操作。请检查关闭阻塞或当前运行状态，不会自动强制关闭。',
  'recheck-submitted':'已提交恢复重查；这不代表修复完成。稍后刷新状态查看结果。',
  'authentication-required':'请通过宿主应用重新登录；旧登录会话不会自动取得新身份。',
  'permission-denied':'当前身份没有权限。请联系管理员。',
  'target-changed':'应用身份或组件已变化，需要由宿主应用或管理员确认目标。',
  'reconnect-exhausted':'自动重连次数已用完。网络恢复后可以手动重试连接。',
  'managed-unavailable':'托管应用未运行或尚未就绪。请通过管理入口检查；连接操作不会启动或重启桌面。',
};

/** SDK-owned presentation; no lifecycle policy or private display access here. */
export function recoveryPanel(container, view, enabled) {
  const doc = container.ownerDocument;
  const node = (tag,text) => {const n=doc.createElement(tag);if(text)n.textContent=text;return n;};
  const root=node('div'),display=node('div'),panel=node('section');
  root.style.cssText='position:relative;height:100%;min-height:300px;width:100%;background:#111827;color:#e5edf6';
  display.style.cssText='height:100%;min-height:300px;width:100%';
  panel.style.cssText='position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;background:rgba(15,23,42,.96);font:15px system-ui;box-sizing:border-box;text-align:center;overflow:auto';
  panel.setAttribute('aria-label','连接恢复 · Connection recovery');panel.dataset.recoveryPanel='';
  root.append(display,panel);container.replaceChildren(root);
  const invoke = fn => Promise.resolve().then(fn).catch(()=>{});
  const button = (text,kind,fn) => {
    const b=node('button',text);b.type='button';b.dataset.recoveryAction=kind;
    b.style.cssText='padding:10px 15px;border-radius:7px;border:1px solid #5b789b;background:#18394f;color:#fff;cursor:pointer;font:inherit';
    b.addEventListener('click',()=>invoke(fn));return b;
  };
  return {
    display,
    render(snapshot) {
      const focused=panel.contains(doc.activeElement)?doc.activeElement?.dataset?.recoveryAction:null;
      panel.hidden=!enabled || snapshot.state==='ready' || snapshot.state==='closed';
      panel.style.display=panel.hidden?'none':'flex';panel.dataset.recoveryState=snapshot.state;
      if(panel.hidden)return;
      const status=node('strong',labels[snapshot.state]);status.setAttribute('role','status');status.setAttribute('aria-live','polite');
      const message=node('p',explanations[snapshot.reason] || (snapshot.state==='recovering'?'正在尝试恢复连接；远程应用不会因此被重启。':'连接尚未就绪。以下操作由 SDK 和服务端共同检查。'));
      message.style.maxWidth='38em';panel.replaceChildren(status,message);
      if(snapshot.recovery){const reason=node('p',`恢复状态：${snapshot.recovery.phase} · ${snapshot.recovery.reason || '—'}`);panel.append(reason);}
      if(snapshot.confirmation){
        const warning=node('p','重启会关闭该运行实例中的应用，并影响它的所有窗口和标签页。已保存文件保留，未保存内容可能丢失。请先保存工作；此操作不会自动强制关闭。');
        warning.style.maxWidth='38em';warning.setAttribute('role','alert');
        panel.append(warning,button('取消 · Cancel','cancel',()=>view.cancelConfirmation()),
          button('确认重启 · Confirm restart','confirm',()=>view.confirm(snapshot.confirmation.id)));
      } else {
        const actions=node('div');actions.style.cssText='display:flex;flex-wrap:wrap;gap:8px;justify-content:center';
        for(const action of snapshot.actions)actions.append(button(labels[action.kind],action.kind,()=>{
          if(action.kind==='help'){
            const info=node('p',`诊断代码：${snapshot.reason || 'unavailable'}。复杂系统故障请通过管理员 Console 处理。`);
            info.setAttribute('role','status');panel.append(info);
          }
          return view.run(action.id);
        }));
        panel.append(actions);
      }
      if(focused)panel.querySelector(`[data-recovery-action="${focused}"]`)?.focus();
    },
    dispose(){root.remove();},
  };
}
