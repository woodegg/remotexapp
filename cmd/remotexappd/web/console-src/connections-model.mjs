export function connectionRuntimeKey(runtime) {
  return JSON.stringify(runtime ? [runtime.id, runtime.sessionGeneration, runtime.state,
    runtime.sessionState, runtime.applicationStatus?.revision, runtime.versions?.current, runtime.upgrade] : null);
}

// Connection reads use the same authentication as other Manager requests.
export class ConnectionInspector {
  #serial = 0;
  #abort;
  constructor(manager, changed = () => {}) { this.manager = manager; this.changed = changed; this.runtime = null; this.value = null; this.message = ''; this.opened = false; }
  open(runtime) { this.close(); this.opened = true; this.runtime = runtime; this.key = connectionRuntimeKey(runtime); this.message = runtime ? 'Refresh to read connection information.' : 'No runtime.'; this.changed(); }
  invalidate(message = 'Connection information is stale. Refresh to read again.') {
    this.#serial++; this.#abort?.abort(); this.#abort = null; this.value = null; this.loading = false; this.message = message; this.changed();
  }
  close() { this.opened = false; this.runtime = null; this.invalidate(''); }
  observe(runtime) {
    if (!this.opened) return;
    const key = connectionRuntimeKey(runtime);
    if (key !== this.key) { this.runtime = runtime; this.key = key; this.invalidate(runtime ? undefined : 'No runtime.'); }
  }
  async refresh() {
    if (!this.opened || !this.runtime) return;
    this.invalidate('Reading connection information…');
    const serial = this.#serial, id = this.runtime.id, controller = this.#abort = new AbortController();
    this.loading = true; this.changed();
    try {
      const runtime = await this.manager.getInstance(id, {signal:controller.signal});
      const value = await this.manager.getConnections(id, {sessionGeneration:runtime.sessionGeneration, signal:controller.signal});
      const latest = await this.manager.getInstance(id, {signal:controller.signal});
      if (serial !== this.#serial || !this.opened) return;
      if (connectionRuntimeKey(runtime) !== connectionRuntimeKey(latest) || value.sessionGeneration !== latest.sessionGeneration) { this.invalidate(); return; }
      this.runtime = latest; this.key = connectionRuntimeKey(latest); this.value = value; this.readAt = new Date().toISOString(); this.message = 'Snapshot only; the process may exit after this read.';
    } catch (error) {
      if (serial !== this.#serial || !this.opened) return;
      // Do not render server error bodies or caller-controlled error text.
      this.message = error.status === 403 ? 'Connection read denied by Manager access policy.' : error.status === 409 ? 'Runtime not ready or metadata changed. Refresh runtime status and try again.' : 'Connection information could not be read.';
    } finally { if (serial === this.#serial && this.opened) { this.loading = false; this.changed(); } }
  }
  async copy(value, writeText, confirm) {
    if (!this.opened || !this.value || this.loading) return;
    if (!confirm('Copy sensitive host/control information to your local clipboard?')) return;
    try { await writeText(value); return true; } catch { return false; }
  }
}
