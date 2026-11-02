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
revoked permission or disconnected channel turns capture off; recovery never
silently calls getUserMedia. Playback handoff requires a previously unlocked
AudioContext; a page without a user gesture must report that limitation.

No capture, AudioContext or audio WebSocket is created by merely launching an
App. The first enabled speaker/mic opens one WSS; additional sessions reuse it.
All off releases the WSS and capture. Server-side retirement of the last
enabled App also releases the WSS on the next coordinator reconciliation;
retained references alone do not keep an empty audio connection open. Enabled silence retains the connection.
An unresponsive SharedWorker is detected by a ten-second active-page watchdog;
worker failure stops capture, closes the local audio graph and retires the
controller. Resuming a browser-suspended page allows a fresh heartbeat grace
period. Worker heartbeats do not wait behind permission prompts or HTTP calls.
A restarted Manager changes the service epoch: old interests are retired before
any fresh route grant. The UAT's **Reconnect audio** action creates a fresh
controller and references with both switches off; enabling audio remains an
explicit action. Network recovery within the same epoch may restore requested
speakers but never reopens microphone capture.

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
// The SDK also disposes automatically on pagehide.
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

Fresh authenticated HTTP renewal is required within 30 seconds, normally every
10 seconds. Audio packets and Ping/Pong do not renew authorization. Explicit SDK
logout revokes the epoch. Out-of-band identity-provider logout is observed when
authentication/renewal fails; it is not claimed to revoke an already upgraded
socket instantaneously. Server restart changes the service epoch. The existing
selected-UID Manager access model remains the authority for its App catalog;
this feature does not introduce a new multi-tenant ACL model.

PCM16LE uses 48 kHz and 960-sample / 20 ms frames. Speaker is stereo, mic mono.
Each packet has an eight-byte header: version 1, kind (1 speaker / 2 mic), slot,
exact-silence flag, little-endian uint32 sequence. Speaker slots are 1–8; the
single mic upstream uses slot 0 and server routing to authorized targets. Full
payloads are 3840 / 1920 bytes. Digital zero frames use only the header. Invalid
versions, sizes, slots, sequences or over-limit traffic are rejected.

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
