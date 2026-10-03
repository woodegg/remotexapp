# App Driver Sandbox — Future TODO

Status: proposed future architecture; no implementation or deployment is
authorized by this document.

## Objective

Reduce an App Package from fully trusted same-UID host code to relatively
untrusted application code. RemoteXApp Core should construct a Bubblewrap
(`bwrap`) sandbox around every eligible App Driver. The application should see
only its own display, private session services, profile, approved documents,
and declared resources.

This is defense in depth for applications belonging to one deployment user.
Mutually untrusted tenants must still use separate Linux UIDs, LXD containers,
or virtual machines.

## Proposed Architecture

```text
remotexappd
  -> systemd session unit and cgroup
    -> trusted Core session supervisor
      -> session-specific D-Bus policy and private IBus/Unicode infrastructure
      -> Core-generated bwrap policy
        -> App Driver -> window manager -> application
```

Core, rather than the package or client, must generate every `bwrap` argument.
The package may select only schema-validated capabilities. It must never supply
raw paths, mounts, environment variables, namespaces, systemd properties, or
Bubblewrap arguments.

## Sandbox Resource Contract

Expose only:

- the exact runtime X11 socket and a read-only runtime Xauthority file;
- exact private D-Bus and IBus sockets, with no unsafe service activation;
- the selected private/shared profile as `$HOME`;
- resolved document parameters beneath administrator-configured document
  roots, with explicit read-only or read-write access;
- read-only App Package content and required system libraries, fonts, locale,
  certificates, and executables;
- private `/tmp` and `/dev/shm`, minimal devices, and a narrow writable work
  area; and
- constrained status and shutdown IPC endpoints.

Do not expose the real user home, the complete `/run/user/$UID`, host or user
D-Bus, host `/proc`, other runtime directories/sockets/control ports, Manager
sockets, Docker/LXD sockets, or unrestricted devices.

Use mount, user, PID, IPC, UTS, and network namespaces; a new terminal session;
an environment allowlist; no privilege gain; and fail-closed setup. Keep CPU,
memory, task, and I/O rate limits in the outer systemd cgroup. Use process
limits such as `LimitNOFILE` for file descriptors and filesystem quotas or
bounded volumes for disk capacity and inode limits.

Bare `bwrap --share-net` also exposes host loopback. Mousepad and LibreOffice
should default to no outbound network. All Apps declaring control ports,
including LibreOffice UNO, require an explicit relay between their private
network and the Manager-allocated host endpoint. Firefox and Edge additionally
require mediated outbound networking; they must not receive the host network
namespace merely for convenience.

## Required Lifecycle Refactoring

- Move the generic server anchor out of package-owned `server.sh` and into
  Core. No package executable may run outside the sandbox.
- Replace Driver-owned `session-input.sh` startup with Core-owned session
  infrastructure. A private D-Bus configuration or filtering proxy must block
  host service activation. Never expose the real user bus to an untrusted App.
- Use an in-sandbox supervisor for App startup, readiness, exit, and the
  package shutdown hook. The outer supervisor sends graceful-shutdown requests
  over a private socket; forced stop terminates the systemd cgroup.
- Do not trust namespace-local PID files from the host. The trusted supervisor
  is the host-visible lifecycle owner and qualifies messages by runtime and
  generation.
- Separate immutable launch inputs from writable outputs. Do not mount the
  durable runtime-manifest directory writable. Publish status through a
  bounded Core-owned broker/helper.
- Preserve restart adoption, locked package identity, graceful/forced stop,
  vacancy actions, clipboard generation binding, and stale-runtime cleanup.

`user-home` XFCE remains a trusted compatibility mode initially: exposing the
real home and user bus would defeat the intended boundary. Strict sandboxing
first targets the isolated Mousepad and LibreOffice packages, followed by the
shared-profile browsers.

## XFCE D-Bus and IBus Compatibility

Moving input infrastructure above the App Driver must preserve the current
`runMode` contract rather than forcing every App onto a new D-Bus topology.

The proposed Core-owned sequence preserves the current `user-home` behavior
(startup is currently performed by the Driver helper):

```text
Core validates the account's /run/user/<uid>/bus
  -> Core starts one runtime-private IBus and Unicode engine
    -> Core exports DBUS_SESSION_BUS_ADDRESS, IBUS_ADDRESS and IM variables
      -> startxfce4 reuses those endpoints
```

`user-home` must reuse, but never own or stop, the account's default D-Bus.
Only the private IBus/Unicode processes belong to the RemoteXApp session
generation. Inspection on 2026-09-05 confirmed that the live local
`xfce-user-desktop` uses the default user bus, has exactly one runtime-private
`ibus-daemon` in its session cgroup, and has no session-owned `dbus-daemon`.

