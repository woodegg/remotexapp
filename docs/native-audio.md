# Native audio integration

Development contract for Core `0.16.0-dev.4` / SDK `0.31.0-dev.4`, tracked in
[Issue #45](https://github.com/woodegg/remotexapp/issues/45) and
[PR #49](https://github.com/woodegg/remotexapp/pull/49). The opt-in standalone
integration is implemented and automatically qualified at
[immutable candidate 7926949](../tests/native-audio/qualification-7926949.md).
The owner reported the current standalone audio UAT passed on 2026-11-01.
That human decision is separate from automated measurements; no per-device,
per-browser or per-region checklist was supplied. Actual embedding-host
acceptance, post-merge qualification and publication remain separate.

## Ownership and compatibility

Development SDK 0.38 / Worker 8 implements the selected
[self-recovery contract](native-self-recovery.md): the owner expresses intent
once, and valid intent may survive Worker replacement or reacquire an ended
source when current permission is granted and a fresh target writer is reserved.
The initial browser permission remains explicit; automatic recovery never
prompts. A ready source and a current processor delivery ACK are both required
for `actualMic`. `microphonePending` reports setup/recovery separately from
`microphoneActionRequired`. Temporary access rejection stops capture and parks
intent; an observed identity change retires old interests. This supersedes
the older manual-resume statements below for this new SDK only. Its real browser,
full fault/resource and release qualification are not complete. Twenty actual
silent exits now pass a scoped headed SDK control; see the self-recovery plan
for the separate resource observation and remaining graph defects.

For failure causes, the distinct epoch fences, automatic-recovery limits and
isolated fault-injection steps, see [audio faults and recovery](native-audio-faults.md).

Core 0.17.5 / SDK 0.35.0 implements
[integration intent recovery](integration-intent-recovery.md). Fresh accepted
requests and runtime grants permit transient recovery without a login-session
header. Requested microphone state survives an ended capture and is exposed as
`requested.microphone` with `microphoneActionRequired`. The login-header recovery
conditions below describe the Core 0.17.4 implementation.

`-native-audio` opts new Kasm runtimes into `pcm-s16le-48k-v1`. The default provider
and existing runtime pins are preserved. Audio pins use durable schema 6;
old Core rejects that format. Existing schema 2–5 records retain their original
audio capability. A runtime upgrade cannot silently change its audio contract;
stop/recreate the selected owned runtime under normal shutdown policy.

The selected non-root account needs `pulseaudio`, `pactl`, `pacat` and `parec`.
These are external distribution packages; Go remains statically buildable.
The supervisor creates a private Pulse domain before App launch, including
separate runtime/state/configuration/cookie paths and virtual speaker and mic
devices. It passes explicit PULSE variables to the App without editing HOME or
the account's audio configuration. `autospawn=no` prevents a failed private
domain falling back to an account mixer. Applications that explicitly override
their Pulse endpoint are outside this routing contract.

Audio-only recovery is independent of D-Bus, input and the App. A temporarily
unavailable domain pauses only that App’s route; other Apps retain playback and
explicit microphone targets on the same connection. A recovered domain may
restore its requested speaker, but its microphone target stays off. Scope
authentication or shared-transport failure still fences all capture. A replacement
has a new domain ID at the App's stable private endpoint. Retries back off to
30 seconds after three failures. Normal session cleanup closes owned audio;
borrowed account audio remains untouched. Same-UID separation is functional
routing, not security between malicious applications. Use UIDs/containers for
mutually untrusted tenants.

## Audio interests and browser behavior

`RemoteXAppAudio` is independent of `RemoteXAppNativeClient`. Acquire an audio
interest for a prepared runtime ID and generation; call `setSpeaker` or
`setMicrophone` from a user action. Releasing a Viewer does not release an
explicitly retained audio interest. Releasing the last reference for a session
removes its routes. Hidden workspaces retain their interests; page retirement
releases that page's references. Audio does not attach a Viewer, launch an App,
cancel a shutdown or renew its vacancy/keepalive lease.

The coordinator scope is canonical same-origin Manager base, browser profile /
storage partition, current authenticated account and service/login epoch.
SharedWorker deduplicates same-session switches across tabs and chooses a single
playback owner. A microphone is captured once and sent only to explicitly enabled
targets. Each remote domain has one server-enforced writer. Another profile sees
a conflict unless it explicitly requests takeover. A lost microphone owner,
revoked permission or ended device stops capture. A transport-only outage can
retain the live owner for up to 12 seconds under current ingress access, browser
permission and fresh Manager route grants for the same runtime generation. Playback handoff requires a previously unlocked
AudioContext; a page without a user gesture must report that limitation.

No capture, AudioContext or audio WebSocket is created by merely launching an
App. The first enabled speaker/mic opens one WSS; additional sessions reuse it.
All off releases the WSS and capture. Server-side retirement of the last
enabled App also releases the WSS on the next coordinator reconciliation;
retained references alone do not keep an empty audio connection open. Enabled silence retains the connection.
An unresponsive SharedWorker has a ten-second active-page watchdog.
Worker failure stops capture and playback and retains the live handle.
Tabs rejoin the same named worker. If the existing worker fails to respond to
initialization, browsers with Web Locks and writable origin storage can agree
on one replacement name. The Manager grants at most one socket per audio scope.
The SDK restores requested speaker routes for the same live owner and runtime
generation after current access and fresh route grants succeed. Optional login
metadata can fence a changed identity; a separate login-session header is not
required. A fresh page starts with audio off, and retired ownership cannot replay
an earlier request. A live microphone may resume only after a fresh route
acknowledgement. Recovery never starts a new browser capture. A recovered
browser page allows heartbeat
grace before its references can be retired. A page that stays unresponsive
while the worker is running may lose its references and need an explicit action.
Ordinary background visibility changes leave healthy audio alone.

A restarted Manager changes its service epoch. The worker obtains fresh
connection and route grants for previously requested speakers under current
ingress access and the same runtime generation. Explicit logout, owner release
and generation replacement cancel recovery. Transport recovery pauses delivery
and fences old capture frames. Worker replacement, page suspension and
permission loss can end the live capture and require another action.
Page unload releases its interests. The same live page can reconcile after
suspension or a back/forward-cache return. A fresh page starts with audio off.

Browsers lacking a secure context, SharedWorker or AudioWorklet fail explicitly;
there is no fallback that silently duplicates playback or channels.

## SDK use

```js
import {RemoteXAppAudio} from '/sdk/index.js';
const audio = new RemoteXAppAudio({baseURL: location.origin});
await audio.ready;
// instance comes from the host's prepared, running App; acquire does not start it.
const interest = await audio.acquire(instance);
speakerButton.onclick = () => interest.setSpeaker(true);
micButton.onclick = () => interest.setMicrophone(true);
// Explicit release when this host no longer retains the session audio.
releaseButton.onclick = () => interest.release();
// The SDK also disposes on page unload.
closeAudioButton.onclick = () => audio.dispose();
```

Observe `statechange` (`CustomEvent<RemoteXAudioSnapshot>`) for actual route,
owner, conflict and playback-blocked status. A requested switch is distinct from
`actualSpeaker` / `actualMic`. The TypeScript declarations accompany the named
SDK export. Serve the pinned `audio-worker.js`, `audio-coordinator.js` and
`audio-worklet.js` at the same Manager base as the SDK.

## Authentication and protocol

Separate audio grants never reuse display/UDP credentials. The Manager issues an
HttpOnly, SameSite cookie epoch tied to its authenticated principal. One-use
connection tokens travel in `Sec-WebSocket-Protocol`, not URLs. One-use route
tokens bind the connection, principal/scope, runtime generation and current
private audio domain. Browsers cannot supply backend socket paths, URLs or
commands. Stop/generation retirement removes corresponding routes and grants;
other sessions on the shared channel continue.

The development self-recovery implementation adds `principal` to the context
and Worker binding: a 64-character opaque correlation derived from the existing
authenticated principal and stable Manager namespace. It survives native-cookie
refresh and service restart, allowing a live SDK owner to distinguish those
events from an observed account change. It is not a credential or proof of a
distinct login session. With `auth-mode=none` it represents only the configured
development trust domain; the Manager cannot infer a Cloudflare user's identity
that ingress does not pass. Explicit host logout remains a revocation boundary.
No new header or setting is required. Previously observed principal/login
bindings changing or disappearing fence old intent; older servers without a
principal correlation retain conservative same-service scope-change behavior.
At the 64-scope cap, only inactive scopes with no pending unexpired grants may
be reclaimed. Live connections/reservations remain protected and can exhaust
capacity honestly. This development contract is not full AUD-006 qualification.

Fresh authenticated HTTP renewal is required within 30 seconds, normally every
10 seconds. Audio packets and Ping/Pong do not renew authorization. Explicit SDK
logout revokes the epoch. Out-of-band identity-provider logout is observed when
authentication/renewal fails; it is not claimed to revoke an already upgraded
socket instantaneously. Server restart changes the service epoch. The optional
`-audio-login-header NAME` with `-auth-mode trusted-header` adds a verified login
epoch fence; it is not required for automatic speaker recovery. The
trusted reverse proxy must strip client-supplied values and set exactly one
opaque, non-secret session identifier derived from its verified login. Use a
fresh high-entropy identifier for each login, stable across requests and
Manager restarts. The value must be 16–128 ASCII letters, digits, dots, dashes
or underscores. A username or a bearer credential cannot serve this role.
The Manager returns an opaque binding to the SDK and checks the current
login on scope, grant and renewal requests. Without that optional header, ingress still owns authentication and the live
SDK owner reconciles intent through fresh grants. See the current
[integration recovery contract](integration-intent-recovery.md), which
supersedes the mandatory-header recovery condition from Core 0.17.4.

The existing
selected-UID Manager access model remains the authority for its App catalog;
this feature does not introduce a new multi-tenant ACL model.

PCM16LE uses 48 kHz and 960-sample / 20 ms frames. Speaker is stereo, mic mono.
Each packet has an eight-byte header: version 1, kind (1 speaker / 2 mic), slot,
exact-silence flag, little-endian uint32 sequence. Speaker slots are 1–8; the
single mic upstream uses slot 0 and server routing to authorized targets. Full
payloads are 3840 / 1920 bytes. Digital zero frames use only the header. Invalid
versions, sizes, slots and sequences are rejected. Valid microphone packets can
arrive together after transport buffering; their arrival rate does not close
the shared connection. The Pulse writer retains at most five queued frames
(100 ms), dropping the oldest under pressure. Packet read bounds and the
independent control-message limit remain in place.

Non-silent PCM payload is 1.536 Mbit/s per speaker and 0.768 Mbit/s for one mic
before WebSocket/TLS/IP overhead. Silence markers reduce quiet traffic, not
connection lifetime. The audio rate display counts protocol packets including their PCM headers,
excluding WebSocket/TLS/IP overhead. Its discard counter reports local credit or
queue pressure, not network packet loss. No MP2/Opus codec or third-party player
is imported. Eight
session slots, bounded queues and HTTP/grant/message limits prevent unbounded
buffer growth. Browser playback/capture use worklet credits so a stalled page
cannot accumulate unlimited queued audio. Playback has eight credits per
enabled speaker (at most 64 for eight slots), matching the unchanged eight-frame
queue per stream; microphone credits remain eight. [P17](../tests/performance/native-audio-burst/README.md)
records the deterministic burst comparison. PCM quality, WAN buffering and actual
bandwidth remain measured qualification items rather than codec assumptions.

## Verification

[Native audio tests](../tests/native-audio/README.md) distinguish real Pulse
routing, synthetic browser audio, full Manager lifecycle, deployment, resource
observations and physical human UAT. Test fixture hooks are compiled only into
the Go test binary. They are never product HTTP routes. Runtime cookies, tokens,
raw audio, device identities and private deployment records are not committed.

The UAT edge must explicitly permit audio routes and pinned worker/worklet
assets, preserve only the audio scope cookie, and terminate/filter external
address and authentication metadata before the desktop container. Audio WSS
must bypass the display-wire parser. Existing display UDP ports and host
forwarding rules remain unchanged.


## Awaitable audio retirement (SDK 0.36)

`await audio.dispose()` stops local capture immediately and resolves only after
terminal playback/capture acknowledgements, port cleanup and Context close.
Repeated calls return the same Promise. `await host.dispose()` and
`await host.logout()` join this cleanup; no host-side Worklet patch is needed.
Direct audio logout fences its handles immediately, attempts server revocation
and joins the same local retirement. A failure remains a rejected Promise,
including a bounded terminal-ACK timeout; local teardown still runs.

Final suspended-context disposal first mutes the output gain and stops every
capture track, then drains only the existing graph. It does not request new
capture, create a Context, enable a route or restore intent. Capture-only stop
does not resume paused playback; a silent terminal processor waits for the next
explicit resume or final disposal. An outstanding browser permission prompt cannot be cancelled by the SDK and
is not awaited indefinitely. A late grant is fenced: its tracks stop immediately
and no processor or route is created. Close the owning Host when retiring its login/server resources;
releasing one session leaves audio resources available for the remaining owners.

Unload cleanup is best effort: browsers cannot await a closing page. Explicitly
await the public lifecycle when a host needs a completed retirement boundary.
Native object release must be tested in a live browser with test-owned refs
removed; closed track state and mock close call counts alone do not prove it.


## Development graph recovery (SDK 0.38)

See [the graph lifecycle contract](native-self-recovery.md#audio-graph-recovery-development)
for source-preserving resume/rebuild and bounded native operations. Failed module
loads and closed Contexts are retired before a replacement; processor errors
reconcile valid intent without a new device request solely for graph failure.
Browser operation timeout is not cancellation. Unresolved native work remains
quarantined, late settlement can wake recovery, and disposal reports unproven
retirement. No automatic permission prompt or cancellation replay is permitted.

`actualSpeaker` requires an authorized route and a ready playback owner; graph
failure cannot report effective playback merely because the media WSS is open.
Local `contextState`/`contextReason` supplement shared route/transport state.
Models pass; real browser/native-resource, mixed faults and full production
qualification remain separate gates.

## Document-scoped bootstrap (SDK 0.37 / worker v6)

The #110 follow-up supersedes one native SharedWorker connection per audio
controller. A document reuses one native bootstrap for a canonical Manager base
and worker generation, with disposable transferable MessageChannels for its
independent controllers. Only logical ports join AudioCoordinator. Native
bootstrap lifetime alone grants no audio interest, lease, route or capture.
One bounded inert bootstrap may remain until document retirement. Owner cleanup
still stops tracks and retires native processors/Contexts; last media interest
still releases the WSS. Other owners and tabs are not terminated to reclaim a
local wrapper. Worker v6 names isolate the bootstrap protocol from v5 peers.

The development graph controls distinguish isolated processor repair from
whole-Context retirement. Ten actual processor throws preserve the same source
and Context and retire nine sampled native audio classes to zero. The earlier
Context-only rebuild control retains native objects and remains recorded as a
failed implementation. Context `closed` is not terminal-render proof.

SDK 0.38 now implements the measured same-origin graph-realm boundary: Context
and processor construction happen in an SDK-owned hidden child; parent intent,
permissions, transport and live capture survive replacement. Normal render ACK
remains the graceful path. Closed/stuck graphs retire their owned execution
environment and detach obsolete callbacks; they do not reload the host or claim
a native Promise resolved. Current scoped headed control passes complete Context
replacement with one parent capture and native audio retirement. See the
[owned graph contract](native-self-recovery.md#owned-graph-execution-environment-sdk-038-development)
for limits and remaining production qualification. The earlier failed graph
control is historical evidence, not the current implementation's disposition.
