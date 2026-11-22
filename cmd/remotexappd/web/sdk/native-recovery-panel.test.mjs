import assert from 'node:assert/strict';
import test from 'node:test';
import {recoveryPanel} from './native-recovery-panel.js';
import {recoveryPanelCopy, recoveryPanelLocale} from './native-recovery-copy.js';

function fixture(enabled = true, locale) {
  const doc = {activeElement:null, createElement:tag => new Element(tag)};
  class Element extends EventTarget {
    constructor(tag) {
      super();
      this.tag = tag;
      this.ownerDocument = doc;
      this.style = {};
      this.dataset = {};
      this.attributes = {};
      this.children = [];
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(key, value) { this.attributes[key] = value; }
    contains(element) { return element === this || this.children.some(child => child.contains(element)); }
    focus() { doc.activeElement = this; }
    find(predicate) {
      return predicate(this) ? this : this.children.map(child => child.find(predicate)).find(Boolean);
    }
    querySelector(selector) {
      const kind = /^\[data-recovery-action="(.+)"\]$/.exec(selector)?.[1];
      return this.find(element => element.dataset.recoveryAction === kind);
    }
  }
  const container = doc.createElement('div');
  const calls = [];
  const view = {
    run: id => calls.push(['run', id]),
    confirm: id => calls.push(['confirm', id]),
    cancelConfirmation: () => calls.push(['cancel']),
  };
  const ui = recoveryPanel(container, view, enabled, locale);
  return {doc, ui, panel:container.find(element => element.tag === 'section'), calls};
}

test('normalizes English and Simplified Chinese while preserving the compatibility fallback', () => {
  for (const value of ['en', 'en-US', 'EN-gb', 'en-US-u-hc-h12']) assert.equal(recoveryPanelLocale(value), 'en');
  for (const value of ['zh-CN', 'zh', 'zh-SG', 'zh-Hans', 'zh-Hans-TW']) assert.equal(recoveryPanelLocale(value), 'zh-CN');
  for (const value of [undefined, '', 1, 'bilingual', 'en_US', 'fr-FR', 'zh-TW', 'zh-HK', 'zh-Hant-CN', 'zh-Latn']) {
    assert.equal(recoveryPanelLocale(value), 'bilingual');
  }
  const english = recoveryPanelCopy('en');
  assert.match(english.message('attention', 'permission-denied'), /lacks permission/);
  assert.match(english.message('attention', 'constructor'), /connection is not ready/);
  assert.match(english.message('recovering', null), /Trying to restore/);
});

test('changes copy and diagnostics in place while retaining action identity and focus', async () => {
  const {doc, ui, panel, calls} = fixture(true, 'en-GB');
  ui.render({state:'connecting', actions:[]});
  const status = panel.find(element => element.tag === 'strong');
  assert.equal(status.textContent, 'Connecting');
  assert.equal(panel.attributes['aria-label'], 'Connection recovery');
  assert.equal(panel.attributes.lang, 'en');
  ui.setLocale('zh-Hans');
  assert.equal(panel.find(element => element.tag === 'strong'), status);
  assert.equal(status.textContent, '连接中');
  assert.equal(panel.attributes['aria-label'], '连接恢复');

  ui.render({state:'attention', reason:'permission-denied', recovery:{phase:'blocked',reason:'test-code'},
    actions:[{kind:'help', id:'4:help'}]});
  const help = panel.querySelector('[data-recovery-action="help"]');
  help.focus();
  help.dispatchEvent(new Event('click'));
  await new Promise(queueMicrotask);
  const note = panel.find(element => element.textContent?.startsWith('诊断代码'));
  assert(note);
  ui.setLocale('en');
  assert.equal(doc.activeElement, help);
  assert.equal(help.textContent, 'Help');
  assert.match(note.textContent, /^Diagnostic code: permission-denied/);
  assert(panel.find(element => element.textContent === 'Recovery status: blocked · test-code'));
  assert.deepEqual(calls, [['run', '4:help']]);
});

test('keeps the confirmation and default or hidden panel behavior', async () => {
  const {doc, ui, panel, calls} = fixture();
  ui.render({state:'attention', confirmation:{id:'existing-confirmation'}, actions:[]});
  const confirm = panel.querySelector('[data-recovery-action="confirm"]');
  confirm.focus();
  assert.equal(confirm.textContent, '确认重启 · Confirm restart');
  ui.setLocale('en');
  assert.equal(doc.activeElement, confirm);
  assert.match(panel.find(element => element.attributes.role === 'alert').textContent, /Unsaved work/);
  assert.equal(confirm.textContent, 'Confirm restart');
  confirm.dispatchEvent(new Event('click'));
  await new Promise(queueMicrotask);
  assert.deepEqual(calls, [['confirm', 'existing-confirmation']]);
  ui.setLocale('fr');
  assert.equal(confirm.textContent, '确认重启 · Confirm restart');
  ui.render({state:'ready', actions:[]});
  assert(panel.hidden);

  const hidden = fixture(false, 'en');
  hidden.ui.render({state:'attention', confirmation:{id:'never-shown'}, actions:[]});
  hidden.ui.setLocale('zh-CN');
  assert(hidden.panel.hidden);
  assert(!hidden.panel.find(element => element.tag === 'button'));
});
