const terminalCodes = new Set(['provider-mismatch','invalid-descriptor','origin','stale-generation',
  'application-failed','disposed','runtime-invalidated','grant-expired','invalid-grant','unsupported']);

export function reconnectPolicy(value = false) {
  if (value === false) return null;
  if (value !== true && (!value || typeof value !== 'object' || Array.isArray(value))) throw new TypeError('Reconnect must be false, true or a policy');
  const {maxAttempts = 4, delays = [1000,2000,5000,10000]} = value === true ? {} : value || {};
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20 ||
      !Array.isArray(delays) || !delays.length || delays.length > 20 ||
      delays.some(v => !Number.isFinite(v) || v < 1 || v > 60000)) throw new RangeError('Invalid native reconnect policy');
  return Object.freeze({maxAttempts, delays:Object.freeze([...delays])});
}

export function retryable(error) {
  const status = error?.status || error?.cause?.status;
  return ![400,401,403,404,409,422].includes(status) &&
    !terminalCodes.has(error?.code) && error?.name !== 'AbortError';
}

/** A cancelled retry can neither attach a new display nor revive an App. */
export class NativeReconnect {
  constructor({policy, read, connect, event}) {
    this.policy = reconnectPolicy(policy);
    this.read = read; this.connect = connect; this.event = event;
    this.epoch = 0;
  }
  cancel() {
    ++this.epoch;
    clearTimeout(this.timer); this.timer = null;
    this.controller?.abort(); this.controller = null;
  }
  begin(expected, error) {
    this.cancel();
    if (!this.policy || !expected || !retryable(error)) return false;
    const epoch = this.epoch, controller = this.controller = new AbortController();
    const identity = {id:expected.id, generation:expected.sessionGeneration, component:expected.displayComponentDigest};
    let attempt = 0;
    const current = () => epoch === this.epoch && !controller.signal.aborted;
    const schedule = () => {
      if (!current()) return;
      if (attempt >= this.policy.maxAttempts) {
        this.cancel(); this.event('reconnectexhausted', {attempts:attempt, code:'reconnect-exhausted'}); return;
      }
      const delayMs = this.policy.delays[Math.min(attempt, this.policy.delays.length - 1)];
      this.event('reconnecting', {attempt:attempt + 1, maxAttempts:this.policy.maxAttempts, delayMs});
      // An event listener is allowed to close/dispose the Viewer synchronously.
      if (!current()) return;
      this.timer = setTimeout(async () => {
        this.timer = null; ++attempt;
        try {
          const actual = await this.read(identity.id, {signal:AbortSignal.any([controller.signal, AbortSignal.timeout(10000)])});
          if (!current()) return;
          if (actual.id !== identity.id || actual.displayProvider !== 'kasm' ||
              actual.sessionGeneration !== identity.generation || actual.displayComponentDigest !== identity.component ||
              actual.sessionState !== 'running' || !['ready','server-ready'].includes(actual.state) ||
              (actual.shutdown && actual.shutdown.state !== 'cancelled') || ['error','exited','stopped'].includes(actual.applicationStatus?.state)) {
            throw Object.assign(new Error('Runtime changed during reconnect'), {code:'stale-generation'});
          }
          await this.connect(actual, controller.signal);
          if (!current()) return;
          this.cancel(); this.event('reconnected', {attempts:attempt, generation:identity.generation});
        } catch (cause) {
          if (!current()) return;
          if (!retryable(cause)) {
            this.cancel(); this.event('reconnectstopped', {attempts:attempt, code:cause.code || 'reconnect-rejected'});
          } else schedule();
        }
      }, delayMs);
    };
    schedule();
    return true;
  }
}
