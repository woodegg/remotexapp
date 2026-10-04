# Clipboard Prompt Reliability Release Train

> Historical technical record. Dated status and validation statements describe
> their original scope; they do not identify a current deployment. See
> [current source versions](current-state.md). Host labels and runtime IDs in
> historical examples are anonymized.

**Status:** CLP-025 through CLP-029 are accepted for RemoteXApp `0.5.1`
and Browser SDK `0.21.1`. Implementation, complete automated and local E2E
validation, and deployment to the local 1991 and 2991 environments passed.
Human UAT was accepted on 2026-09-03 and formal GitHub prerelease publication
was completed on the same date. Annotated `v0.5.1-rc.1` passed both hosted
workflows and independent artifact verification. Stable `v0.5.1` was then
published without functional changes and its independently downloaded formal
artifact was aligned to local 1991/2991, test-host-a 1991/2991, and
test-host-c/03/07/10 production 1991.

Candidate commit `b6e6b2fb19e4` passed the complete release gate, an isolated
four-App real-browser suite with two-Viewer Mousepad and LibreOffice coverage,
and post-deployment two-Viewer checks on both local environments. Local 1991
preserved its existing XFCE runtime and temporary wide-test listener; local
2991 preserved its loopback, Console-disabled, kiosk-enabled policy. Exact
evidence is
[`clipboard-prompt-reliability-0.5.1-rc.1-local.json`](private-history.md).
Human UAT was accepted on the exact candidate; acceptance evidence is
[`clipboard-prompt-reliability-0.5.1-rc.1-human-uat.json`](private-history.md).
Formal publication evidence is
[`clipboard-prompt-reliability-0.5.1-rc.1-formal-publication.json`](private-history.md).
Stable publication and alignment evidence are
[`clipboard-prompt-reliability-0.5.1-formal-publication.json`](private-history.md)
and
[`clipboard-prompt-reliability-0.5.1-alignment.json`](private-history.md).

## Goal

Make the optional `RemoteXAppClipboardPrompts` UI resistant to ordinary
embedding-page CSS that unintentionally sizes every direct child of the Viewer
container. A prompt must remain a content-height, newest-first stack at the top
of the remote display instead of stretching across and obscuring the complete
framebuffer.

The motivating downstream failure used a rule equivalent to
`viewer > * { height: 100% }`. That rule remains a downstream defect and must
be narrowed there. SDK hardening prevents the same common integration mistake
from turning a prompt bar into a full-screen input-blocking overlay; it does not
transfer ownership of downstream CSS to RemoteXApp.

The same train also makes clipboard direction immediately recognizable. A
local-to-remote prompt uses a high-contrast orange-red treatment, an upward
arrow, and explicit `Local → Remote` wording. A remote-to-local prompt uses a
high-contrast blue treatment, a downward arrow, and explicit
`Remote → Local` wording. Direction must never depend on color alone.

## SDK behavior and integration boundary

The standard prompt controller must explicitly own its root geometry, including
top anchoring, content-driven height, bounded stacking, and overflow behavior.
Ordinary non-`!important` host sizing rules must not stretch the root or its
bars. Prompt rendering, approval, dismissal, expiry, focus restoration,
accessibility, and the 60-second offer lifetime remain unchanged.

Prompt state remains distinct from direction. Approval is a high-contrast
primary action; success changes briefly to green, failure changes to dark red
while retaining its direction label, and expiry changes to neutral gray.
Text, arrow, color, focus indication, and controls must meet applicable WCAG AA
contrast and keyboard/screen-reader requirements. The more opaque direction
background replaces unnecessary heavy backdrop blur rather than obscuring the
remote framebuffer.

## Actual-write rebound suppression

After a successful remote-to-local approval, the same Viewer must not offer the
resulting browser clipboard write back to the remote session. Suppression must
describe what the browser actually committed, not every representation in the
original remote offer. This matters when a browser omits an unsupported format
such as RTF, falls back to plain-text-only writing, reorders MIME types, or
normalizes a representation such as HTML or text line endings.

The implementation must contain no MIME-, application-, template-, browser-,
or platform-specific suppression branch. It records the successful browser
write path, serializes reconciliation with that write, and, when clipboard-read
authority is already available, uses a canonicalized post-write readback as the
authoritative local result. Canonical comparison is independent of MIME
ordering and uses the representations and bytes actually exposed by the
browser. When read authority is unavailable, the SDK retains a bounded
successful-write receipt for comparison when an authorized read later occurs;
it must not perform a new permission-triggering read solely for suppression.

Any representation may be omitted, reduced to a successful fallback, reordered,
or normalized without producing a false local-to-remote prompt. A genuinely
new local clipboard value must still prompt normally, including a value changed
while or after the browser write completes. Suppression remains local to one
Client: another Viewer may detect the same browser clipboard after it becomes
input-active, as required by CLP-021.

Embedding applications may size and position the container supplied to
`RemoteXAppClient`, but must treat SDK-created descendants as SDK-owned. They
must not apply wildcard child layout rules such as `container > *`. An
embedding application that needs different prompt presentation may omit the
optional controller and implement UI from the public clipboard events.

This is resilience against accidental integration CSS, not a browser security
boundary. The train does not attempt to defeat `!important`, hostile JavaScript
DOM mutation, element removal, or arbitrary same-page code. It also excludes
MutationObserver-based style repair, Shadow DOM migration, Viewer DOM
restructuring, Manager/gateway protocol changes, and App/template/driver
changes.

## Acceptance gate

Acceptance requires focused SDK tests and rendered real-browser coverage using
the exact regression shape:

- a Viewer host applies `> * { width: 100%; height: 100% }` before a prompt is
  created;
- one and multiple prompt bars remain top-aligned and content-height, with the
  newest first and bounded overflow;
- an unobscured point below the prompt remains targeted at the remote display,
  while Yes and X remain clickable and accessible;
- long status/error text stays bounded without covering the complete Viewer;
- local-to-remote and remote-to-local prompts retain their specified
  orange-red/up and blue/down direction treatments across normal, progress,
  success, failure, and expired states, without relying on color alone;
- prompt text, controls, focus indication, and accessible names pass the
  applicable WCAG AA contrast and keyboard/screen-reader checks;
- a LibreOffice-style `text/plain` + `text/html` + `text/rtf` remote offer
  written by a browser without RTF support produces no same-Viewer
  local-to-remote rebound, while a subsequent real local change does;
- the same no-rebound invariant holds for every allowed representation across
  unsupported-format omission, plain-text fallback, MIME reordering, HTML/text
  normalization, write/read timing, absent read permission, and reconnect;
- a different clipboard value introduced during or after the write is not
  suppressed, and another active Viewer retains its independent CLP-021
  behavior;
- Unified Console and kiosk prompt behavior, focus restoration, expiry, and
  cleanup remain unchanged; and
- the complete repository gate passes and the resulting generated SDK assets
  match their sources.

Human UAT, prerelease verification, stable publication, and the explicitly
enumerated eight-endpoint alignment completed on 2026-09-03. No other
deployment target was in scope.
