export function createActionsPanel(manager, doc = document) {
  const node = (tag, text) => { const n=doc.createElement(tag); if(text!==undefined)n.textContent=text; return n; };
  const dialog=node('dialog'),title=node('h2','App actions'),identity=node('p'),message=node('p'),select=node('select'),form=node('div'),output=node('pre');
  dialog.setAttribute('aria-label','App actions');
  dialog.style.cssText='width:min(700px,95vw);max-height:90vh;overflow:auto;background:#101d2d;color:#dce8f6;border:1px solid #4696d3;border-radius:10px';
  output.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere';
  const refresh=node('button','Refresh'),invoke=node('button','Invoke'),cancel=node('button','Cancel request'),close=node('button','Close');
  let runtime,capabilities,controller,epoch=0,pending=false,opened=false;
  const signature=x=>x ? `${x.id}:${x.sessionGeneration}:${x.driverVersion}:${x.sessionState}:${x.applicationStatus?.state}` : '';
  function reset(){epoch++;controller?.abort();controller=null;pending=false;capabilities=null;select.replaceChildren();form.replaceChildren();output.textContent='';invoke.disabled=true;cancel.disabled=true;refresh.disabled=false;select.disabled=false;}
  function fields(){
    form.replaceChildren();output.textContent='';
    const schema=capabilities?.actions[select.value]?.parameters||{};
    for(const [name,d] of Object.entries(schema)){
      const label=node('label',name),input=node(d.type==='enum'?'select':d.type==='json'?'textarea':'input');
      label.style.cssText='display:block;margin:10px 0';input.dataset.parameter=name;input.dataset.type=d.type;input.required=!!d.required;
      if(d.type==='enum')for(const value of d.values||[]){const option=node('option',value);option.value=value;input.append(option);}
      else input.type=d.type==='boolean'?'checkbox':d.type==='integer'?'number':d.type==='url'?'url':'text';
      if(d.maxLength)input.maxLength=d.maxLength;
      if(d.minimum!==undefined)input.min=d.minimum;if(d.maximum!==undefined)input.max=d.maximum;
      if(d.default!==undefined){if(d.type==='boolean')input.checked=d.default;else input.value=d.type==='json'?JSON.stringify(d.default):String(d.default);}
      label.append(input);form.append(label);
    }
    invoke.disabled=!capabilities?.ready||!select.value||pending;
  }
  async function load(){
    reset();identity.textContent=runtime?`${runtime.id} · App ${runtime.driverVersion} · generation ${runtime.sessionGeneration}`:'No runtime';
    if(!runtime){message.textContent='No runtime. Launch and connect first.';return;}
    const ticket=epoch;controller=new AbortController();message.textContent='Loading actions…';
    try{const value=await manager.getActions(runtime.id,{signal:controller.signal});if(ticket!==epoch||!opened)return;
      if(value.sessionGeneration!==runtime.sessionGeneration)throw Error('Session changed; refresh runtime first.');
      capabilities=value;for(const name of Object.keys(value.actions)){const option=node('option',name);option.value=name;select.append(option);}
      message.textContent=!Object.keys(value.actions).length?'This pinned App has no actions.':!value.ready?'Connect and wait for the application to be ready.':'Shared-runtime actions affect all viewers.';fields();
    }catch(error){if(ticket===epoch&&opened)message.textContent=error.message;}
  }
  select.onchange=fields;refresh.onclick=()=>{void load();};
  invoke.onclick=async()=>{
    if(pending||!runtime||!capabilities?.ready)return;
    let parameters={};
    try{for(const input of form.querySelectorAll('[data-parameter]')){if(!input.reportValidity())return;const {parameter,type}=input.dataset;if(type==='boolean')parameters[parameter]=input.checked;else if(input.value!=='')parameters[parameter]=type==='integer'?Number(input.value):type==='json'?JSON.parse(input.value):input.value;}}
    catch{message.textContent='Invalid JSON parameters.';return;}
    const ticket=epoch;controller=new AbortController();pending=true;invoke.disabled=true;refresh.disabled=true;select.disabled=true;cancel.disabled=false;message.textContent='Running…';output.textContent='';
    try{const result=await manager.invokeAction(runtime.id,select.value,parameters,{sessionGeneration:capabilities.sessionGeneration,signal:controller.signal});if(ticket!==epoch||!opened)return;output.textContent=JSON.stringify(result,null,2);message.textContent='Completed: browser/application acknowledged the action.';}
    catch(error){if(ticket===epoch&&opened)message.textContent=`${error.message}. A cancelled or timed-out request may already have taken effect. No automatic retry.`;}
    finally{if(ticket===epoch){pending=false;invoke.disabled=!capabilities?.ready;refresh.disabled=false;select.disabled=false;cancel.disabled=true;}}
  };
  cancel.onclick=()=>{controller?.abort();epoch++;pending=false;invoke.disabled=!capabilities?.ready;refresh.disabled=false;select.disabled=false;cancel.disabled=true;output.textContent='';message.textContent='Request cancelled; outcome unknown. It may already have taken effect. No automatic retry.';};
  const clear=()=>{opened=false;reset();runtime=null;message.textContent='';identity.textContent='';};
  close.onclick=()=>{clear();dialog.close();};dialog.addEventListener('cancel',clear);dialog.addEventListener('close',()=>{if(!dialog.open)clear();});
  window.addEventListener('pagehide',()=>{clear();dialog.close();});
  dialog.append(title,identity,node('p','Declared App operations only. New browser tabs are visible to all viewers.'),refresh,close,message,select,form,invoke,cancel,output);doc.body.append(dialog);reset();
  return {open(item){clear();runtime=item;opened=true;dialog.showModal();void load();},invalidate(){if(opened){reset();message.textContent='Runtime changing; refresh before invoking.';}},observe(items){if(!opened)return;const item=items.find(x=>x.id===runtime?.id)||null;if(signature(item)!==signature(runtime)){runtime=item;void load();}}};
}
