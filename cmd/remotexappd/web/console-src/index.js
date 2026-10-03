import { managedPrimaryAction, standaloneRuntimes, runtimeVersionLabel, runtimeVersionSummary } from './navigation-model.mjs';
import {createConnectionsPanel} from './connections-panel.mjs';
import {createActionsPanel} from './actions-panel.mjs';
import {createCoordinatorPanel} from './coordinator-panel.mjs';

const moduleURL = new URL(import.meta.url);
const assetIndex = moduleURL.pathname.lastIndexOf('/assets/');
const serviceBase = assetIndex >= 0 ? moduleURL.pathname.slice(0, assetIndex) : '';
// Build injects the matching immutable SDK filename. Resolve beside this bundle
// so a reverse-proxy prefix is preserved without consulting the mutable entry.
const { RemoteXAppClient, RemoteXAppManager, RemoteXAppAPIError, RemoteXAppClipboardPrompts, RemoteXAppCoordinator, SDK_VERSION } = await import(new URL(__REMOTEXAPP_CONSOLE_SDK__, moduleURL).href);

const path = location.pathname;
const viewerMatch = path.match(/\/remotexapps\/([^/]+)\/kiosk[.]html$/);
const mode = viewerMatch ? 'viewer' : path.endsWith('/sdk/minimal.html') ? 'launch' : 'operator';
const root = document.querySelector('#remotexapp-console');
const manager = new RemoteXAppManager({ baseURL:serviceBase });
let runtimeCoordinator;
let coordinatorPanel;
function openCoordinatorPanel() {
  coordinatorPanel ||= createCoordinatorPanel(() => runtimeCoordinator ||= new RemoteXAppCoordinator({ manager, scope:'builtin-console' }));
  coordinatorPanel.open();
}

document.documentElement.dataset.consoleMode = mode;
installStyles();
if (mode === 'viewer') {
  await startViewer(decodeURIComponent(viewerMatch[1]));
} else {
  await startConsole(mode);
}

function installStyles() {
  const style = document.createElement('style');
  style.textContent = `
    :root{color-scheme:dark;font:13px system-ui,sans-serif;background:#07101a;color:#dce8f6}
    *{box-sizing:border-box}html,body,#remotexapp-console{width:100%;height:100%;margin:0}button,input,select,textarea{font:inherit;color:#e7f0fa;background:#142339;border:1px solid #405570;border-radius:6px;padding:7px 9px}button{cursor:pointer}button:disabled{cursor:not-allowed;opacity:.45}button.primary{background:#1768aa;border-color:#2d83c6}button.danger{color:#ffc0c5;background:#3c1d27;border-color:#814552}button.warn{color:#ffe5a6;background:#3a2c13;border-color:#80662d}a{color:#8dcbff}.muted{color:#8298af}.error{color:#ff9ca5}.ok{color:#80d7a6}.chip{display:inline-block;padding:2px 6px;border-radius:999px;background:#24364c;color:#bed0e4;font:10px ui-monospace,monospace}.toolbar,.actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.console{height:100%;display:grid;grid-template-columns:370px minmax(0,1fr);overflow:hidden}.sidebar{overflow:auto;border-right:1px solid #293b51;background:#0b1624}.top{position:sticky;top:0;z-index:3;padding:14px;background:#101d2e;border-bottom:1px solid #293b51}.top h1{margin:0;font-size:18px}.health{margin:6px 0 0}.section-title{margin:17px 12px 7px;color:#9dc6ed;font-size:11px;text-transform:uppercase;letter-spacing:.09em}.card{margin:7px 10px;padding:10px;border:1px solid #2c4058;border-radius:8px;background:#101d2d}.card.selected{border-color:#4696d3;box-shadow:0 0 0 1px #4696d344}.card-title{display:flex;align-items:center;gap:7px;font-weight:650}.card-title span:first-child{min-width:0;overflow-wrap:anywhere}.meta{margin-top:6px;color:#9aafc4;font:10px/1.5 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.detail-json{max-height:145px;overflow:auto;margin:7px 0 0;padding:7px;background:#08111b;border-radius:5px;color:#a8bdd2;font:10px/1.4 ui-monospace,monospace;white-space:pre-wrap}.field{display:grid;grid-template-columns:110px minmax(0,1fr);align-items:center;gap:8px;margin:7px 0;color:#9fb4c9;font-size:11px}.field>input,.field>select,.field>textarea{width:100%}.field textarea{min-height:64px;resize:vertical}.field input[type=checkbox]{width:auto;justify-self:start}.workspace{min-width:0;display:grid;grid-template-rows:auto minmax(0,1fr) 190px;background:#050b12}.viewer-head{display:flex;align-items:center;gap:7px;padding:9px 12px;border-bottom:1px solid #293b51;background:#0c1725}.viewer-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.screen{position:relative;min-height:0;overflow:hidden;background:#171b20}.empty{position:absolute;inset:0;display:grid;place-items:center;color:#71879e}.diagnostics{overflow:auto;margin:0;padding:10px 12px;border-top:1px solid #293b51;background:#050a10;color:#a8bdd2;font:10px/1.45 ui-monospace,monospace;white-space:pre-wrap}.operation{min-height:18px;margin-top:7px;color:#a7bed6;font-size:11px}.launch-only .managed-section,.launch-only #serviceRestart{display:none!important}.viewer-shell{position:relative;width:100%;height:100%;overflow:hidden;background:#05080d}.viewer-shell .screen{position:absolute;inset:0}.viewer-tools{position:absolute;right:8px;top:8px;z-index:6}.viewer-status{position:absolute;left:10px;bottom:10px;z-index:6;max-width:min(720px,calc(100% - 20px));padding:6px 9px;border:1px solid #344a62;border-radius:6px;background:#0a1522e8;color:#a3c9ed}.viewer-shell .diagnostics{position:absolute;right:8px;bottom:8px;z-index:7;width:min(550px,calc(100% - 16px));max-height:45%;border:1px solid #344a62;border-radius:7px}.viewer-shell .diagnostics[hidden],.viewer-status[hidden]{display:none}.empty-state{padding:14px;color:#748ba2;text-align:center}details summary{cursor:pointer;color:#a9c4df;margin:8px 0}.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
      .viewer-head{flex-wrap:wrap}.viewer-title{min-width:180px}.viewer-tools{z-index:31;max-width:calc(100% - 16px);padding:6px;border-radius:7px;background:#0a1522e8}.clipboard-tools{display:flex;align-items:center;gap:5px;flex-wrap:wrap}.clipboard-tools label{display:flex;align-items:center;gap:4px;color:#9fb4c9;font-size:10px}.clipboard-tools select,.clipboard-tools button{padding:4px 6px;font-size:10px}.clipboard-state{max-width:290px;color:#89a8c5;font:9px/1.3 ui-monospace,monospace;overflow-wrap:anywhere}
      .workspace{position:relative;min-width:0;display:grid;grid-template-rows:minmax(0,1fr) auto;overflow:hidden;background:#050b12}.window-stage{position:relative;min-height:0;overflow:hidden}.window-stage>.empty{pointer-events:none}.viewer-window{position:absolute;display:grid;grid-template-rows:auto auto minmax(0,1fr);width:min(820px,calc(100% - 32px));height:min(620px,calc(100% - 32px));min-width:360px;min-height:260px;overflow:hidden;resize:both;border:1px solid #3b536d;border-radius:9px;background:#07101a;box-shadow:0 12px 35px #0009}.viewer-window.active{border-color:#59a9e8;box-shadow:0 15px 45px #000b,0 0 0 1px #59a9e855}.window-head{display:flex;align-items:center;gap:6px;min-height:40px;padding:6px 8px;border-bottom:1px solid #293b51;background:#101d2e;user-select:none;touch-action:none}.window-head .viewer-title{cursor:move}.window-head button{padding:4px 7px;font-size:10px}.window-clipboard{padding:5px 7px;border-bottom:1px solid #293b51;background:#0b1624}.window-body{min-height:0;display:grid;grid-template-rows:minmax(0,1fr) auto}.window-body .screen{min-height:120px}.window-body .diagnostics{max-height:150px}.viewer-window.minimized{display:none}.window-taskbar{display:flex;align-items:center;gap:6px;min-height:42px;padding:5px 8px;overflow-x:auto;border-top:1px solid #293b51;background:#0c1725}.window-taskbar button{max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.window-taskbar button.active{border-color:#59a9e8;background:#173653}.window-message{max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#91abc3;font-size:10px}.window-message.error{color:#ff9ca5}
      @media(max-width:850px){.console{grid-template-columns:1fr;grid-template-rows:330px minmax(0,1fr)}.sidebar{border-right:0;border-bottom:1px solid #293b51}.workspace{grid-template-rows:minmax(0,1fr) auto}}
  `;
  document.head.append(style);
}

