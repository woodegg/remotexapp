import {recoveryPanelCopy, recoveryPanelLocale} from './native-recovery-copy.js';

const palette = {
  fontSize: 'var(--remotexapp-recovery-font-size, 15px)',
  backgroundColor: 'var(--remotexapp-recovery-background, rgba(15,23,42,.96))',
  color: 'var(--remotexapp-recovery-foreground, #e5edf6)',
};
const buttonPalette = {
  backgroundColor: 'var(--remotexapp-recovery-button-background, #18394f)',
  color: 'var(--remotexapp-recovery-button-foreground, #fff)',
  borderColor: 'var(--remotexapp-recovery-button-border, #5b789b)',
};

/** SDK-owned presentation. */
export function recoveryPanel(container, view, enabled, initialLocale) {
  const doc = container.ownerDocument;
  const node = tag => doc.createElement(tag);
  const root = node('div'), display = node('div'), panel = node('section'), content = node('div');
  root.style.cssText = 'position:relative;height:100%;min-height:300px;width:100%;background:#111827;color:#e5edf6';
  display.style.cssText = 'height:100%;min-height:300px;width:100%';
  panel.style.cssText = 'position:absolute;inset:0;display:flex;padding:24px;font-family:system-ui;box-sizing:border-box;text-align:center;overflow:auto';
  Object.assign(panel.style, palette);
  content.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:12px;margin:auto;min-width:0;max-width:100%;overflow-wrap:anywhere';
  panel.dataset.recoveryPanel = '';
  panel.append(content);
  root.append(display, panel);
  container.replaceChildren(root);

  let locale = recoveryPanelLocale(initialLocale);
  let copy = recoveryPanelCopy(locale);
  let bindings = [];
  function applyLocale() {
    panel.setAttribute('lang', locale === 'bilingual' ? 'zh-CN' : locale);
    panel.setAttribute('aria-label', copy.label('region'));
    for (const translate of bindings) translate();
  }
  applyLocale();
  function translated(tag, message) {
    const element = node(tag);
    const update = () => { element.textContent = message(copy); };
    bindings.push(update);
    update();
    return element;
  }
  const label = (tag, key) => translated(tag, strings => strings.label(key));
  const invoke = fn => Promise.resolve().then(fn).catch(()=>{});
  function button(kind, fn) {
    const b = label('button', kind);
    b.type = 'button';
    b.dataset.recoveryAction = kind;
    b.style.cssText = 'padding:10px 15px;border-radius:7px;border:1px solid #5b789b;cursor:pointer;font:inherit;white-space:normal;max-width:100%;overflow-wrap:anywhere';
    Object.assign(b.style, buttonPalette);
    b.addEventListener('focus', () => { b.style.boxShadow = '0 0 0 2px var(--remotexapp-recovery-focus-ring, transparent)'; });
    b.addEventListener('blur', () => { b.style.boxShadow = ''; });
    b.addEventListener('click', () => invoke(fn));
    return b;
  }

  return {
    display,
    setLocale(value) {
      if (!enabled) return;
      const next = recoveryPanelLocale(value);
      if (next === locale) return;
      locale = next;
      copy = recoveryPanelCopy(locale);
      applyLocale();
    },
    render(snapshot) {
      const focused = panel.contains(doc.activeElement) ? doc.activeElement?.dataset?.recoveryAction : null;
      panel.hidden = !enabled || snapshot.state === 'ready' || snapshot.state === 'closed';
      panel.style.display = panel.hidden ? 'none' : 'flex';
      panel.dataset.recoveryState = snapshot.state;
      bindings = [];
      if (panel.hidden) {
        content.replaceChildren();
        return;
      }
      const status = label('strong', snapshot.state);
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      const message = translated('p', strings => strings.message(snapshot.state, snapshot.reason));
      message.style.maxWidth = '38em';
      content.replaceChildren(status, message);
      if (snapshot.recovery) {
        content.append(translated('p', strings => strings.recovery(snapshot.recovery.phase, snapshot.recovery.reason)));
      }
      if (snapshot.confirmation) {
        const warning = translated('p', strings => strings.warning);
        warning.style.maxWidth = '38em';
        warning.setAttribute('role', 'alert');
        content.append(warning, button('cancel', () => view.cancelConfirmation()),
          button('confirm', () => view.confirm(snapshot.confirmation.id)));
      } else {
        const actions = node('div');
        actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;justify-content:center;max-width:100%';
        let help;
        for (const action of snapshot.actions) {
          actions.append(button(action.kind, () => {
            if (action.kind === 'help' && !help) {
              help = translated('p', strings => strings.diagnostic(snapshot.reason));
              help.setAttribute('role', 'status');
              content.append(help);
            }
            return view.run(action.id);
          }));
        }
        content.append(actions);
      }
      if (focused) panel.querySelector(`[data-recovery-action="${focused}"]`)?.focus();
    },
    dispose() {
      bindings = [];
      root.remove();
    },
  };
}
