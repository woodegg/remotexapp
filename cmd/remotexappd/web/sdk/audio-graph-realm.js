const unavailable = () => Object.assign(Error('audio-context-realm-unavailable'),{code:'audio-context-realm-unavailable'});

// The SDK owns this execution environment, not the embedding host's document.
// Its destruction can retire a Worklet that a closed Context cannot process.
export class AudioGraphRealm {
  constructor(environment) {
    const document=environment.document;
    if(!document?.createElement || !(document.body || document.documentElement)?.append)throw unavailable();
    const frame=this.frame=document.createElement('iframe');
    frame.hidden=true;frame.allow='autoplay';frame.title='RemoteXApp audio processing';
    frame.setAttribute('aria-hidden','true');frame.setAttribute('data-remotexapp-audio-graph','');
    try {
      // No navigation or request: initial about:blank inherits the parent origin.
      // Creation remains synchronous in the original enable gesture.
      (document.body || document.documentElement).append(frame);
      this.document=this._window().document;
    } catch(error) {frame.remove();this.frame=null;throw unavailable();}
  }
  _window() {
    const realm=this.frame?.contentWindow;
    if(!this.frame?.isConnected || !realm?.document || this.document && realm.document!==this.document || !realm.AudioContext || !realm.AudioWorkletNode)throw unavailable();
    return realm;
  }
  context(options) {const realm=this._window();return new realm.AudioContext(options);}
  node(context,name,options) {const realm=this._window();return new realm.AudioWorkletNode(context,name,options);}
  retire() {
    if(!this.frame)return;
    this.frame.remove();
    if(this.frame.isConnected)throw Object.assign(Error('audio-context-realm-retirement-incomplete'),{code:'audio-context-realm-retirement-incomplete'});
    this.frame=this.document=null;
  }
  get retired() {return !this.frame;}
  get live() {try {this._window();return true;}catch{return false;}}
}
