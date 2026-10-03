// Shared by the Manager and bound Client before disconnecting a Viewer.
export function validateRuntimeUpgrade(sessionGeneration, targetRevision) {
  if (!Number.isSafeInteger(sessionGeneration) || sessionGeneration < 0) throw new RangeError('sessionGeneration must be a non-negative safe integer');
  if (typeof targetRevision !== 'string' || !/^[a-f0-9]{64}$/.test(targetRevision)) throw new TypeError('targetRevision must be the server-provided SHA-256 revision');
}

/** Error returned by the RemoteXApp manager API. */
export class RemoteXAppAPIError extends Error {
  constructor(message, { status = 0, body = null, cause } = {}) {
    super(message, { cause });
    this.name = 'RemoteXAppAPIError';
    this.status = status;
    this.body = body;
  }
}

/** Control-plane client for class discovery and instance lifecycle. */
export function inferServiceBaseURL(moduleURL) {
  try {
    const url = new URL(moduleURL);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    for (const marker of ['/assets/', '/sdk/']) {
      const index = url.pathname.lastIndexOf(marker);
      if (index >= 0) return url.pathname.slice(0, index);
    }
  } catch (_) {}
  return '';
}

const inferredBaseURL = inferServiceBaseURL(import.meta.url);

export class RemoteXAppManager extends EventTarget {
  async getActions(instanceId, { signal } = {}) {
    const value = await this.request(`/api/instances/${encodeURIComponent(instanceId)}/actions`, { signal });
    if (value?.instanceId !== instanceId || !Number.isSafeInteger(value.sessionGeneration) || value.sessionGeneration < 0 || !value.actions || typeof value.actions !== 'object' || Array.isArray(value.actions)) throw new RemoteXAppAPIError('Invalid action capabilities', { status:409 });
    return value;
  }

