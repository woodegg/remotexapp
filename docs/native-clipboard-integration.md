# Native automatic clipboard integration requirements

Status: requirements selected by the owner on 2026-11-01; implementation and
qualification pending. [Issue #50](https://github.com/woodegg/remotexapp/issues/50)
tracks this follow-on under the proposed 0.16.0 milestone. This document does
not enable automatic clipboard access in a current build.

## Problem and current behavior

A user should be able to opt into copying text between a local application and
a remote App without pressing a transfer button for every copy/paste operation.
The [upstream KasmVNC client](https://docs.kasmvnc.com/docs/clientside/#clipboard-seamless)
provides Clipboard Up, Clipboard Down and Clipboard Seamless in supported
Chromium browsers. That capability is input to this work, not evidence that
RemoteXApp has integrated or qualified it.

The current native adapter sets `clipboardSeamless = false`. Its patched
receiver emits bounded text events instead of writing directly to the browser
clipboard. `RemoteXAppNativeClient` requires a focused user gesture for each
browser transfer. See the [implemented SDK contract](browser-sdk.md#native-inputclipboard-checkpoint-development-sdk-0310-dev2)
and [manual checkpoint evidence](../tests/kasm-native/D2-UAT.md). Changing one
adapter flag cannot establish the feature while those restrictions remain.

The legacy `RemoteXAppClient.clipboard` supports automatic directions, but its
separate gateway/offer implementation must not run alongside the native path.
Native SDK consumers need a supported native contract; importing the legacy
controller is not migration.

## Required user and SDK behavior

Stable requirements KNC-001–008 are registered in [requirements.md](requirements.md#native-automatic-clipboard-integration).
Exact API names are to be specified and tested in the implementation PR, not
inferred from the legacy SDK or private Kasm internals.

- Expose local-to-remote and remote-to-local configuration independently, with
  off, manual and automatic operation. Default both directions off. Automatic
  mode requires explicit opt-in and suitable browser permissions; a successful
  authorized copy/paste cycle needs no extra transfer-button click. Preserve
  manual transfer and clear actions.
- Reuse Kasm's native clipboard transport and seamless behavior through the
  supported adapter. Limit SDK policy to consent, target selection, capabilities,
  lifecycle and bounded state. Do not add a parallel legacy bridge, use clipboard
  as an automatic input fallback, or expose private Kasm objects as the SDK API.
  Record necessary upstream adaptations and tests with the pinned component.
- Expose actual format capabilities and requested versus effective directional
  modes, including unsupported, disabled, permission-required and manual-fallback
  states. Denial, revocation or unavailable APIs must not be displayed as auto
  success. Permission requests require explicit activation; focus alone must not
  create a permission prompt.
- First qualify plain UTF-8 text up to 64 KiB, including Chinese, emoji and
  multiline content. Retain server validation before allocation/mutation,
  bounded client parsing and queues, empty-read no-op and explicit clear.
  HTML/PNG need separate qualification before capability advertisement. RTF,
  file objects, directories, drag-and-drop and upload/download are outside this
  text increment.

## Focus, consent and ownership

The browser clipboard is shared local state. Automatic synchronization must
target only the focused/active, connected Viewer with the relevant direction
explicitly enabled. Hosts must express activation through the supported SDK
focus contract. Connecting or receiving a clipboard event must not select a
Viewer. With no eligible target, perform no automatic browser read/write.

Two Viewers of one runtime and two different runtimes retain independent
consent. Multiple tabs must not produce duplicate local writes or echo loops.
Switching targets must not broadcast local contents to unrelated Apps; inactive
or hidden Viewers must not overwrite the local clipboard. Native notifications
may reach multiple Viewers, but do not authorize each to mutate the local
clipboard. Audio ownership or speaker/mic switches never select the target.

Before applying asynchronous results, revalidate the target, Viewer connection,
runtime generation, consent revision and authenticated scope. Disable, blur,
hide, disconnect, disposal, generation replacement and logout/account change
retire pending automatic work for the old target. Reconnect requires new
consent. Do not replay old content when a target becomes active: establish
fresh state. If both sides changed and the source cannot be determined, require
a visible manual direction choice rather than silently choosing a winner.

A browser write started before retirement may finish despite cancellation.
Preserve the uncertain outcome; do not report cancellation or replay it. Native
submission is not proof of remote App paste. Text, previews and content
fingerprints must stay out of logs, diagnostics, exported results and browser/
server persistence. Tests use synthetic clipboard contents in an isolated
browser and disposable documents.

## UAT and evidence

Extend the existing workbench with a visible clipboard entry, independent
direction controls, active-target and permission/fallback indicators, manual
actions and a result matrix. Use the local text area and a real remote editor
for both directions. Distinguish unexecuted cases, operation status and actual
paste/readback. Keep frame statistics visible during clipboard interaction.

| Case | Required evidence |
| --- | --- |
| Local to remote, remote to local and both directions enabled | Remote editor paste/save and local clipboard readback with Chinese, emoji and multiline synthetic text; ordinary copy/paste needs no extra transfer action after opt-in |
| Consent and permissions | Off/manual/auto transitions, one direction disabled, initial denial and later revocation; no hidden read/write or automatic permission prompt; visible manual fallback |
| Multiple Viewers and tabs | Same-runtime A/B, different runtimes, two tabs, focus switching, blur/hide/show and no eligible target; no cross-session paste, duplicate local write or echo loop |
| Races and lifecycle | Delayed reads/writes across target change, disable/re-enable, disconnect/reconnect, disposal, generation and logout/account change; stale work fenced and uncertain writes identified |
| Bounds and contents | 64 KiB UTF-8 boundary, one-byte oversize, malformed input, empty no-op, explicit clear, unsupported MIME types and conflicting source changes; rejection leaves the other clipboard unchanged |
| Display and audio coexistence | Embedded and standalone Viewers over WSS and established WebRTC display, including UDP fallback; repeat with speaker/mic enabled when qualified audio is available; audio changes do not retarget clipboard |
| Compatibility and host ownership | Manual native API and legacy-provider regression; actual embedding-host focus/workspace integration recorded separately from generic workbench tests |

Run focused SDK/component/server tests and `make check`, plus applicable
coverage, race and vulnerability gates. Record exact Core/SDK/component source
and artifact identities, browser versions, operating systems and real readback
results. Granted automation permissions do not qualify first-run user consent.

Chrome and Edge are the initial seamless acceptance targets. Record actual
Windows, macOS and Linux results and explicit untested/unsupported combinations;
do not infer one OS/browser result from another. Other browsers require honest
capabilities and qualified manual fallback before claiming support. Finish
automation before one consolidated physical end-to-end UAT. Historical PoC and
manual-checkpoint results do not accept this feature.

## Delivery and compatibility

1. Review this requirements-only PR with `Refs #50`. Keep the Issue open.
2. Use a separate linked implementation PR for the SDK/adapter, minimal native
   changes, workbench and tests. Update API/version/provenance records with the
   actual implementation and pin changed components immutably.
3. Qualify the candidate, then collect complete human UAT. Review, merge,
   post-merge qualification, release and downstream deployment remain separate.

This follows [Issue #32](https://github.com/woodegg/remotexapp/issues/32), without
reinterpreting its manual D2 acceptance. It prospectively supersedes only the
per-transfer-gesture restriction for an explicitly opted-in automatic mode
after implementation and qualification. Default-off, server authorization,
bounds, consent/generation fencing and manual behavior remain. Read-only role
authorization and rich formats are not implicitly delivered by automatic text.

Clipboard stays on the native reliable control path regardless of display
UDP selection; it needs no new UDP ports and does not share the audio WSS.
[Audio Issue #45](https://github.com/woodegg/remotexapp/issues/45) and
[PR #49](https://github.com/woodegg/remotexapp/pull/49) retain their scope;
coexistence is a later combined-candidate gate. No App, runtime pin, deployment
or provider default changes as a result of this document.
