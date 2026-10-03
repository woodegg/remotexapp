const CLIPBOARD_MODES = new Set(['off', 'manual', 'prompt', 'auto']);
const CLIPBOARD_TYPES = new Set(['text/plain', 'text/html', 'text/rtf', 'image/png']);

/** Bidirectional clipboard policy and transfer surface for one Viewer. */
export class RemoteXAppClipboard extends EventTarget {
  constructor(client) {
    super();
    this.client = client;
    this.viewerId = createViewerID();
    this.config = { toRemote:'off', toLocal:'off', checkOnFocus:true };
    this.pending = new Map();
    this.lastSequence = 0;
    this.remoteGeneration = null;
    this.remoteObserved = false;
    this.lifecycle = 0;
    this.localObservation = 0;
    this.localOfferNumber = 0;
    this.localProcessing = 0;
    this.localFingerprint = '';
    this.localObserved = false;
    this.localWriteFingerprint = '';
    this.localWriteFingerprints = new Set();
    this.localWriteInFlight = null;
    this.capabilities = this._browserCapabilities();
    this.permissions = { read:'unknown', write:'unknown' };
    this.access = browserAccess(this.capabilities, this.permissions);
    this.inputActive = false;
    this.monitoring = false;
    this.reconcileTimer = null;
    this.expiryTimer = null;
    this.listeners = [];
  }

  configure({ toRemote = this.config.toRemote, toLocal = this.config.toLocal, checkOnFocus = this.config.checkOnFocus } = {}) {
    if (!CLIPBOARD_MODES.has(toRemote) || !CLIPBOARD_MODES.has(toLocal)) {
      throw new TypeError('clipboard modes must be off, manual, prompt, or auto');
    }
    if (this.client.viewOnly && (toRemote === 'prompt' || toRemote === 'auto')) toRemote = 'manual';
    const wasMonitoring = this.monitoring;
    this.config = { toRemote, toLocal, checkOnFocus:Boolean(checkOnFocus) };
    this._updateMonitoring();
    if (!wasMonitoring && this.monitoring && this.config.checkOnFocus) {
      this._scheduleReconcile('configuration');
    }
    for (const [id, offer] of this.pending) {
      const mode = offer.direction === 'toRemote' ? toRemote : toLocal;
      if (mode === 'off') this.pending.delete(id);
    }
    const detail = this.snapshot();
    this._emit('statechange', detail);
    return detail;
  }

  snapshot() {
    return {
      viewerId:this.viewerId, config:{ ...this.config }, capabilities:{ ...this.capabilities },
      permissions:{ ...this.permissions }, access:cloneAccess(this.access),
      inputActive:this.inputActive,
      pending:[...this.pending.values()].map(publicOffer),
    };
  }

