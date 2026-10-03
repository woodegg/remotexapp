# Repository Guidelines

## Project Structure & Module Organization

Go services live under `cmd/`: `remotexappd` manages instances, `novnc-input`
provides the browser gateway, and `remotexapp-status` implements the driver
status contract. Browser SDK source/tests and generated bundles are under
`cmd/remotexappd/web/`. Session drivers live in `drivers/`; class policy is in
`configs/remotexapp-classes/*.json`. Deployment files live in
`deploy/`. Vendored noVNC release source and provenance live in
`third_party/novnc/`; update it only with `scripts/update-novnc.sh`. Tests are
colocated as Go `*_test.go` and SDK `*.test.mjs` files,
with integration and measured experiments under `tests/`. Obsolete prototypes
belong in Git history rather than the release branch.

Before changing transport, input, lifecycle, or deployment behavior, read
`docs/production-handover.md` and the relevant linked design or experiment
record.

Deployment ownership is split by repository. This project may develop, test in
its project-owned test environment, and publish immutable releases to GitHub.
The sandbox project owns deployment, runtime restart, and alignment of all
sandbox environments. Do not operate sandbox deployments from this repository.
If the owner asks only to “align” or “对齐”, first ask why alignment is needed
and clarify whether they want release/handoff preparation or work in the
sandbox project; the word alone is not deployment authorization.

For a behavior change, update `CHANGELOG.md` under `Unreleased`, revise the
stable requirement entry in `docs/requirements.md`, and append a dated entry to
`docs/design-log.md` when an invariant, data model, lifecycle, deployment, or
trust-boundary decision changes. Do not rewrite accepted decisions; supersede
them with a linked replacement.

## Build, Test, and Development Commands

- `make build` regenerates web assets and builds all four binaries into
  `bin/`.
- `make check` runs asset/document consistency checks, all Go and JavaScript
  tests, and `go vet`.
- `make test-race` runs the Go suite with the race detector.
- `make coverage-check` enforces non-regressing Go and SDK coverage floors.
- `make vuln-check` scans source call paths with the pinned vulnerability tool.
- `make module-check` verifies module checksums and clean dependency metadata.
- `make nightly-portable` adds race, repeated shuffled tests, and fuzzing.
- `make release-check` adds production builds, race tests, and host preflight.
- `make release-ci` runs the portable publication gate and creates a release
  artifact plus checksum under `dist/`.
- `make package-release` packages validated production files for the current
  Linux architecture.
- `make web-assets` regenerates browser bundles; never edit generated assets
  manually.
- `make novnc-check` validates vendored noVNC provenance and the private
  keyboard compatibility surface used by the SDK.
- `make install-user` builds and installs the user service.
- `sudo make install-system` installs previously built artifacts for the
  dedicated non-root production account; use
  `scripts/install-system.sh --user NAME --listen 127.0.0.1:PORT` for a
  centrally managed real user.

Use the loopback command in `README.md`. Live checks require
systemd, TigerVNC, IBus, X11, and a browser.

## Coding Style & Naming Conventions

Format Go with `gofmt` and keep tests beside their implementation. Follow
existing two-space indentation in JavaScript and JSON; honor each shell
script's shebang. Use `remotexapp` for machine identifiers, `RemoteXApp` for
the product, kebab-case class names such as `xfce-desktop`, and `REMOTEXAPP_*`
for driver environment variables.

## Testing Guidelines

Add focused tests for behavior changes. Run the narrowest relevant test, then
`make check`. Performance changes must update the applicable
`tests/performance/<experiment>/README.md`, result JSON, manifest, and linked
baseline documents; verify them with `make performance-docs-check`. State
clearly when validation depends on live infrastructure or credentials.

## Commit & Pull Request Guidelines

Commits use imperative subjects, for example `fix XFCE profile
recovery and session shutdown`; prefixes such as `feat:` also appear. Keep
commits scoped. Pull requests should explain behavior and operational impact,
list verification, link relevant issues or designs, and include screenshots
for visible changes. Never commit secrets, runtime state, or profiles.

## Security & Configuration

Keep TigerVNC and internal sockets loopback-only. Publish only the Go gateway
behind authenticated TLS. `auth-mode=none` is for loopback development.
Separate mutually untrusted tenants by Linux UID or container.
