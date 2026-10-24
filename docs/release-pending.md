# Release pending

Future requirements recorded 2026-09-18. RTC-005/006 remain unselected. AUD-001 is selected for feasibility review in
the [proposed next train](next-release-train.md), not locked implementation. Promote an
item explicitly into a future train before development and preserve its stable
ID in [requirements.md](requirements.md). This list does not reclassify other
historical deferred requirements.

## RTC-005 — multiple RemoteXApp servers

Extend RemoteXAppCoordinator to manage concurrent servers, each with its own
Manager client, authentication scope, runtime registry, observation and leases.
Isolate failure/reconnection and identical runtime IDs across servers. Preserve
base-path and login boundaries; do not equate a hostname with a server/account.

The shipped Coordinator manages one server. Reserve identity boundaries in the
current design, but defer multi-server orchestration, UI and migration. Acceptance needs
two actual servers, independent outages, auth changes and cross-target tests.

## RTC-006 — reliable external keepalive ownership

Permit a host application/native host or backend service to own keepalive interests when
all browser Tabs may be frozen or closed. Reuse the same server lease API;
define identity, authorization, explicit release, bounded stale ownership and
recovery. Do not retain Apps indefinitely because an owner disappeared.

Browser-only coordination cannot promise this guarantee. Acceptance must cover
browser termination, host/service crash, logout, transfer and eventual expiry.

## AUD-001 — server-scoped shared audio integration

Historical proposal, not shipped. The 2026-10-24
[AUD-002 native audio proposal](kasm-native-architecture.md#audio-model)
requests owner review of session audio domains, same-session shared controls,
multiple explicit mic targets and lazy connection establishment. Its proposed
replacement scope is recorded in [requirements](requirements.md#proposed-native-architecture--owner-review-pending).
Until reviewed, neither proposal is a locked implementation requirement.

Integrate shared speaker playback and microphone through one bidirectional
audio connection per server per client coordination scope. The remote audio
service belongs to the sandbox/Linux user and is shared across its runtimes
and displays. Other devices may connect independently; this is not a
server-global single-client limit.

Coordinate playback ownership across Tabs to avoid duplicate sound. Playback
and microphone have independent enabled states; default both off. Permit
per-server playback controls and one explicitly selected microphone target in
the client scope. Never route microphone by Viewer focus or silently start it
after an owner handoff. Runtime release/stop must not tear down other Apps'
audio; audio activity must not implicitly renew every runtime.

The shared stream mixes that user's applications; per-App/display audio
isolation is outside this proposal. Audio outages must not stop Viewer or
runtime operation. A future integration must establish permission/gesture,
owner-transfer, reconnection, shared-user trust and resource-cleanup contracts
and test them with actual playback/microphone and multiple Tabs.

The [KasmVNC evaluation](kasmvnc-0.16.0-evaluation.md) retains this original
scope for comparison. Review the explicit AUD-002 differences before promotion.
Audio transport and controls are outside the shipped Coordinator contract;
no unpublished plan is a public dependency.