  /** Internal Client focus handoff; clipboard policy remains independently configured. */
  _setInputActive(value, { reason = 'client-focus', reconcile = true } = {}) {
    const active = Boolean(value);
    if (active === this.inputActive) return this.snapshot();
    this.inputActive = active;
    if (!active) {
      clearTimeout(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    this._updateMonitoring();
    if (active && reconcile && this.monitoring && this.config.checkOnFocus) {
      this._scheduleReconcile(reason);
    }
    const detail = this.snapshot();
    this._emit('statechange', detail);
    return detail;
  }

  async checkAccess() {
    this.capabilities = { ...this.capabilities, ...this._browserCapabilities() };
    [this.permissions.read, this.permissions.write] = await Promise.all([
      queryPermission('clipboard-read'), queryPermission('clipboard-write'),
    ]);
    this.access = browserAccess(this.capabilities, this.permissions);
    if (this.config.toRemote === 'auto' && this.permissions.read !== 'granted') this.config.toRemote = 'prompt';
    if (this.config.toLocal === 'auto' && this.permissions.write !== 'granted') this.config.toLocal = 'prompt';
    this._updateMonitoring();
    this._emit('statechange', this.snapshot());
    return this.snapshot();
  }

  async refreshCapabilities() {
    return this.checkAccess();
  }

  async requestReadAccess() {
    this.capabilities = { ...this.capabilities, ...this._browserCapabilities() };
    this.access = browserAccess(this.capabilities, this.permissions);
    const clipboard = globalThis.navigator?.clipboard;
    let readPromise;
    let outcome;

    if (!this.access.secureContext) {
      outcome = { state:'secure-context-required', verified:false, reason:'secure-context-required' };
    } else if (!this.access.read.supported || !clipboard) {
      outcome = { state:'unsupported', verified:false, reason:'clipboard-read-unsupported' };
    } else if (this.access.focused === false) {
      outcome = { state:'document-not-focused', verified:false, reason:'document-not-focused' };
    } else {
      try {
        // Start the privileged operation before the first await so a direct
        // click/tap activation is not lost. The returned content is discarded.
        readPromise = clipboard.read ? clipboard.read() : clipboard.readText();
        await readPromise;
        outcome = { state:'granted', verified:true };
      } catch (error) {
        outcome = readAccessFailure(error, this.access);
      }
    }

    [this.permissions.read, this.permissions.write] = await Promise.all([
      queryPermission('clipboard-read'), queryPermission('clipboard-write'),
    ]);
    this.access = browserAccess(this.capabilities, this.permissions);
    this.access.read = { ...this.access.read, ...outcome };
    this._emit('statechange', this.snapshot());
    return this.snapshot();
  }

  async list({ baseline = false, recovery = false } = {}) {
    const lifecycle = this.lifecycle;
    const requestedSequence = this.lastSequence;
    const offers = await this.client.manager.listClipboardOffers(this.client.instanceId, { sessionGeneration:this._generation() });
    if (lifecycle !== this.lifecycle) return [];
    const currentRemote = new Set(offers.filter(offer => offer.direction === 'toLocal').map(offer => offer.id));
    let removed = false;
    for (const [id, offer] of this.pending) {
      if (offer.direction === 'toLocal' && offer.sequence <= requestedSequence && !currentRemote.has(id)) {
        this.pending.delete(id);
        removed = true;
      }
    }
    // Recovery is a snapshot, not a replay of every unexpired copy.
    const latest = offers.filter(offer => offer.direction === 'toLocal').sort((a, b) => b.sequence - a.sequence)[0];
    if (latest && !this.pending.has(latest.id)) this._receiveOffer(latest, { recovered:true, baseline:baseline || !recovery });
    this._scheduleExpiry();
    if (removed) this._emit('statechange', this.snapshot());
    return [...this.pending.values()].map(publicOffer);
  }

  async send(items, { action = 'set', expectedSequence } = {}) {
    if (this.client.viewOnly) throw new Error('toRemote clipboard is unavailable in view-only mode');
    if (action !== 'set' && action !== 'paste') throw new TypeError('clipboard action must be set or paste');
    const normalized = normalizeItems(items);
    if (!normalized.length) return { skipped:true, reason:'empty-clipboard' };
    return this.client.manager.sendClipboardOffer(this.client.instanceId, {
      sessionGeneration:this._generation(), viewerId:this.viewerId, action, items:normalized, expectedSequence,
    });
  }

  async syncToRemote({ action = 'set', items } = {}) {
    const content = items ? normalizeItems(items) : await this._readLocalClipboard({ userActivation:true });
    const result = await this.send(content, { action });
    if (result?.skipped) return result;
    // Explicit payload uploads also work outside a secure browser context;
    // they do not establish an observation of that browser's clipboard.
    if (!items) {
      this.localFingerprint = await fingerprint(content);
      this.localObserved = true;
    }
    this._emit('sync', { direction:'toRemote', offer:result });
    return result;
  }

  async syncToLocal(offerId) {
    const offer = this.pending.get(offerId);
    if (!offer || offer.direction !== 'toLocal') throw new Error('toLocal clipboard offer is not pending');
    const lifecycle = this.lifecycle;
    const opposite = this._pendingDirection('toRemote');
    const result = await this.client.manager.acceptClipboardOffer(this.client.instanceId, offerId, {
      sessionGeneration:this._generation(),
    });
    const items = normalizeItems(result.items);
    if (!items.length) {
      this.dismiss(offerId);
      return { skipped:true, reason:'empty-clipboard' };
    }
    const previousWrite = this.localWriteInFlight;
    const operation = Promise.resolve(previousWrite).catch(() => {}).then(async () => {
      this._requirePending(offer, lifecycle);
      const server = await this._remoteSnapshot();
      this._requirePending(offer, lifecycle);
      if (server.sequence !== offer.sequence) {
        this.dismiss(offerId);
        await this.list({ recovery:true });
        throw new Error('Remote clipboard changed. Choose the latest offer.');
      }
      // A failed read is uncertainty, never permission to overwrite a new copy.
      if (offer.localAtOffer !== undefined || this.permissions.read === 'granted') {
        const local = normalizeItems(await this._readLocalClipboard({ userActivation:true }));
        const current = local.length ? await fingerprint(local) : '';
        this._requirePending(offer, lifecycle);
        if (offer.localAtOffer !== undefined && current !== offer.localAtOffer && !this.localWriteFingerprints.has(current)) {
          await this._offerLocal(local, 'accept-revalidation');
          offer.localAtOffer = current;
          throw new Error('Local clipboard changed. Review the directions and choose again.');
        }
      }
      const receipt = await this._writeLocalClipboard(items);
      if (lifecycle === this.lifecycle) await this._rememberLocalWrite(receipt);
      return receipt;
    });
    this.localWriteInFlight = operation;
    let receipt;
    try {
      receipt = await operation;
    } finally {
      if (this.localWriteInFlight === operation) this.localWriteInFlight = null;
    }
    const summary = await summarizeContent(receipt.items);
    if (lifecycle !== this.lifecycle) return { offer:publicOffer(offer), types:receipt.types, summary };
    this.capabilities = { ...this.capabilities, ...this._browserCapabilities() };
    this.access = browserAccess(this.capabilities, this.permissions);
    this.access.write = { ...this.access.write, state:'granted', verified:true };
    this.pending.delete(offerId);
    if (opposite && this.pending.get(opposite.id) === opposite) this.pending.delete(opposite.id);
    this._emit('sync', { direction:'toLocal', offer:publicOffer(offer) });
    this._emit('statechange', this.snapshot());
    return { offer:publicOffer(offer), types:receipt.types, summary };
  }

  // Internal prompt-only read: never publish payloads in offers or state events.
  async _previewOffer(offerId, { signal } = {}) {
    const offer = this.pending.get(offerId);
    const lifecycle = this.lifecycle;
    if (!offer) throw new Error('clipboard offer is not pending');
    this._requirePending(offer, lifecycle);
    let items = offer.items;
    if (offer.direction === 'toLocal') {
      // Despite its historical name, accept retrieves a repeatable, revision-
      // guarded payload only. Browser clipboard writes happen in syncToLocal.
      const result = await this.client.manager.acceptClipboardOffer(this.client.instanceId, offerId, {
        sessionGeneration:offer.generation, signal,
      });
      if (result.offerId !== offerId) throw new Error('clipboard preview offer mismatch');
      items = result.items;
    }
    const normalized = normalizeItems(items || []);
    const summary = await summarizeContent(normalized);
    this._requirePending(offer, lifecycle);
    if (signal?.aborted) throw new Error('clipboard preview cancelled');
    const png = normalized.find(item => item.type === 'image/png');
    const detail = summary.representations.find(item => item.type === 'image/png');
    // Avoid decoding large images merely to decorate a prompt. Transfer limits
    // remain unchanged; oversized previews still show sizes and dimensions.
    const thumbnail = png && detail?.width && detail?.height && detail.bytes <= 16 * 1024 * 1024 && detail.width * detail.height <= 4 * 1024 * 1024
      ? new Blob([png.data], { type:'image/png' }) : null;
    return { summary, thumbnail };
  }

  async cancel(offerId) {
    const result = await this.client.manager.cancelClipboardOffer(this.client.instanceId, offerId, {
      sessionGeneration:this._generation(), viewerId:this.viewerId,
    });
    this.pending.delete(offerId);
    this._emit('statechange', this.snapshot());
    return result;
  }

  dismiss(offerId) {
    const deleted = this.pending.delete(offerId);
    if (deleted) this._emit('statechange', this.snapshot());
    return deleted;
  }

  async approve(offerId, { action = 'set' } = {}) {
    const offer = this.pending.get(offerId);
    if (!offer) throw new Error('clipboard offer is not pending');
    if (offer.direction === 'toRemote') {
      const lifecycle = this.lifecycle;
      const items = normalizeItems(await this._readLocalClipboard({ userActivation:true }));
      const current = items.length ? await fingerprint(items) : '';
      this._requirePending(offer, lifecycle);
      if (current !== offer.fingerprint) {
        this.dismiss(offerId);
        await this._offerLocal(items, 'accept-revalidation');
        throw new Error('Local clipboard changed. Choose the latest offer.');
      }
      const server = await this._remoteSnapshot();
      this._requirePending(offer, lifecycle);
      if (server && offer.remoteAtOffer !== server.sequence) {
        offer.remoteAtOffer = server.sequence;
        await this.list({ recovery:true });
        throw new Error('Remote clipboard changed. Review the directions and choose again.');
      }
      const finalItems = normalizeItems(await this._readLocalClipboard({ userActivation:true }));
      const finalFingerprint = finalItems.length ? await fingerprint(finalItems) : '';
      this._requirePending(offer, lifecycle);
      if (finalFingerprint !== current) {
        this.dismiss(offerId);
        await this._offerLocal(finalItems, 'accept-revalidation');
        throw new Error('Local clipboard changed. Choose the latest offer.');
      }
      const opposite = this._pendingDirection('toLocal');
      const result = await this.send(items, { action, expectedSequence:server?.sequence });
      this.dismiss(offerId);
      if (opposite && this.pending.get(opposite.id) === opposite) this.dismiss(opposite.id);
      return result?.skipped ? result : { ...result, summary:await summarizeContent(items) };
    }
    return this.syncToLocal(offerId);
  }

  async _connected() {
    const lifecycle = ++this.lifecycle;
    const generation = this._generation();
    const identity = `${this.client.instanceId}:${generation}`;
    const first = this.remoteGeneration !== identity;
    if (first) {
      this.remoteGeneration = identity;
      this.remoteObserved = false;
      this.lastSequence = 0;
      this.pending.clear();
    }
    try {
      const server = await this.client.manager.getClipboardCapabilities(this.client.instanceId, {
        sessionGeneration:generation,
      });
      if (lifecycle !== this.lifecycle) return;
      // First observation establishes a baseline; it is not a fresh remote copy.
      if (first && Number.isSafeInteger(server.sequence)) this.lastSequence = Math.max(this.lastSequence, server.sequence);
      this.capabilities = { ...this._browserCapabilities(), server };
      await this.refreshCapabilities();
      if (lifecycle !== this.lifecycle) return;
      if (!first || server.settled !== false) await this.list({ baseline:first, recovery:true });
      if (server.settled !== false) this.remoteObserved = true;
    } catch (error) {
      this._emit('error', { error });
    }
  }

  _disconnected({ reset = false } = {}) {
    this.lifecycle++;
    this.localObservation++;
    clearTimeout(this.reconcileTimer);
    clearTimeout(this.expiryTimer);
    this.reconcileTimer = null;
    this.expiryTimer = null;
    this.pending.clear();
    this.inputActive = false;
    this._updateMonitoring();
    if (reset) {
      this.remoteGeneration = null;
      this.lastSequence = 0;
      this.configure({ toRemote:'off', toLocal:'off', checkOnFocus:true });
    }
    this._emit('statechange', this.snapshot());
  }

  _handleMessage(message) {
    if (message?.type === 'clipboard-invalidated') {
      let generation;
      try { generation = this._generation(); } catch (_) { return true; }
      if (message.generation === generation && Number.isSafeInteger(message.sequence) && message.sequence > this.lastSequence) {
        this.lastSequence = message.sequence;
        this._removeDirection('toLocal');
        this._emit('statechange', this.snapshot());
      }
      return true;
    }
    if (message?.type === 'clipboard-error') {
      let generation;
      try { generation = this._generation(); } catch (_) { return true; }
      if (message.generation === generation && this.config.toLocal !== 'off') {
        this._emit('error', { direction:'toLocal', error:new Error(message.error || 'Remote clipboard read failed') });
      }
      return true;
    }
    if (message?.type !== 'clipboard-offer' || !message.offer) return false;
    const offer = message.offer;
    let generation;
    try { generation = this._generation(); } catch (_) { return true; }
    if (offer.generation !== generation) return true;
    if (this.lastSequence && offer.sequence > this.lastSequence + 1) {
      this.list({ recovery:true }).catch(error => this._emit('error', { error }));
    }
    this._receiveOffer(offer);
    return true;
  }

  _receiveOffer(offer, { recovered = false, baseline = false } = {}) {
    if (!offer?.id || offer.generation !== this._generation() || offer.direction !== 'toLocal') return;
    if (!Number.isSafeInteger(offer.sequence) || (baseline ? offer.sequence < this.lastSequence : offer.sequence <= this.lastSequence)) return;
    baseline = baseline || (offer.baseline === true && !this.remoteObserved);
    this.remoteObserved = true;
    this.lastSequence = Math.max(this.lastSequence, offer.sequence || 0);
    this._removeDirection('toLocal');
    const source = offer.sourceViewerId === this.viewerId;
    const mode = this.config.toLocal === 'off' ? 'off' : baseline ? 'manual' : this.config.toLocal;
    if (mode === 'off' || source) {
      this._emit('statechange', this.snapshot());
      return;
    }
    this.pending.set(offer.id, { ...offer, source, recovered, baseline, localAtOffer:this.localObserved ? this.localFingerprint : undefined });
    this._scheduleExpiry();
    this._emit('offer', { offer:publicOffer(offer), mode, recovered });
    this._emit('statechange', this.snapshot());
    if (mode === 'auto') this._autoApprove(offer.id).catch(error => this._degradeToPrompt('toLocal', error));
  }

  _pendingDirection(direction) {
    return [...this.pending.values()].find(offer => offer.direction === direction);
  }

  _removeDirection(direction) {
    for (const [id, offer] of this.pending) if (offer.direction === direction) this.pending.delete(id);
  }

  _requirePending(offer, lifecycle) {
    if (lifecycle !== this.lifecycle || this.pending.get(offer.id) !== offer ||
        (offer.generation !== undefined && offer.generation !== this._generation()) || Date.parse(offer.expiresAt) <= Date.now()) {
      throw new Error('Clipboard offer expired or was superseded. Choose the latest offer.');
    }
  }

  async _remoteSnapshot() {
    const server = await this.client.manager.getClipboardCapabilities(this.client.instanceId, { sessionGeneration:this._generation() });
    if (server.consistencyVersion !== 1 || !Number.isSafeInteger(server.sequence)) {
      throw new Error('Clipboard consistency requires an upgraded runtime.');
    }
    if (server.settled === false) throw new Error('Remote clipboard is being rechecked. Wait for its current contents before synchronizing.');
    return server;
  }

  async _autoApprove(id) {
    // Reconcile both observed sides before any automatic transfer. Conflicts
    // use the same explicit choice UI as prompt mode, without a clock winner.
    if (await queryPermission('clipboard-read') !== 'granted') throw new Error('Automatic clipboard sync needs readable local state.');
    if (this.pending.get(id)?.direction === 'toLocal' && !this.localObserved) throw new Error('Local clipboard baseline is unknown; choose a direction explicitly.');
    const lifecycle = this.lifecycle;
    const items = normalizeItems(await this._readLocalClipboard({ userActivation:false }));
    if (lifecycle !== this.lifecycle) return;
    await this._offerLocal(items, 'auto-revalidation');
    if (!this.pending.has(id)) return;
    if (this._pendingDirection('toRemote') && this._pendingDirection('toLocal') && !this._pendingDirection('toLocal').baseline) {
      for (const offer of this.pending.values()) this._emit('offer', { offer:publicOffer(offer), mode:'prompt', conflict:true });
      return;
    }
    await this.approve(id);
  }

  _updateMonitoring() {
    const wanted = this.inputActive && (this.config.toRemote === 'prompt' || this.config.toRemote === 'auto');
    if (wanted === this.monitoring) return;
    this.monitoring = wanted;
    for (const remove of this.listeners.splice(0)) remove();
    if (!wanted) {
      clearTimeout(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    if (!wanted || typeof window === 'undefined') return;
    const schedule = event => this._scheduleReconcile(event?.type || 'signal');
    const clipboard = globalThis.navigator?.clipboard;
    if (clipboard?.addEventListener) {
      clipboard.addEventListener('clipboardchange', schedule);
      this.listeners.push(() => clipboard.removeEventListener('clipboardchange', schedule));
    }
    if (this.config.checkOnFocus) {
      window.addEventListener('focus', schedule);
      document.addEventListener('visibilitychange', schedule);
      this.listeners.push(() => window.removeEventListener('focus', schedule));
      this.listeners.push(() => document.removeEventListener('visibilitychange', schedule));
    }
    const capturePaste = event => this._capturePaste(event);
    document.addEventListener('paste', capturePaste, true);
    this.listeners.push(() => document.removeEventListener('paste', capturePaste, true));
  }

  _scheduleReconcile(reason) {
    if (!this.inputActive) return;
    if (reason === 'visibilitychange' && document.hidden) return;
    clearTimeout(this.reconcileTimer);
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = null;
      this._reconcileLocal(reason).catch(error => this._emit('error', { error }));
    }, 120);
  }

  async _reconcileLocal(reason) {
    const observation = ++this.localObservation;
    const lifecycle = this.lifecycle;
    if (!this.inputActive || (this.config.toRemote !== 'prompt' && this.config.toRemote !== 'auto')) return;
    const permission = await queryPermission('clipboard-read');
    if (!this.inputActive || (this.config.toRemote !== 'prompt' && this.config.toRemote !== 'auto')) return;
    this.permissions.read = permission;
    if (permission !== 'granted') {
      if (this.config.toRemote === 'auto') this.config.toRemote = 'prompt';
      this._emit('permissionrequired', { direction:'toRemote', permission:'clipboard-read', reason });
      this._emit('statechange', this.snapshot());
      return;
    }
    await this._waitForLocalWrite();
    if (!this.inputActive || (this.config.toRemote !== 'prompt' && this.config.toRemote !== 'auto')) return;
    const items = await this._readLocalClipboard({ userActivation:false });
    if (observation !== this.localObservation || lifecycle !== this.lifecycle || !this.inputActive) return;
    await this._offerLocal(items, reason);
  }

  async _capturePaste(event) {
    if (!this.inputActive || !event.clipboardData || this.config.toRemote === 'off' || this.config.toRemote === 'manual') return;
    const items = [];
    const plain = event.clipboardData.getData('text/plain');
    const html = event.clipboardData.getData('text/html');
    const rtf = event.clipboardData.getData('text/rtf') || event.clipboardData.getData('application/rtf');
    if (plain) items.push({ type:'text/plain', data:new TextEncoder().encode(plain) });
    if (html) items.push({ type:'text/html', data:new TextEncoder().encode(html) });
    if (rtf) items.push({ type:'text/rtf', data:new TextEncoder().encode(rtf) });
    for (const clipboardItem of event.clipboardData.items || []) {
      if (canonicalType(clipboardItem.type) !== 'image/png') continue;
      const file = clipboardItem.getAsFile?.();
      if (file) items.push({ type:'image/png', data:await file.arrayBuffer() });
      break;
    }
    if (items.length) {
      await this._waitForLocalWrite();
      await this._offerLocal(items, 'paste');
    }
  }

  async _offerLocal(items, reason) {
    if (!this.inputActive || (this.config.toRemote !== 'prompt' && this.config.toRemote !== 'auto')) return;
    const processing = ++this.localProcessing;
    const lifecycle = this.lifecycle;
    items = normalizeItems(items);
    this.localObserved = true;
    if (!items.length) {
      this._removeDirection('toRemote');
      this.localFingerprint = '';
      this.localWriteFingerprints.clear();
      this.localWriteFingerprint = '';
      this._emit('statechange', this.snapshot());
      return;
    }
    const current = await fingerprint(items);
    if (processing !== this.localProcessing || lifecycle !== this.lifecycle) return;
    if (!this.inputActive || (this.config.toRemote !== 'prompt' && this.config.toRemote !== 'auto')) return;
    if (!current || current === this.localFingerprint || this.localWriteFingerprints.has(current)) {
      if (this.localWriteFingerprints.has(current)) this.localFingerprint = current;
      return;
    }
    this.localWriteFingerprints.clear();
    this.localWriteFingerprint = '';
    this.localFingerprint = current;
    this._removeDirection('toRemote');
    const id = `local_${this.viewerId.slice(7)}_${++this.localOfferNumber}`;
    const offer = {
      id, direction:'toRemote', sourceViewerId:this.viewerId, generation:this._generation(),
      types:items.map(item => item.type), totalBytes:items.reduce((sum, item) => sum + byteLength(item.data), 0),
      createdAt:new Date().toISOString(), expiresAt:new Date(Date.now() + 60000).toISOString(), state:'pending', items,
      fingerprint:current, remoteAtOffer:this.lastSequence,
    };
    const remote = this._pendingDirection('toLocal');
    if (remote) remote.localAtOffer = current;
    this.pending.set(id, offer);
    this._scheduleExpiry();
    this._emit('offer', { offer:publicOffer(offer), mode:this.config.toRemote, reason });
    this._emit('statechange', this.snapshot());
    if (this.config.toRemote === 'auto' && reason !== 'auto-revalidation') {
      this._autoApprove(id).catch(error => this._degradeToPrompt('toRemote', error));
    }
  }

  _degradeToPrompt(direction, error) {
    this.config[direction] = 'prompt';
    this._emit('permissionrequired', { direction, error });
    this._emit('error', { error });
    for (const offer of this.pending.values()) {
      if (offer.direction === direction) {
        this._emit('offer', { offer:publicOffer(offer), mode:'prompt', degraded:true });
      }
    }
    this._emit('statechange', this.snapshot());
  }

  _scheduleExpiry() {
    clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    let nearest = Infinity;
    for (const offer of this.pending.values()) {
      const expires = Date.parse(offer.expiresAt || '');
      if (Number.isFinite(expires)) nearest = Math.min(nearest, expires);
    }
    if (Number.isFinite(nearest)) {
      this.expiryTimer = setTimeout(() => {
        this.expiryTimer = null;
        this._expirePending();
        this._scheduleExpiry();
      }, Math.max(0, nearest - Date.now()));
      this.expiryTimer.unref?.();
    }
  }

  _expirePending() {
    const now = Date.now();
    const expired = [];
    for (const [id, offer] of this.pending) {
      const expires = Date.parse(offer.expiresAt || '');
      if (Number.isFinite(expires) && expires <= now) {
        this.pending.delete(id);
        expired.push(publicOffer({ ...offer, state:'expired' }));
      }
    }
    for (const offer of expired) this._emit('expired', { offer });
    if (expired.length) this._emit('statechange', this.snapshot());
    return expired.length;
  }

  async _readLocalClipboard({ userActivation }) {
    const clipboard = globalThis.navigator?.clipboard;
    if (!globalThis.isSecureContext || !clipboard) throw new Error('Clipboard access requires a secure browser context');
    try {
      if (clipboard.read) {
        const result = [];
        const clipboardItems = await clipboard.read();
        for (const clipboardItem of clipboardItems) {
          for (const rawType of clipboardItem.types) {
            const type = canonicalType(rawType);
            if (!CLIPBOARD_TYPES.has(type) || result.some(item => item.type === type)) continue;
            const blob = await clipboardItem.getType(rawType);
            result.push({ type, data:await blob.arrayBuffer() });
          }
        }
        if (!result.length && clipboardItems.some(item => item.types.length)) throw new Error('Local clipboard has no supported representations');
        return normalizeItems(result);
      }
      if (clipboard.readText) {
        const text = await clipboard.readText();
        return normalizeItems([{ type:'text/plain', data:new TextEncoder().encode(text) }]);
      }
    } catch (error) {
      if (!userActivation) this._emit('permissionrequired', { direction:'toRemote', error });
      throw error;
    }
    throw new Error('This browser does not support clipboard reading');
  }

  async _writeLocalClipboard(items) {
    const clipboard = globalThis.navigator?.clipboard;
    if (!globalThis.isSecureContext || !clipboard) throw new Error('Clipboard access requires a secure browser context');
    if (clipboard.write && globalThis.ClipboardItem) {
      const values = {};
      for (const item of items) {
        if (!ClipboardItem.supports || ClipboardItem.supports(item.type)) {
          values[item.type] = new Blob([item.data], { type:item.type });
        }
      }
      if (Object.keys(values).length) {
        try {
          await clipboard.write([new ClipboardItem(values)]);
          const types = Object.keys(values);
          return { types, items:items.filter(item => types.includes(item.type)) };
        } catch (error) {
          if (!items.some(item => item.type === 'text/plain')) throw error;
        }
      }
    }
    const plain = items.find(item => item.type === 'text/plain');
    if (plain && clipboard.writeText) {
      await clipboard.writeText(new TextDecoder().decode(plain.data));
      return { types:['text/plain'], items:[plain] };
    }
    throw new Error('This browser cannot write the offered clipboard representations');
  }

  async _rememberLocalWrite(receipt) {
    const candidates = await subsetFingerprints(receipt.items);
    let written = await fingerprint(receipt.items);
    if (this.permissions.read === 'granted') {
      try {
        const actual = await this._readLocalClipboard({ userActivation:true });
        if (await plausibleWriteReadback(receipt.items, actual)) {
          written = await fingerprint(actual);
          candidates.add(written);
        }
      } catch (_) {
        // Suppression must never request or degrade clipboard-read permission.
      }
    }
    this.localWriteFingerprints = candidates;
    this.localWriteFingerprint = candidates.values().next().value || '';
    this.localFingerprint = written;
    this.localObserved = true;
  }

  async _waitForLocalWrite() {
    while (this.localWriteInFlight) {
      const operation = this.localWriteInFlight;
      try { await operation; } catch (_) {}
      if (this.localWriteInFlight === operation) return;
    }
  }

  _browserCapabilities() {
    const clipboard = globalThis.navigator?.clipboard;
    const writeTypes = [...CLIPBOARD_TYPES].filter(type => !globalThis.ClipboardItem?.supports || ClipboardItem.supports(type));
    return {
      secureContext:Boolean(globalThis.isSecureContext), read:Boolean(clipboard?.read), readText:Boolean(clipboard?.readText),
      write:Boolean(clipboard?.write && globalThis.ClipboardItem), writeText:Boolean(clipboard?.writeText),
      writeTypes, clipboardChange:Boolean(clipboard?.addEventListener),
    };
  }

  _generation() {
    const generation = this.client.instance?.sessionGeneration;
    if (!Number.isInteger(generation) || generation < 1) throw new Error('Active session generation is unavailable');
    return generation;
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
    this.client._emit(`clipboard${type}`, detail);
  }

  destroy() {
    this.lifecycle++;
    this.localObservation++;
    this.inputActive = false;
    this.monitoring = false;
    for (const remove of this.listeners.splice(0)) remove();
    clearTimeout(this.reconcileTimer);
    clearTimeout(this.expiryTimer);
    this.pending.clear();
  }
}

/** Optional standard newest-first prompt stack. */
export class RemoteXAppClipboardPrompts {
  constructor(client, { container = client.container, limit = 5, successDuration = 3000 } = {}) {
    this.client = client;
    this.clipboard = client.clipboard;
    this.container = container;
    this.limit = limit;
    this.successDuration = successDuration;
    this.nodes = new Map();
    this.timers = new Map();
    this.previews = new Map();
    this.root = document.createElement('div');
    this.root.className = 'remotexapp-clipboard-prompts';
    this.root.setAttribute('aria-live', 'polite');
    Object.assign(this.root.style, {
      position:'absolute', inset:'0 0 auto 0', width:'100%', height:'fit-content', maxHeight:'100%',
      zIndex:'30', display:'grid', alignContent:'start', gap:'6px', overflowY:'auto',
      boxSizing:'border-box', overscrollBehavior:'contain', pointerEvents:'none',
    });
    this.onOffer = event => {
      if (event.detail.mode === 'prompt') this.add(event.detail.offer);
    };
    this.onState = event => {
      const pending = new Set(event.detail.pending.map(offer => offer.id));
      for (const [id, bar] of this.nodes) {
        if (!pending.has(id) && bar.dataset.terminal !== 'true') this.remove(id);
      }
    };
    this.onExpired = event => this.expire(event.detail.offer);
    this.clipboard.addEventListener('offer', this.onOffer);
    this.clipboard.addEventListener('statechange', this.onState);
    this.clipboard.addEventListener('expired', this.onExpired);
    this.container.append(this.root);
  }

  add(offer) {
    if (this.nodes.has(offer.id)) return;
    const bar = document.createElement('div');
    bar.dataset.offerId = offer.id;
    bar.dataset.direction = offer.direction;
    bar.dataset.state = 'pending';
    bar.setAttribute('role', 'status');
    const direction = promptDirection(offer.direction);
    Object.assign(bar.style, {
      pointerEvents:'auto', display:'flex', flexWrap:'wrap', alignItems:'center', gap:'10px',
      width:'100%', minHeight:'44px', height:'auto', maxWidth:'100%', padding:'9px 12px',
      boxSizing:'border-box', overflow:'hidden', color:'#fff', background:direction.background,
      boxShadow:'0 2px 8px rgba(0,0,0,.35)',
    });
    const message = document.createElement('span');
    Object.assign(message.style, {
      flex:'1 1 280px', minWidth:'0', overflowWrap:'anywhere', lineHeight:'1.4',
      paddingLeft:'30px', boxSizing:'border-box',
      backgroundImage:promptIcon(offer.direction === 'toRemote' ? 'up' : 'down', '#ffffff'),
      backgroundRepeat:'no-repeat', backgroundPosition:'left center', backgroundSize:'19.6px 19.6px',
    });
    message.textContent = `${direction.label}: ${direction.question}`;
    const yes = document.createElement('button');
    yes.type = 'button'; yes.setAttribute('aria-label', `Sync ${direction.name} clipboard`);
    yes.setAttribute('title', `Sync ${direction.name} clipboard`);
    const dismiss = document.createElement('button');
    dismiss.type = 'button'; dismiss.setAttribute('aria-label', `Dismiss ${direction.name} clipboard sync`);
    dismiss.setAttribute('title', `Dismiss ${direction.name} clipboard sync`);
    for (const button of [yes, dismiss]) {
      Object.assign(button.style, {
        width:'40px', height:'34px', flex:'0 0 40px', minWidth:'40px', minHeight:'34px', border:'2px solid rgba(255,255,255,.8)', borderRadius:'4px',
        color:'#111827', background:'#fff', font:'inherit', fontWeight:'700', cursor:'pointer',
        backgroundImage:promptIcon(button === yes ? 'check' : 'close', '#111827'),
        backgroundRepeat:'no-repeat', backgroundPosition:'center', backgroundSize:'15.4px 15.4px',
      });
      button.addEventListener('pointerdown', event => event.preventDefault());
      button.addEventListener('focus', () => { button.style.outline = '3px solid #fef08a'; button.style.outlineOffset = '2px'; });
      button.addEventListener('blur', () => { button.style.outline = ''; button.style.outlineOffset = ''; });
    }
    yes.onclick = async () => {
      this._releasePreview(offer.id);
      yes.disabled = dismiss.disabled = true;
      bar.dataset.terminal = 'true';
      setPromptState(bar, direction, 'progress', 'Syncing clipboard…');
      try {
        const result = await this.clipboard.approve(offer.id);
        setPromptState(bar, direction, result?.skipped ? 'expired' : 'success', result?.skipped ? 'Clipboard is empty; nothing synchronized.' : synchronizedMessage(result?.summary));
        yes.remove();
        dismiss.remove();
        this._removeLater(offer.id);
      } catch (error) {
        setPromptState(bar, direction, 'failure', `Clipboard sync failed: ${error.message}`);
        yes.disabled = dismiss.disabled = false;
      } finally { this.client.focus(); }
    };
    dismiss.onclick = () => { this.clipboard.dismiss(offer.id); this.remove(offer.id); this.client.focus(); };
    bar.append(message, yes, dismiss);
    this.root.prepend(bar);
    this.nodes.set(offer.id, bar);
    while (this.nodes.size > this.limit) this.remove(this.nodes.keys().next().value);
    if (this.clipboard._previewOffer) this._loadPreview(offer, bar, message);
  }

  async _loadPreview(offer, bar, message) {
    const controller = new AbortController();
    const resource = { controller, url:null };
    this.previews.set(offer.id, resource);
    const direction = promptDirection(offer.direction);
    const fallback = offer.types?.length ? ` ${offer.types.map(clipboardTypeLabel).join(', ')}${Number.isFinite(offer.totalBytes) ? ` · ${formatClipboardBytes(offer.totalBytes)}` : ''}.` : '';
    message.textContent = `${direction.label}: ${direction.question}${fallback} Loading preview…`;
    const current = () => this.nodes.get(offer.id) === bar && bar.dataset.state === 'pending' && !controller.signal.aborted;
    try {
      const { summary, thumbnail } = await this.clipboard._previewOffer(offer.id, { signal:controller.signal });
      if (!current()) return;
      const details = synchronizedMessage(summary).replace(/^Clipboard synchronized/, '');
      message.textContent = `${direction.label}: ${direction.question}${details}${!summary.preview && !thumbnail ? ' Preview unavailable.' : ''}`;
      if (thumbnail) {
        const img = document.createElement('img');
        img.alt = 'Clipboard PNG preview';
        Object.assign(img.style, { display:'block', maxWidth:'100%', width:'auto', height:'auto', maxHeight:'96px', marginTop:'6px', objectFit:'contain' });
        resource.url = URL.createObjectURL(thumbnail);
        img.src = resource.url;
        img.onerror = () => {
          img.remove();
          if (current()) message.append(document.createTextNode(' Image preview unavailable.'));
          this._releasePreview(offer.id);
        };
        message.append(img);
      }
    } catch (_) {
      if (current()) message.textContent = `${direction.label}: ${direction.question}${fallback} Preview unavailable.`;
    }
  }

  _releasePreview(id) {
    const preview = this.previews.get(id);
    preview?.controller.abort();
    if (preview?.url) URL.revokeObjectURL(preview.url);
    this.previews.delete(id);
  }

  remove(id) {
    this._releasePreview(id);
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.nodes.get(id)?.remove();
    this.nodes.delete(id);
  }

  _removeLater(id) {
    clearTimeout(this.timers.get(id));
    const timer = setTimeout(() => this.remove(id), this.successDuration);
    timer.unref?.();
    this.timers.set(id, timer);
  }

  expire(offer) {
    const bar = this.nodes.get(offer.id);
    if (!bar) return;
    this._releasePreview(offer.id);
    bar.dataset.terminal = 'true';
    setPromptState(bar, promptDirection(offer.direction), 'expired', 'Clipboard offer expired.');
    for (const button of [...bar.children].slice(1)) button.disabled = true;
    this._removeLater(offer.id);
  }

  destroy() {
    for (const id of this.previews.keys()) this._releasePreview(id);
    this.clipboard.removeEventListener('offer', this.onOffer);
    this.clipboard.removeEventListener('statechange', this.onState);
    this.clipboard.removeEventListener('expired', this.onExpired);
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.nodes.clear();
    this.root.remove();
  }
}

function promptDirection(direction) {
  return direction === 'toRemote'
    ? { name:'Local to Remote', label:'Local → Remote', question:'Local clipboard changed. Sync it to the remote session?', background:'#b42318' }
    : { name:'Remote to Local', label:'Remote → Local', question:'Remote clipboard changed. Sync it to this device?', background:'#075985' };
}

// Decorative SVG backgrounds leave native buttons and their accessible names intact.
function promptIcon(kind, color) {
  const paths = { up:'M12 21V3M4 11l8-8 8 8', down:'M12 3v18M4 13l8 8 8-8', check:'M4 12l5 5L20 6', close:'M6 6l12 12M18 6L6 18' };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[kind]}"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function setPromptState(bar, direction, state, message) {
  const backgrounds = { progress:direction.background, success:'#166534', failure:'#7f1d1d', expired:'#374151' };
  bar.dataset.state = state;
  bar.style.background = backgrounds[state] || direction.background;
  bar.children[0].textContent = `${direction.label}: ${message}`;
}

// Ephemeral receipt only: never put previews in offer events or snapshots.
async function summarizeContent(items) {
  const types = items.map(item => item.type);
  const representations = await Promise.all(items.map(async item => {
    const blob = new Blob([item.data]);
    const detail = { type:item.type, bytes:blob.size };
    if (item.type === 'image/png') {
      // Read only the PNG signature/IHDR; never decode a potentially huge bitmap.
      try {
        const header = new Uint8Array(await blob.slice(0, 33).arrayBuffer());
        const signature = [137,80,78,71,13,10,26,10];
        if (header.length === 33 && signature.every((byte, i) => header[i] === byte)) {
          const view = new DataView(header.buffer);
          const width = view.getUint32(16), height = view.getUint32(20);
          if (view.getUint32(8) === 13 && view.getUint32(12) === 0x49484452 && width > 0 && height > 0 && width <= 0x7fffffff && height <= 0x7fffffff) {
            Object.assign(detail, { width, height });
          }
        }
      } catch (_) { /* Optional metadata must not turn a completed sync into failure. */ }
    }
    return detail;
  }));
  const plain = items.find(item => item.type === 'text/plain');
  let preview = '';
  if (plain) {
    const blob = new Blob([plain.data]);
    const text = await blob.slice(0, 1024).text();
    const characters = [...text.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim()];
    preview = characters.slice(0, 80).join('') + (characters.length > 80 || blob.size > 1024 ? '…' : '');
  }
  return { types, preview, representations, totalBytes:representations.reduce((sum, item) => sum + item.bytes, 0) };
}

function clipboardTypeLabel(type) {
  return { 'text/plain':'Plain text', 'text/html':'Rich text (HTML)', 'text/rtf':'Rich text (RTF)', 'image/png':'PNG image' }[type] || type;
}

function synchronizedMessage(summary) {
  const labels = { 'text/plain':'Plain text', 'text/html':'Rich text (HTML)', 'text/rtf':'Rich text (RTF)', 'image/png':'PNG image' };
  const types = summary?.types?.map(type => {
    const detail = summary.representations?.find(item => item.type === type);
    let label = labels[type] || type;
    if (detail) {
      label += ` · ${formatClipboardBytes(detail.bytes)}`;
      if (detail.width && detail.height) label += ` · ${detail.width} × ${detail.height} px`;
    }
    return label;
  }).join('; ');
  const total = summary?.types?.length > 1 && Number.isFinite(summary.totalBytes) ? ` (${formatClipboardBytes(summary.totalBytes)} total)` : '';
  return `Clipboard synchronized${types ? ` — ${types}${total}` : ''}.${summary?.preview ? ` “${summary.preview}”` : ''}`;
}

function formatClipboardBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function createViewerID() {
  if (globalThis.crypto?.randomUUID) return `viewer_${crypto.randomUUID()}`;
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  return `viewer_${[...bytes].map(value => value.toString(16).padStart(2, '0')).join('') || Math.random().toString(36).slice(2)}`;
}

function browserAccess(capabilities, permissions) {
  const secureContext = Boolean(globalThis.isSecureContext);
  const focused = typeof globalThis.document?.hasFocus === 'function' ? Boolean(globalThis.document.hasFocus()) : null;
  const userActivation = typeof globalThis.navigator?.userActivation?.isActive === 'boolean'
    ? globalThis.navigator.userActivation.isActive : null;
  return {
    secureContext, focused, userActivation,
    read:accessDirection(Boolean(capabilities.read || capabilities.readText), permissions.read, secureContext),
    write:accessDirection(Boolean(capabilities.write || capabilities.writeText), permissions.write, secureContext),
  };
}

function accessDirection(supported, permission, secureContext) {
  let state = permission || 'unknown';
  if (!secureContext) state = 'secure-context-required';
  else if (!supported) state = 'unsupported';
  return { supported, permission:permission || 'unknown', state, verified:false };
}

function readAccessFailure(error, access) {
  if (access.userActivation === false && access.read.permission !== 'granted') {
    return { state:'requires-user-activation', verified:false, reason:'requires-user-activation' };
  }
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    return { state:'denied', verified:false, reason:error.name };
  }
  return { state:'failed', verified:false, reason:error?.name || 'clipboard-read-failed' };
}

