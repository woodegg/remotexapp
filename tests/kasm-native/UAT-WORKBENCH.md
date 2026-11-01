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
routes. Existing WebSockets may finish on the preceding listener, retained
with its configuration for rollback. No runtime/App restart or Core/component
replacement is needed. Refreshing the UAT page loads the new layout.

The dated result record distinguishes page identity, retained runtime/component
identity, actual checks, rollout verification and cleanup. This UI check does
not repeat native transport qualification, physical OS IME acceptance or a soak.
