# noVNC upstream dependency

## Architecture

RemoteXApp vendors stable noVNC release source in `third_party/novnc/` and
bundles it with esbuild into the content-hashed assets embedded by
`remotexappd`. Normal builds never fetch noVNC, and deployed hosts need neither
the source tree nor a JavaScript toolchain.

The vendor directory contains complete upstream `core/` and `vendor/` trees,
attribution and license texts. `UPSTREAM.json` identifies the release, peeled
Git tag commit, commit-archive URL and downloaded SHA-256. This is preferable
to a submodule or moving branch because one repository commit fully determines
the browser source used by a release.

## Compatibility boundary

`cmd/remotexappd/web/assets-src/novnc-entry.js` and its adjacent
`novnc-resize-bridge.mjs` form the only boundary allowed to use noVNC-private
interfaces. RemoteXApp needs upstream keyboard translation/ungrab so the
hidden IME host receives composition events. SDK 0.15 also schedules noVNC's
private remote-resize request while reading its screen size, support,
in-flight, framebuffer, and 100 ms throttle state. These interfaces are not
guaranteed by noVNC's public API. `make novnc-check` validates their complete
expected source shape, ensures application SDK code does not bypass the
adapter, and the normal asset build validates the import graph.

## Update and merge policy

The scheduled `Update noVNC upstream` GitHub workflow compares the vendored
release with upstream's latest stable GitHub release. It creates a bot branch,
runs the same importer, commits vendored and generated assets, opens one draft
pull request, and explicitly dispatches the Verify workflow for that branch.
If import or PR creation fails, it opens a deduplicated issue with the failed
workflow run. A maintainer can also import a release manually:

```bash
./scripts/update-novnc.sh VERSION
make check
```

The importer refuses a dirty vendor tree, resolves annotated tags to their
peeled commits, validates paths and version metadata, replaces the reviewed
payload, records provenance, and regenerates assets. The pull request must
review upstream release notes, licenses, source and bundle-size diffs. CI must
pass and prove generated assets are committed. The build also enforces a
256-KiB uncompressed noVNC bundle review budget; raising it requires an
explained performance review.

Before merge, complete the real-browser matrix in `docs/operations.md`. In
particular, verify rendering, keyboard modifiers, English/Chinese switching,
first-character IME composition, pointer/wheel, resize and reconnect. Updates
must also repeat P15 compatibility-zero, trailing debounce, finite maximum
wait, flush, local scaling, and final-size convergence. They are never merged
solely because the source compiles. The bot opens the PR as a
draft and never enables auto-merge. Rollback is a normal revert to the previous
vendor/provenance and generated asset commit followed by the standard build
and deployment process.

The initial `v1.7.0` adoption passed the isolated real-browser gate recorded in
`tests/go-live-validation/results/novnc-1.7-upgrade.json`. Production evidence
is recorded in `tests/go-live-validation/results/novnc-1.7-production.json`,
and human visual and interactive UAT was accepted on 2026-08-27.
