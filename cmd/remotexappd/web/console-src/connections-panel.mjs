import {ConnectionInspector} from './connections-model.mjs';
import {runtimeVersionLabel} from './navigation-model.mjs';

export function createConnectionsPanel(manager, doc = document) {
  const node = (tag, text) => { const n = doc.createElement(tag); if (text !== undefined) n.textContent = text; return n; };
  const dialog = node('dialog'); dialog.setAttribute('aria-label','Connection info');
  dialog.style.cssText = 'width:min(850px,95vw);max-height:90vh;overflow:auto;background:#101d2d;color:#dce8f6;border:1px solid #4696d3;border-radius:10px';
  const heading = node('h2','Connection info'), warning = node('p','Sensitive host/control information. Access follows Manager authentication. Copy only to trusted tools.');
  const refresh = node('button','Refresh'), close = node('button','Close'), copy = node('button','Copy JSON');
  const message = node('p'), versions = node('p'), fields = node('div'), output = node('pre'); output.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere';
  const result = new ConnectionInspector(manager, render);
  function render() {
    message.textContent = result.message; versions.textContent = result.runtime ? `${result.runtime.id} · ${runtimeVersionLabel(result.runtime.versions?.current)}${result.value ? ' · Retrieved '+result.readAt : ''}` : 'No runtime';
    output.textContent = result.value ? JSON.stringify(result.value,null,2) : '';
    copy.disabled = !result.value || result.loading; refresh.disabled = !result.runtime || result.loading;
    fields.replaceChildren();
    const visit = (value, path) => {
      if (value !== null && typeof value === 'object') { for (const [key, child] of Object.entries(value)) visit(child,path ? `${path}.${key}` : key); return; }
      const row = node('p'), label = node('span',path), content = node('code',String(value)), button = node('button','Copy field');
      row.style.cssText = 'display:grid;grid-template-columns:minmax(90px,1fr) minmax(100px,3fr) auto;gap:8px;align-items:start;margin:6px 0;font-size:11px;overflow-wrap:anywhere';
      button.style.cssText = 'padding:3px 6px;font-size:11px';
      button.onclick = () => copyValue(String(value)); row.append(label,content,button); fields.append(row);
    };
    if (result.value) visit(result.value,'');
    if (result.value && !result.value.environment?.ibus) fields.append(node('p',`IBus unavailable: ${result.value.unavailableReasons?.ibus || 'not supplied by this server/runtime'}`));
  }
  async function copyValue(value) {
    const ok = await result.copy(value, text => navigator.clipboard.writeText(text), text => window.confirm(text));
    if (ok === false && result.opened) message.textContent = 'Local clipboard copy failed or permission was denied.';
    if (ok === true && result.opened) message.textContent = 'Copied to the local clipboard.';
  }
  refresh.onclick = () => { void result.refresh(); };
  copy.onclick = () => { if (result.value) void copyValue(JSON.stringify(result.value,null,2)); };
  const clear = () => { result.close(); };
  close.onclick = () => { clear(); dialog.close(); };
  // close is queued by the browser: a rapid reopen must not clear the new panel.
  dialog.addEventListener('close',() => { if (!dialog.open) clear(); }); dialog.addEventListener('cancel',clear);
  window.addEventListener('pagehide',() => { clear(); dialog.close(); });
  const raw = node('details'); raw.append(node('summary','Raw descriptor JSON'),output);
  dialog.append(heading,warning,refresh,copy,close,message,versions,fields,raw); doc.body.append(dialog);
  return {
    open(runtime) {
      clear();
      const loopback = ['localhost','127.0.0.1','[::1]'].includes(location.hostname);
      if (!loopback && !(location.protocol === 'https:' && window.isSecureContext)) { window.alert('Connection inspection requires trusted loopback or authenticated HTTPS.'); return; }
      result.open(runtime); if (!dialog.open) dialog.showModal(); refresh.focus();
    },
    observe(instances) { if (result.opened) result.observe(instances.find(x => x.id === result.runtime?.id) || null); },
    invalidate() { if (result.opened) result.invalidate(); },
  };
}
