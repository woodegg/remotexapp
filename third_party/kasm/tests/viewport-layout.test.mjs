import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('applied viewport scheduler fits connected positive-size boxes without requesting a desktop resize',
  {skip: !process.env.KASM_CLIENT_SOURCE}, () => {
    const source = readFileSync(process.env.KASM_CLIENT_SOURCE + '/core/rfb.js', 'utf8');
    const start = source.indexOf('    _scheduleViewportLayout() {');
    const end = source.indexOf('    // Update state of clipping', start);
    assert(start !== -1 && end > start);
    const methods = source.slice(start, end).replace('\n    _windowResize(', ',\n    _windowResize(');
    const frames = [];
    const calls = [];
    const window = {requestAnimationFrame: callback => frames.push(callback)};
    const runnable = new Function('window', 'setTimeout', 'clearTimeout', 'CustomEvent',
      'return ({' + methods + '})')(window, callback => { calls.push('remote-timer'); return callback; },
      () => {}, class { constructor(type) { this.type = type; } });
    const size = {width: 760, height: 427};
    const viewer = {
      ...runnable,
      isConnected: true,
      _viewportFrame: null,
      _resizeSession: true,
      _screen: {isConnected: true, getBoundingClientRect: () => size},
      _screenSize: () => calls.push('measure'),
      _updateClip: () => calls.push('clip'),
      _updateScale: () => calls.push('scale'),
      _requestRemoteResize: () => calls.push('request'),
      dispatchEvent: event => calls.push(event.type),
    };

    viewer._scheduleViewportLayout();
    viewer._scheduleViewportLayout();
    assert.equal(frames.length, 1);
    assert.deepEqual(calls, []);
    frames.shift()();
    assert.deepEqual(calls, ['measure', 'clip', 'scale']);

    size.height = 0;
    viewer._scheduleViewportLayout();
    frames.shift()();
    assert.deepEqual(calls, ['measure', 'clip', 'scale']);

    size.height = 500;
    viewer._scheduleViewportLayout();
    viewer._screen.isConnected = false;
    frames.shift()();
    assert.deepEqual(calls, ['measure', 'clip', 'scale']);

    viewer._screen.isConnected = true;
    viewer._scheduleViewportLayout();
    viewer.isConnected = false;
    frames.shift()();
    viewer._scheduleViewportLayout();
    assert.equal(frames.length, 0);
    assert.deepEqual(calls, ['measure', 'clip', 'scale']);

    viewer.isConnected = true;
    viewer._windowResize();
    assert.deepEqual(calls.slice(-2), ['screenregistered', 'remote-timer']);
    frames.shift()();
    viewer._resizeTimeout();
    assert.deepEqual(calls.slice(-4), ['measure', 'clip', 'scale', 'request']);
  });
