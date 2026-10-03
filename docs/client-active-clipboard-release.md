# Client-Active Clipboard Release Train

**Status:** CLP-018 through CLP-024 are accepted for stable `0.5.0`. The exact
`0.5.0-rc.1` behavior passed complete automated and local real-browser/runtime
validation, was deployed to both local environments on ports 1991 and 2991,
and received Human UAT acceptance on 2026-09-03. The prerelease and subsequent
stable `v0.5.0` GitHub release were independently verified on 2026-09-03. The
exact stable artifact is deployed to both local environments, both sandbox00
environments, and sandbox02/03/07/10 production.

**Target release:** RemoteXApp `0.5.0`, SDK `0.21.0`. RemoteXApp Manager
and gateway protocol behavior, App Package ABI V1, application packages,
templates, and drivers remain unchanged.

## Goal

Make local-to-remote clipboard detection belong to each
`RemoteXAppClient` and follow that Client's real input focus. A configured but
inactive Viewer must not read, fingerprint, or prompt for local clipboard
changes. Remote-to-local broadcast behavior remains unchanged.

This prospectively supersedes only the Client-focus portion of CLP-013 after
the new train is implemented and accepted. The accepted RemoteXApp 0.4.0
behavior remains immutable history.

## Client-owned focus model

Every Client independently owns its clipboard configuration, input-active
state, local fingerprints, pending offers, prompt controller, timers, and
cleanup. Clients share no clipboard coordinator, active-Viewer registry,
fingerprint, or pending state. Browser focus provides natural exclusion: only
the Client whose input host owns focus in a focused, visible document is
input-active.

Trusted pointer or keyboard input over the Viewer and an embedding host's
explicit `client.focus()` activate that Client. Focus moving to another Client
or unrelated UI, top-level blur, document hiding, disconnect, and destruction
make it inactive or pause it. The SDK must distinguish this activation from
the existing connection-completion focus so a background RFB connection cannot
claim clipboard activity or trigger a read.

`toRemote: "prompt"` remains a session-local user preference; it is not
rewritten to `off` when focus moves. On the transition to input-active, the
Client immediately reconciles the current local clipboard. If supported
content is new to that Client, it creates a 60-second prompt offer. While
inactive it ignores `clipboardchange`, top-level focus/visibility, and captured
paste signals without updating either local fingerprint. Combined activation
signals remain debounced, and focus alone never requests new browser
permission.

## Per-Client loop suppression

Loop suppression is intentionally local to one Client. If Viewer A accepts a
remote-to-local offer, A records the successful browser write in its own
`localWriteFingerprint` and must not offer that write back to its remote
session. Viewer B does not inherit A's fingerprint. When B later becomes
input-active, it may detect the same local clipboard value as new and prompt
the user to send it to B's remote session.

Likewise, `sourceViewerId` continues to suppress the remote rebound only in
the Viewer that originated a local-to-remote send. Other Viewers attached to
that runtime retain their independent remote-to-local offer handling. No
global content deduplication is permitted.

## Preserved remote-to-local behavior

An authoritative remote X11 clipboard change continues to produce one bounded
offer and broadcast its metadata to every Viewer attached to that runtime and
session generation. This path does not depend on input-active state. Each
Viewer independently applies `off`, `manual`, `prompt`, or `auto`, and one
Viewer's accept, dismiss, or expiry does not consume or change another
Viewer's offer. Existing 60-second lifetime, reconnect recovery, permissions,
format/size limits, and source-Viewer suppression remain unchanged.

## Downstream integration

Embedding applications do not coordinate clipboard state. They configure and
destroy each Client normally and may install one
`RemoteXAppClipboardPrompts` instance per Viewer. When their window chrome,
task switcher, or keyboard navigation activates a Viewer without a pointer
event over its canvas, they call the ordinary `client.focus()` method. They do
not switch other Clients' clipboard modes or share fingerprints.

