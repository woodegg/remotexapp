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

Use **2 MiB (2,097,152 bytes)** of aggregate content per transaction, in either
direction. Count all representations, not each representation separately.
Validate the complete transaction before changing clipboard ownership. Reject
duplicate or unsupported MIME types, invalid framing/text and oversize content;
do not silently fall back to one representation after a rejected rich item.
Bound parser buffers, allocation and retained state. Validate each layer:
browser adapter, reliable native control stream, server and outgoing client parser.
An X11 terminal text NUL is framing, not content; embedded NUL remains invalid.

RTF, arbitrary custom MIME, file objects, URI-list/file-manager selections,
directories, drag-and-drop and file upload/download remain excluded. A PNG
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

The rich suite also accepts `--wss-roundtrip` to repeat real Writer HTML/PNG
copy and paste with UDP explicitly disabled. Its normal public run requires
actual UDP display bytes and painted frames. Every run creates a fresh Writer
document and resets consent; run suites serially within one browser profile.
