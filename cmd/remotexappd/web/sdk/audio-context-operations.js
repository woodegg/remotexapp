// A JavaScript timeout does not cancel a browser-native audio operation. Keep
// one observable flight instead of starting another native Promise per retry.
const failure = kind => Object.assign(Error('audio-context-'+kind+'-timeout'),{code:'audio-context-'+kind+'-timeout'});
const quarantine = Symbol.for('remotexapp.audio-context-quarantine.v1');

// Keep the native callback outside run(): after realm retirement it must not
// retain run's Context, start closure or owning controller through its scope.
function flight(env,kind,gesture,context,notify,timeoutMs) {
  let resolve,reject;
  const record={pending:true,gesture,context,notify,wait:new Promise((yes,no)=>{resolve=yes;reject=no;})};
  record.wait.catch(()=>{});
  const timer=env.setTimeout(()=>{record.timedOut=true;reject(failure(kind));},timeoutMs);
  record.finish=(error,value)=>{
    record.pending=false;env.clearTimeout(timer);
    if(record.detached)return;
    record.error=error;record.value=value;
    if(error)reject(error);else resolve(value);
    const current=record.context,completed=record.notify;record.context=record.notify=null;
    try {completed?.(current,kind,!!record.timedOut);}catch(error){env.reportError?.(error);}
  };
  record.detach=()=>{
    record.detached=true;record.context=record.notify=record.error=record.value=null;env.clearTimeout(timer);
    reject(Object.assign(Error('audio-context-realm-retired'),{code:'audio-context-realm-retired'}));
  };
  record.observe=promise=>Promise.resolve(promise).then(value=>record.finish(null,value),error=>record.finish(error));
  return record;
}

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
    const record=flight(this.env,kind,gesture,context,(current,operation,late)=>{
      this.forget(current);this.settled(current,operation,late);
    },this.timeoutMs);
    kinds.set(kind,[...pending,record]);
    // Invoke start synchronously so resume retains the original gesture.
    try {record.observe(start());}
    catch(error){record.finish(error);}
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
  releaseRealm(context,realm) {
    if(!realm?.retired)throw Error('Audio graph realm is still live');
    for(const records of this.contexts.get(context)?.values() || [])for(const record of records)record.detach();
    this.contexts.delete(context);
    const pool=this.pools.get(this.scope),entry=this.retired.get(context);
    if(entry)pool?.delete(entry);
    this.retired.delete(context);
    if(pool && !pool.size)this.pools.delete(this.scope);
  }
  detach() { this.settled=()=>{}; }
}
