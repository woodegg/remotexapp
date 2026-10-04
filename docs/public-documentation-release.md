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

## Publication record

Stable [v0.14.4](https://github.com/woodegg/remotexapp/releases/tag/v0.14.4)
was published on 2026-10-04 from source commit
`a67be470abf094c46e2e69f37d8724ae15913641`. Hosted Verify, the same-commit
candidate and Release workflows passed. The downloaded candidate passed the
full exact-archive E2E harness; all eight App archives match 0.14.3 and all
48 readable archive documents passed the public-documentation gate.

Fresh release downloads match the tested archive, checksums and candidate
evidence byte-for-byte. Archive SHA-256:
`94e5e1cca394dd98be6e0b4bfe2245d65e43a59354d432830082bb3b8cfe4469`.
See [publication evidence](../tests/evidence/v1/public-documentation-0.14.4-publication.json)
for scoped results and skipped interactive-UAT/real-reboot checks. No
deployment, runtime upgrade or historical asset rewrite was performed.
