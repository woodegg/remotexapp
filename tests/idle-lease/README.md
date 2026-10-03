# Runtime idle lease qualification

Unit contracts are `cmd/remotexappd/idle_lease_test.go`, SDK Coordinator tests,
and Client ownership tests. Run the normal pinned-toolchain `make check`,
`make test-race`, `make coverage-check` and `make vuln-check` gates.

## Coordinator panel (RTC-007)

Run `node tests/idle-lease/check-coordinator-panel.mjs` after `make web-assets`.
Requires Google Chrome, Node with WebSocket support and the local Console on
127.0.0.1:1991 (override with `REMOTEXAPP_PANEL_TEST_URL`, loopback only).
It launches its own browser, intercepts its asset requests with the current
build, and uses read-only Console endpoints. Existing deployed assets and Apps
are untouched. Two real browser Tabs run Coordinator against in-memory Manager
fixtures: this qualifies UI/coordination, not the server idle-lease API.
Checks cover the built Console button, passive empty panel, peer/interest/lease
rendering, closed-leader takeover, renewed ownership, event history and closing.
The script prints a temporary evidence directory containing result and screenshot.
SDK tests separately cover snapshot privacy/cloning/bounds and DOM timer cleanup.

The 2026-09-18 source follow-up passed `make check` and this browser check.
It is not part of the prior RC.2 deployment evidence or a claim of human UAT.

## Full idle-lease qualification

`run-local-e2e.mjs` is an explicit live test, not a portable CI job. It requires
an extracted candidate archive, a disposable non-root Linux account with a
running user systemd manager, all eight shipped App dependencies, Google Chrome,
Node with WebSocket support, X11 tools, and free loopback ports 21997/9297.
Never point it at an existing Manager or use the desktop owner's account.
Set `REMOTEXAPP_LEASE_TEST_UID` to the disposable account UID and
`REMOTEXAPP_LEASE_RELEASE_ROOT` to the extracted archive. Copy this test and the
SDK Manager source/module metadata into the equivalent archive-relative paths.

The test installs private fixture Apps under a new temporary directory: prefixed
IDs, 12-second vacancy policy, relocated XFCE display, and a Mousepad shutdown
refusal wrapper for enforcement tests. Production templates are not modified.
The local container's WebKit sandbox exception is set only on the disposable
user manager; this does not qualify production WebKit sandbox support.

Coverage includes every App's real Viewer attach/detach, no-RFB lease survival,
policy expiry, on-attach no-start, Manager adoption, real Chrome Tab freeze and
takeover, all-Tabs-frozen expiry, ownership release, restart/upgrade generation
fences, explicit stop, natural exit, managed desired-stop and blocked shutdown
with host enforcement across Manager restart. Output reports exact checkpoints
and retains `result.json` plus fixture state in its printed temporary directory.
Clean up only that account's test resources afterward; preserve the evidence.

For focused reruns, `REMOTEXAPP_LEASE_APPS=xfce-user-desktop` narrows the App
loop, while `REMOTEXAPP_LEASE_MATRIX_ONLY=1` runs only the lifecycle matrix.
Neither focused mode substitutes for the full candidate run. Do not count a
failed run as passed merely because earlier checkpoints succeeded.

After isolated qualification has finished, run
`node tests/idle-lease/check-local-deployment.mjs --local-deployment`.
This tests the actual Console/kiosk checkbox on 2992 then 1991, including a
disconnected Mousepad surviving longer than its shipped 60-second timeout.
Do not run it concurrently with Manager-restart tests or other live X-display
allocation suites: local Managers share the host display namespace. Run
`node tests/session-services/check-local-deployment.mjs --restart-local-managers`
separately for actual Unicode/clipboard, reconnection and helper-fault regression.
