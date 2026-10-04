# Release policy

RemoteXApp versions the Core service, browser SDK and App Packages separately.
Read [current source identity](current-state.md) for their versions; query the
running Manager and verify artifact checksums to identify an installation.
Historical release records do not establish current deployment state.

## Versions and supported surface

Core uses semantic versions from `VERSION`; annotated tags are `v<VERSION>`.
Before 1.0, patch changes should preserve compatibility. Breaking API changes
require a new minor version, a changelog entry and migration guidance.
Independent Apps use `<app-id>-v<driverVersion>` tags and the `remotexapp/v1`
package ABI. The served SDK reports its own version.

The supported integration boundary includes health/readiness and version
routes, template/instance and managed-instance APIs, declared App actions,
protected connection descriptors, Viewer routes and the same-origin
`/sdk/index.js` module. Use `/api/templates`; `/api/classes` is a compatibility
alias. [SDK reference](browser-sdk.md) and [integration guide](integration-guide.md)
define the client contracts.

Generated asset names, private sockets, persisted file layouts, component
handles and repository Go/SDK source paths are implementation details. There
is no independently published npm SDK package or reusable Go library.

## Platform and trust boundary

Runtime hosts require Linux X11, the selected lifecycle backend and each App's
native dependencies. Systemd remains the default. Explicit standalone mode
supports a selected existing non-root UID with delegated cgroup v2 containment;
runit can supervise the Manager. See [dependencies](dependencies.md),
[standalone contract](standalone-runit-release.md) and [security policy](../SECURITY.md).

Qualification is scenario- and environment-specific. Historical Ubuntu and
standalone results are not certification for every distribution, architecture,
clean host or reboot. Keep any unexecuted real-host/reboot gates explicit.
Audio and reliable external/background lease ownership remain deferred.

An authenticated Manager operates within one Unix-account trust boundary.
Separate mutually untrusted tenants by UID/container. The deployment owner
supplies TLS, identity, provisioning, storage, backup and capacity controls.
Connection descriptors are for trusted local automation, not public control
socket exposure.

## Immutable publication

A release is promoted from one reviewed, same-commit candidate. Hosted portable
checks, exact-archive target-like E2E and human UAT must cover the change before
publication. Publish those exact bytes, verify fresh downloads, and never reuse
an immutable tag or change content under an existing version. Follow the
[release process](release-process.md) and [test tiers](development-quality-process.md).

Publishing does not activate a service or upgrade pinned runtimes. The target
owner separately verifies and deploys the artifact. Compatible Manager restart
adopts existing runtimes; explicit runtime upgrade/restart applies new pins.
Breaking state-schema downgrades require the pre-upgrade state snapshot.
See [runtime upgrade API](runtime-upgrade-api.md) and
[deployment procedure](release-alignment-process.md).

## Historical records

Public technical histories retain accepted behavior, stable requirement IDs,
decision rationale and testing limitations. They are not deployment instructions
or a queue of approvals for the current release. Earlier operational artifacts
and issues belong to the [private historical archive](private-history.md).
