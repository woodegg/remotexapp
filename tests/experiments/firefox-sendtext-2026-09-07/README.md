# Firefox sendText investigation, 2026-09-07

Status: failure reproduced; a reversible preference experiment identifies the
native-focus cause in this environment. No product fix applied.

## Environment and method

Local test Manager `127.0.0.1:2991`, RemoteXApp 0.5.2, shipped SDK served by
that Manager. Local 1991 was checked for health only. No sandbox deployment
was accessed. A headless Chrome viewer on CDP port 9247 invoked the real
`window.remoteXApp.client.sendText()` through the normal input WebSocket.

Created dedicated profile `sendtext-investigation-20260907` for shipped
`firefox-esr@2.1.0` (display :10) and `edge@1.0.0` (display :11).
Firefox ESR was 140.15.0; Edge was 149.0.4022.62. A separate Google Chrome
149.0.7827.102 process was launched on Edge's display with its session
environment and `--class=microsoft-edge` to satisfy the existing gateway
allowlist. Thus Chrome is an application compatibility control, not a shipped
Chrome package validation.

Navigate to a synthetic data-URL page containing plain input, textarea,
password input and contenteditable. Use BiDi for Firefox and CDP for Chromium
to select the field and read its value. Click the field through X11 and send
`x` using SDK `sendKey()` over RFB. Verify document focus and the inserted `x`.
Then await `sendText('AsciiProbe')` and `sendText('中文测试')` separately,
waiting 400 ms before reading each result. DOM evaluation never inserts the
test text. Firefox also tested a button as a non-editable negative control.

## Observations

| Target | Plain / textarea / contenteditable | Password | RFB x |
| --- | --- | --- | --- |
| Firefox ESR | ACK success, no insertion | ACK success, no insertion | inserted |
| Edge | ASCII and Chinese inserted | ACK success, no insertion | inserted |
| Chrome | ASCII and Chinese inserted | ACK success, no insertion | inserted |

The shipped Firefox process reproduced the failure repeatedly, including with
native clicks and successful RFB input. To obtain internal diagnostics, a
second Firefox process with a fresh temporary profile inherited the Firefox
session environment on :10 and enabled `MOZ_LOG=IMEHandler:5`. It reproduced
the same result. `firefox-debug-results.json` records its final matrix; the
corresponding native trace is `firefox-ime.log`. An explicit X11 focus
away/back experiment did not resolve the failure in this diagnostic process.
The Edge and Chrome JSON files include raw-key before-values and SDK ACKs.

An IBus D-Bus monitor during the original Firefox test observed Engine/1
CommitText followed by InputContext_2 CommitText addressed to the same client
connection that sent FocusIn. For the button, engine CommitText was observed
without a forwarded InputContext CommitText. This monitor output was observed
in the tool transcript; it is not retained as a raw file here.

The diagnostic Firefox trace records `OnCommitCompositionNative` with the
exact synthetic text and then:

```text
DispatchCompositionCommitEvent(), FAILED, there are no focused window in this module
```

It also records `mLastFocusedWindow=0x0` while raw key events reach Firefox and
the page reports `document.hasFocus() === true`.

## Interpretation and limits

The failing Firefox request reaches SDK, gateway, Unicode engine, IBus and
Firefox's native IME callback. Its immediate rejection is Firefox's internal
IME focus state, not WebSocket delivery or absence of a DOM input target.
The follow-up below identifies an automation preference controlling this
failure. Do not claim every Firefox installation fails, or that Firefox
hosting the viewer has been tested; the viewer browser here was Chrome.

RemoteXApp's ACK currently means the engine accepted and emitted a commit,
not that the application's document changed. `commit_request()` in
`components/remote-unicode-engine/engine.py` returns success immediately after
`engine.commit_text()`. `ibusCommit()` in `cmd/novnc-input/input.go` propagates
that result, and SDK `sendText()` resolves it. Consequently a downstream
discard can produce a successful ACK. Password-field rejection is an expected
`sendText()` limitation, confirmed by the operator, not a Chromium or Firefox
defect. Passwords and other direct-keyboard-only widgets require the RFB
keyboard path; they are excluded from ordinary editable-field failure counts.

