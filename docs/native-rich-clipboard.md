# Native rich clipboard extension

Status: selected for implementation on 2026-11-02 in
[Issue #55](https://github.com/woodegg/remotexapp/issues/55), dependent on the
native automatic text integration in [PR #54](https://github.com/woodegg/remotexapp/pull/54).
This contract is prospective; previous text-only qualification does not
establish rich support in an installed component.

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
