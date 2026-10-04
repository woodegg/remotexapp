# App Package ABI v1 major release train

> Historical technical record. Dated status and validation statements describe
> their original scope; they do not identify a current deployment. See
> [current source versions](current-state.md). Host labels and runtime IDs in
> historical examples are anonymized.

Status: release scope was accepted and locked on 2026-08-29 after
primary-source research, scope narrowing, and host application integration review. Exact
candidate `0.2.0-rc.4` source `b21524c08d6e`, release archive SHA-256
`9466197d170b9aa9c75a39711c6b5847e3764a5a6c0bc39c375071d3d8234a99`, and
SDK 0.17 passed core, race, release-CI, build-once, all-six-App real-X11, local
paired activation/rollback, and exact host application integration gates. After separate
approvals, the pair passed test-host-a isolated staging, rollback/forward
restoration, production activation, read-only acceptance, and Human UAT. The
operator accepted UAT on 2026-08-30, separately approved ordered follower
deployment, and the byte-identical pair passed deployment and acceptance on
test-host-c, test-host-d, test-host-h, and test-host-k. Their managed Desktop runtimes
were explicitly restarted at the package-major boundary and are server-ready
on driver 2.0.0; exact core/SDK/package, service, root, hygiene, snapshot, and
unchanged host-application session gates pass.

## Required outcome

An ordinary X11 application must be addable or upgradable without rebuilding
the RemoteXApp manager, gateway, status helper, browser SDK, or host application. The
operator installs one trusted, versioned App Package, validates and activates
it, then restarts the manager. Existing healthy runtimes remain on their
immutable package snapshots; only new runtimes select the newly active package.

Adding an ordinary App may change only its package, package-owned tests,
dependency provisioning, and downstream UI that deliberately understands the
application. A core change is justified only for a new platform capability or
security boundary, such as GPU allocation, audio transport, a new resource
kind, or a new authentication model.

Hot catalog reload is not required. Manager restart remains the first release
boundary because unified runtime manifests already support healthy adoption.

## Coupling being removed

The current catalog is mostly declarative, but application work still leaks
into the core because:

- the manager recognizes `webdriver-bidi` and constructs its WebSocket URL;
- instance and SDK types contain protocol-specific control fields;
- driver status accepts only scalar detail values;
- `xfce-user-desktop` is named directly in override policy;
- session readiness has a manager-owned fixed 20-second deadline;
- deployment preflight contains a global hand-maintained application list;
- manager catalog tests inspect application driver source text; and
- shared shell helpers make package ownership and version boundaries unclear.

Application commands, protocol probes, visible-window detection, document
locks, and graceful shutdown remain driver responsibilities. They must not be
moved into Go merely to make a package declarative.

## Package format, integrity, and activation

The source package owns its manifest, executable assets, documentation, and
tests. The installed runtime artifact is intentionally smaller:

```text
apps/<app-id>/
  manifest.json
  session.sh
  shutdown.sh
  probes/
  README.md
  LICENSE
  tests/

/usr/local/share/remotexapp/apps/<app-id>/<driver-version>/
  manifest.json
  session.sh
  shutdown.sh
  probes/
  LICENSE
/etc/remotexapp/apps-enabled/<app-id> -> installed version
```

User installations use equivalent paths below `~/.local/share/remotexapp/`
and `~/.config/remotexapp/`. A release package is a deterministic `.tar.gz`
plus SHA-256 checksum. The runtime manifest pins the App ID, version, verified
content digest, and canonical installed path so adoption never follows a
changed selector. Mandatory registries or signatures are deferred; operators
may add signed transport around the checksummed artifact.

Packages are trusted executable code, installed only by the account or
administrator that owns the RemoteXApp deployment. They are never accepted
from an instance-creation request or unauthenticated marketplace. Activation
requires strict core-schema validation, safe package-local paths, production
ownership/permissions, an unused immutable version, verified digest, and
satisfied dependencies.

