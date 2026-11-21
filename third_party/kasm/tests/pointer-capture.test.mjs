import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const upstream = process.env.KASM_CLIENT_SOURCE;
const options = {skip: !upstream};

function documentFixture() {
  const overlays = new Set();
  const observers = new Set();
  const win = Object.assign(new EventTarget(), {
    AbortController,
    MutationObserver: class {
      constructor(callback) { this.callback = callback; }
      observe() { observers.add(this); }
      disconnect() { observers.delete(this); }
    },
    getComputedStyle(target) {
      assert.equal(target.isConnected, true);
      return target.style;
    },
  });
  const doc = {
    defaultView: win,
    body: {appendChild: element => overlays.add(element)},
    createElement() {
      const element = Object.assign(new EventTarget(), {
        ownerDocument: doc,
        isConnected: true,
        style: {},
        remove() { element.isConnected = false; overlays.delete(element); },
      });
      return element;
    },
  };
  return {doc, win, overlays, observers};
}

class Mouse extends Event {
  constructor(type, options = {}) {
    super(type, options);
    this.buttons = options.buttons ?? 0;
  }
}

test('applied capture belongs to one Viewer across distinct module URLs and documents', options, async () => {
  const source = readFileSync(upstream + '/core/util/events.js', 'utf8');
  const url = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
  const a = await import(url + '#a');
  const {doc, win, overlays, observers} = documentFixture();
  const other = documentFixture();
  const first = doc.createElement('canvas');
  const second = doc.createElement('canvas');
  const separate = other.doc.createElement('canvas');
  const received = [];
  for (const [name, element] of [['first', first], ['second', second]]) {
    for (const type of ['mousedown', 'mousemove', 'mouseup', 'contextmenu']) {
      element.addEventListener(type, event => {
        received.push([name, type, event.buttons]);
        event.preventDefault();
      });
    }
  }
  const gesture = (type, buttons) => win.dispatchEvent(new Mouse(type, {buttons, cancelable:true}));

  assert.equal(a.setCapture(first), true);
  const b = await import(url + '#b');
  assert.notEqual(a, b);
  assert.equal(b.capturedElement(doc), first, 'loading a second copy must preserve live capture');
  assert.equal(b.setCapture(second), false);
  b.releaseCapture(second);
  assert.equal(observers.size, 1);
  assert.equal(overlays.size, 1);
  assert.equal(b.setCapture(separate), true, 'another document owns an independent gesture');
  assert.equal(a.capturedElement(other.doc), separate);
  a.releaseCapture(separate);

  const firstObserver = [...observers][0];
  first.style.cursor = 'crosshair';
  firstObserver.callback();
  assert.equal([...overlays][0].style.cursor, 'crosshair');
  assert.equal(gesture('mousemove', 1), false, 'preventDefault propagates through the proxy');
  gesture('mousedown', 3);
  gesture('mouseup', 2);
  assert.equal(a.capturedElement(doc), first, 'an additional held button retains capture');
  gesture('contextmenu', 2);
  gesture('mouseup', 0);
  assert.equal(a.capturedElement(doc), null);
  assert.equal(observers.size, 0);
  assert.equal(overlays.size, 0);

  assert.equal(b.setCapture(second), true);
  a.releaseCapture(first);
  firstObserver.callback();
  assert.equal(a.capturedElement(doc), second, 'stale cleanup cannot retire a new owner');
  gesture('mousemove', 1);
  gesture('mouseup', 0);
  gesture('mousemove', 0);
  assert.deepEqual(received, [
    ['first', 'mousemove', 1],
    ['first', 'mousedown', 3],
    ['first', 'mouseup', 2],
    ['first', 'contextmenu', 2],
    ['first', 'mouseup', 0],
    ['second', 'mousemove', 1],
    ['second', 'mouseup', 0],
  ]);
  assert.equal(overlays.size, 0);
  assert.equal(observers.size, 0);

  assert.equal(b.setCapture(second), true);
  second.isConnected = false;
  gesture('mouseup', 0);
  assert.equal(overlays.size, 0);
  assert.equal(observers.size, 0);
});

test('applied RFB acquires browser capture before an input queue can delay dispatch', options, () => {
  const source = readFileSync(upstream + '/core/rfb.js', 'utf8');
  const start = source.indexOf('    _handleMouse(ev) {');
  const end = source.indexOf('\n    _handleMouseNative(ev)', start);
  assert(start >= 0 && end > start);
  const calls = [];
  const canvas = {};
  const setCapture = target => { assert.equal(target, canvas); calls.push('capture'); return true; };
  const handler = new Function('setCapture', 'return ({' + source.slice(start, end) + '})._handleMouse')(setCapture);
  const rfb = {
    _canvas: canvas,
    _keyboard: {routePointer: () => calls.push('queued gesture')},
  };
  handler.call(rfb, {type:'mousedown', preventDefault:() => {}});
  assert.deepEqual(calls, ['capture', 'queued gesture']);
  assert.doesNotMatch(source.slice(end, source.indexOf('    _handleMouseButton(', end)), /setCapture\(/);
});
