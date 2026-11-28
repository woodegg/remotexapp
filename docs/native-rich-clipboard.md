# Native rich clipboard extension

Status: selected for implementation on 2026-11-02 in
[Issue #55](https://github.com/woodegg/remotexapp/issues/55), dependent on the
native automatic text integration in [PR #54](https://github.com/woodegg/remotexapp/pull/54).
Implementation is present on the development branch. The
[candidate report](../tests/kasm-native/NATIVE-RICH-CLIPBOARD.md) records exact
artifacts, automated checks and open observations; human acceptance remains
pending. Previous text-only qualification does not establish rich support in an
installed component.

## Formats and limits

Support the pinned Kasm browser path's `text/plain`, `text/html` and
`image/png`, including multiple representations of one clipboard item. Text is
well-formed UTF-8 without embedded NUL. HTML is clipboard data, never rendered
by RemoteXApp or inserted into its DOM. Browser clipboard sanitization and
image encoding may change representation bytes; test meaningful paste/readback
and reconcile the browser's actual value to prevent feedback loops.

The original rich component accepts **2 MiB (2,097,152 bytes)** of aggregate
content per transaction. The new component accepts **10 MiB (10,485,760
bytes)** in either direction. The Manager negotiates the limit with each
runtime's immutable component pin. Count all representations, not each representation separately.
Validate the complete transaction before changing clipboard ownership. Reject
duplicate or unsupported MIME types, invalid framing/text and oversize content;
do not silently fall back to one representation after a rejected rich item.
Bound parser buffers, allocation and retained state. Validate each layer:
browser adapter, reliable native control stream, server and outgoing client parser.
An X11 terminal text NUL is framing, not content; embedded NUL remains invalid.

RTF, arbitrary custom MIME, file objects, URI lists, directories, drag-and-drop
and file upload/download remain excluded. A mixed X11 selection that advertises
file markers can supply inline PNG through the new component. The component
omits the selection's other representations. A PNG
image copied as clipboard content is supported; copying a PNG file in a file
manager is not a file-transfer feature. No new UDP ports or audio path changes.

## Policy and compatibility

Retain KNC-001–008's default-off, independent directions, explicit permission
requests, focused Viewer ownership, conflict handling, paste ordering and
lifecycle fencing. Browser `read`/`write` and `ClipboardItem` must expose honest
format capabilities. Missing rich APIs may provide an explicitly reported
text-only manual fallback; they must not claim rich automatic synchronization.
Keep payloads, previews and equality fingerprints out of public state, logs,
exported results and persistence.

Identify rich capability through a new immutable component protocol and runtime
descriptor. New Core/SDK must still operate existing text-only pinned Apps with
their 64 KiB limit. Installing a rich component must not rewrite an existing App's
pin, restart it or silently upgrade its clipboard contract. Preserve legacy
provider behavior and the existing manual text API.

## Required qualification

- Verify each format and combined representations through real browser and
  remote application paste/readback, independently in both directions.
- Exercise exact aggregate boundary, one-byte oversize, malformed/duplicate/
  unsupported formats, partial network messages, empty no-op and explicit clear.
  Rejected content leaves the previous destination intact.
- Test slow and superseded X11 selection responses so a transaction cannot
  combine representations from different clipboard revisions or publish an
  incomplete item when a later representation fails validation.
- Repeat focus, multi-Viewer/tab, permissions, delayed read/write, conflict,
  disconnect and no-echo cases with rich content and browser normalization.
- Qualify exact amd64/arm64 candidates in project-owned UAT, with embedded and
  standalone Viewers, WSS/established WebRTC/fallback and audio coexistence.
  Preserve existing Apps and documents; record cleanup and artifact hashes.
- Complete automation before one consolidated physical end-to-end UAT covering
  both #54 and this extension. Record untested OS/browser and actual embedding
  host combinations explicitly. Existing text/audio acceptance is not rich
  clipboard acceptance.

Keep this work in a separate Draft PR stacked on #54 until its dependency is
merged, then retarget to `main`. Issue #55 holds progress; the PR holds review
and CI evidence. Merge, post-merge qualification and publication remain separate.

## Reproducible live regression

`tests/kasm-native/browser-rich-clipboard.mjs` takes the disposable fixture JSON
used by `browser-fixture.mjs`, with a ready `alpine-writer` instance and a dedicated
browser. Install LibreOffice Writer, xclip and Python Xlib in that fixture. The
test replaces only synthetic clipboard/document content, exercises real Writer
HTML/PNG paste and copy, drives a temporary X11 owner for INCR and stale-selection
cases, and deletes that owner's processes and files in `finally`. Its result JSON
contains case status only; the optional screenshot contains synthetic content.
Do not run this helper against a user's editor or personal browser clipboard.

Use the [combined human UAT checklist](../tests/kasm-native/NATIVE-RICH-CLIPBOARD-UAT.md)
for one end-to-end pass across #54 and #56. The reusable
`browser-rich-lifecycle.mjs` also exercises real same-runtime and different-runtime
tabs, inactive baseline handling, manual source choice and consent reset. Public
fixtures require an explicitly named HTTPS origin, a project-owned disposable
runtime and an isolated authenticated browser; permission overrides do not
qualify physical prompts.

The rich suite accepts `--wss-roundtrip` to repeat real Writer HTML/PNG copy
and paste with UDP disabled. Use `--wss-full` for the complete clipboard
matrix over WSS, including the negotiated byte limit and mixed selections. Its normal public run requires
actual UDP display bytes and painted frames. Every run creates a fresh Writer
document and resets consent; run suites serially within one browser profile.

## Clipboard faults and recovery follow-on

The limit and filtering changes are implemented for the new component.
The follow-on retains requested state after a verified Viewer reconnect. A
reconnect without a matching login and runtime requires explicit consent.

An observed X11 image copy first advertised file targets, then a new selection
offered both file targets and inline PNG. The current Kasm snapshot cancels on
any file marker. Prefer the inline PNG in the second selection when it passes
the configured size and format checks. Ignore URI lists, file references and
alternate text or HTML for a mixed file selection. A file-only selection
continues to produce no transferable item. Validate that the owner and
selection revision are still current before publishing. No file is opened.

Browser clipboard readback can encode the same pixels into a larger PNG. The
SDK currently applies the transfer size limit to readback and to the new local
baseline on focus. A legal remote PNG can be written successfully and its
larger browser representation can still block a later short remote copy.
Separate bounded local equality checks from transfer validation. An unchanged
local item that is too large to upload can be replaced by a valid, newly
offered remote item. Treat a changed or unidentifiable local item as a
conflict and preserve it until an explicit source choice. Apply the pinned 10 MiB or 2 MiB
aggregate transfer cap in both directions before sending data. Bound local
comparison to 32 MiB and retain only transient digests of oversized items.
Keep equality data transient and local. For keyboard paste, surface an
oversize upload failure and preserve the remote clipboard. The remote
application menu remains available for pasting the existing X11 clipboard.

The recovery scope is the same verified login and remote runtime generation.
Retain the user's requested directions per logical Viewer. A disconnected
Viewer retires pending work and discards old clipboard offers. After fresh
Manager authorization, a focused Viewer with browser permission establishes
its baseline and accepts new clipboard events. Treat focus pause separately
from the user's on/off setting. Clear intent on explicit off, disposal, logout
or target replacement. For the associated shared audio recovery requirements,
see AUD-003 in [requirements](requirements.md).

Qualify both failure reproductions on a real Chrome and Kasm Viewer. A mixed
file-plus-PNG item must write PNG only. A PNG within the transfer limit that
reads back above it must paste locally, then permit a new short remote copy in
a second eligible Viewer. Add positive PNG-only and short-text controls and
negative cases for file-only, unsent oversize uploads, simultaneous clipboard
changes and stale Viewer ownership. Use the host workbench to verify display
and audio interruption, Manager restart, foreground/background transitions,
multiple tabs and explicit cancellation.


## Verified browser delivery (SDK 0.37)

#111/#107 replace the assumption that any rich post-write read is our normalized
value. Automatic writes use a bounded random browser-local custom-format
receipt where supported; only matching receipt and preserved nonempty content,
or exact content equality, proves the observed write. A new local copy is never
silently absorbed as that remote baseline. Empty/stale/unverifiable readback
reports clipboard-uncertain without replay or clearing requested modes. An
explicit source choice can continue. Permission/focus retirement fences the
verification read. Receipt bytes never travel to X11 or public state; the
10 MiB content and 32 MiB comparison budgets remain unchanged.

Without previously granted read permission, manual copying can return
write-accepted rather than verified copied-to-local. No new read prompt is
started for verification. Browser admission cannot guarantee an OS clipboard
update, cancel an already-started write or protect against a later external
writer. Validate actual data, not just successful promises. See the
[SDK 0.37 adoption contract](native-host-migration.md#adopt-bounded-worker-owners-and-clipboard-receipts-sdk-037).

Custom formats follow the [Clipboard API representation model](https://www.w3.org/TR/clipboard-apis/)
and [Chromium's custom-format API](https://developer.chrome.com/blog/web-custom-formats-for-the-async-clipboard-api).
No claim is made that another browser supports custom receipts; feature-detect
it and retain exact verification or explicit uncertainty.

## Concurrent destination ordering (development)

The repaired SDK A-B-A echo comparison does not close an X11 owner change whose
offer has not arrived before an automatic upload. The selected
[destination-ordering design](native-clipboard-ordering.md) requires a revision
comparison at native transaction admission, before any clipboard buffer or X11
selection mutation. This needs a newly qualified immutable component/capability;
it is not implemented or accepted by the earlier receipt/normalization tests.
