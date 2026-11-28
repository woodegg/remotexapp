# Integration intent and connection recovery

Core 0.17.5 / SDK 0.35.0 implements the historical contract below.
The owner selected [automatic self-recovery](native-self-recovery.md) on
2026-11-28 in #119, including reacquisition under already-granted microphone
permission. That implementation/qualification is in progress; this historical
manual-resume rule is not the new target or a claim that the new target shipped.
Issue [#98](https://github.com/woodegg/remotexapp/issues/98) supersedes the
mandatory login-continuity condition introduced for recovery in Core 0.17.4.

The embedding host sets connection and integration intent through the existing
Host, Viewer and audio-interest APIs. The SDK owns retries, fresh grants,
transport replacement and reconciliation. Ingress authenticates public access.
The configured Manager authentication boundary, same-origin checks and
generation-qualified grants continue to protect requests. A deployment can use
its existing ingress without adding a separate login-session header.

## State and ownership

Clipboard requested directions survive transient replacement of the same logical
Viewer targeting the same runtime ID, generation and component. Each replacement
retires pending operations and cached offers. Permission observation and a fresh
clipboard baseline resume after focus. No copy payload is replayed.

Audio retains speaker intent through transport or Manager replacement. It obtains
fresh connection and per-runtime route grants. A healthy audio connection remains
independent of display reconnect and workspace visibility. Same-session tabs share
their switches and one channel through the existing SharedWorker.

The audio route's additive `requested` field contains `speaker` and
`microphone`. Existing `speaker`, `mic`, `actualSpeaker` and `actualMic`
retain their meanings for old consumers. `mic` indicates a currently eligible
capture request. `microphoneActionRequired` means microphone intent remains
enabled while capture needs an explicit action.

A still-live microphone owned by the same page can resume within the existing
12-second interruption window. Outage frames are discarded and the new route
uses a new delivery fence. Expired capture, permission loss, device loss and
worker replacement preserve the request but require a fresh browser action.
Automatic recovery never calls getUserMedia. Turning the microphone off clears
both its eligible route and its request.

## Cancellation and access

Explicit disconnect, dispose, logout and released handles cancel their recovery.
Runtime replacement fences old-generation delivery. Current authorization
rejection ends automatic attempts. Optional existing verified login metadata
continues to fence an observed login change; its absence allows normal transient
recovery. A host changing account calls logout before binding the new account.

With automatic reconnect enabled through reconnect:true, display retries run in
bounded bursts followed by a 30-second cooldown until connection succeeds or
the owner cancels. Explicit retry-policy objects retain their finite budget and
report exhaustion while preserving clipboard intent. Audio uses its
existing bounded connection/HTTP deadlines and shared retry loop. Hosts display
requested settings, actual activity, recovery and required-action states rather
than sending enable again from reconnect listeners.

## Local verification

Run the focused SDK tests and make check. The project-owned native integration
fixture must use a real Kasm Viewer, X11 clipboard, PulseAudio readback and a
synthetic browser microphone. Exercise independent display/audio cuts, combined
cuts, transient renewal errors, Manager restart, long microphone outage, explicit
off during recovery, tab ownership, generation retirement and logout. Check both
retained intent and actual recovered content or tone. Private deployment paths,
runtime identifiers and detailed evidence stay in the private UAT runbook.