function element(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'className') node.className = value;
    else if (name === 'text') node.textContent = value;
    else if (name.startsWith('on') && typeof value === 'function') node.addEventListener(name.slice(2), value);
    else if (value !== undefined && value !== null) node.setAttribute(name, String(value));
  }
  node.append(...children.filter(child => child !== undefined && child !== null));
  return node;
}

function installClipboardControls(client, host, screen, report) {
  host.replaceChildren();
  host.className = 'clipboard-tools';
  const modes = ['off', 'manual', 'prompt', 'auto'];
  const selector = label => element('select', { 'aria-label':label }, ...modes.map(modeName => element('option', { value:modeName, text:modeName })));
  const toRemote = selector('Local to remote clipboard mode');
  const toLocal = selector('Remote to local clipboard mode');
  const send = element('button', { type:'button', text:'Local → remote' });
  const receive = element('button', { type:'button', text:'Remote → local' });
  const authorizeRead = element('button', { type:'button', text:'Authorize local clipboard read' });
  const state = element('span', { className:'clipboard-state', text:'Clipboard sync off' });
  const apply = async () => {
    client.clipboard.configure({ toRemote:toRemote.value, toLocal:toLocal.value, checkOnFocus:true });
    state.textContent = clipboardSummary(await client.clipboard.checkAccess());
  };
  toRemote.onchange = () => apply().catch(error => report(error.message, true));
  toLocal.onchange = () => apply().catch(error => report(error.message, true));
  send.onclick = () => client.clipboard.syncToRemote()
    .then(() => report('Local clipboard synchronized.'))
    .catch(error => report(error.message, true));
  receive.onclick = () => {
    const pending = client.clipboard.snapshot().pending.filter(offer => offer.direction === 'toLocal');
    const offer = pending[pending.length - 1];
    if (!offer) { report('No remote clipboard offer is pending.', true); return; }
    client.clipboard.syncToLocal(offer.id)
      .then(() => report('Remote clipboard synchronized.'))
      .catch(error => report(error.message, true));
  };
  authorizeRead.onclick = () => client.clipboard.requestReadAccess()
    .then(snapshot => {
      const result = snapshot.access.read;
      report(result.verified ? 'Local clipboard read access verified.' : `Local clipboard read access: ${result.state}.`, !result.verified);
    })
    .catch(error => report(error.message, true));
  client.clipboard.addEventListener('statechange', event => {
    toRemote.value = event.detail.config.toRemote;
    toLocal.value = event.detail.config.toLocal;
    state.textContent = clipboardSummary(event.detail);
  });
  client.clipboard.addEventListener('permissionrequired', event => report(`Clipboard permission required for ${event.detail.direction}.`, true));
  client.clipboard.addEventListener('error', event => report(event.detail.error.message, true));
  host.append(
    element('label', {}, element('span', { text:'Local→remote' }), toRemote),
    element('label', {}, element('span', { text:'Remote→local' }), toLocal),
    send, receive, authorizeRead, state,
  );
  return new RemoteXAppClipboardPrompts(client, { container:screen });
}

