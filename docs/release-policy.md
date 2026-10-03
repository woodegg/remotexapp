# Release policy

RemoteXApp uses semantic versions from `VERSION`. Git tags are exactly
`v<VERSION>`, including release-candidate suffixes. While the product remains
below 1.0, a patch release should remain compatible and a minor release may
change an API only with a changelog entry and migration guidance.

Three version domains are intentionally separate:

- the RemoteXApp release versions the manager, gateway, deployment files, and
  bundled web assets;
- the browser SDK reports its own version from `/sdk/index.js`;
- each App Package reports one driver version for its manifest, server,
  session, shutdown, probes, and package-owned assets.

## Supported surface

The accepted LightView Viewer-attach repair targets stable Core `0.14.1` and
LightView App Package `1.0.13` with SDK `0.29.1` unchanged. App Package V1 adds
optional paired, bounded Viewer transition hooks; prior Apps remain compatible.
The new LightView package requires Core 0.14.1 or later. Local RC.1 / App
1.0.12 UAT passed on 1991/2992 and the operator authorized formal publication
on 2026-10-02. Formal App 1.0.13 excludes ignored bytecode from the archive;
Driver behavior is unchanged. Local 1.0.12 runtimes remain pinned. GitHub
candidate and exact-artifact verification remain publication gates.
Publication does not authorize sandbox deployment. See
[LTV-013](lightview-app-package-release.md#formal-target-1013-viewer-attach-wakeup).

Formal [v0.14.0](private-history.md)
/ SDK `0.29.1` promotes the accepted standalone/runit and
selected-user train. Systemd remains the default; standalone requires explicit
selection, a non-root existing UID, and a delegated cgroup v2 subtree. The
default XFCE App accepts administrator-owned fixed display/RFB/gateway ports
without client overrides. All eight shipped Apps passed exact-RC.6 host E2E,
and Ubuntu 26.04 systemd regression passed. RC.6 human UAT was accepted on
2026-10-01. Host reboot persistence remains unverified because reboot was not
approved. Publication does not deploy or restart a host. See the
[release contract](standalone-runit-release.md).

LightView App Package `1.0.10` is independently published under annotated tag
[`lightview-v1.0.10`](private-history.md).
Optional memory protection no longer gates startup, navigation or native quit.
Low-memory launch defaults remain; public `launchLowMemory` replaces static
live-memory claims. Core 0.13.0 / SDK 0.29.1 and connection/action schemas are
unchanged. This App-only release does not replace Core Latest or deploy
endpoints. See [publication evidence](../tests/evidence/v1/lightview-1.0.10-publication.json).

Core `0.13.0` / SDK `0.29.1` promotes the accepted runtime idle-lease and
Coordinator train. All new keepalive behavior is opt-in; standalone Clients,
App Package ABI V1 and App versions are unchanged. The operator accepted local
RC.3 UAT; formal [v0.13.0](private-history.md)
was published and verified on 2026-09-18. Browser background
keepalive remains best effort, not a guarantee after all Tabs suspend. See
[the contract](runtime-coordinator-release.md) and
[WAOS migration guidance](waos-runtime-coordinator-migration.md).

LightView App Package `1.0.8` is independently published under annotated tag
[`lightview-v1.0.8`](private-history.md).
It accepts exactly formal Lightview
0.1.8 and retains the App-neutral Manager/SDK boundary while validating
upstream stable-endpoint WebKit recovery. Publication does not authorize
deployment. Exact public artifact, upstream and validation identities are in
the [publication evidence](../tests/evidence/v1/lightview-1.0.8-publication.json).

LightView App Package `1.0.7` remains independently published under annotated
tag [`lightview-v1.0.7`](private-history.md).
It is compatible with App Package ABI
`remotexapp/v1` and tested with Core `0.12.2`; SDK `0.28.0` is unchanged. This
App-only release does not replace the Latest RemoteXApp Core release or
authorize deployment. The local container UAT sandbox qualification is recorded
in the package release design. Downloaded public bytes, exact host dependency
identity and manifest identity are recorded in the
[publication evidence](../tests/evidence/v1/lightview-1.0.7-publication.json).

Stable `0.12.1` is published as GitHub Latest after UAT acceptance of the bounded
[Ubuntu compatibility repair](ubuntu-host-compatibility-release.md). See
[publication evidence](../tests/evidence/v1/ubuntu-host-compatibility-0.12.1-publication.json). It retains
SDK `0.28.0`, the Core-owned session-services contract and all App versions
except Mousepad `4.0.1`. Native clean Ubuntu 26.04/Qt6/full-host validation is
not yet certified; document this limit rather than inferring it from local
24.04 acceptance. Publishing and deployment remain separate operations.

Core `0.12.0` promotes the accepted [Core-owned session services](session-services-release.md)
train. Public SDK/API behavior remains unchanged (SDK `0.28.0`), but runtime
manifest schema 2 and `session.services: core-v1` require all seven matching App
Packages and a stopped-system cutover from the Driver-owned architecture.
Preserve HOME/profiles/documents/configuration intent; do not adopt legacy
runtimes or point an old Manager at new records. New-architecture Manager
adoption, restart and explicit coherent upgrades retain their documented
semantics. Stable `v0.12.0` was published as GitHub Latest at that gate; see
[publication evidence](../tests/evidence/v1/core-session-services-0.12.0-publication.json).
Deployment remains a separate operator decision. The older train descriptions
below are historical.

The [Firefox interactive IME fix](firefox-ime-fix-release.md), FFX-007, is
scope-locked for `0.5.3-rc.1` / `firefox-esr@2.1.1`. Implementation, tests and
local 1991 UAT deployment are authorized; publication and other deployments
remain separate approvals.

The supported 0.5 integration surface is `/healthz`, `/readyz`, `/api/version`,
template and instance APIs, managed-instance APIs, instance viewer routes, and
the same-origin `/sdk/index.js` module. `/api/classes` is a compatibility alias;
new integrations should use `/api/templates`.

Generated asset names, host paths, persisted JSON layout, private sockets,
systemd unit names, Go packages, and repository SDK source paths are internal.
The repository does not publish a standalone npm package or a reusable Go
library.

The `0.2.0-rc.4` architecture-major train is the scope-locked
[App Package ABI v1](app-package-major-release.md) migration. It deliberately
changes the template/control contract and therefore requires coordinated SDK
and WAOS migration rather than release on the supported rc.24 patch line. The
defining publication gate is a build-once test that installs and exercises a
new checksummed App Package without changing or rebuilding core artifacts. V1
uses one package `apiVersion`, named loopback TCP allocation, and bounded JSON
status; it does not include the deferred managed/anonymous lifecycle redesign.
The APP-001 through APP-013 release scope is accepted and locked, with APP-008
explicitly deferred. A material scope change requires
explicit unlock approval and a dated design decision. The required WAOS work follows
[the downstream migration guide](waos-app-package-migration.md).

The independent `edge@1.0.0`
[Microsoft Edge identity release](edge-app-package-release.md) is scope-locked,
implemented, and deployed on sandbox00, sandbox02, sandbox03, sandbox07, and
sandbox10. It supersedes template ID `edge-browser` with `edge` while
preserving App Package ABI V1. Sandbox00 received the App independently;
followers received the byte-identical App in the formal rc.4 distribution.
Any other sandbox and any separately released WAOS consumer migration remain
outside this approval.

The `0.2.0-rc.5` core-only
[managed runtime recovery train](managed-runtime-recovery-release.md) is
scope-locked to Issue #5 and RTM-010. It changes no SDK, App Package ABI,
template, driver, or downstream WAOS contract. After sandbox00 acceptance, the
operator separately approved sandbox02, sandbox03, sandbox07, and sandbox10;
the candidate passed on all four followers. The operator then explicitly
ordered formal GitHub publication and alignment of sandbox00 plus all four
followers. The checksum-verified `v0.2.0-rc.5` archive was activated on all
five at that gate; Human UAT remained separate and was later accepted in the
stable train. Rc.5 now remains as a rollback release after the separately
approved stable deployment.

The `0.2.0-rc.10` / SDK `0.18.0`
[unified operator console train](unified-operator-console-release.md)
consolidates the root, SDK console, minimal, and kiosk implementations while
retaining explicit least-privilege modes and the independent console/kiosk
exposure policy. It adds generic launch, status, lifecycle, and durable runtime
restart workflows. Optional manager-service restart requires a separate
non-root, fixed-allowlist operator helper and authenticated operator boundary;
the manager never becomes a general systemd or command-execution interface.
CON-001 through CON-010 are scope-locked. Implementation, complete local
release validation, and deployment only to local port 1991 are authorized; no
sandbox deployment is authorized. Service restart is unavailable in
unauthenticated or dedicated system-service deployment modes.
The rc.9 automated local gate completed, but Human UAT rejected its flat
managed/runtime navigation. Rc.10 implements the accepted hierarchy correction
and passed affected local acceptance. Human UAT was accepted on 2026-09-01;
the CON-001 through CON-010 train is complete.

The stability-only `0.2.0`
[stable release train](stable-0.2.0-release.md) was scope-locked on 2026-09-01
with SDK `0.18.0` and App Package ABI V1 unchanged. It adds no functionality.
Stable positioning, confidentiality, downstream compatibility, local
upgrade/rollback, separately approved sandbox00 staging/production, and
Firefox/LibreOffice Human UAT have passed. Issues #4 and #5 were closed with
exact candidate evidence, and the final clean release-automation gate passed.
Normal latest GitHub release `v0.2.0` is published, its downloaded checksum is
verified, and the formal artifact is aligned locally and on sandbox00 after a
separate explicit production approval. STB-001 through STB-009 are accepted
and the stable train is complete. The train lock itself authorized none of the
sandbox, tag, or publication actions; follower sandboxes remained outside the
train. The operator later issued a separate post-train production approval to
align sandbox02, sandbox03, sandbox07, and sandbox10 to the same formal bytes.

The accepted `0.3.0`
[template catalog simplification train](template-catalog-0.3.0-release.md)
changes Firefox ESR to a 16-bit framebuffer and retires the unused public
template ID `xfce-desktop`. The operator confirms that it has no external or
downstream consumers, so the release includes no compatibility alias,
deprecation period, or migration to `xfce-user-desktop`. The breaking catalog
removal requires a new pre-1.0 minor version. SDK 0.18.0 and App Package ABI V1
remain unchanged. Automated and local validation plus Human UAT passed on
2026-09-02. Annotated `v0.3.0` is published as the normal Latest GitHub
release, and its downloaded archive and checksum were verified. Sandbox
deployment remains separately approved and is not authorized.

The accepted `0.4.0` / SDK `0.20.0`
[bidirectional rich clipboard train](rich-clipboard-requirement.md) was
scope-locked on 2026-09-02. It adds Manager and SDK public surfaces for bounded
plain-text, HTML, RTF, and PNG clipboard exchange in both directions, a
pure-Go per-runtime X11/XFixes bridge, all-Viewer remote-change broadcast, and
manual, prompt, or permission-dependent automatic client policy. The Unified
Console is the non-persistent public-SDK validation and UAT surface for all
clipboard modes and both directions. App Package ABI V1 and all template/App
contracts remain unchanged. The lock authorizes implementation, complete
automated and local E2E, and local `0.0.0.0:1991` UAT deployment only;
sandbox changes, tagging, and GitHub publication remain separately approved.
Rc.1 failed Human UAT because expiring a PNG offer released X11 ownership and
allowed XFCE Clipman to restore older text. CLP-016 corrects rc.2 by separating
offer expiry from the one active selection and using an empty owner for clean
clear operations.
CLP-017 adds explicit, non-destructive browser permission inspection and read
authorization for rc.3; it does not probe write access by rewriting the user's
clipboard. The exact rc.3 build passed the repository/release gates and an
isolated real-Chromium direct-click permission check without changing the local
clipboard. Human UAT was accepted and formal GitHub publication was explicitly
authorized on 2026-09-02. Annotated `v0.4.0-rc.3` is now published as a GitHub
prerelease and its downloaded archive and checksum are verified. The operator
then approved promoting that exact behavior without functional changes to
stable `v0.4.0`; only version metadata, acceptance evidence, and current
support documentation differ. Annotated `v0.4.0` is published as the normal
Latest GitHub Release and its downloaded archive/checksum are verified. Local
port 1991 remains on rc.2 and no sandbox deployment is authorized.

The accepted `0.5.0` / SDK `0.21.0`
[client-active clipboard train](client-active-clipboard-release.md) makes
local-to-remote clipboard detection follow each Client's real input focus and
adds the multi-window Unified Console reference integration. Manager/gateway
protocols, App Package ABI V1, packages, templates, drivers, and remote-to-local
broadcast behavior are unchanged. Complete automated, local real-browser, and
two-local-environment validation passed; Human UAT was accepted and annotated
`v0.5.0-rc.1` was published as an independently checksum-verified GitHub
prerelease on 2026-09-03. The operator then approved promoting that exact
behavior without functional changes to stable `v0.5.0`; only version metadata,
stable acceptance evidence, and current support documentation may differ.
Normal Latest `v0.5.0` passed hosted and independent artifact verification.
Its exact formal bytes are deployed only to the separately authorized local
1991/2991, sandbox00 1991/2991, and sandbox02/03/07/10 production 1991
endpoints. Publication and rollout evidence are linked from the release train.

The accepted stable `0.5.1` / SDK `0.21.1`
[clipboard prompt reliability train](clipboard-prompt-reliability-release.md)
hardens the optional prompt geometry against ordinary embedding-page wildcard
CSS, adds redundant high-contrast direction cues, and suppresses a
same-Viewer rebound using the representations the browser actually committed.
Manager/gateway protocols, App Package ABI V1, packages, templates, and drivers
remain unchanged. Complete automated, isolated real-browser, and local
1991/2991 validation passed; Human UAT was accepted and formal GitHub
prerelease publication explicitly authorized on 2026-09-03. Annotated
`v0.5.1-rc.1` passed both hosted workflows and independent archive, checksum,
identity, SDK, App Package, sensitive-data, and startup verification. The
operator then authorized promotion without functional changes to stable
`v0.5.1` and alignment of its exact formal artifact to local 1991/2991,
sandbox00 1991/2991, and sandbox02/03/07/10 production 1991 only. Normal
Latest `v0.5.1` passed both hosted workflows, independent verification, and
that complete rollout using archive SHA-256
`1dbfa4dd3747572bb8970c5c88d5df26cd9c289a8207845790efbd7b22c60eb5`.
No other target changed. Follow the
[formal release alignment process](release-alignment-process.md).

The accepted stable `0.5.2` development-quality train changes no Manager,
gateway, SDK, App Package ABI, template, or driver contract. It pins Go
`1.26.8`, adds vulnerability, coverage, repeat, race, fuzz, evidence, and
tracked-shell gates, and changes core publication to build-once candidate
promotion. Exact `v0.5.2-rc.1` candidate and real-App E2E passed, Human UAT was
accepted, and stable publication was authorized on 2026-09-04. The stable
promotion also installs the release runner's required `ripgrep` dependency;
deployment remained separately controlled. The operator subsequently
authorized alignment of the exact formal archive to local 1991/2991,
sandbox00 1991/2991, and sandbox02/03/07/10 production 1991. That rollout
preserved configuration and runtime identity and completed without drift or
post-activation warnings; see
[`development-quality-0.5.2-alignment.json`](../tests/evidence/v1/development-quality-0.5.2-alignment.json).
REL-009 through REL-013 and
[`development-quality-process.md`](development-quality-process.md) define the
scope.

Security fixes are applied to the latest supported pre-1.0 line. A breaking
change should use a new minor version. Where practical, a deprecated HTTP or
SDK entry remains available for one minor release before removal.

## Platform and maturity

The stable release artifact targets Linux amd64 and the deployment scripts
target an Ubuntu/systemd/X11 host. Other distributions and architectures
require a source build and are not claimed as validated for 0.2.

The `0.5.0` stable scope includes the core manager, gateway, multi-window
unified console, SDK 0.21.0, App Package ABI V1, five shipped App identities,
managed and anonymous
runtime recovery, and all three run modes. It does not
certify an operator's TLS, identity, tenancy, backup, monitoring, legal, or
capacity controls. Dedicated-account `user-home` UAT was accepted on
2026-08-27. IME input to secure widgets without an IBus context remains outside
the supported Unicode scope.

See [the release process](release-process.md) for the publication gate and the
[alignment process](release-alignment-process.md) for repeatable fleet rollout.
