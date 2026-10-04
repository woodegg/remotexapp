# Microsoft Edge App Package release train

> Historical technical record. Dated status and validation statements describe
> their original scope; they do not identify a current deployment. See
> [current source versions](current-state.md). Host labels and runtime IDs in
> historical examples are anonymized.

Follow-up accepted 2026-09-17: EDGE-005 advances the independent package to
`edge@2.0.2` with fail-closed stale Chromium singleton-link recovery. It changes
only the Edge package. Complete local validation and loopback 1991/2992 UAT
passed; formal GitHub publication is authorized. Sandbox deployment remains a
separate approval.

Published and closed 2026-09-17 as annotated tag
[`edge-v2.0.2`](private-history.md).
The release contains only `edge-2.0.2.tar.gz` and its checksum; downloaded
bytes match local UAT SHA-256
`aa0e33cb60db69c211582a52b702b50dbcad4397a274ff969996a713895e84f7`.

Status: EDGE-001 through EDGE-004 were scope-locked on 2026-08-30, implemented
as App Package `edge@1.0.0`, and formally released as GitHub tag
`edge-v1.0.0`. The exact package was deployed and accepted by automated
production checks on test-host-a, test-host-c, test-host-d, test-host-h, and test-host-k.
No other sandbox deployment is authorized.

## Outcome

Ship Microsoft Edge as the independently deployable App Package and template
ID `edge`. Reuse the proven `edge-browser` drivers and generic App Package ABI
instead of adding application knowledge to RemoteXApp core. The old
`edge-browser` ID is superseded rather than retained as a second active Edge
template because both would contend for the same persistent browser profile.

The template is a shared anonymous singleton using profile `default`. Its
server starts on demand, its session starts on first viewer attach, and six
hours without a viewer stops the complete instance while preserving the
profile. The display remains dynamic 1280x720, depth 16, 5 FPS, with client
resize enabled. Parameters remain bounded `startUrl` plus optional `incognito`.

## CDP control contract

The manifest requests one generic `loopback-tcp` resource with port `0`; the
manager allocates an available unprivileged port on `127.0.0.1`. The driver
starts Edge with that exact debugging address and port. Ready requires both a
visible `microsoft-edge` window and a complete CDP probe: bounded
`/json/version`, validated browser WebSocket URL, successful WebSocket
handshake, and `Browser.getVersion` response.

Instance `resources.control` returns the generic address and port. Ready
`applicationStatus.details.control` returns `protocol: cdp`, the matching
address and port, `endpoints.versionUrl`, the discovered
`endpoints.browserWebSocketUrl`, and bounded browser product/protocol metadata.
The browser WebSocket path is discovered after Edge starts and must not be
constructed by the manager or SDK. Raw CDP remains loopback-only and is never
reverse-proxied.

## Change boundary and migration

Implementation is limited to the `edge` package manifest, server/session/
shutdown drivers, CDP probe, package tests, and documentation. No Go binary,
browser SDK, global preflight, or unrelated App is changed or rebuilt. The host application
already owns a CDP adapter; when it adopts `edge`, it changes the adapter key,
fixtures, and deployment expectation from `edge-browser` to `edge` without a
RemoteXApp ABI change.

Migration must stop any `edge-browser` runtime, prove zero clients, disable its
selector, and prove its CDP listener and units are gone. Because profile roots
are keyed by template ID, the inactive `profiles/edge-browser/default`
directory must then be renamed atomically to `profiles/edge/default`; migration
fails closed if both source and destination already exist. Activate `edge` only
after that rename, then restart the manager. Never enable both IDs
concurrently. Acceptance proves the old runtime and port are gone, the new
singleton is reusable, manager restart adopts it without churn, detached
expiry cleans the runtime and port, and the next create reuses the profile.

## Local release evidence

