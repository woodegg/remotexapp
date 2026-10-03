// A local observer, not a global runtime census or a keepalive owner.
export function coordinatorRows(snapshot) {
  return snapshot.runtimes.map(runtime => [
    `${runtime.instanceId} · generation ${runtime.sessionGeneration ?? 'pending'}`,
    runtime.leaderId ? `${runtime.isLeader ? 'This Tab' : 'Other Tab'} · ${runtime.leaderId}` : 'No eligible leader',
    `${runtime.localHandles} local / ${runtime.remoteInterests} remote`,
    runtime.keepAlive ? 'On' : 'Observe only',
    runtime.instance ? `${runtime.instance.state} / ${runtime.instance.sessionState}` : 'Waiting for status',
    runtime.lease ? `${runtime.lease.outcome}${runtime.lease.expiresAt ? ` · server expiry ${runtime.lease.expiresAt}` : ' · no timed deadline'}` : 'No receipt observed',
    runtime.isLeader && runtime.keepAlive ? (runtime.inFlight ? 'Request in flight' : `In ${Math.ceil(runtime.nextRenewalInMs / 1000)}s`) : '—',
  ]);
}

export function createCoordinatorPanel(getCoordinator, doc = document) {
  const node = (tag, text) => {
    const result = doc.createElement(tag);
    if (text !== undefined) result.textContent = text;
    return result;
  };
  const panel = node('section');
  panel.className = 'coordinator-panel';
  panel.setAttribute('aria-label', 'Runtime Coordinator');
  panel.hidden = true;
  const style = node('style', `
    .coordinator-panel{position:fixed;z-index:2147483000;right:12px;bottom:12px;width:min(1100px,calc(100vw - 24px));max-height:65vh;overflow:auto;padding:16px;background:#132235;color:#e7f0fa;border:1px solid #6592b2;border-radius:12px;box-shadow:0 12px 40px #0009;font:13px system-ui,sans-serif}
    .coordinator-panel[hidden]{display:none}.coordinator-panel header{display:flex;align-items:center;gap:12px}.coordinator-panel h2{margin:0 auto 0 0;font-size:18px}.coordinator-panel h3{font-size:14px;margin:16px 0 8px}.coordinator-panel p{overflow-wrap:anywhere}.coordinator-panel table{border-collapse:collapse;width:100%;font-size:12px}.coordinator-panel td,.coordinator-panel th{padding:8px;text-align:left;vertical-align:top;border-bottom:1px solid #405570;overflow-wrap:anywhere;min-width:90px}.coordinator-panel .table-scroll{overflow:auto}.coordinator-panel pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}.coordinator-panel button{padding:6px 10px}
  `);
  const header = node('header');
  const refresh = node('button', 'Refresh'), close = node('button', 'Close');
  refresh.type = close.type = 'button';
  header.append(node('h2', 'Runtime Coordinator'), refresh, close);
  const body = node('div');
  panel.append(style, header, body);
  doc.body.append(panel);
  let timer = null, returnFocus = null;
  const render = () => {
    const state = getCoordinator().getDiagnostics();
    body.replaceChildren();
    body.append(node('p', `${state.mode} · ${state.destroyed ? 'Destroyed' : 'Active'} · ${state.localHandles} local handles · ${state.peers.length} observed Tabs`),
      node('p', `This Tab: ${state.ownerId} · Server: ${state.serverKey} · Scope: ${state.scope}`),
      node('p', `Refreshes every second. Heartbeat ${state.policy.heartbeatMs / 1000}s; leader timeout ${state.policy.leaderTimeoutMs / 1000}s; silent interests retained ${state.policy.interestRetentionMs / 1000}s. This is a local observation, not a global census. Silent does not mean closed. All Tabs suspended: keepalive is not guaranteed.`),
      node('h3', 'Runtime interests'));
    if (!state.runtimes.length) body.append(node('p', 'No runtime interests observed. Enable “Keep running while disconnected” in a Viewer to test. Opening this panel does not keep apps alive.'));
    else {
      const wrap = node('div'); wrap.className = 'table-scroll';
      const table = node('table'), head = node('thead'), heading = node('tr'), rows = node('tbody');
      for (const title of ['Runtime', 'Renewal leader', 'Handles', 'Keepalive', 'State', 'Last lease receipt', 'Next local renewal']) heading.append(node('th', title));
      head.append(heading);
      for (const values of coordinatorRows(state)) {
        const row = node('tr');
        for (const value of values) row.append(node('td', value));
        rows.append(row);
      }
      table.append(head, rows); wrap.append(table); body.append(wrap);
    }
    body.append(node('h3', 'Observed peer Tabs'));
    for (const peer of state.peers) body.append(node('p', `${peer.ownerId} · last seen ${Math.floor(peer.ageMs / 1000)}s ago · ${peer.interests} interests · ${peer.eligible ? 'eligible leader' : peer.retained ? 'silent; interests retained' : 'expired; awaiting cleanup'}`));
    if (!state.peers.length) body.append(node('p', 'No peer Tabs observed in this server/login scope.'));
    body.append(node('h3', 'Recent events (latest first, at most 100; this page only)'));
    const events = node('pre', [...state.events].reverse().map(event => {
      const { time, type, ...details } = event;
      return `${time} ${type} ${JSON.stringify(details)}`;
    }).join('\n') || 'No events yet.');
    body.append(events);
  };
  const hide = () => {
    panel.hidden = true; clearInterval(timer); timer = null;
    returnFocus?.focus();
  };
  close.addEventListener('click', hide);
  refresh.addEventListener('click', render);
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); hide(); } });
  doc.defaultView?.addEventListener('pagehide', () => { clearInterval(timer); timer = null; });
  doc.defaultView?.addEventListener('pageshow', () => { if (!panel.hidden && timer === null) { render(); timer = setInterval(render, 1000); } });
  return { open() {
    if (panel.hidden) returnFocus = doc.activeElement;
    panel.hidden = false; render();
    if (timer === null) timer = setInterval(render, 1000);
    close.focus();
  }, close:hide };
}