  async invokeAction(instanceId, action, parameters, { sessionGeneration, signal } = {}) {
    if (typeof action !== 'string' || !/^[a-z][A-Za-z0-9]{0,63}$/.test(action)) throw new TypeError('Invalid action name');
    if (!Number.isSafeInteger(sessionGeneration) || sessionGeneration < 1) throw new RangeError('sessionGeneration must be positive');
    if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) throw new TypeError('parameters must be an object');
    const value = await this.request(`/api/instances/${encodeURIComponent(instanceId)}/actions/${encodeURIComponent(action)}`, { method:'POST', body:{ sessionGeneration, parameters }, signal });
    if (value?.instanceId !== instanceId || value.sessionGeneration !== sessionGeneration || value.action !== action || !value.result || typeof value.result !== 'object' || Array.isArray(value.result)) throw new RemoteXAppAPIError('Invalid or stale action result; outcome unknown', { status:409 });
    return value;
  }
  constructor({ baseURL = inferredBaseURL, fetchImpl = globalThis.fetch?.bind(globalThis) } = {}) {
    super();
    if (!fetchImpl) throw new TypeError('fetch is required');
    this.baseURL = String(baseURL).replace(/\/+$/, '');
    this.fetchImpl = fetchImpl;
    this.classCache = null;
  }

  url(path) {
    if (/^https?:\/\//.test(path)) return path;
    return `${this.baseURL}${path.startsWith('/') ? path : `/${path}`}`;
  }

  async request(path, { method = 'GET', body, signal, headers } = {}) {
    let response;
    try {
      response = await this.fetchImpl(this.url(path), {
        method,
        signal,
        cache: 'no-store',
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(headers || {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (cause) {
      throw new RemoteXAppAPIError(`Manager request failed: ${cause.message}`, { cause });
    }
    const text = await response.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); } catch (_) { payload = text; }
    }
    if (!response.ok) {
      const message = payload?.error || `Manager returned HTTP ${response.status}`;
      throw new RemoteXAppAPIError(message, { status: response.status, body: payload });
    }
    return payload;
  }

  async requestRaw(path, { method = 'GET', body, signal, headers } = {}) {
    let response;
    try {
      response = await this.fetchImpl(this.url(path), {
        method, body, signal, cache:'no-store', headers:headers || {},
      });
    } catch (cause) {
      throw new RemoteXAppAPIError(`Manager request failed: ${cause.message}`, { cause });
    }
    if (!response.ok) {
      const text = await response.text();
      let payload = text;
      try { payload = text ? JSON.parse(text) : null; } catch (_) {}
      throw new RemoteXAppAPIError(payload?.error || `Manager returned HTTP ${response.status}`, {
        status:response.status, body:payload,
      });
    }
    return response;
  }

  async listClasses({ refresh = false, signal } = {}) {
    if (!refresh && this.classCache) return this.classCache.map(item => structuredClone(item));
    const classes = await this.request('/api/classes', { signal });
    this.classCache = classes;
    this.dispatchEvent(new CustomEvent('classeschange', { detail: { classes } }));
    return classes.map(item => structuredClone(item));
  }

  getVersion({ signal } = {}) {
    return this.request('/api/version', { signal });
  }

  getHealth({ signal } = {}) {
    return this.request('/healthz', { signal });
  }

  async getClass(classId, options) {
    const classes = await this.listClasses(options);
    return classes.find(item => item.id === classId) || null;
  }

  /** Preferred template terminology; listClasses remains a compatibility alias. */
  async listTemplates({ refresh = false, signal } = {}) {
    if (!refresh && this.classCache) return this.classCache.map(item => structuredClone(item));
    const templates = await this.request('/api/templates', { signal });
    this.classCache = templates;
    this.dispatchEvent(new CustomEvent('classeschange', { detail: { classes: templates } }));
    return templates.map(item => structuredClone(item));
  }

  async getTemplate(templateId, options) {
    const templates = await this.listTemplates(options);
    return templates.find(item => item.id === templateId) || null;
  }

  async listInstances({ classId, states, signal } = {}) {
    let instances = await this.request('/api/instances', { signal });
    if (classId) instances = instances.filter(item => item.classId === classId);
    if (states) {
      const allowed = new Set(Array.isArray(states) ? states : [states]);
      instances = instances.filter(item => allowed.has(item.state));
    }
    return instances;
  }

  getInstance(instanceId, { signal } = {}) {
    return this.request(`/api/instances/${encodeURIComponent(instanceId)}`, { signal });
  }

  async renewIdleLease(instanceId, { sessionGeneration, signal } = {}) {
    if (!Number.isSafeInteger(sessionGeneration) || sessionGeneration < 0) throw new RangeError('sessionGeneration must be a non-negative safe integer');
    const value = await this.request(`/api/instances/${encodeURIComponent(instanceId)}/idle-lease`, {
      method:'POST', body:{ sessionGeneration }, signal,
    });
    if (value?.instanceId !== instanceId || value.sessionGeneration !== sessionGeneration ||
        !['renewed','attached','kept'].includes(value.outcome) ||
        !['keep','stop-session','stop-instance'].includes(value.idleAction) ||
        !Number.isSafeInteger(value.idleTimeoutMs) || value.idleTimeoutMs < 1000 ||
        !Number.isFinite(Date.parse(value.serverTime)) ||
        (value.outcome === 'renewed' ? !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.parse(value.serverTime) : value.expiresAt !== null)) {
      throw new RemoteXAppAPIError('Invalid idle lease response; renewal outcome unknown', { status:502 });
    }
    return value;
  }

  async getConnections(instanceId, { sessionGeneration, signal } = {}) {
    if (sessionGeneration !== undefined && (!Number.isSafeInteger(sessionGeneration) || sessionGeneration < 1)) {
      throw new RangeError('sessionGeneration must be a positive safe integer');
    }
    const query = sessionGeneration === undefined ? '' : `?sessionGeneration=${sessionGeneration}`;
    const result = await this.request(`/api/instances/${encodeURIComponent(instanceId)}/connections${query}`, {
      signal,
    });
    if (result?.schemaVersion !== 1 || result.instanceId !== instanceId || result.state !== 'ready' ||
        !Number.isSafeInteger(result.sessionGeneration) || result.sessionGeneration < 1 ||
        typeof result.revision !== 'string' || !result.revision ||
        (sessionGeneration !== undefined && result.sessionGeneration !== sessionGeneration)) {
      throw new RemoteXAppAPIError('Invalid or stale connection descriptor', { status: 409 });
    }
    const ibus = result.environment?.ibus;
    const reasons = result.unavailableReasons;
    if ((ibus !== undefined && (!ibus || typeof ibus.address !== 'string' || !ibus.address.startsWith('unix:path=/') || /[;\r\n\0]/.test(ibus.address) || ibus.scope !== 'runtime')) ||
        (reasons !== undefined && (!reasons || typeof reasons !== 'object' || Array.isArray(reasons))) ||
        (reasons?.ibus !== undefined && (!['metadata-missing', 'not-enabled', 'not-running'].includes(reasons.ibus) || !Array.isArray(result.unavailable) || !result.unavailable.includes('ibus') || ibus !== undefined))) {
      throw new RemoteXAppAPIError('Invalid IBus connection descriptor', { status:409 });
    }
    return result;
  }

  getApplicationStatus(instanceId, { signal } = {}) {
    return this.request(`/api/instances/${encodeURIComponent(instanceId)}/status`, { signal });
  }

  getApplicationEnvironment(instanceId, { sessionGeneration, signal } = {}) {
    if (!Number.isInteger(sessionGeneration) || sessionGeneration < 1) {
      throw new RangeError('sessionGeneration must be a positive integer');
    }
    return this.request(`/api/instances/${encodeURIComponent(instanceId)}/status/environment`, {
      method: 'POST', body: { sessionGeneration }, signal,
    });
  }

  async waitForApplicationState(instanceId, states, { generation, timeout = 30000, interval = 500, signal } = {}) {
    const allowed = new Set(Array.isArray(states) ? states : [states]);
    if (!allowed.size) throw new TypeError('at least one application state is required');
    const deadline = Date.now() + timeout;
    while (true) {
      if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
      const status = await this.getApplicationStatus(instanceId, { signal });
      if ((generation === undefined || status.generation >= generation) && allowed.has(status.state)) return status;
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for application state: ${[...allowed].join(', ')}`);
      await new Promise((resolve, reject) => {
		const onAbort = () => { clearTimeout(timer); reject(signal.reason || new DOMException('Aborted', 'AbortError')); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, interval);
        signal?.addEventListener('abort', onAbort, { once:true });
      });
    }
  }

  createInstance({ templateId, classId, profileRef, parameters, overrides, signal } = {}) {
    const selectedTemplate = templateId || classId;
    if (!selectedTemplate) throw new TypeError('templateId is required');
    const body = { templateId: selectedTemplate };
    if (profileRef) body.profileRef = profileRef;
    if (parameters) body.parameters = parameters;
    if (overrides) body.overrides = overrides;
    return this.request('/api/instances', { method: 'POST', body, signal });
  }

  launch(options) {
    return this.createInstance(options);
  }

  attachInstance(instanceId, { signal } = {}) {
    return this.request(`/api/instances/${encodeURIComponent(instanceId)}/attach`, { method: 'POST', signal });
  }

  stopInstance(instanceId, { force = false, signal } = {}) {
    return this.request(`/api/instances/${encodeURIComponent(instanceId)}/stop`, {
      method: 'POST', body: force ? { force:true } : undefined, signal,
    });
  }

  restartInstance(instanceId, { sessionGeneration, force = false, signal } = {}) {
    if (!Number.isInteger(sessionGeneration) || sessionGeneration < 0) {
      throw new RangeError('sessionGeneration must be a non-negative integer');
    }
    return this.request(`/api/instances/${encodeURIComponent(instanceId)}/restart`, {
      method: 'POST', body: { sessionGeneration, ...(force ? { force:true } : {}) }, signal,
    });
  }

  getRuntimeVersions(instanceId, { signal } = {}) {
    return this.request(`/api/instances/${encodeURIComponent(instanceId)}/upgrade-and-restart`, { signal });
  }

  upgradeAndRestartInstance(instanceId, { sessionGeneration, targetRevision, force = false, signal } = {}) {
    validateRuntimeUpgrade(sessionGeneration, targetRevision);
    // Never retry a lifecycle mutation after an ambiguous network failure.
    return this.request(`/api/instances/${encodeURIComponent(instanceId)}/upgrade-and-restart`, {
      method:'POST', body:{ sessionGeneration, targetRevision, ...(force ? { force:true } : {}) }, signal,
    });
  }

  restartManagerService({ signal } = {}) {
    return this.request('/api/operator/service/restart', {
      method: 'POST', body: {}, headers: { 'X-RemoteXApp-Operator-Request':'console-v1' }, signal,
    });
  }

  getClipboardCapabilities(instanceId, { sessionGeneration, signal } = {}) {
    return this.request(`/api/instances/${encodeURIComponent(instanceId)}/clipboard/capabilities`, {
      signal, headers:clipboardHeaders({ sessionGeneration }),
    });
  }

  listClipboardOffers(instanceId, { sessionGeneration, signal } = {}) {
    return this.request(`/api/instances/${encodeURIComponent(instanceId)}/clipboard/offers`, {
      signal, headers:clipboardHeaders({ sessionGeneration }),
    });
  }

  getClipboardOffer(instanceId, offerId, { sessionGeneration, signal } = {}) {
    return this.request(`/api/instances/${encodeURIComponent(instanceId)}/clipboard/offers/${encodeURIComponent(offerId)}`, {
      signal, headers:clipboardHeaders({ sessionGeneration }),
    });
  }

  async sendClipboardOffer(instanceId, { sessionGeneration, viewerId, action = 'set', items, expectedSequence, signal } = {}) {
    if (action !== 'set' && action !== 'paste') throw new TypeError('clipboard action must be set or paste');
    if (!viewerId) throw new TypeError('viewerId is required');
    const form = new FormData();
    for (const item of normalizeClipboardItems(items)) {
      form.append('item', new Blob([item.data], { type:item.type }));
    }
    const response = await this.requestRaw(`/api/instances/${encodeURIComponent(instanceId)}/clipboard/offers`, {
      method:'POST', body:form, signal,
      headers:clipboardHeaders({ sessionGeneration, viewerId, action, expectedSequence }),
    });
    return response.json();
  }

  async acceptClipboardOffer(instanceId, offerId, { sessionGeneration, signal } = {}) {
    const response = await this.requestRaw(`/api/instances/${encodeURIComponent(instanceId)}/clipboard/offers/${encodeURIComponent(offerId)}/accept`, {
      method:'POST', signal, headers:clipboardHeaders({ sessionGeneration }),
    });
    const form = await response.formData();
    const items = [];
    for (const value of form.getAll('item')) {
      if (value instanceof Blob) items.push({ type:value.type, data:await value.arrayBuffer() });
    }
    return { offerId:response.headers.get('X-RemoteXApp-Clipboard-Offer-ID') || offerId, items };
  }

  cancelClipboardOffer(instanceId, offerId, { sessionGeneration, viewerId, signal } = {}) {
    return this.request(`/api/instances/${encodeURIComponent(instanceId)}/clipboard/offers/${encodeURIComponent(offerId)}`, {
      method:'DELETE', signal, headers:clipboardHeaders({ sessionGeneration, viewerId }),
    });
  }

  getOperatorOperation(operationId, { signal } = {}) {
    if (!/^operator-[a-f0-9]{24}$/.test(operationId)) throw new TypeError('invalid operator operation ID');
    return this.request(`/api/operator/operations/${operationId}`, { signal });
  }

  async waitForOperatorOperation(operationId, { timeout = 90000, interval = 500, signal } = {}) {
    const deadline = Date.now() + timeout;
    let lastError = null;
    while (Date.now() < deadline) {
      if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
      try {
        const operation = await this.getOperatorOperation(operationId, { signal });
        if (operation.state === 'succeeded') return operation;
        if (operation.state === 'failed') throw new RemoteXAppAPIError(operation.error || 'Manager service restart failed', { body:operation });
        lastError = null;
      } catch (error) {
        if (error instanceof RemoteXAppAPIError && error.body?.state === 'failed') throw error;
        lastError = error;
      }
      await new Promise((resolve, reject) => {
        const onAbort = () => { clearTimeout(timer); reject(signal.reason || new DOMException('Aborted', 'AbortError')); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, interval);
        signal?.addEventListener('abort', onAbort, { once:true });
      });
    }
    throw new RemoteXAppAPIError(`Timed out waiting for operator operation${lastError ? `: ${lastError.message}` : ''}`);
  }

  listManagedInstances({ signal } = {}) {
    return this.request('/api/managed-instances', { signal });
  }

  getManagedInstance(id, { signal } = {}) {
    return this.request(`/api/managed-instances/${encodeURIComponent(id)}`, { signal });
  }

  createManagedInstance({ id, templateId, desiredState = 'running', profileRef, parameters, overrides, signal } = {}) {
    if (!id || !templateId) throw new TypeError('id and templateId are required');
    const body = { id, templateId, desiredState };
    if (profileRef) body.profileRef = profileRef;
    if (parameters) body.parameters = parameters;
    if (overrides) body.overrides = overrides;
    return this.request('/api/managed-instances', { method: 'POST', body, signal });
  }

  setManagedInstanceState(id, desiredState, { force = false, signal } = {}) {
    return this.request(`/api/managed-instances/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: { desiredState, ...(force ? { force:true } : {}) }, signal,
    });
  }

  deleteManagedInstance(id, { purge = false, signal } = {}) {
    const suffix = purge ? '?purge=true' : '';
    return this.request(`/api/managed-instances/${encodeURIComponent(id)}${suffix}`, { method: 'DELETE', signal });
  }

  viewerURL(instance) {
    const path = typeof instance === 'string'
      ? `/remotexapps/${encodeURIComponent(instance)}/kiosk.html`
      : instance.viewerUrl || `/remotexapps/${encodeURIComponent(instance.id)}/kiosk.html`;
    return this.url(path);
  }

  async waitForState(instanceId, states, { timeout = 30000, interval = 500, signal } = {}) {
    const accepted = new Set(Array.isArray(states) ? states : [states]);
    const started = Date.now();
    while (true) {
      if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
      const instance = await this.getInstance(instanceId, { signal });
      if (accepted.has(instance.state)) return instance;
      if (instance.state === 'failed') throw new RemoteXAppAPIError(instance.error || 'Instance failed', { body: instance });
      if (Date.now() - started >= timeout) throw new RemoteXAppAPIError(`Timed out waiting for ${[...accepted].join(', ')}`);
      await new Promise((resolve, reject) => {
        const aborted = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', aborted); resolve(); }, interval);
        signal?.addEventListener('abort', aborted, { once: true });
      });
    }
  }

  /** Poll an instance and return a function that stops the watcher. */
  watchInstance(instanceId, { interval = 2000, signal, onChange } = {}) {
    let stopped = false;
    let timer = null;
    let previous = '';
    const stop = () => { stopped = true; if (timer) clearTimeout(timer); };
    signal?.addEventListener('abort', stop, { once: true });
    const poll = async () => {
      if (stopped) return;
      try {
        const instance = await this.getInstance(instanceId, { signal });
        const serialized = JSON.stringify(instance);
        if (serialized !== previous) {
          previous = serialized;
          const detail = { instance };
          this.dispatchEvent(new CustomEvent('instancechange', { detail }));
          onChange?.(instance);
        }
      } catch (error) {
        if (!stopped) this.dispatchEvent(new CustomEvent('error', { detail: { error } }));
      } finally {
        if (!stopped) timer = setTimeout(poll, interval);
      }
    };
    poll();
    return stop;
  }
}

function clipboardHeaders({ sessionGeneration, viewerId, action, expectedSequence } = {}) {
  if (!Number.isInteger(sessionGeneration) || sessionGeneration < 1) {
    throw new RangeError('sessionGeneration must be a positive integer');
  }
  if (expectedSequence !== undefined && (!Number.isSafeInteger(expectedSequence) || expectedSequence < 0)) {
    throw new RangeError('expectedSequence must be a non-negative safe integer');
  }
  return {
    'X-RemoteXApp-Session-Generation':String(sessionGeneration),
    ...(viewerId ? { 'X-RemoteXApp-Viewer-ID':viewerId } : {}),
    ...(action ? { 'X-RemoteXApp-Clipboard-Action':action } : {}),
    ...(expectedSequence !== undefined ? { 'X-RemoteXApp-Clipboard-Sequence':String(expectedSequence) } : {}),
  };
}

function normalizeClipboardItems(items) {
  const values = items instanceof Map ? [...items].map(([type, data]) => ({ type, data })) : Array.from(items || []);
  if (!values.length) throw new TypeError('at least one clipboard item is required');
  return values.map(item => {
    if (!item?.type || item.data === undefined) throw new TypeError('clipboard items require type and data');
    return item;
  });
}
