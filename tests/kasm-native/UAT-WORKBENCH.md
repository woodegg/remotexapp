# Native UAT workbench

The native test page keeps the remote application and per-Viewer diagnostics
in the same viewport. This extends KNA-005 and Issue #36 / Draft PR #37. It
changes the UAT presentation, not the pinned Core, SDK, Kasm component or
transport measurement contract.

Focus A, focus B and side-by-side modes preserve both iframe nodes and their
connection identities. The inactive focus panel retains dimensions but is
inert and visually hidden. Fullscreen applies to the whole workbench, including
statistics. Explicit hide, close and recreate controls remain separate from
layout changes. No additional keyboard shortcuts are intercepted.

The stats rail shows protocol, resolution, duration, UDP/WSS RTT, display-block
loss, payload rates and measured FPS for each Viewer. Cumulative counters and
queue size expand on demand. Narrow screens move statistics below the remote
surface; phones offer A/B stats selection. The page itself does not scroll;
long diagnostics and input tools scroll within their own regions. Input and
explicit local clipboard controls expand without covering the statistics.

All values use the existing read-only snapshots and sampling cadence. Empty,
disconnected and unmeasurable states remain explicit. UDP loss still means
[observed display-block loss](UDP-LOSS.md), and RTT still follows the separate
[latency contract](LATENCY.md). The embedded Viewer receives presentation-only
styles; its original transport, keyboard and clipboard controls remain active.
Standalone Viewer pages are unchanged.

## Verification

[`browser-workbench.mjs`](browser-workbench.mjs) exports `checkWorkbench` for
an authenticated, owned CDP tab containing two Viewers of a disposable Mousepad
App. Supply target-side `readDocument` and an optional screenshot callback.
Never run its typing against a user's existing application or document.

The checks measure viewport/rail/metric geometry across eight desktop/tablet/
phone sizes, actual fullscreen, focus and comparison layouts, and expanded
input tools. They check retained iframe/epoch identity, pointer/Unicode/arrow
input with saved-file readback, local clipboard actions and denial, focus
return, independent close/recreate, and browser exceptions. Keep browser tests
serial: taking foreground with a second test can change visibility behavior.
Live checks depend on SSH, a target App and an authenticated browser.

## Deployment

Package this HTML under a distinct immutable page hash. Copy the already
qualified edge executable, SDK, Viewer and component assets unchanged; verify
each retained hash. Start the pinned edge configuration on a second loopback
listener and validate its response before changing only the protected UAT
hostname's tunnel destination. Preserve the Access requirements and all other
routes. Retain the preceding listener and its configuration for rollback. A tunnel
configuration update may still interrupt existing WebSockets; keeping that
listener alive does not guarantee continuity. Account for vacant-session
cleanup before scheduling a cutover. No runtime/App restart or Core/component
replacement is needed. Refreshing the UAT page loads the new layout.

The dated result record distinguishes page identity, retained runtime/component
identity, actual checks, rollout verification and cleanup. This UI check does
not repeat native transport qualification, physical OS IME acceptance or a soak.

## 2026-11-01 verification

Page source `ef126a3c80ef446eb7abe670a402bf8333c70e28` and HTML hash
`4eaed1fc49ac08b4a373b9616aae19d69ae02e24d83d35df7e7f9686005ad7e2`
passed 91 preview checks and 91 checks on each authenticated Australia, China
and US public UAT. All eight viewport sizes, fullscreen, layout identity, real
input/readback, clipboard allow/deny, and independent close/recreate passed.
`make check` and [source CI](https://github.com/woodegg/remotexapp/actions/runs/41268928044) passed.
The [result record](results-uat-workbench-20261101.json) binds exact hashes and
records the observed transport states and retained runtime identities.

The static HTML is identical in all three regions. Retained binaries, SDK,
Viewer and component assets matched their hashes; only the protected UAT
route destination changed. Australia/China existing process identities and
saved documents were unchanged. US Core and managed desktop remained running,
but its previously open editor lost its last Viewers five seconds after the
route update, then stopped under the existing one-minute vacant cleanup policy.
Its saved files were unchanged. This is evidence that a second listener alone
does not guarantee connection continuity across tunnel reconfiguration.

Owned temporary Apps were stopped, documents removed, and browser tabs/profile
cleaned up. The previous edge listeners remain available for rollback. These
results qualify the UI change; they do not repeat the transport fault matrix,
physical OS IME or other browser engines. US test traffic used WSS; Australia
and China also supplied live UDP statistics.

![Focused Viewer with persistent statistics](uat-workbench-focus.png)

[Two-Viewer comparison](uat-workbench-split.png) ·
[Narrow-screen statistics](uat-workbench-mobile.png)
