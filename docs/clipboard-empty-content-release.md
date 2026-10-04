# Clipboard Empty Content Release Train

> Historical technical record. Dated status and validation statements describe
> their original scope; they do not identify a current deployment. See
> [current source versions](current-state.md). Host labels and runtime IDs in
> historical examples are anonymized.

Status: Human UAT accepted and train closed on 2026-09-10 UTC. Stable `0.5.4`
is published as normal Latest with SDK `0.22.0` and unchanged App Packages.
Independent download, checksum, identity and byte comparison passed; see
[publication evidence](private-history.md).
No further deployment is authorized by this publication approval.

Historical lock: scope locked by the operator on 2026-09-09; implementation and local
deployment to `127.0.0.1:1991` and `127.0.0.1:2992` are authorized. Candidate
target: Core `0.5.4-rc.1`, SDK `0.22.0`; App Packages remain unchanged.
Requirements: CLP-030 through CLP-034. Publication and sandbox deployment are
not authorized. The latest operator instruction explicitly selects 2992,
superseding the earlier 2991 test endpoint for this local deployment.

## Problem and evidence

The operator intermittently sees `Local → Remote: Clipboard sync failed:
read text/plain clipboard representation: EOF`. An isolated reproduction of
the current Manager validator produced that exact error for a valid multipart
request containing a zero-byte text/plain part; 1-, 5-, and 24-byte text parts
passed. The SDK currently retains empty Blob representations. This establishes
a reproducible cause, not proof of the contents of the reported request.

## Required behavior

| Input | Outcome |
|---|---|
| Valid PNG plus empty plain text | Sync PNG; omit empty representation |
| Valid text plus other empty formats | Preserve all valid supported formats |
| Every representation has zero bytes | No-op; preserve destination clipboard; report skipped, not successful sync |
| Whitespace-only text | Preserve exactly; emptiness means zero bytes, never trimmed text |
| Nonempty HTML with absent/empty plain fallback | Apply the explicit fallback policy below; never silently discard HTML |
| Read failure, truncated request, invalid UTF-8/PNG, or limit violation | Fail explicitly; never reinterpret as empty or silently submit a subset |
| Explicit clearing | Separate intent; empty upload must never imply clearing |

CLP-030 covers zero-byte normalization and no-op semantics. CLP-031 covers
HTML fallback. CLP-032 covers SDK/Manager/Gateway consistency and atomic
destination updates. CLP-033 covers fingerprints, prompts and rebound
suppression. CLP-034 covers acceptance testing.

## Locked HTML fallback and no-op contract

Retain the existing rule that HTML requires valid, nonempty plain text.
Reject nonempty HTML without that fallback with a
clear, actionable error; preserve the destination. Do not implicitly reread
the clipboard after the captured snapshot, synthesize text from HTML, or
silently downgrade to another format. If HTML-to-text generation is desired,
define and approve its conversion semantics in a separate train.

All-empty valid offers return HTTP 200 with
`{"skipped":true,"reason":"empty-clipboard"}`; SDK manual calls return the
same object without a sync-success event. Automatic detection silently ignores
empty content. Prompt approval that becomes a no-op shows a neutral skipped
message, never success. Empty multipart offers with no parts remain malformed;
only supported zero-byte representations qualify for normalization. Duplicate
or unsupported formats remain errors even when empty.

## Implementation boundaries

- Normalize before fingerprinting and upload. Apply equivalent policy to
  remote offers and browser writes without bypassing the destination's
  supported-format rules or requesting extra permissions.
- Use the locked skipped/no-op SDK result and direct-API response above.
  Automatic checks must not repeatedly prompt for the same empty value;
  a later nonempty value must still be detected. No success event, clipboard
  clear, or remote-change broadcast may result from an empty no-op.
- Remote capture failures use a `clipboard-error` event with the captured
  session generation and a content-free error message; SDK exposes it through
  `clipboarderror` only for the current generation and enabled toLocal mode.
- Manager and Gateway must enforce the same semantic policy for callers that
  bypass the SDK. Replace misleading EOF errors for valid empty parts with
  explicit outcomes; genuine truncation remains an error.
- Validate the entire offer before changing X11 selection ownership or browser
  clipboard contents. Streaming forwarding alone must not commit partial data.
- Base deduplication and suppression on the actual normalized/written formats;
  preserve genuine-change detection and independent behavior of other Viewers.
- No new clear API, new MIME formats, template changes, or D-Bus/IBus refactor
  is included. Supported formats remain plain text, HTML, RTF, and PNG.

## Acceptance gate

Add deterministic SDK, Manager and Gateway tests for the table above, empty
parts in different positions, multiple valid formats, malformed/truncated
multipart, and a late invalid part after valid data. Prove that rejection and
no-op preserve previous destination content and do not emit success events.
Cover direct API calls, normalized fingerprints, retry after failure,
permission/read failures, and same-Viewer rebound versus another Viewer's
genuine local change. Check both directions and manual/prompt/auto modes.

Run real-browser Console tests with Mousepad and LibreOffice for mixed
image/text and rich-text cases; verify actual paste/readback, retained formats,
unchanged content after failure, and no prompt loop. Run `make check` and the
release publication gates before human UAT. Any approved local deployment
must use `127.0.0.1:1991` and `127.0.0.1:2992` per the updated DEP-016. Sandbox deployment
and publication require separate explicit approval.

## Automated acceptance and local deployment

On 2026-09-10 UTC, the exact hosted candidate at commit `4f55e629cdef` passed
checksum/identity, synthetic ABI, and four-App live E2E. Both local Managers
now serve that archive. Each endpoint passed newly created Mousepad and
LibreOffice two-Viewer clipboard tests and actual application paste/copy
readback. See [machine evidence](private-history.md).
Human UAT was subsequently explicitly accepted by the operator. See
[acceptance](private-history.md).

## Stable promotion

Only core version metadata and acceptance/publication documentation change
from the accepted candidate behavior. The stable-version candidate must pass
the portable gate and exact-archive App E2E before its annotated tag is pushed.
The Release workflow published those same verified stable-candidate bytes.
Local 1991/2992 retain the accepted rc.1 deployment until separate alignment.

## Runtime upgrade boundary

The updated SDK handles empty local content before upload. Gateway-side capture
and direct-API normalization require a runtime created with the new gateway;
Manager restart preserves existing runtime component pins. Local deployment
must explicitly report retained older runtimes and use newly created candidate
Mousepad/LibreOffice runtimes for UAT, rather than silently rewriting a live
manifest or forcibly ending unrelated user sessions.
