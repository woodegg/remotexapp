# Native connection and recovery panel appearance

Proposed for Core 0.17.3 and browser SDK 0.34.0. The implementation is tracked in
[Issue #89](https://github.com/woodegg/remotexapp/issues/89).

## Scope

The default panel from `RemoteXAppHost.mount()` has fixed colors and font size.
Its headings and actions mix Chinese and English, while its explanations are in
Chinese. An embedding host needs to match the language and theme of its
windows, including changes made while those windows are open.

The SDK owns the overlay copy, recovery controls and accessible labels. The
host supplies its locale and theme values on the container it already owns.
The host also owns surrounding window chrome, including the title and footer
status line. The [existing recovery contract](native-recovery-experience.md)
continues to define the state, action and confirmation behavior.

## Proposed SDK contract

- `host.mount(container, target, { panelLocale })` selects the language before
  the first connecting message. The initial catalogs are English
  (`en`) and Simplified Chinese (`zh-CN`). Resolve English variants to `en`
  and generic `zh` or explicit Simplified Chinese variants such as `zh-Hans`
  to `zh-CN`. A missing or unsupported locale, including explicit Traditional
  Chinese variants, uses the current bilingual presentation.
- `view.setPanelLocale(locale)` changes the language in place and accepts the
  same locale values and fallback. Localize the complete visible panel,
  including state headings, explanations, buttons, restart warnings,
  diagnostic labels and accessible names. Diagnostic codes stay stable and
  are rendered with text APIs. The catalog preserves the meaning of
  destructive-action warnings in both languages.
- Keep `panel: true` as the default. `panel: false` still lets a host render
  `getState()` and dispatch the existing action IDs through `view.run()`.
  Locale updates have no visible effect on a disabled or released panel.

Language changes update only the panel presentation. They preserve keyboard
focus, snapshot revision, action IDs and an open confirmation's ID and expiry.
Ready and closed views hide the overlay.

## Proposed theme contract

Define CSS custom properties on the mount container or a host-owned ancestor.
The panel reads them in its own styles, so normal CSS inheritance applies
system theme updates to live windows. Unspecified tokens use the current SDK
defaults. The host sizes its own windows and manages display sizing through
the existing display contract.

| CSS custom property | Type and purpose |
| --- | --- |
| `--remotexapp-recovery-font-size` | CSS font size for panel copy and controls. Relative units let a host follow typography settings. |
| `--remotexapp-recovery-background` | CSS color for the overlay surface. |
| `--remotexapp-recovery-foreground` | CSS color for headings, messages and diagnostics. |
| `--remotexapp-recovery-button-background` | CSS color for recovery controls. |
| `--remotexapp-recovery-button-foreground` | CSS color for control labels. |
| `--remotexapp-recovery-button-border` | CSS color for the control outline. |
| `--remotexapp-recovery-focus-ring` | CSS color for the visible keyboard focus ring. |

An embedding host can map these to its own design tokens. Each window may
override its inherited tokens on its own container.

```css
.host-remote-view {
  --remotexapp-recovery-font-size: var(--host-font-size-body, 1rem);
  --remotexapp-recovery-background: var(--host-surface, #151b2c);
  --remotexapp-recovery-foreground: var(--host-text, #e5edf6);
}
```

```js
const view = host.mount(container, { instanceId }, { panelLocale: currentLocale });

// Call from the host's language-change handler.
view.setPanelLocale?.(nextLocale);
```

The optional call lets an older SDK keep showing its existing default panel.
These public settings and the container are the integration surface.

## Qualification and delivery

1. Check default behavior, `panel: false`, both languages and unsupported
   locale fallback. Verify all visible text and accessible labels,
   including warnings, diagnostics and action labels.
2. On the served `/sdk/recovery.html` reference host, test two simultaneously
   mounted Viewers with different locale and palette choices. Toggle
   light and dark surfaces, preset text sizes and language while connecting
   and recovering. Verify that the rendered styles follow each container and
   ready Views hide the panel.
3. At 200% browser zoom and in a narrow host pane, check wrapping, scrolling,
   text contrast, visible focus and keyboard access to all controls. During a
   pending restart confirmation, verify that locale and theme changes preserve
   focus and confirmation identity and produce no recovery requests, Viewer
   remounts or framebuffer changes.
4. Document the public types, token defaults and host example in the SDK
   reference and migration guide during implementation. Run portable checks
   and served-browser regression tests, then verify the exact release
   candidate on the reference host before one consolidated human UAT.

The proposal lives in the served browser SDK. An embedding host can adopt the
SDK with its defaults, then enable its locale and token mapping. To roll back
the presentation, remove those optional settings and reload the host page.
