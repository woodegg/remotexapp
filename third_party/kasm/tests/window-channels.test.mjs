import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Exercise the applied upstream lifecycle methods, not a second cleanup model.
test('applied disconnect retires only its window channels and repeated disposal is safe',
  {skip:!process.env.KASM_CLIENT_SOURCE}, () => {
    const method = (file, start, end, globals) => {
      const source = readFileSync(process.env.KASM_CLIENT_SOURCE+'/core/'+file,'utf8');
      const body = source.slice(source.indexOf(start)+start.length,source.indexOf(end));
      return new Function(...Object.keys(globals),`return function(){${body.slice(0,body.lastIndexOf('}'))}}`)(...Object.values(globals));
    };
    const channel = () => ({closed:false, close(){this.closed=true;}, postMessage(){assert(!this.closed);}});
    const removed=[],noop = () => {}, window = {cancelAnimationFrame:noop,
      removeEventListener:(name,fn)=>removed.push([name,fn]),localStorage:{removeItem:noop}};
    const dispose = method('display.js','    dispose() {','    fillRect(',{window});
    const display = () => ({_broadcastChannel:channel(),_screens:[{channel:channel()}],
      registeredWindows:new Map([['screen','window']]),displayWindows:new Map([['window',{}]]),
      _asyncFrameRequest:null,_syncFrameRequest:null,_frameStatsInterval:null,clear:noop,
      _renderer:{dispose:noop},dispose});
    const disconnect = method('rfb.js','    _disconnect() {','    _updateHiddenKeyboard(',
      {document:{removeEventListener:noop},window,Log:{Debug:noop}});
    const owner = () => ({_display:display(),_controlChannel:channel(),_closeUdp:noop,
      _cursor:{detach:noop},_canvas:{removeEventListener:noop},
      _eventHandlers:{handleFocusChange(){},handleMouseOut(){}},
      _keyboard:{ungrab:noop},_gestures:{detach:noop},_isPrimaryDisplay:true,
      _sock:{close:noop},_target:{removeChild:noop}});
    const a=owner(),b=owner();
    const aChannels=[a._controlChannel,a._display._broadcastChannel,a._display._screens[0].channel];
    const bChannels=[b._controlChannel,b._display._broadcastChannel,b._display._screens[0].channel];
    disconnect.call(a);disconnect.call(a);
    assert(aChannels.every(c=>c.closed),'every owned channel must close');
    assert(bChannels.every(c=>!c.closed),'another Viewer must retain its channels');
    assert.equal(a._controlChannel,null);assert.equal(a._display._broadcastChannel,null);
    assert.equal(a._display._screens[0].channel,null);
    assert.equal(a._display.registeredWindows.size,0);assert.equal(a._display.displayWindows.size,0);
    for(const [name,fn] of [['blur',a._eventHandlers.handleFocusChange],['mouseover',a._eventHandlers.handleMouseOut]])
      assert(removed.some(([event,callback])=>event===name && callback===fn),'global listener must be removed: '+name);
    disconnect.call(b);assert(bChannels.every(c=>c.closed));
  });