The installer stages and validates the artifact, publishes it with an atomic
rename, and atomically changes the enabled selector. It never runs `apt`,
downloads code, or overwrites an existing version. Removing a selector prevents
new instances but must not remove a version referenced by a runtime manifest.

## Stable App Package ABI

One required field, `"apiVersion": "remotexapp/v1"`, versions the complete
package/core contract. V1 has no separate schema-version negotiation or
`driverApiVersion`. The manager rejects an unsupported `apiVersion` before
activation.

The manager strictly validates fields it owns: identity, assets, execution
mode, parameters, override locks, named ports, readiness deadlines, status
limits, and dependencies. An optional `driver` object may contain an opaque
`config` JSON object; when omitted, the launch file contains `{}`. The manager
passes the value unchanged in a mode-0600 launch file. This lets a
driver add application-specific settings without expanding the core schema.
Unknown top-level core fields fail validation.

The manager owns display and port allocation, HOME/profile selection, runtime
directories, generation, systemd containment, launch-parameter validation,
status transport, attachment accounting, and host shutdown policy. Stable
environment variables supply DISPLAY, Xauthority, runtime paths, generation,
and status-helper paths.

The driver owns application launch, Matchbox or desktop startup, visible-window
detection, application-protocol probes, readiness publication, clean exit,
application-specific status, and shutdown/lock cleanup. Common input, status,
window-close, and server helpers are immutable core ABI assets whose exact
paths are recorded by the runtime snapshot.

The existing coherent `runMode` values remain unchanged: `isolated`, `shared`,
and `user-home` continue to select their complete HOME, D-Bus, and Xauthority
environment. V1 also retains the current managed and anonymous lifecycle
semantics. The broader separation of registration durability, runtime
activation, session activation, and vacancy action is a later lifecycle train,
not an App Package prerequisite.

## Named loopback ports and generic status

V1 allocates only named loopback TCP ports:

```json
{
  "ports": {
    "control": {"kind": "loopback-tcp", "port": 0}
  }
}
```

The runtime and public instance expose the allocation under a generic
`resources.control` object. The manager neither recognizes CDP, WebDriver BiDi,
or LibreOffice UNO nor synthesizes or proxies their URLs. Other resource kinds
must be proposed as later platform capabilities instead of being hidden in a
generic arbitrary-resource registry.

Driver status adds a declared bounded JSON detail type. The helper enforces
generation, total encoded bytes, nesting depth, and collection limits without
interpreting application meaning. A ready App may report:

```json
{
  "details": {
    "application": "edge-browser",
    "control": {
      "protocol": "cdp",
      "address": "127.0.0.1",
      "port": 21001,
      "endpoints": {
        "versionUrl": "http://127.0.0.1:21001/json/version",
        "browserWebSocketUrl": "ws://127.0.0.1:21001/devtools/browser/..."
      }
    }
  }
}
```

The SDK exposes `resources` and status details as generic JSON values and drops
protocol-specific top-level control fields in this major API. The host application retains its
application adapters: Browser interprets Firefox BiDi or Edge CDP, File Editor
interprets LibreOffice UNO, and Desktop remains a generic viewer. Those
adapters may share a small reader for `resources.control` and
`applicationStatus.details.control`; RemoteXApp must not pretend the protocols
have one common behavior. A later App changes host application only when host application deliberately
adds App-specific UI, control, or Agent behavior.

## Policy, readiness, and dependencies

Every manifest explicitly declares allowed and locked instance overrides. One
template-independent validator applies that policy; no template ID may appear
in production policy code. Startup/readiness deadlines are bounded manifest
policy. The driver publishes readiness only after its visible-window and
application-protocol conditions pass, while a current-generation driver error
ends the wait promptly.

Dependencies are simple capability checks, initially required executable names
and Python module names. Generic preflight reads the enabled catalog and names
the unavailable package and capability. It does not resolve distribution
package relationships or install anything; dependency provisioning remains an
operator/playbook responsibility.