XFCE can invoke `dbus-launch` as a fallback when it cannot find a usable
session bus. Core must therefore make the selected D-Bus socket connectable and
export its address before starting XFCE. It must not switch addresses or
restart D-Bus in place after XFCE starts; loss of an owned private bus ends that
session generation. For a Core-owned private bus, its activation environment
must already contain the correct `DISPLAY`, `XAUTHORITY`, HOME, and XDG values.

XFCE does not inherently require a separately launched IBus. Distribution
`im-config`, system/user autostart, or saved-session entries can nevertheless
start one. Ubuntu 24.04's installed `im-launch` autostart currently exits early
for this directly started X11 session, but that is not a portable invariant.
Core must own the exact IBus socket, wait for it before launching XFCE, and
detect a conflicting daemon or socket fail-closed. It must not interpret
`ibus-daemon --single` as an exclusivity guarantee: that option suppresses the
panel and config modules; it does not prove there is only one daemon.

A future sandboxed full XFCE mode requires its own compatibility gate. A
private D-Bus can avoid cross-display bus-name collisions, but XFCE depends on
selected activation services such as Xfconf and may use GVFS, portals, Thunar,
accessibility, logout, and session restoration. Use an explicit service
allowlist or filtering proxy rather than disabling all activation or exposing
the real user bus. Until those paths pass real E2E, `xfce-user-desktop` remains
trusted and outside strict `bwrap` mode.

## App Package Contract

Evaluate this as a new App Package ABI rather than silently changing V1. A
minimal declarative policy could contain:

```json
{
  "sandbox": {
    "mode": "bwrap",
    "network": "none",
    "home": "private",
    "documents": [{"parameter": "filePath", "access": "read-write"}]
  }
}
```

V1 packages may remain explicitly trusted during migration. The public Manager
API, RFB transport, and Client SDK should not require a protocol change.

## Implementation Checklist

### Review Follow-ups Recorded 2026-09-07

These are unresolved design tasks, not implemented guarantees. Resolve their
contracts before locking an implementation train. The identifiers below are
local TODO references, not release requirement IDs.

- [ ] **SBX-T01 — Constrain external D-Bus activation.** External services
  must use Core-controlled HOME/XDG configuration, immutable service
  definitions and fixed executable paths. Do not search App-writable profiles
  through `standard_session_servicedirs`; a service-name allowlist alone does
  not prevent a malicious same-name `.service` file from replacing its command.
  Put services that execute App-controlled configuration inside the sandbox
  or separately confine them. Test a malicious user service definition and
  prove it cannot execute outside the sandbox.
- [ ] **SBX-T02 — Preserve cross-instance document ownership.** Move shared
  document leases to an external Core broker with runtime/generation ownership.
  Current LibreOffice leases use global state, `kill -0` and `fuser`; these
  cannot reliably identify other sessions from a private PID namespace.
  Define external-process occupancy checks and crash recovery before allowing
  the Driver to remove application locks. Test simultaneous opens, active
  owners, stale leases and owner death without disturbing another session.
- [ ] **SBX-T03 — Define document save semantics.** Choose explicitly between
  an authorized writable working directory and staged files with controlled
  writeback. A single-file bind can break temporary-file plus rename saves;
  binding its parent exposes neighboring files. Cover LibreOffice sidecar
  locks, atomic replacement, Save As, symlink races and concurrent host edits.
  Staged writeback must detect conflicts and preserve recoverable data on
  failure; directory access must disclose and enforce the broader grant.
- [ ] **SBX-T04 — Specify supervisor adoption and control authentication.**
  Keep the runtime supervisor independently supervised so Manager restart
  preserves the session. Define authenticated reconnection, runtime/generation
  checks, namespace and relay recovery, pinned policy versions, and cleanup
  after either supervisor fails. Same UID or an in-sandbox process claiming to
  be the supervisor is insufficient authority. Test Manager restart with an
  attached viewer, forged/replayed control messages, supervisor death and
  stale endpoints. The outside supervisor remains authoritative even if the
  App disrupts the inner supervisor.
- [ ] **SBX-T05 — Separate outbound networking from control access.** Define
  a generic relay for every declared control port, including UNO with outbound
  networking disabled. Distinguish the Driver's namespace-local endpoint from
  the host endpoint returned to clients; bind relays to exact allocated
  resources and generations. Test CDP/BiDi/UNO access, blocked unrelated host
  loopback services, port collisions and relay cleanup/recovery.
- [ ] **SBX-T06 — Preserve EXP-007 environment semantics.** Separate the
  lifecycle supervisor identity from the canonical application environment
  source. Current `cmd/remotexappd/environment.go` reads the readiness PID's
  `/proc` environment and cwd; replacing it with the outer supervisor would
  return the wrong environment. Define validated host/namespace process
  identity and path meaning while preserving generation checks and the
  complete initial environment contract. Test deliberately different outer
  and inner environments, cwd, process replacement and stale generations.