Future regression gates must assert actual application insertion. Do not
introduce automatic resend/fallback based solely on a successful
ACK or missing caret, as that risks duplicate or misdirected text.

Sources inspected: repository SDK, input gateway and Unicode engine; Mozilla
ESR140 `widget/gtk/IMContextWrapper.cpp` at
https://github.com/mozilla-firefox/firefox/blob/esr140/widget/gtk/IMContextWrapper.cpp.
Upstream source inspection supports interpretation; the local native trace is
the evidence for the observed rejection.

## Follow-up: reversible automation-focus experiment

On the same local 2991 service, created runtime
`firefox-esr-EXAMPLE`, display :10. A diagnostic Firefox ESR 140.15.0
inherited its session environment, gateway, IBus and Matchbox, with a separate
temporary profile and BiDi on loopback port 21004. Across three Firefox
launches, only the explicit `focusmanager.testmode` preference was changed in
that same profile's `user.js`; no manager/SDK/engine/WM changes. The probe used
BiDi navigation and evaluation, native clicks, RFB `x`, SDK text submission
and DOM readback. Password and button controls were excluded from this matrix.

| Launch / parent PID | Explicit preference | ASCII + Chinese in three normal fields | RFB x |
| --- | --- | --- | --- |
| 1 / 2101605 | false | 6/6 inserted | 3/3 inserted |
| 2 / 2103155 | true | 0/6 inserted, despite successful ACK | 3/3 inserted |
| 3 / 2104440 | false | 6/6 inserted | 3/3 inserted |

Evidence: `focus-off-results.json`, `focus-on-results.json`,
`focus-off-repeat-results.json`, and corresponding filtered `*-ime.log`
excerpts. `probe.mjs` retains the exact follow-up probe; its runtime ID,
display, Xauthority and viewer CDP port must be updated for reproduction.
Positive rounds read `xAsciiProbe` then `xAsciiProbe中文测试`; the negative
round remains `x`. Native logs show `OnFocusWindow` in positive rounds and
missing focused-window rejection in the negative round. BiDi navigation and
evaluation worked in all three rounds.

The installed Firefox `omni.ja` confirms its Remote Agent recommended
preferences set `focusmanager.testmode=true`, unless a user value exists.
The investigated 2.1.0 `apps/firefox-esr/session.sh` enables remote debugging without
overriding that preference. Mozilla ESR140 source explains the mechanism:

1. [RecommendedPreferences](https://github.com/mozilla-firefox/firefox/blob/esr140/remote/shared/RecommendedPreferences.sys.mjs)
   enables test focus mode and preserves explicit user preferences.
2. [nsFocusManager](https://github.com/mozilla-firefox/firefox/blob/esr140/dom/base/nsFocusManager.cpp)
   skips native widget focus adjustments in test mode.
3. [GTK nsWindow](https://github.com/mozilla-firefox/firefox/blob/esr140/widget/gtk/nsWindow.cpp)
   normally calls `mIMContext->OnFocusWindow(this)` from `SetFocus`.
4. Local traces prove the commit reaches Firefox but fails without this
   native IME focused window, despite working DOM focus and raw keys.

Conclusion: an integration conflict between Firefox automation focus mode and
interactive native IME input. Matchbox replacement or BiDi removal is not
necessary to restore the tested path. Proposed minimal production fix:
`user_pref("focusmanager.testmode", false);` in driver-generated profile
settings. Do not disable all recommended automation preferences. Before
shipping, test the packaged driver, persistent-profile restart, multi-window
focus switching and downstream BiDi controls. This bounded causal experiment
does not constitute full release qualification.

Cleanup: terminated only investigation diagnostic browsers and viewer and
stopped its disposable runtime. Final health: 2991 healthy with zero active
instances; 1991 healthy with its one existing instance unchanged. Temporary
test profiles retained. No sandbox access or production behavior change.