The behavior is template-neutral and identical for shared Desktop, Firefox,
Edge, and each disposable LibreOffice Viewer.

## Multi-window Unified Console

The Unified Console becomes the reference multi-Client integration surface.
Its operator and launch workspaces may keep multiple runtime Viewers open at
the same time instead of replacing one global `client` and screen. Every open
Viewer is a distinct, independently focusable window with its own
`RemoteXAppClient`, `RemoteXAppClipboardPrompts`, connection state,
diagnostics, clipboard controls, and cleanup. Opening the same runtime more
than once is permitted so all-Viewer broadcast and independent acceptance can
be tested alongside different-runtime transfer.

Window activation performs the Console's ordinary focus handoff to that
window's Client; it does not coordinate clipboard configuration or share
fingerprints. Launch, connect, reconnect, disconnect, close, runtime stop, and
managed desired-state actions remain visibly distinct and apply only to the
identified target. Closing a Viewer window destroys only its browser Client
and does not imply a runtime stop. The existing managed-application/runtime
navigation hierarchy remains authoritative.

Viewer windows must be bring-to-front, movable, resizable, and minimizable
within the Console workspace, with an unambiguous active state and accessible
keyboard switching through `Ctrl+F6`. Window geometry and clipboard choices remain ephemeral
and must not enter URLs, browser storage, runtime manifests, or Manager
configuration. Standalone kiosk routes remain single-Viewer and retain their
current capability boundary; multi-window UI must not grant new server-side
authority.

## Acceptance gate

Acceptance requires focused SDK tests plus real secure-context multi-Client
browser E2E proving:

- configured inactive Clients do not read, fingerprint, or prompt;
- activating Firefox checks once and starts its prompt lifetime then, while a
  later Edge activation can independently prompt for the same content;
- a remote-to-local write accepted by A is suppressed only in A, while B may
  offer it after B becomes active;
- only the current input Client handles local clipboard, focus, visibility,
  and paste signals, including rapid focus changes and delayed debounce work;
- connection-completion focus cannot activate clipboard monitoring;
- the Unified Console concurrently opens different runtimes and multiple
  Viewers of one runtime, hands focus to exactly one Client, keeps actions
  target-scoped, and destroys one Viewer without stopping or disturbing the
  others;
- remote-to-local fanout, per-Viewer acceptance, source suppression, reconnect,
  permission failure, expiry, disconnect, and destruction retain RemoteXApp
  0.4.0 behavior; and
- the Unified Console and a downstream multi-window integration use only the
  public SDK and require no application-specific branch.

The candidate passed `make check`, browser permission tests, the multi-Viewer
clipboard matrix, and local real-X11/browser E2E. Machine evidence is
[`client-active-clipboard-0.5.0-rc.1-local.json`](../tests/go-live-validation/results/client-active-clipboard-0.5.0-rc.1-local.json),
and explicit acceptance is recorded in
[`client-active-clipboard-0.5.0-rc.1-human-uat.json`](../tests/go-live-validation/results/client-active-clipboard-0.5.0-rc.1-human-uat.json).
Human UAT is accepted. Annotated
[`v0.5.0-rc.1`](private-history.md)
is published as a GitHub prerelease, and its independently downloaded archive
and checksum are verified in
[`client-active-clipboard-0.5.0-rc.1-formal-publication.json`](../tests/go-live-validation/results/client-active-clipboard-0.5.0-rc.1-formal-publication.json).
The exact behavior is published as the normal Latest
[`v0.5.0`](private-history.md), with
independent [formal publication](../tests/go-live-validation/results/client-active-clipboard-0.5.0-formal-publication.json)
and [fleet deployment](../tests/go-live-validation/results/client-active-clipboard-0.5.0-fleet-deployment.json)
evidence. Only local 1991/2991, sandbox00 1991/2991, and sandbox02/03/07/10
production 1991 were changed.
