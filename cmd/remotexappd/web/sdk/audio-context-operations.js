// A JavaScript timeout does not cancel a browser-native audio operation. Keep
// one observable flight instead of starting another native Promise per retry.
const failure = kind => Object.assign(Error('audio-context-'+kind+'-timeout'),{code:'audio-context-'+kind+'-timeout'});
const quarantine = Symbol.for('remotexapp.audio-context-quarantine.v1');

export class AudioContextOperations {
  constructor(environment, settled = () => {}, timeoutMs = 3000, scope = '') {
    this.env=environment;this.settled=settled;this.timeoutMs=timeoutMs;this.contexts=new Map();
    this.scope=scope;this.pools=environment[quarantine] ||= new Map();this.retired=new Map();
  }
  run(context, kind, start, {gesture=false} = {}) {
    let kinds=this.contexts.get(context);
    if(!kinds)this.contexts.set(context,kinds=new Map());
    const records=kinds.get(kind) || [], pending=records.filter(r=>r.pending), last=records.at(-1);
    // A genuinely new user gesture may unblock an earlier autoplay resume.
    // Permit one additional native resume, never one for every automatic retry
    // or repeated click while the browser still leaves both calls pending.
    if(pending.length && !(kind==='resume' && gesture && pending.length===1 && !pending[0].gesture))return pending.at(-1).wait;
    if(!pending.length && kind==='module' && last)return last.error?Promise.reject(last.error):Promise.resolve(last.value);
    if(!pending.length && kind==='close' && context.state==='closed')return Promise.resolve();
    let resolve,reject;
    const record={pending:true,gesture,wait:new Promise((yes,no)=>{resolve=yes;reject=no;})};
    record.wait.catch(()=>{});
    kinds.set(kind,[...pending,record]);
    const timer=this.env.setTimeout(()=>{record.timedOut=true;reject(failure(kind));},this.timeoutMs);
    const finish=(error,value)=>{
      record.pending=false;record.error=error;record.value=value;
      this.env.clearTimeout(timer);
      if(error)reject(error);else resolve(value);
      // Late completion after owner disposal must release the closed graph
      // even though its owner-facing wait already timed out and detached.
      this.forget(context);
      try {this.settled(context,kind,!!record.timedOut);}catch(error){this.env.reportError?.(error);}
    };
    // Invoke start synchronously so resume retains the original gesture.
    try {Promise.resolve(start()).then(value=>finish(null,value),error=>finish(error));}
    catch(error){finish(error);}
    return record.wait;
  }
  pending(context) {
    return [...(this.contexts.get(context)?.values() || [])].some(records=>records.some(r=>r.pending));
  }
  forget(context) {
    if(context.state!=='closed' || this.pending(context))return false;
    this.contexts.delete(context);
    const record=this.retired.get(context),pool=this.pools.get(this.scope);
    if(record){pool?.delete(record);this.retired.delete(context);}
    if(pool && !pool.size)this.pools.delete(this.scope);
    return true;
  }
  retire(context) {
    if(this.retired.has(context))return;
    let pool=this.pools.get(this.scope);if(!pool)this.pools.set(this.scope,pool=new Set());
    const record={context,operations:this};this.retired.set(context,record);pool.add(record);
  }
  canCreate() {
    const pool=this.pools.get(this.scope);
    for(const record of [...(pool || [])])record.operations.forget(record.context);
    return (this.pools.get(this.scope)?.size || 0)<2;
  }
  detach() { this.settled=()=>{}; }
}