function clipboardSummary(snapshot) {
  const browser = snapshot.capabilities || {};
  const read = snapshot.access?.read || { state:snapshot.permissions.read, verified:false };
  const write = snapshot.access?.write || { state:snapshot.permissions.write, verified:false };
  return `${snapshot.inputActive ? 'active' : 'inactive'} · ${snapshot.pending.length} pending · read ${read.state}${read.verified ? ' verified' : ''} · write ${write.state}${write.verified ? ' verified' : ''} · rich ${browser.read && browser.write ? 'yes' : 'fallback'}`;
}

function installConnectionMaskSwitch(client, host) {
  const checkbox = element('input', { type:'checkbox', 'aria-label':'Connection mask' });
  checkbox.checked = client.connectionMask;
  checkbox.onchange = () => client.setConnectionMaskEnabled(checkbox.checked);
  host.append(element('label', {}, checkbox, element('span', { text:'Connection mask' })));
}

function installIdleLeaseSwitch(client, host, report) {
  const checkbox = element('input', { type:'checkbox', 'aria-label':'Keep running while disconnected' });
  const status = element('span', { className:'chip', text:'Idle lease off' });
  let handle, request = 0;
  checkbox.onchange = async () => {
    const current = ++request;
    handle?.release(); handle = null;
    status.textContent = 'Idle lease off';
    if (!checkbox.checked) return;
    try {
      const instance = await manager.getInstance(client.instanceId);
      if (current !== request || client.destroyed) return;
      runtimeCoordinator ||= new RemoteXAppCoordinator({ manager, scope:'builtin-console' });
      const owned = handle = runtimeCoordinator.track(instance.id, { sessionGeneration:instance.sessionGeneration, keepAlive:true });
      owned.addEventListener('leasechange', event => {
        if (handle !== owned) return;
        const lease = event.detail.lease;
        status.textContent = lease.expiresAt ? `Keep until ${new Date(lease.expiresAt).toLocaleTimeString()}` : `Keep running · ${lease.outcome}`;
      });
      owned.addEventListener('invalidated', () => {
        if (handle !== owned) return;
        checkbox.checked = false; status.textContent = 'Idle lease ended';
      });
      await owned.ready;
      if (handle === owned && !owned.lease) status.textContent = 'Waiting for idle lease';
    } catch (error) {
      if (current !== request) return;
      checkbox.checked = false; status.textContent = 'Idle lease unavailable';
      report(error.message, true);
    }
  };
  client.addEventListener('statechange', event => {
    if (event.detail.state === 'destroyed') { request++; handle?.release(); handle = null; }
  });
  host.append(element('label', { title:'Keep this App running without a Viewer connection. Background browser suspension is best effort.' }, checkbox, element('span', { text:'Keep running' })), status);
}

