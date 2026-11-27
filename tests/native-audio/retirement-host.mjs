import {RemoteXAppHost} from '/sdk/index.js';

// Counters only: no retained Stream/Context/Node/Host references across cycles.
const lab=window.lab={owner:null,reply:null,done:0,error:null,peak:0,requests:0,
  stopped:0,closedContexts:0,closedState:null,immediateStopped:0,acks:0,micFrames:0,lastMicFrameAt:null};
const post=MessagePort.prototype.postMessage;
MessagePort.prototype.postMessage=function(message,...rest){
  const result=post.call(this,message,...rest);
  if(message?.op==='microphone-frame'){lab.micFrames++;lab.lastMicFrameAt=Date.now();}
  return result;
};
const Worklet=AudioWorkletNode;
window.AudioWorkletNode=class extends Worklet {
  constructor(...args){super(...args);this.port.addEventListener('message',({data})=>{if(data.type==='disposed')lab.acks++;});this.port.start();}
};
const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
navigator.mediaDevices.getUserMedia=async options=>{
  lab.requests++;
  const stream=await get(options);
  for(const track of stream.getTracks()){
    const stop=track.stop.bind(track);let ended=false;
    track.stop=()=>{if(!ended){ended=true;lab.stopped++;}return stop();};
  }
  return stream;
};
const close=AudioContext.prototype.close;
AudioContext.prototype.close=async function(){await close.call(this);lab.closedContexts++;lab.closedState=this.state;};
const target=new URLSearchParams(location.search).get('instance');
if(!target)throw Error('An existing disposable App is required');
const keeper=new RemoteXAppHost({scope:'retirement-keeper',crossTabs:false});
try { await keeper.open({instanceId:target,keepAlive:true}); }
catch(error) { lab.error='Keeper preparation: '+error.message; throw error; }
lab.releaseKeeper=()=>keeper.dispose();
const act=(id,fn)=>document.getElementById(id).onclick=async()=>{
  lab.reply=null;lab.error=null;
  try{await fn();lab.reply={ok:true};}
  catch(error){lab.error=error.message;lab.reply={ok:false,error:error.message};}
  document.getElementById('status').value=JSON.stringify({done:lab.done,reply:lab.reply});
};
act('open',async()=>{
  if(lab.owner)throw Error('Retire the previous owner first');
  const host=new RemoteXAppHost({scope:'retirement-cycles',crossTabs:false});
  lab.peak=0;lab.owner={host};
  const view=lab.owner.view=host.mount(document.getElementById('viewer'),{instanceId:target},{preferUDP:false});
  await view.settled;
  if(!view.getState().displayReady)throw Error('Viewer did not paint');
  lab.owner.interest=await view.session.audio();
  host.addEventListener('audiochange',({detail})=>{lab.peak=Math.max(lab.peak,detail.playback?.peak||0);});
});
act('speaker',()=>lab.owner.interest.setSpeaker(true));
act('speaker-off',()=>lab.owner.interest.setSpeaker(false));
act('mic',()=>lab.owner.interest.setMicrophone(true));
act('mic-off',()=>lab.owner.interest.setMicrophone(false));
act('clipboard',async()=>{
  const viewer=lab.owner.view.viewer;viewer.focus();
  await viewer.configureClipboard({toLocal:'auto',toRemote:'auto'});
  await viewer.requestClipboardPermission();
});
act('suspend',()=>lab.owner.host._audio.context.suspend()); // owned lifecycle fault
for(const op of ['dispose','logout'])act(op,async()=>{
  const host=lab.owner.host;lab.owner=null;
  const pending=host[op]();lab.immediateStopped=lab.stopped;
  if(host.dispose()!==pending && !new URLSearchParams(location.search).has('baseline'))throw Error('Retirement callers did not join');
  await pending;
  document.getElementById('viewer').replaceChildren();lab.done++;
});
lab.snapshot=()=>{
  const owner=lab.owner,audio=owner?.host.getAudioState(),viewer=owner?.view.viewer;
  return {done:lab.done,error:lab.error,requests:lab.requests,stopped:lab.stopped,
    immediateStopped:lab.immediateStopped,closedContexts:lab.closedContexts,closedState:lab.closedState,acks:lab.acks,
    micFrames:lab.micFrames,lastMicFrameAt:lab.lastMicFrameAt,
    peak:lab.peak,audio,display:viewer?.getStats(),clipboard:viewer?.getClipboardState()};
};
