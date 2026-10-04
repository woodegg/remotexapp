# Public documentation release — Core 0.14.4

This patch release improves public integration guidance and archive
qualification. SDK 0.29.1, App versions, App Package ABI, public APIs and runtime
behavior remain unchanged. See [cleanup scope](public-documentation-review.md)
and [current source identity](current-state.md).

## Included changes

The README introduces Citrix-style Linux application delivery and the client
SDK with an early embedding example. Public manuals use generic deployment
examples and distinguish historical qualification from current host state.
Host-application migration guides replace downstream-specific instructions.
Stable requirement IDs, dated design decisions, test failures and qualification
limits remain documented; third-party source and license text remain intact.

REL-014 adds a current-documentation disclosure/link gate to `make check`.
Release packaging separately checks staged readable documents. Links to
bundled files remain local; references to omitted source material point to the
full release source commit. App archives retain their unchanged immutable
content because their README/test files are excluded from package identity.

## Qualification and operational impact

Use the reviewed commit's hosted build-once candidate and qualify its exact
archive with the established synthetic and shipped-App suites. Also inspect
bundled documentation and source-commit links, verify all binary identities,
and compare fresh release downloads with the tested archive. Do not rebuild
between candidate acceptance and publication.

The operator requested formal publication after the documentation cleanup.
This is approval of the documentation/release work, not a claim of new
interactive App UAT. Existing runtime semantics and their qualification limits
remain unchanged; exact-artifact automated regression results are recorded
separately.

Publishing changes no installed service or runtime pin. No deployment, runtime
restart, sandbox alignment, history rewrite or replacement of existing release
assets is authorized by this publication request. Earlier historical copies
need separate exposure assessment; current-file cleanup does not erase them.
