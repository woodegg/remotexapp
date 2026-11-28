# Native clipboard ordering and partial-upload control

Issue [#119](https://github.com/woodegg/remotexapp/issues/119) owns systematic
qualification. The [contract](../../docs/native-clipboard-ordering.md) and
[requirements](../../docs/requirements.md) define destination admission, bounded
staging and intent/permission boundaries. This record is scoped development
proof, not release, human UAT or full fault/resource acceptance.

The [original native failure](results-native-clipboard-partial-stall-20261128.json)
holds a rich transaction after 24 bytes: an unrelated X11 owner cannot complete
until its tail is released. The final destination survives, but a slow sender
stalls the shared desktop. Incremental nonblocking staging fixes that failure
while keeping complete validation and final atomic revision admission.

The [current eighteen-case control](results-native-clipboard-current-pair-20261128.json)
uses committed Core/embedded SDK, current built helpers, fixed unchanged drivers
and an independently pinned native v4 pair. Product/source/manifest hashes and
private evidence hashes identify its exact scope. Sandboxed headed Chrome uses
native CDP and actual X11 clipboard data, with no focus emulation or periodic GC.

| Area | Checks |
| --- | --- |
| Admission | Handshake, A-B-A, unannounced-owner/local-read conflict, explicit source choice, stale native submission, simultaneous Viewers and split-body responsiveness |
| Snapshots/formats | Actual INCR; browser-to-X11 text/HTML/PNG; X11-to-browser text/HTML/PNG including decoded PNG dimensions/pixels |
| Bounds | Exact 10 MiB, one-byte oversize preservation and acknowledged explicit empty clear |
| Metadata | 1,000 same-window owner changes with one unacknowledged notification per connection |
| Lifecycle | Actual background before freeze; visible/focused return, retained manual intent and fresh per-Viewer RTT |
| Slow sender | A public SDK action takes about 41 seconds for 10 MiB under bounded payload pacing; peer RTT/X11 commands remain responsive |
| Current permission | Supported native receive/send switches change after staging; verified mutation/readback, rejection and unchanged destination |

## Permanent narrow checks

Build a fresh immutable component from the checked source archives described in
[the component instructions](../../third_party/kasm/README.md). The builder runs
applied-source native tests; it does not install a runtime or service. Use fresh
work/output directories. The real control uses its reliable WSS path even though
the component is compiled with optional UDP support.

For an already applied source tree, run the mandatory SDK and native regressions:

```sh
node --test cmd/remotexappd/web/sdk/native-clipboard.test.mjs \
  cmd/remotexappd/web/sdk/native-clipboard-data.test.mjs \
  cmd/remotexappd/web/sdk/remotexapp-native-client.test.mjs \
  third_party/kasm/tests/clipboard-order-client.test.mjs \
  third_party/kasm/tests/clipboard-order.test.mjs \
  third_party/kasm/tests/clipboard-input.test.mjs
KASM_SERVER_SOURCE="$WORK/server" node --test \
  third_party/kasm/tests/native-clipboard.test.mjs
```

The compiled reader harness tests every truncation, byte-at-a-time continuation,
no mutation/admission before completion, absolute expiry, late owner conflict,
changed byte/format policy, malformed representations and aggregate limits under
ASan/UBSan. Without `KASM_SERVER_SOURCE`, that applied-reader test is explicitly
skipped; ordinary portable success must not be called native parser proof.

## Real control reproduction

Use only a disposable project-owned runtime and browser. Keep fixture addresses,
identity configuration, remote-executor arguments, units, profiles, native
credentials and raw evidence outside Git. Existing browser fixture helpers and
the repository's native CDP driver provide transport/input primitives; the run's
private controller supplies its owned environment.

1. Confirm the exact Core/SDK/component and actual headed browser version. Grant
   clipboard permission for the owned origin and verify actual visibility/focus.
   Open two Viewers for one runtime; prove the new ordering handshake.
2. Exercise A-B-A and real selection readback. Wait for verified delivery to
   settle before beginning an unrelated next case. Hold a browser read, change
   the real X11 owner with delayed TARGETS discovery, then release it. Stale
   upload must conflict with both copies preserved. Resolve only by explicit
   source choice.
3. Split one native rich body across WebSocket messages and hold its tail.
   Complete an independent X11 copy before releasing the tail; final admission
   must conflict. A second Viewer using the same revision must not also win.
4. Withhold only content-free revision acknowledgements. Produce repeated X11
   ownership changes on the same window; count actual wire notifications, then
   release ACKs and observe the current selection. Never serialize clipboard
   payloads into public diagnostics.
5. Bring a real other tab to the foreground before freezing the test page.
   Unfreeze, return normally and verify actual visibility/focus and fresh RTT
   on the current displays. A ready flag or lifecycle `active` alone can precede
   queued connection-close events or leave an artificially frozen visible tab
   hidden. A no-SDK native control distinguishes that setup error.
6. Use real test-control clicks for public SDK manual transfers; an unactivated
   evaluation is not an explicit browser action. Verify text/HTML and PNG pixels,
   exact/oversize preservation and explicit clear. Pace the owned 10 MiB sender
   at 32 KiB per 125 ms, retain its finite deadline and sample the peer throughout.
   Respect the five-second RTT probe rate limit and verify sample freshness.
7. Change existing `AcceptCutText`/`SendCutText` switches while a body is staged.
   Check command stderr and native readback: `vncconfig` can report failure while
   exiting zero. Use unconditional source choice in this test so a stale CAS
   cannot mask a missing permission check. Reject without mutation; restore the
   exact previous value and verify the peer.
8. Default native `AllowOverride` excludes MIME/byte parameters. Do not add an
   override for a test: these are pinned runtime limits, not a new hot-reload
   API. Compiled-reader red/green cases cover late MIME/byte revalidation.
9. Stop owned Apps, browser/profile, controller and service; verify cleanup and
   the initially stopped fixture container. Preserve unrelated sessions/UAT.
   Retain failed/incomplete runs separately; never concatenate them into a soak.

## Remaining gates

These controls do not cover every actual App/toolkit, automatic-mode suspension,
independent SDK documents, physical clipboard/device behavior, audio combinations,
all 24 audio fault classes, WAN loss/jitter, long-term allocation or release
artifacts. Background manual-mode retention is distinct from automatic clipboard
focus eligibility. Browser/OS clipboard writes still cannot provide atomic CAS
against unrelated local writers. The actual WeChat incident is not captured.

Complete the [whole self-recovery gates](../../docs/native-self-recovery.md),
including natural eight hours and separate 90-minute/1,000-operation stress,
verified PSS/Pss_Anon/SwapPss/heap/native review, matching immutable final candidate
and one complete human UAT. Short functional and queue observations cannot close
those gates.