- [ ] **SBX-T07 — Assign resource limits to the correct mechanisms.** Specify
  cgroup CPU/memory/tasks/I/O limits, process file-descriptor limits, and disk
  byte/inode quotas separately. I/O throttling is not a disk capacity quota.
  Verify delegated controller and filesystem support and test exhaustion
  without consuming another runtime's allocation.
- [ ] **SBX-T08 — Require administrator permission grants.** Schema validation
  validates a capability request, not authorization. Resolve effective rights
  from package requests and administrator grants; clients must not elevate
  them through parameters or overrides. Define denial behavior and pin the
  effective policy to the runtime. Test valid but unauthorized requests.
- [ ] **SBX-T09 — State the X11 trust boundary.** A dedicated display separates
  runtimes, but App, WM and input/clipboard participants on that display still
  share X11 access. Document that limitation, protect the external services
  against hostile protocol input, and test cross-display denial. Do not claim
  isolation between clients sharing one display.

Prove the basic sandbox and restart/adoption contract with Mousepad first.
Then prove LibreOffice save, document ownership and UNO behavior before moving
to browser networking. Retain the existing trusted XFCE mode throughout.

### Implementation Work

- [ ] Threat-model same-UID App code, hostile document content, hostile package
  content, browser subprocesses, D-Bus activation, localhost access, and
  runtime recovery.
- [ ] Select and pin a maintained Bubblewrap build containing the fix for
  `GHSA-pxhw-h44j-8pfx` (upstream 0.12.0 or newer at the time of this record),
  and reject setuid installations.
- [ ] Add deployment preflight for user namespaces, required mounts, LXD and
  AppArmor policy, private `/proc`, and the exact Bubblewrap version.
- [ ] Implement the Core outer/inner supervisors and declarative policy
  validator without invoking a shell to build arguments.
- [ ] Implement safe file-descriptor-based or canonical pre-opened mounts so
  untrusted symlink replacement cannot redirect a mount.
- [ ] Implement private D-Bus policy, network mediation, control-port relay,
  status IPC, and graceful-shutdown IPC.
- [ ] Add D-Bus/IBus ordering and failure tests: valid inherited bus, missing
  bus fallback rejection, private-bus loss, stale socket cleanup, conflicting
  IBus startup, user/system autostart attempts, and a clean second generation.
- [ ] Migrate Mousepad, LibreOffice, Firefox, and Edge independently; keep
  `xfce-user-desktop` trusted until a separate desktop policy is approved.
- [ ] Measure cold-start latency and steady-state CPU/memory against the current
  stable baseline.

## Acceptance Tests

The gate must include a synthetic hostile App that attempts to read or modify
the real home, another runtime, Manager state, `/proc`, host/user D-Bus,
localhost services, devices, and forbidden document paths; signal outside
processes; replace mount inputs with symlinks; exceed cgroup limits; and leave
descendants behind. Every attempt must fail without weakening normal runtime
cleanup.

Run full real X11/browser E2E for all migrated Apps: raw and IME input, rich
clipboard in both directions, resize, document access, browser networking,
CDP/BiDi/UNO control, status, graceful and forced shutdown, client detach,
Manager restart/adoption, abnormal driver exit, and stale-state recovery.

## Known Blockers Recorded 2026-09-05

- The local Ubuntu 24.04 LXC environment has Bubblewrap `0.9.0`. Upstream marks
  versions before `0.12.0` affected by a sandbox-setup symlink escape, so the
  installed version is not an acceptable production security boundary.
- A minimal user/mount namespace probe succeeds locally, but mounting a private
  `/proc` inside the nested LXC environment fails with `Operation not
  permitted`. The LXD/AppArmor policy must be corrected and verified without
  broadly weakening the container before implementation can claim PID/process
  isolation.

References:

- [Bubblewrap security model and limitations](https://github.com/containers/bubblewrap#sandbox-security)
- [GHSA-pxhw-h44j-8pfx](https://github.com/containers/bubblewrap/security/advisories/GHSA-pxhw-h44j-8pfx)
- [Ubuntu AppArmor user-namespace restrictions](https://documentation.ubuntu.com/security/security-features/privilege-restriction/apparmor/)
- [Debian XFCE session-bus analysis](https://bugs.debian.org/cgi-bin/bugreport.cgi?bug=1006762)
- [IBus daemon option reference](https://github.com/ibus/ibus/blob/main/bus/ibus-daemon.1.in)
- [D-Bus service activation search paths](https://dbus.freedesktop.org/doc/dbus-daemon.1.html)
- [Linux cgroup v2 controllers](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html)