The 2026-08-30 candidate passed `make check`, `make test-race`, and two real
X11/RFB/CDP shipped-App runs on the isolated local manager at
`127.0.0.1:21991`. The exact six-hour manifest run covered singleton reuse,
input, resize, visible/CDP readiness, concurrent Firefox port allocation,
manager restart adoption, explicit shutdown, profile reuse, and cleanup. A
test-only `3s` package version exercised the same detached `stop-instance`
policy and proved terminal state, manifest/runtime removal, inactive units,
closed CDP, and retained profile. The deterministic `edge-1.0.0.tar.gz` digest
is `0ab9d97f549fe24657f4d45ffe04d6c6f4cf82338cce0ca48a04f3d025235a37`.

test-host-a was the initial authorized production target. The operator later
authorized ordered promotion to test-host-c, test-host-d, test-host-h, and test-host-k;
all five deployments passed the read-only preflight and fail-closed profile
migration above.

## test-host-a production evidence

Production activated `/usr/local/share/remotexapp/apps/edge/1.0.0` from source
commit `4d9f27a49998` with archive SHA-256
`0ab9d97f549fe24657f4d45ffe04d6c6f4cf82338cce0ca48a04f3d025235a37`
and installed content SHA-256
`4d1dffde7b62afb38e6f88fad0e9e0485fb79569f662e4a51ec4adb3a7f746b7`.
The old selector is absent. No old Edge runtime or persistent `default` profile
existed, so migration left the unrelated historical `temporary` profile
untouched and created the new profile only on first launch.

The core remained `0.2.0-rc.4` commit `b21524c08d6e`; no core or SDK artifact
was deployed. The production manager restarted twice and adopted the existing
XFCE and Firefox runtimes with all eight unit PIDs unchanged. A real headless
viewer established the noVNC/RFB connection and reached a visible Edge window
plus live CDP ready state on dynamically allocated port 21001 while Firefox
remained healthy on port 21000. Singleton reuse, policy projection, control
status, `Browser.getVersion`, old-ID rejection, cleanup, closed-port behavior,
and profile reuse passed. The final manager restart removed test-only stopped
records; production ended with only the original desktop and Firefox runtimes,
zero clients, no Edge process/listener, and no warning-level service journal
entries. Build-host access to the LXD private IP was unavailable, so all live
checks used container loopback through direct `lxc exec`; the production
gateway was not used.

## GitHub publication evidence

The final source commit is `e19125384bdac50c19cdba4ffa33148bc5e01d24`.
Annotated tags `v0.2.0-rc.4` and `edge-v1.0.0` both resolve to that commit.
The core tag workflow passed history scanning, all portable release gates,
generated-source verification, and publication. Its GitHub archive has
SHA-256 `834c3a7425930072e8a1c11c198e4569e205216d1d6cb8e4a10baa0e5b4eeacf`
and embeds `edge-1.0.0.tar.gz` with the accepted package digest
`0ab9d97f549fe24657f4d45ffe04d6c6f4cf82338cce0ca48a04f3d025235a37`.

The independent Edge release publishes that package archive and its checksum
as separate assets. Fresh downloads of both releases passed their published
checksum files, and the downloaded Edge manifest reports exactly
`remotexapp/v1`, `edge`, and driver version `1.0.0`.

## Follower deployment evidence

test-host-c, test-host-d, test-host-h, and test-host-k replaced their unpublished
rc.4 candidate with the formal core artifact and activated the embedded Edge
archive, which is byte-identical to `edge-v1.0.0`. All had zero clients, no old
Edge runtime, and neither `edge-browser/default` nor `edge/default` before the
change, so profile migration correctly performed no move. The old
`edge-browser` selector is absent and the new selector resolves exactly to
`edge/1.0.0`; the installed archive and content seals match the published
digests.

Each follower passed a real headless viewer over noVNC/RFB, dynamic framebuffer
resize from 1280x720 to 900x640, SDK reconnect, visible Edge readiness, and a
live loopback CDP result reporting `Edg/150.0.4078.83` and protocol 1.3.
Allocated control ports were 21000 on test-host-c, test-host-d, and test-host-h and
21001 on test-host-k, proving the port is not fixed. Every test runtime, viewer,
and control listener was then stopped; a final manager restart removed the
test runtime and adopted the same Desktop runtime ID. Final fleet verification
found zero clients, zero active Edge runtimes, zero open App control ports, and
zero warning-level manager journal entries.