function cloneAccess(access) {
  return { ...access, read:{ ...access.read }, write:{ ...access.write } };
}

function canonicalType(type) {
  type = String(type || '').toLowerCase().split(';')[0].trim();
  if (type === 'application/rtf') return 'text/rtf';
  return type;
}

function normalizeItems(items) {
  const values = items instanceof Map ? [...items].map(([type, data]) => ({ type, data })) : Array.from(items || []);
  const seen = new Set();
  const result = [];
  for (const item of values) {
    const type = canonicalType(item?.type);
    if (!CLIPBOARD_TYPES.has(type) || seen.has(type) || item?.data === undefined) throw new TypeError('Unsupported, duplicate, or missing clipboard representation');
    seen.add(type);
    if (byteLength(item.data) === 0) continue;
    result.push({ type, data:item.data });
  }
  if (result.some(item => item.type === 'text/html') && !result.some(item => item.type === 'text/plain')) throw new TypeError('text/html requires nonempty text/plain fallback');
  return result;
}

async function queryPermission(name) {
  try { return (await globalThis.navigator?.permissions?.query({ name }))?.state || 'unknown'; }
  catch (_) { return 'unknown'; }
}

async function fingerprint(items) {
  const ordered = [...items].sort((left, right) => left.type.localeCompare(right.type));
  const identity = [];
  for (const item of ordered) {
    const bytes = new Uint8Array(item.data instanceof ArrayBuffer ? item.data : await new Blob([item.data]).arrayBuffer());
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
    identity.push([item.type, bytes.length, [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('')]);
  }
  return JSON.stringify(identity);
}

async function subsetFingerprints(items) {
  const result = new Set();
  for (let mask = 1; mask < (1 << items.length); mask++) {
    result.add(await fingerprint(items.filter((_, index) => mask & (1 << index))));
  }
  return result;
}

async function plausibleWriteReadback(written, actual) {
  const writtenByType = new Map(written.map(item => [item.type, item]));
  if (!actual.length || actual.some(item => !writtenByType.has(item.type))) return false;
  if ((await fingerprint(written)) === (await fingerprint(actual))) return true;
  for (const item of actual) {
    if ((await fingerprint([item])) === (await fingerprint([writtenByType.get(item.type)]))) return true;
  }
  return false;
}

function byteLength(value) {
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof Blob) return value.size;
  return new TextEncoder().encode(String(value)).byteLength;
}

function publicOffer(offer) {
  const { items, fingerprint, localAtOffer, remoteAtOffer, ...result } = offer;
  return structuredClone(result);
}