## Reference migration: Microsoft Edge

Edge is the proving package. For V1 it uses the already supported anonymous
singleton-persistent pattern rather than forcing a managed-lifecycle redesign:
shared run mode, persistent profile `default`, dynamic 1280x720 display, depth
16, 5 FPS, client resize, and complete runtime stop after six detached hours
while preserving the profile.

The package requests one dynamic loopback TCP port and enables CDP on that exact
`127.0.0.1` endpoint. Ready requires both a visible Edge window and a working
CDP endpoint: `/json/version` returns the browser target, its browser WebSocket
completes a handshake, and a harmless command such as `Browser.getVersion`
succeeds. The complete control object is returned through bounded status.

Firefox ESR then migrates BiDi to the same port/status boundary; LibreOffice
migrates UNO; Mousepad proves the no-control path; and both XFCE templates prove
desktop, fixed-display, and `user-home` behavior.

## Verification and release gates

The major release is not ready until all of the following pass:

1. Build the core and SDK once, then install, enable, launch, update, disable,
   and roll back a synthetic package without rebuilding or editing core source.
2. Prove manifest/path/permission/digest/dependency rejection and that failed
   atomic activation leaves the previous catalog selected.
3. Prove manager restart adopts runtimes pinned to old package digests while
   new runtimes select the newly active immutable version.
4. Separate neutral core capability tests from package-owned contract and real
   App tests; core tests never inspect application driver source text.
5. Run real X11 E2E for all six shipped Apps, including input, resize,
   readiness, status, control probes, exit, shutdown, restart adoption, profile
   persistence, and cleanup.
6. Complete the required
   [host application migration](host-app-package-migration.md), update its exact
   RemoteXApp/SDK lock, and pass rendered downstream E2E against the same
   immutable candidate. Follow that guide's provider freeze, downstream
   invalidation, stopped-consumer activation, and pre-upgrade state-snapshot
   plus two-direction paired rollback sequence.
7. Pass `make check`, race, release, package, confidentiality, installation,
   local deployment, rollback, and required human UAT gates.

## Why this boundary

The design follows proven small extension boundaries without adopting their
entire ecosystems: CNI uses a versioned JSON/executable contract; VS Code uses
a manifest and host compatibility declaration; OCI descriptors use digests as
content identity. Kubernetes extension controllers and RPC plugin frameworks
also demonstrate the operational failure points created by a second service or
plugin process, so V1 deliberately remains an in-process catalog plus trusted
executables. Debian-style dependency solving is likewise left to the host
package manager.

Primary references: [CNI specification](https://github.com/containernetworking/cni/blob/main/SPEC.md),
[VS Code extension manifest](https://code.visualstudio.com/api/references/extension-manifest),
[OCI descriptor](https://github.com/opencontainers/image-spec/blob/main/descriptor.md),
[Kubernetes custom resources](https://kubernetes.io/docs/concepts/extend-kubernetes/api-extension/custom-resources/),
[HashiCorp go-plugin](https://github.com/hashicorp/go-plugin), and
[Debian package relationships](https://www.debian.org/doc/debian-policy/ch-relationships.html).

Scope changes require explicit release-train unlock approval, a new stable
requirement, a dated design decision, and an updated acceptance matrix. They
must not be added silently during implementation.

## Deferred and non-goals

- full managed/anonymous lifecycle redesign or durable on-demand registration;
- RPC/gRPC drivers or a second long-running plugin service;
- OCI registry distribution or mandatory GPG/Sigstore signing;
- untrusted or remotely uploaded packages and a public marketplace;
- automatic dependency resolution or operating-system package installation;
- arbitrary resource kinds or public proxying of raw App control endpoints;
- hot catalog reload or a full JSON Schema engine in V1; and
- changing a running instance to a newly activated package.
