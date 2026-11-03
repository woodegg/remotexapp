# Core 0.16.0 / SDK 0.31.0

This release adds the native host/session SDK, reference workbench, opt-in
session audio, consented rich clipboard and optional IPv4 screen UDP. The
default TigerVNC/noVNC provider and App Package ABI remain unchanged.
The owner accepted the reference-host UAT on 2026-11-03 in
[#57](https://github.com/woodegg/remotexapp/issues/57); exact post-merge artifact
qualification and publication are tracked in
[#59](https://github.com/woodegg/remotexapp/issues/59).

Release qualification also found and corrected stale Viewer counts blocking
managed desktop recovery after Manager restart and a changed boot (#62).
Startup discards counts belonging to the previous Manager; current connection
ownership checks, live-process protection and retry policy remain intact.

## Install and select capabilities

The published Core archive contains four Linux AMD64 binaries, eight versioned
App Packages, the served SDK/workbench, operator and migration guides, and the
native component source recipe. It does not include Kasm server/client binaries,
PulseAudio, X11 or application executables. Regional Alpine/ARM64 experiments
are separate evidence, not additional published binary assets.

1. Verify the archive, checksum and candidate evidence using the bundled verifier.
   Stage a new immutable Core directory following the existing installer.
2. For the default provider, retain the normal TigerVNC/noVNC prerequisites.
   For native integration, reconstruct and install a separately pinned component
   using [the native recipe](../third_party/kasm/README.md). Source archives,
   patches, dependency notices and target-library requirements remain part of
   that component. Select `-display-provider kasm -kasm-bundle /absolute/path`.
3. Install the selected App's operating-system dependencies. Enable native
   clipboard and audio policies explicitly, following the
   [clipboard contract](native-rich-clipboard.md) and [audio contract](native-audio.md).
   Browser permission/consent is a separate step. Native clipboard supports
   plain text, HTML and PNG within 2 MiB in aggregate; files/folders are excluded.
4. Serve Manager behind authenticated TLS. Import its `/sdk/index.js` and use
   `/sdk/host.html` as a reference. Apply the [host migration guide](native-host-migration.md)
   for application selection, file paths, window/task ownership and permissions.

WSS is the functional base. Optional UDP requires the matching component profile,
declared endpoint catalog, trusted edge and deployment-owned host forwarding.
UDP carries screen updates; input/control retain WSS and audio has its own
multiplexed transport. Automatic multi-container forwarding/allocation is not
included. See [the endpoint/trust boundary](native-udp-uat.md).

## Compatibility and rollout

The native API is an explicit integration path. Existing legacy calls do not
automatically acquire native clipboard, audio or host-session ownership.
Each window/task releases its own references; explicit App stop remains separate.
Native reconnect stays on its eligible generation and never replays input or
uncertain actions. User-home templates require a registered managed target.

A Manager replacement adopts compatible running Apps and their immutable
component/App pins. It does not upgrade those runtimes. Apply new pins only
through an explicit runtime upgrade or stopped migration. Native schema-4 state
cannot be opened by an older unsupported Core. Preserve pre-upgrade state/HOME
snapshots and previous releases for rollback; never silently switch providers
for a live profile writer.

The functional workbench simulates embedding-host workflows. Actual embedding-host file
mapping, durable windows, permission UX and trusted control execution still
belong to the embedding-host project. The accepted test matrix does not establish every
browser/device/platform, IPv6, or long-duration/load behavior of the new host layer.

Publication uses the existing build-once workflow: qualify the exact post-merge
archive, retain its identity, and publish unchanged bytes. An earlier PR/UAT
archive is not the formal release artifact. The release qualification Issue
retains check results, source/asset identities and owner acceptance scope.