function numberOption(search, name) {
  if (!search.has(name)) return undefined;
  const raw = search.get(name);
  if (raw === 'Infinity') return Infinity;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

async function startViewer(instanceId) {
  document.title = 'Remote application';
  root.className = 'viewer-shell';
  root.replaceChildren();
  const screen = element('div', { className:'screen', 'aria-label':'Remote application display' });
  const status = element('div', { className:'viewer-status', text:'Preparing remote application…' });
  const diagnostics = element('pre', { className:'diagnostics', hidden:'' });
  const reconnect = element('button', { type:'button', text:'Reconnect' });
  const toggle = element('button', { type:'button', text:'Diagnostics', 'aria-expanded':'false' });
  const clipboardHost = element('div');
  const viewerTools = element('div', { className:'viewer-tools toolbar' }, reconnect, toggle, clipboardHost);
  const coordinatorButton = element('button', { type:'button', text:'Coordinator' });
  coordinatorButton.addEventListener('click', openCoordinatorPanel);
  viewerTools.append(coordinatorButton);
  root.append(screen, viewerTools, status, diagnostics);
  const search = new URLSearchParams(location.search);
  const diagnosticsVisible = search.get('diagnostics') === 'on';
  const setStatus = (message, isError = false) => {
    status.textContent = message;
    status.classList.toggle('error', isError);
    status.hidden = !message;
  };
  try {
    const instance = await manager.getInstance(instanceId);
    document.title = `${instance.templateId || instance.classId} · RemoteXApp`;
    const client = new RemoteXAppClient({
      manager, instance, container:screen, resize:'class', autoReconnect:true,
      connectionMask:search.get('connectionMask') !== 'off',
      maxReconnectAttempts:numberOption(search, 'maxReconnectAttempts'),
      resizeDebounce:numberOption(search, 'resizeDebounce'),
      resizeMaxWait:numberOption(search, 'resizeMaxWait'),
      textBatchDelay:numberOption(search, 'textBatchDelay'),
      inputEventTracing:search.get('trace') === 'on', diagnosticsEnabled:diagnosticsVisible,
    });
    installConnectionMaskSwitch(client, viewerTools);
    installIdleLeaseSwitch(client, viewerTools, setStatus);
    client.addEventListener('statechange', event => {
      const { state, reason } = event.detail;
      setStatus(state === 'connected' ? '' : `${state}${reason ? ` · ${reason}` : ''}`, state === 'disconnected');
    });
    client.addEventListener('reconnecting', event => setStatus(`Reconnecting in ${event.detail.delay} ms…`));
    client.addEventListener('reconnectexhausted', event => setStatus(`Reconnect attempts exhausted (${event.detail.attempts}).`, true));
    client.addEventListener('error', event => setStatus(event.detail.error.message, true));
    client.addEventListener('diagnostics', event => {
      if (!diagnostics.hidden) diagnostics.textContent = JSON.stringify({ sdkVersion:SDK_VERSION, ...event.detail.diagnostics }, null, 2);
    });
    reconnect.onclick = () => client.reconnect().catch(error => setStatus(error.message, true));
    toggle.onclick = async () => {
      const visible = diagnostics.hidden;
      diagnostics.hidden = !visible;
      toggle.setAttribute('aria-expanded', String(visible));
      const snapshot = await client.setDiagnosticsEnabled(visible);
      if (visible) diagnostics.textContent = JSON.stringify({ sdkVersion:SDK_VERSION, ...snapshot }, null, 2);
    };
    diagnostics.hidden = !diagnosticsVisible;
    toggle.setAttribute('aria-expanded', String(diagnosticsVisible));
    await client.connect();
    installClipboardControls(client, clipboardHost, screen, setStatus);
    client.focus();
    window.remoteXApp = { manager, client, instance };
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function startConsole(consoleMode) {
  const connectionsPanel = consoleMode === 'operator' ? createConnectionsPanel(manager) : null;
  const actionsPanel = consoleMode === 'operator' ? createActionsPanel(manager) : null;
  document.title = consoleMode === 'launch' ? 'RemoteXApp launcher' : 'RemoteXApp operator console';
  root.className = `console ${consoleMode === 'launch' ? 'launch-only' : ''}`;
  root.innerHTML = `
    <aside class="sidebar">
      <header class="top"><h1>RemoteXApp console</h1><div id="health" class="health muted">Checking manager…</div><div class="toolbar"><button id="refresh">Refresh</button><button id="serviceRestart" class="warn" hidden>Restart manager service</button></div><div id="operation" class="operation" role="status"></div></header>
      <h2 class="section-title">Applications</h2>
      <section class="card"><label class="field"><span>Application</span><select id="template"></select></label><div id="parameters"></div><label class="field"><span>Profile</span><input id="profile" autocomplete="off"></label><details><summary>Allowed overrides</summary><div id="overrides"></div></details><div id="templateDetails" class="meta"></div><div class="toolbar"><button id="open" class="primary">${consoleMode === 'launch' ? 'Open and connect in new window' : 'Open standalone and connect in new window'}</button></div><details class="managed-section"><summary>Create managed application</summary><label class="field"><span>Managed name</span><input id="managedID" pattern="[a-z0-9][a-z0-9-]{0,63}" autocomplete="off"></label><div class="toolbar"><button id="createManaged">Create managed application and connect in new window</button></div></details></section>
      <div class="managed-section"><h2 class="section-title">Managed applications</h2><div id="managed"></div></div>
      <h2 class="section-title">Standalone runtimes</h2><div id="instances"></div>
    </aside>
      <section id="workspace" class="workspace" tabindex="0" aria-label="Viewer windows">
        <div id="windowStage" class="window-stage"><div id="emptyWorkspace" class="empty">Open an application or connect to an existing runtime</div></div>
        <nav id="windowTaskbar" class="window-taskbar" aria-label="Open Viewer windows"></nav>
      </section>`;
  const ui = Object.fromEntries([...root.querySelectorAll('[id]')].map(node => [node.id, node]));
  const coordinatorButton = element('button', { type:'button', text:'Coordinator' });
  coordinatorButton.addEventListener('click', openCoordinatorPanel);
  ui.refresh.parentElement.append(coordinatorButton);
  let templates = [];
    let refreshing = false;
    let renderedTemplateID = '';
    let windowSequence = 0;
    let activeWindowID = '';
    let windowZ = 10;
    const viewerWindows = new Map();

  const message = (text, error = false) => {
    ui.operation.textContent = text;
    ui.operation.classList.toggle('error', error);
  };
  const run = async (label, action) => {
    if (/stop|restart|upgrade|remove/i.test(label)) { connectionsPanel?.invalidate(); actionsPanel?.invalidate(); }
    message(`${label}…`);
    try {
      const result = await action();
      message(`${label} completed.`);
      return result;
    } catch (error) {
      message(error.message, true);
      throw error;
    }
  };

  function renderTemplate() {
    const template = templates.find(item => item.id === ui.template.value);
    ui.parameters.replaceChildren();
    ui.overrides.replaceChildren();
    if (!template) return;
    renderedTemplateID = template.id;
    ui.profile.value = template.profileRef || 'default';
    for (const [name, definition] of Object.entries(template.parameters || {})) {
      ui.parameters.append(parameterField(name, definition));
    }
    for (const name of template.overrides?.allowed || []) {
      ui.overrides.append(overrideField(name));
    }
    ui.templateDetails.textContent = [
      `${template.singleton ? 'singleton' : 'multi-instance'} · ${template.runMode}`,
      `${template.display.mode} ${template.display.size} ${template.display.depth}-bit ${template.display.frameRate}fps · resize ${template.display.allowClientResize ? 'remote' : 'scale'}`,
      `server ${template.serverActivation} · session ${template.sessionActivation}`,
      `${template.vacantAction} after ${template.vacantTimeout} · driver ${template.driverVersion}`,
    ].join('\n');
  }

  function parameterField(name, definition) {
    let input;
    if (definition.type === 'enum') {
      input = element('select');
      input.append(...(definition.values || []).map(value => element('option', { value, text:value })));
    } else if (definition.type === 'json') {
      input = element('textarea');
    } else {
      input = element('input', { type:definition.type === 'boolean' ? 'checkbox' : definition.type === 'integer' ? 'number' : definition.type === 'url' ? 'url' : 'text' });
    }
    input.dataset.parameter = name;
    input.dataset.type = definition.type;
    input.dataset.hasDefault = String(Object.hasOwn(definition, 'default'));
    input.required = Boolean(definition.required);
    if (definition.type === 'boolean') input.checked = Boolean(definition.default);
    else if (definition.default !== undefined) input.value = definition.type === 'json' ? JSON.stringify(definition.default, null, 2) : String(definition.default);
    if (definition.maxLength) input.maxLength = definition.maxLength;
    if (definition.minimum !== undefined) input.min = definition.minimum;
    if (definition.maximum !== undefined) input.max = definition.maximum;
    return element('label', { className:'field' }, element('span', { text:`${name}${definition.required ? ' *' : ''}` }), input);
  }

  function overrideField(name) {
    const choices = {
      displayMode:['fixed', 'dynamic'], workspaceMode:['ephemeral', 'persistent'],
      sessionActivation:['on-attach', 'immediate'], idleAction:['keep', 'stop-session', 'stop-instance'],
      allowClientResize:['true', 'false'], singleton:['true', 'false'],
    };
    let input;
    if (choices[name]) {
      input = element('select', {}, element('option', { value:'', text:'Template default' }), ...choices[name].map(value => element('option', { value, text:value })));
    } else {
      input = element('input', { type:['display', 'frameRate'].includes(name) ? 'number' : 'text', placeholder:'Template default' });
    }
    input.dataset.override = name;
    return element('label', { className:'field' }, element('span', { text:name }), input);
  }

  function collectParameters() {
    const result = {};
    for (const input of ui.parameters.querySelectorAll('[data-parameter]')) {
      const name = input.dataset.parameter;
      if (input.dataset.type === 'boolean') result[name] = input.checked;
      else if (input.value !== '' || input.required || input.dataset.hasDefault === 'true') {
        if (input.dataset.type === 'integer') result[name] = Number(input.value);
        else if (input.dataset.type === 'json') result[name] = JSON.parse(input.value);
        else result[name] = input.value;
      }
      if (!input.checkValidity()) throw new Error(`Invalid value for ${name}`);
    }
    return result;
  }

  function collectOverrides() {
    const result = {};
    for (const input of ui.overrides.querySelectorAll('[data-override]')) {
      if (input.value === '') continue;
      const name = input.dataset.override;
      if (['allowClientResize', 'singleton'].includes(name)) result[name] = input.value === 'true';
      else if (['display', 'frameRate'].includes(name)) result[name] = Number(input.value);
      else result[name] = input.value;
    }
    return result;
  }

    function hasViewer(instanceId) {
      return [...viewerWindows.values()].some(entry => entry.instance.id === instanceId);
    }

    function activateViewer(entry, { focus = false } = {}) {
      if (!entry || !viewerWindows.has(entry.id)) return;
      activeWindowID = entry.id;
      entry.node.classList.remove('minimized');
      entry.node.style.zIndex = String(++windowZ);
      for (const candidate of viewerWindows.values()) {
        const active = candidate === entry;
        candidate.node.classList.toggle('active', active);
        candidate.task.classList.toggle('active', active);
      }
      if (focus) queueMicrotask(() => entry.client.focus());
    }

    function closeViewer(entry) {
      if (!entry || !viewerWindows.delete(entry.id)) return;
      entry.prompts?.destroy();
      entry.client.destroy();
      entry.node.remove();
      entry.task.remove();
      if (activeWindowID === entry.id) {
        activeWindowID = '';
        const next = [...viewerWindows.values()].at(-1);
        if (next) activateViewer(next);
      }
      ui.emptyWorkspace.hidden = viewerWindows.size > 0;
      refresh().catch(() => {});
    }

    function installWindowDrag(entry, handle) {
      handle.addEventListener('pointerdown', event => {
        if (event.button !== 0 || event.target.closest('button,select,input')) return;
        activateViewer(entry, { focus:true });
        const startX = event.clientX;
        const startY = event.clientY;
        const startLeft = entry.node.offsetLeft;
        const startTop = entry.node.offsetTop;
        const move = moveEvent => {
          const maxLeft = Math.max(0, ui.windowStage.clientWidth - 80);
          const maxTop = Math.max(0, ui.windowStage.clientHeight - 40);
          entry.node.style.left = `${Math.max(0, Math.min(maxLeft, startLeft + moveEvent.clientX - startX))}px`;
          entry.node.style.top = `${Math.max(0, Math.min(maxTop, startTop + moveEvent.clientY - startY))}px`;
        };
        const done = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', done);
          window.removeEventListener('pointercancel', done);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', done);
        window.addEventListener('pointercancel', done);
        event.preventDefault();
      });
    }

    async function openViewer(instance) {
      const id = `viewer-${++windowSequence}`;
      const label = `${instance.templateId || instance.classId} · ${instance.id}`;
      const title = element('strong', { className:'viewer-title', text:label });
      const state = element('span', { className:'chip', text:'connecting' });
      const status = element('span', { className:'window-message', text:'Preparing…' });
      const reconnect = element('button', { type:'button', text:'Reconnect' });
      const disconnect = element('button', { type:'button', text:'Disconnect' });
      const diagnosticsToggle = element('button', { type:'button', text:'Diagnostics', 'aria-expanded':'false' });
      const stop = element('button', { type:'button', className:'danger', text:'Stop runtime' });
      const minimize = element('button', { type:'button', text:'Minimize', 'aria-label':`Minimize ${label}` });
      const close = element('button', { type:'button', text:'Close viewer', 'aria-label':`Close Viewer for ${label}` });
      const header = element('header', { className:'window-head' }, title, state, status, reconnect, disconnect, diagnosticsToggle, stop, minimize, close);
      const clipboardHost = element('div', { className:'window-clipboard' });
      const screen = element('div', { className:'screen', 'aria-label':`Remote display for ${label}` });
      const diagnostics = element('pre', { className:'diagnostics', hidden:'', text:'No viewer diagnostics.' });
      const body = element('div', { className:'window-body' }, screen, diagnostics);
      const node = element('article', { className:'viewer-window', 'data-viewer-window':id, 'data-runtime-id':instance.id }, header, clipboardHost, body);
      const task = element('button', { type:'button', text:label, 'data-viewer-task':id });
      const offset = 18 + ((windowSequence - 1) % 7) * 28;
      node.style.left = `${offset}px`;
      node.style.top = `${offset}px`;
      node.style.zIndex = String(++windowZ);
      ui.windowStage.append(node);
      ui.windowTaskbar.append(task);
      ui.emptyWorkspace.hidden = true;

      const client = new RemoteXAppClient({ manager, instance, container:screen, resize:'class', autoReconnect:true, diagnosticsEnabled:true });
      const entry = { id, instance, node, task, client, prompts:null };
      viewerWindows.set(id, entry);
      const report = (text, error = false) => {
        status.textContent = text;
        status.classList.toggle('error', error);
        if (error) message(`${label}: ${text}`, true);
      };
      entry.prompts = installClipboardControls(client, clipboardHost, screen, report);
      installConnectionMaskSwitch(client, clipboardHost);
      installIdleLeaseSwitch(client, clipboardHost, report);
      client.addEventListener('statechange', event => {
        state.textContent = event.detail.state;
        task.textContent = `${label} · ${event.detail.state}`;
      });
      client.addEventListener('diagnostics', event => { diagnostics.textContent = JSON.stringify(event.detail.diagnostics, null, 2); });
      client.addEventListener('error', event => report(event.detail.error.message, true));
      task.onclick = () => activateViewer(entry, { focus:true });
      node.addEventListener('pointerdown', event => {
        if (!event.target.closest('button,select,input')) activateViewer(entry);
      }, true);
      installWindowDrag(entry, title);
      reconnect.onclick = () => client.reconnect().catch(error => report(error.message, true));
      disconnect.onclick = () => client.disconnect();
      diagnosticsToggle.onclick = async () => {
        const visible = diagnostics.hidden;
        diagnostics.hidden = !visible;
        diagnosticsToggle.setAttribute('aria-expanded', String(visible));
        const snapshot = await client.setDiagnosticsEnabled(visible);
        if (visible) diagnostics.textContent = JSON.stringify(snapshot, null, 2);
      };
      stop.onclick = () => run('Runtime stop', async () => { await stopRuntime(instance); await refresh(); }).catch(() => {});
      minimize.onclick = () => {
        node.classList.add('minimized');
        if (activeWindowID === id) activeWindowID = '';
        task.classList.remove('active');
        client.blur();
      };
      close.onclick = () => closeViewer(entry);
      activateViewer(entry);
      try {
        await client.connect();
        report('Connected.');
        activateViewer(entry, { focus:true });
        await refresh();
        return entry;
      } catch (error) {
        report(error.message, true);
        throw error;
      }
    }

  async function stopRuntime(item) {
    if (!confirm(`Gracefully stop ${item.id}?`)) return;
    try {
      await manager.stopInstance(item.id);
    } catch (error) {
      if (!(error instanceof RemoteXAppAPIError) || error.status !== 409 || !confirm(`Graceful stop was blocked. Force ${item.id} and discard unsaved work?`)) throw error;
      await manager.stopInstance(item.id, { force:true });
    }
  }

  async function restartRuntime(item) {
    if (!confirm(`Restart runtime ${item.id} using its locked App version and original launch parameters?`)) return;
    try {
      await manager.restartInstance(item.id, { sessionGeneration:item.sessionGeneration });
    } catch (error) {
      if (!(error instanceof RemoteXAppAPIError) || error.status !== 409 || !confirm(`Graceful restart was blocked. Force restart ${item.id} and discard unsaved work?`)) throw error;
      const current = await manager.getInstance(item.id);
      await manager.restartInstance(item.id, { sessionGeneration:current.sessionGeneration, force:true });
    }
  }

  async function upgradeRuntime(item) {
    const versions = item.versions;
    if (!versions?.eligible) throw new Error(versions?.reason || 'Upgrade is unavailable');
    if (!confirm(`Upgrade ${item.id}?\nFrom: ${runtimeVersionLabel(versions.current)}\nTo: ${runtimeVersionLabel(versions.available)}\nThe application will close. Unsaved work may be lost; persistent data is retained. On-demand applications wait for a Viewer before becoming ready.`)) return;
    const options = { sessionGeneration:item.sessionGeneration, targetRevision:versions.targetRevision };
    try {
      await manager.upgradeAndRestartInstance(item.id, options);
    } catch (error) {
      if (!(error instanceof RemoteXAppAPIError) || error.body?.code !== 'shutdown-blocked' || !confirm(`Shutdown blocked. Force upgrade ${item.id} and discard unsaved work?`)) throw error;
      // Keep the exact confirmed generation and target, even on a force retry.
      await manager.upgradeAndRestartInstance(item.id, { ...options, force:true });
    }
  }

  function upgradeButton(item) {
    return element('button', { className:'warn', text:'Upgrade and restart',
      disabled:item.versions?.eligible ? null : '', title:item.versions?.reason || 'Apply the selected local release',
      onclick:() => run('Runtime upgrade', async () => { try { await upgradeRuntime(item); } finally { await refresh(); } }).catch(() => {}),
    });
  }

  async function stopManaged(item) {
    if (!confirm(`Stop managed application ${item.id}?`)) return;
    try {
      await manager.setManagedInstanceState(item.id, 'stopped');
    } catch (error) {
      if (!(error instanceof RemoteXAppAPIError) || error.status !== 409 || !confirm(`Graceful stop was blocked. Force ${item.id} and discard unsaved work?`)) throw error;
      await manager.setManagedInstanceState(item.id, 'stopped', { force:true });
    }
  }

  async function startManagedAndConnect(item) {
    const updated = await manager.setManagedInstanceState(item.id, 'running');
    if (!updated.runtime || (updated.runtime.state !== 'server-ready' && updated.runtime.state !== 'ready')) {
      throw new Error(updated.error || `Managed application ${item.id} did not produce a ready runtime`);
    }
    await openViewer(updated.runtime);
  }

  function renderInstances(items) {
    items = standaloneRuntimes(items);
    ui.instances.replaceChildren();
    if (!items.length) ui.instances.append(element('div', { className:'empty-state', text:'No standalone runtimes.' }));
    for (const item of items.slice().reverse()) {
      const title = element('div', { className:'card-title' }, element('span', { text:item.templateId || item.classId }), element('span', { className:'chip', text:`${item.state}/${item.sessionState}` }));
      const status = item.applicationStatus;
      const meta = element('div', { className:'meta', text:`${item.id}\ndriver ${item.driverVersion} · ${item.display} · ${item.attachedClients} clients\nprofile ${item.profileRef} · generation ${item.sessionGeneration}${status ? `\napp ${status.state} r${status.revision}${status.summary ? ` · ${status.summary}` : ''}` : ''}${item.error ? `\nERROR: ${item.error}` : ''}` });
      const details = element('pre', { className:'detail-json', text:JSON.stringify({ parameters:item.parameters || {}, resources:item.resources || {}, applicationStatus:item.applicationStatus || null, shutdown:item.shutdown || null }, null, 2) });
      meta.append(element('div', { text:runtimeVersionSummary(item) }));
      const actions = element('div', { className:'actions' }, upgradeButton(item));
      if (connectionsPanel) actions.append(element('button', {text:'Connection info', onclick:() => connectionsPanel.open(item)}));
      if (actionsPanel) actions.append(element('button', {text:'Actions', onclick:() => actionsPanel.open(item)}));
      if (item.state === 'server-ready' || item.state === 'ready') {
        actions.append(
          element('button', { text:'Connect in new window', onclick:() => run('Connect', () => openViewer(item)).catch(() => {}) }),
          element('button', { className:'warn', text:'Restart (current version)', onclick:() => run('Runtime restart', async () => { await restartRuntime(item); await refresh(); }).catch(() => {}) }),
          element('button', { className:'danger', text:'Stop', onclick:() => run('Runtime stop', async () => { await stopRuntime(item); await refresh(); }).catch(() => {}) }),
        );
      }
      ui.instances.append(element('article', { className:`card ${hasViewer(item.id) ? 'selected' : ''}`, 'data-runtime-kind':'standalone', 'data-runtime-id':item.id }, title, meta, details, actions));
    }
  }

  function renderManaged(items) {
    ui.managed.replaceChildren();
    if (!items.length) ui.managed.append(element('div', { className:'empty-state', text:'No managed applications.' }));
    for (const item of items) {
      const actions = element('div', { className:'actions' });
      if (connectionsPanel) actions.append(element('button', {text:'Connection info', onclick:() => connectionsPanel.open(item.runtime || null)}));
      if (actionsPanel) actions.append(element('button', {text:'Actions', onclick:() => actionsPanel.open(item.runtime || null)}));
      const primary = managedPrimaryAction(item);
      if (primary.kind === 'connect') {
        actions.append(element('button', { text:`${primary.label} in new window`, onclick:() => run('Connect', () => openViewer(item.runtime)).catch(() => {}) }));
      } else if (primary.kind === 'start-and-connect') {
        actions.append(element('button', { className:'primary', text:`${primary.label} in new window`, onclick:() => run('Start and connect', () => startManagedAndConnect(item)).catch(() => {}) }));
      } else {
        actions.append(element('button', { text:primary.label, disabled:'' }));
      }
      if (item.runtime && (item.runtime.state === 'server-ready' || item.runtime.state === 'ready')) {
        actions.append(element('button', { className:'warn', text:'Restart (current version)', onclick:() => run('Runtime restart', async () => { await restartRuntime(item.runtime); await refresh(); }).catch(() => {}) }));
      }
      if (item.runtime) actions.append(upgradeButton(item.runtime));
      if (item.desiredState === 'running') {
        actions.append(element('button', { className:'danger', text:'Stop managed application', onclick:() => run('Managed application stop', async () => { await stopManaged(item); await refresh(); }).catch(() => {}) }));
      } else if (item.observedState === 'shutdown-blocked' && item.runtime) {
        actions.append(element('button', { className:'danger', text:'Force stop', onclick:() => {
          if (confirm(`Force stop ${item.id} and discard unsaved work?`)) run('Force stop', async () => { await manager.setManagedInstanceState(item.id, 'stopped', { force:true }); await refresh(); }).catch(() => {});
        } }));
      }
      actions.append(element('button', { className:'danger', text:'Remove managed application', onclick:() => {
        if (confirm(`Remove managed application ${item.id}? Its persistent profile will be preserved.`)) run('Remove managed application', async () => { await manager.deleteManagedInstance(item.id); await refresh(); }).catch(() => {});
      } }));
      const runtime = item.runtime;
      const runtimeDetails = runtime
        ? element('details', {}, element('summary', { text:'Runtime details' }),
          element('div', { className:'meta', text:`${runtime.id}\ndriver ${runtime.driverVersion} · ${runtime.display} · ${runtime.attachedClients} clients\ngeneration ${runtime.sessionGeneration} · session ${runtime.sessionState}` }),
          element('pre', { className:'detail-json', text:JSON.stringify({ parameters:runtime.parameters || {}, resources:runtime.resources || {}, applicationStatus:runtime.applicationStatus || null, shutdown:runtime.shutdown || null }, null, 2) }))
        : element('details', {}, element('summary', { text:'Runtime details' }), element('div', { className:'meta', text:'No active runtime.' }));
      ui.managed.append(element('article', { className:`card ${runtime && hasViewer(runtime.id) ? 'selected' : ''}`, 'data-managed-id':item.id, 'data-runtime-id':runtime?.id || '' },
        element('div', { className:'card-title' }, element('span', { text:item.id }), element('span', { className:'chip', text:`${item.desiredState}/${item.observedState}` })),
        element('div', { className:'meta', text:`${item.templateId} · profile ${item.profileRef}\ndriver ${item.appliedDriverVersion || 'not applied'} (available ${item.availableDriverVersion || 'none'}) · ${item.updateStatus}${item.error ? `\nERROR: ${item.error}` : ''}` }),
        element('div', { className:'meta', text:runtimeVersionSummary(runtime, item.availableVersion) }),
        runtimeDetails,
        actions,
      ));
    }
  }

  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      const [version, health, newTemplates, managed, instances] = await Promise.all([
        manager.getVersion(), manager.getHealth(), manager.listTemplates({ refresh:true }),
        consoleMode === 'operator' ? manager.listManagedInstances() : Promise.resolve([]), manager.listInstances(),
      ]);
      templates = newTemplates;
      connectionsPanel?.observe(instances);
      actionsPanel?.observe(instances);
      const selected = ui.template.value;
      ui.template.replaceChildren(...templates.map(item => element('option', { value:item.id, text:`${item.name} (${item.id})` })));
      if (templates.some(item => item.id === selected)) ui.template.value = selected;
      if (renderedTemplateID !== ui.template.value) renderTemplate();
      renderManaged(managed);
      renderInstances(instances);
      ui.health.textContent = `${version.version} · SDK ${SDK_VERSION} · ${health.activeInstances} active · ${health.attachedClients} clients`;
      ui.health.className = 'health ok';
      ui.serviceRestart.hidden = consoleMode !== 'operator' || !version.capabilities?.serviceRestart;
    } catch (error) {
      ui.health.textContent = `Manager unavailable · ${error.message}`;
      connectionsPanel?.invalidate();
      actionsPanel?.invalidate();
      ui.health.className = 'health error';
      throw error;
    } finally {
      refreshing = false;
    }
  }

  ui.template.onchange = renderTemplate;
  ui.refresh.onclick = () => run('Refresh', refresh).catch(() => {});
  const collectOpenOptions = () => ({ templateId:ui.template.value, profileRef:ui.profile.value, parameters:collectParameters(), overrides:collectOverrides() });
  ui.open.onclick = () => run('Open and connect', async () => {
    const instance = await manager.createInstance(collectOpenOptions());
    await openViewer(instance);
  }).catch(() => {});
  if (ui.createManaged) ui.createManaged.onclick = () => run('Create managed application and connect', async () => {
    if (!ui.managedID.reportValidity() || !ui.managedID.value) throw new Error('Managed name is required');
    const registration = await manager.createManagedInstance({ id:ui.managedID.value, desiredState:'running', ...collectOpenOptions() });
    const instance = registration.runtime;
    if (!instance) throw new Error(registration.error || 'Managed runtime was not created');
    await openViewer(instance);
  }).catch(() => {});
  ui.workspace.addEventListener('keydown', event => {
    if (!event.ctrlKey || event.key !== 'F6' || !viewerWindows.size) return;
    event.preventDefault();
    const entries = [...viewerWindows.values()];
    const current = entries.findIndex(entry => entry.id === activeWindowID);
    activateViewer(entries[(current + 1) % entries.length], { focus:true });
  });
  ui.serviceRestart.onclick = () => {
    if (!confirm('Restart only the RemoteXApp manager user service? Application runtimes stay pinned and browser channels will reconnect.')) return;
    run('Manager service restart', async () => {
      const operation = await manager.restartManagerService();
      message(`Manager restart ${operation.id} accepted; waiting for recovery…`);
      await manager.waitForOperatorOperation(operation.id);
      await refresh();
    }).catch(() => {});
  };
  await refresh().catch(error => message(error.message, true));
  setInterval(() => { if (!document.hidden) refresh().catch(() => {}); }, 3000);
  window.remoteXApp = {
    manager,
    get client() { return viewerWindows.get(activeWindowID)?.client || null; },
    get clients() { return [...viewerWindows.values()].map(entry => entry.client); },
    get windows() { return [...viewerWindows.values()].map(entry => ({ id:entry.id, runtimeId:entry.instance.id })); },
    openViewer,
    refresh,
  };
}
