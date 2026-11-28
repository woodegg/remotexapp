# Native clipboard destination ordering (development)

Issue [#119](https://github.com/woodegg/remotexapp/issues/119) includes the
unannounced-remote/concurrent-upload window separately from the repaired
[A-B-A echo defect](../tests/kasm-native/CLIPBOARD-ABA.md). This document selects
the destination-ordering invariant. Development implements the wire extension, conditional admission, SDK
baseline/acknowledgement handling and portable regressions. The new immutable pair
builds and passes scoped real X11/browser controls. Complete fault, resource,
natural/stress and final artifact gates remain **pending**; this is not published
or UAT-qualified.

## Why an SDK offer check is insufficient

The focused Viewer observes a local clipboard change and starts an asynchronous
browser read. Meanwhile, the remote App owns a new X11 selection. Its data may
take longer to arrive, particularly during format discovery or INCR transfer.
An ordinary upload can replace that new remote selection before the SDK sees
its offer. Checking only the latest received offer, or inserting a transport
round trip before sending, cannot atomically prove the destination unchanged.

A payload digest is not a transaction identity. Remote A after B is a new copy,
even when A appeared earlier. The fixed A-B-A comparison remains necessary.

## Selected invariant

Automatic local-to-remote submission must compare an observed destination
revision at the native selection owner, immediately before any destination or
connection clipboard-buffer mutation. Accept the complete bounded transaction
only if the revision still matches. A conflict preserves the existing remote
selection and all cached representations. Explicit paste remains an intentional
source choice; it does not silently resolve an automatic conflict.

The server advances its per-display revision when X11 selection ownership changes,
before asynchronous data discovery. Empty, unsupported or file-only selections
also invalidate an older revision even though no transferable payload follows.
Accepted imports advance the same revision. Revisions are bounded, opaque
ordering metadata; they contain no payload digest, content or wall-clock time.
Do not wrap an exhausted counter into an earlier identity.

The SDK records the observed remote revision with its actual local baseline
before an asynchronous read. It must not silently replace that expected revision
with a newer event received during the read. Only an accepted native transaction
acknowledgement advances the upload baseline. A remote offer carries its own
revision, so browser write verification and subsequent offers remain ordered.
Two simultaneous uploaders cannot both succeed against the same revision.

Keep one bounded pending submission per Viewer, with a finite deadline and
connection/target/consent fences. Stale acknowledgements cannot complete a new
operation. A timeout reports uncertainty instead of blind replay. A known conflict
preserves both sides until an explicit source choice. Existing focus, permission,
browser-local Web Locks, receipts, normalization and cancellation checks remain.
This does not add an atomic compare-and-set primitive to the browser/OS clipboard:
an unrelated local writer can still race a browser write, requiring existing
verified-delivery or uncertainty handling.

## Native extension boundary

The existing rich upload already validates and stages the whole transaction
before clearing/adding connection data or announcing X11 ownership. Place
conditional admission at that boundary, then perform comparison and mutation in
the same serialized native event-loop turn. Checking after clearing buffers is
too late. Preserve clipboard permissions and existing 10 MiB text/HTML/PNG bounds;
no file/folder transfer is introduced.

A versioned private RFB Fence extension is now implemented for the reliable
ordered channel's capability/revision messages and correlated conditional
admission around the existing rich transaction. A new
server's handshake response must differ from the old server's ordinary echoed
Fence, so echo is never mistaken for support. Conditional state must be bounded
and cancelled on disconnect or explicit replacement, without interfering with
latency probes or leaving a later manual upload accidentally conditional.
Native tests must prove this encoding and admission ordering before it is
accepted; an ordinary Fence round trip alone is not the repair. Revision advances
immediately at ownership change; one sixteen-millisecond timer per connection
coalesces metadata to the latest revision without an event queue. Each outgoing
snapshot also carries its own valid revision before its payload. At most one
metadata notification is unacknowledged per connection; further owner changes
coalesce into the latest counter until the client processes it. A frozen or slow
document cannot build a queue of revision notifications. Do not stamp a
delayed cached payload with a later selection's revision.

The development v4 pair uses one fixed-size armed admission per connection.
Complete validation precedes comparison; an accepted response additionally
requires revision advance and confirmed X11 CLIPBOARD ownership. Conditional
uploads require an explicit expected revision. Only an explicit source-choice
call uses unconditional admission; a missing revision is never treated as one.
SDK `ordering` reports `ready`, `waiting`, `unavailable` or `unsupported`, with no raw revision
or clipboard content in state. Normalized local baseline and native destination
baseline are committed separately. Late native admission after cancellation
cannot recreate the owner's old baseline or intent.

Browser clipboard I/O retains its five-second observation bound. Native transfer
admission gets a separate size-based budget: ten seconds plus one second per
256 KiB, up to fifty seconds at 10 MiB. This is a wait budget, not a throughput
guarantee. Explicit paste can wait for an existing transfer and its own submission;
the input gate remains bounded by 128 events and 120 seconds, releases modifiers
on cancellation and checks elapsed time before replay. A suspended event loop
cannot make a late ACK, browser result or paste key valid merely because its
timer callback has not run. Freeze retires clipboard work; a still-focused
Viewer rebaselines on resume without clearing requested modes.

Publish a new immutable server/client pair and manifest capability. Development
recipes emit `kasm-wss-clipboard-v4` or `kasm-routed-udp-clipboard-v4` while retaining
the rich-v2 10 MiB runtime limit. The SDK must
not claim conditional automatic upload safety on an older component. Expose an
honest directional manual fallback while retaining supported remote-to-local
automatic operation and explicit transfer. Core pin validation, SDK types,
adoption instructions and UAT diagnostics must describe that boundary together.
The host declares intent and renders effective/conflict/uncertain state; it does
not implement a clipboard recovery or ordering loop.

## Partial native uploads (development repair)

The [real partial-upload control](../tests/kasm-native/results-native-clipboard-partial-stall-20261128.json)
passes A-B-A, delayed/unannounced owner conflict, explicit source choice, INCR
and simultaneous two-Viewer admission, then reproduces a separate blocking-read
defect. Holding a rich body after its first 24 bytes prevents an independent X11
owner operation from finishing until the tail is released. Final destination
readback survives, but this stalls the shared desktop and is not an acceptable
slow-link design. A completed ordinary upload does not exercise that boundary.

Development patch 0030 stages one transaction per connection incrementally using
nonblocking availability checks and yields the native event loop while incomplete.
Only complete validated representations reach final revision admission/mutation.
One absolute fifty-second native deadline bounds an incomplete body; progress
cannot reset it. A timer closes a stalled connection even if it sends no further
bytes, freeing its staged data. Completed transactions release staging before the
next message. This bound is separate from browser I/O and size-based SDK waits.
The same split-body test and actual peer responsiveness must pass before this
repair is qualified. Other small upstream RFB message readers are unchanged;
this repair does not claim that all native message parsing is nonblocking.

## Scoped real native control

The [twelve-case development control](../tests/kasm-native/results-native-clipboard-ordering-20261128.json)
uses committed Core/embedded SDK and a fully rebuilt v4 native pair. The same
split-body failure now permits the independent X11 copy to finish before release,
rejects stale admission and preserves the destination. Actual A-B-A, unannounced
owner conflict, explicit source choice, INCR and two-Viewer competition pass.
With 1,000 X11 owner changes and ACKs withheld, each of two connections sends
only one revision notification. Releasing ACKs restores current observation.
Actual page freeze disconnects the Viewers; both recover automatically with
requested manual modes retained. Exact 10 MiB conditional upload/X11 readback
and one-byte oversize preservation also pass.

This is a scoped development control, not full natural/stress/resource or final
artifact acceptance. That older pair does not contain the subsequent
current-policy follow-up. The current-pair control below supersedes its native
format/slow-payload/permission scope; full automatic modes, more real SDK
documents, audio combinations and the fault/resource/candidate gates stay open. Earlier native failure and
incomplete driver attempts are retained rather than combined into a single run.

## Required proof

- Preserve the original A-B-A text/HTML/PNG cases and genuine-echo controls.
- Force an actual X11 owner change before its offer reaches the browser, during
  a delayed local read and during a split upload. Stale admission must leave
  remote data and peer caches untouched, including delayed INCR snapshots.
- Exercise same-owner repeated copies, empty/unsupported/file selections,
  multiple Viewers/tabs and simultaneous uploaders. Correlate accepted/rejected
  acknowledgements with actual destination readback.
- Cover timeout, late/wrong acknowledgement, disconnect/reconnect, old runtime,
  permission/focus/off/logout and explicit manual paste after conflict.
- Test exact/oversize and malformed text/HTML/PNG transactions, atomic rejection,
  byte budgets, queue/arm limits and preservation of clipboard policy/latency.
- Verify old component fallback, matching new component capability and exact
  immutable source/binary provenance. Then include these paths in the combined
  natural/stress and final-candidate gates; models alone cannot prove the native
  selection boundary.

When incremental native staging yields, format/byte policy may change. Revalidate
current policy immediately before admission, in the same final event-loop turn;
parsed earlier headers are not lasting permission. Mid-transfer policy rejection
must leave the prior destination and connection cache untouched.

## Current exact-pair development control

The [eighteen-case control](../tests/kasm-native/results-native-clipboard-current-pair-20261128.json)
uses Core/embedded SDK and the fully rebuilt v4 pair from `9f608cf`. It repeats
unannounced-owner, A-B-A, INCR, simultaneous admission, split-body and bounded
metadata checks. A real background tab precedes forced freeze; returning verifies
actual visibility/focus, requested-mode retention and fresh per-Viewer RTT.
An old ready state or CDP lifecycle `active` alone is not recovery proof.

Real browser/X11 text, HTML and PNG readback passes in both directions, including
PNG dimensions/pixels. A real public SDK action sends 10 MiB at an owned nominal
262,144 bytes/second and completes in about 41 seconds. Fresh peer RTT and owned X11
commands at four points remain responsive. Exact-limit, one-byte-oversize and
explicit empty-clear controls also pass. This is not a WAN throughput claim.

Supported native `AcceptCutText`/`SendCutText` switches change after body staging;
verified set/readback, rejected unconditional admission and unchanged destination
prove current-permission fencing without a stale CAS masking it. Default native
`AllowOverride` excludes MIME/byte limit changes: those limits stay fixed per
pinned runtime. Their late-validation repair retains compiled-reader red/green
coverage; no new live configuration authority is introduced for testing.

The earlier active-visible forced-freeze controls retain their narrower results.
The current run proves actual background/return setup before browser I/O. It is
still single-document/manual-mode freeze qualification, with no audio allocation,
full fault-class, natural/stress or final-candidate acceptance. Owned runtimes,
services, browser/profile and dedicated test container are retired; existing UAT
is preserved. See [reproduction and limits](../tests/kasm-native/NATIVE-CLIPBOARD-ORDERING.md).
