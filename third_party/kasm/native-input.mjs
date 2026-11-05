// Programmatic input uses the same native transport as human keys. Submission
// is not an App acknowledgement; this module never accesses the clipboard.
const keys = Object.freeze({Enter:0xff0d,Tab:0xff09,Escape:0xff1b,Backspace:0xff08,
  Delete:0xffff,Insert:0xff63,Home:0xff50,End:0xff57,PageUp:0xff55,PageDown:0xff56,
  ArrowLeft:0xff51,ArrowUp:0xff52,ArrowRight:0xff53,ArrowDown:0xff54,Space:0x20,
  ...Object.fromEntries(Array.from({length:12},(_,i)=>[`F${i+1}`,0xffbe+i]))});
const modifiers = Object.freeze({Control:0xffe3,Shift:0xffe1,Alt:0xffe9,Meta:0xffeb});
const fail = code => Object.assign(new Error(code),{code});

export class NativeInput {
  constructor({current,lookup,busy = () => false}) { this.current=current; this.lookup=lookup; this.busy=busy; }
  target() {
    const rfb=this.current();
    if (!rfb?.isConnected || rfb.viewOnly) throw fail('input-unavailable');
    const keyboard=rfb._keyboard;
    if (this.busy() || keyboard.inputPolicy && !keyboard.inputPolicy.neutral ||
        keyboard._rfbKeyQueue?.length || keyboard._submittedKeys?.size ||
        Object.keys(keyboard._keyDownList || {}).length) throw fail('input-busy');
    if ((rfb._sock?.trafficStats?.bufferedBytes || 0) > 65536) throw fail('input-backpressure');
    return rfb;
  }
  text(value) {
    if (typeof value !== 'string' || !value || new TextEncoder().encode(value).length > 4096 ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) throw fail('invalid-text');
    const symbols=[...value.replace(/\r\n?/g,'\n')].map(character => {
      const point=character.codePointAt(0);
      if (point >= 0xd800 && point <= 0xdfff) throw fail('invalid-text');
      return point === 10 ? keys.Enter : point === 9 ? keys.Tab : this.lookup(point);
    });
    const rfb=this.target();
    for (const symbol of symbols) rfb.sendKey(symbol,'Unidentified');
    return {status:'submitted',count:symbols.length};
  }
  key(key,{modifiers:held=[]} = {}) {
    if (typeof key !== 'string' || !Array.isArray(held) || held.length > 4 ||
        new Set(held).size !== held.length || held.some(name => !Object.hasOwn(modifiers,name))) throw fail('invalid-key');
    let symbol=Object.hasOwn(keys,key) ? keys[key] : null;
    if (symbol === null && [...key].length === 1 && key.codePointAt(0) >= 32 &&
        key.codePointAt(0) !== 127 && !/[\ud800-\udfff]/u.test(key)) symbol=this.lookup(key.codePointAt(0));
    if (symbol === null) throw fail('invalid-key');
    const rfb=this.target(), pressed=[];
    try {
      for (const name of held) { rfb.sendKey(modifiers[name],`${name}Left`,true); pressed.push(name); }
      rfb.sendKey(symbol,'Unidentified');
    } finally {
      for (const name of pressed.reverse()) rfb.sendKey(modifiers[name],`${name}Left`,false);
    }
    return {status:'submitted',count:1};
  }
}
