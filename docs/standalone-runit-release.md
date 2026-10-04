# Standalone/runit and selected-user Core release

> Historical technical record. Dated status and validation statements describe
> their original scope; they do not identify a current deployment. See
> [current source versions](current-state.md). Host labels and runtime IDs in
> historical examples are anonymized.

Status: **RC.6 UAT accepted; stable
[v0.14.0](private-history.md)
published 2026-10-01**.
Scope is RUN-001–RUN-007 and DEP-017. The exact RC.6 artifact passed isolated standalone
host E2E, Ubuntu 26.04 systemd regression and rollback rehearsal. No host
reboot was approved, so boot persistence is not claimed. Publication does not
authorize sandbox deployment or a target service restart.
The stable archive also passed the exact-candidate E2E and was published
unchanged from commit `14c7ef7a0f4c2c379bd8eb1564d8cec2086a192c` with
SHA-256 `1fdd0f12745b29ccb403b35313c3b93a4862061d2e59d4200d4895f12125b22c`.

The target owner provisions cgroup delegation, account services and the
trusted service launcher. RemoteXApp supplies immutable artifacts, the
configuration contract and validation matrix. Publication alone does not
activate or restart a target.

## Objective and boundaries

Support a Linux host whose PID 1 is not systemd, with `runit` supervising the
Manager, while preserving the existing Ubuntu 26.04 systemd installation and
public API/SDK/App Package ABI. Installation chooses one **existing non-root
Unix account**; all Manager-owned runtimes and Apps stay in that UID. A browser
request never chooses a UID. Multiple mutually untrusted accounts require
separate Manager processes, state roots and listeners. This train does not add
cross-UID/root orchestration, Docker, bwrap, audio or a new remote control API.

The existing systemd `install-system.sh --user USER` already implements the
selected-account deployment policy, but its installer, Manager component
launcher, observers and manifest adoption require systemd. A runit `run` file
around the current binary is not a working standalone implementation.

## Lifecycle backend contract

Select `systemd` by default; `standalone` must be explicitly configured and
persisted with each runtime. Define one internal backend interface for
launch, stop, liveness/identity, descendant cleanup and adoption of VNC,
gateway, server Driver and session supervisor. Keep generation and immutable
component/App pins in the existing logical runtime record. Backend-specific
handles belong in a versioned private manifest section, not in public API or
SDK responses. Reject a record from a different backend or unverified UID;
never guess a live owner from a PID file or socket pathname alone.

The standalone supervisor must survive Manager loss, retain exact process
start identity, enforce bounded stop/kill of the owned descendant tree, and
report actual exit. Manager restart must adopt a healthy session without
restarting its App or changing generation. A dead/partial runtime follows
existing boot-aware and failure policy, not an unconditional restart. The
preferred Linux implementation uses a host-delegated cgroup v2 subtree for
the selected UID, with each component spawned into its own cgroup atomically
(`clone3`/`CLONE_INTO_CGROUP` where permitted), per-component `cgroup.events`
observation, generation/PID-start verification and `cgroup.kill` fallback.
Do not assume that a writable cgroup mount or a successful `pidfd_open` proves
delegation or atomic spawn: test both on the target. If unavailable, the train
must design and prove an equally complete containment alternative, not silently
fall back to main-PID-only cleanup.
Stopping a component must also remove its verified empty cgroup leaf. Empty
leaves count against `cgroup.max.descendants` even though they contain no
processes; startup must reclaim leaves left by older builds without touching
populated or replaced cgroups. Exercise repeated launch/stop under the host's
actual descendant quota.
Natural App exit, explicit stop-session, refusal and enforcement remain
distinct. Runit's default `run` restart behavior is unsuitable for each App;
use an explicitly controlled one-shot service or a persistent per-runtime
guardian that implements the lifecycle state machine. Select one mechanism
only after a fault-injection prototype proves Manager-crash adoption and
complete descendant cleanup. Runit may continuously supervise the Manager;
that does not make every App auto-restartable.

Do not weaken the current Core-owned D-Bus/IBus/Unicode session supervisor.
Private input services remain per session generation. User-home borrows the
account D-Bus and never stops it. In standalone mode, the host supplies a
private user runtime directory and, when needed, a persistent account bus;
the Manager validates ownership/mode/protocol before use. Runtime sockets
remain volatile; durable manifests/profiles stay under owned persistent
state. Remove hard-coded systemd assumptions from socket path validation,
operator-socket validation, cgroup observation and installed preflight.
Selecting poll observation alone does not replace component supervision.

## Selected-user installation

Choose an existing non-root account. Provision its HOME, state and private
runtime directory, and an account D-Bus when a user-home App requires one.
The host must provide a cgroup v2 subtree delegated to that account and start
the final Manager process inside it. A writable mount or successful pidfd
probe alone does not establish working delegation or atomic component spawn.

Run `scripts/preflight-standalone.sh --help` for the required user, delegated
cgroup root, site-display configuration and loopback listener arguments. The
trusted host launcher can select the service identity; the Manager never runs
as root, changes UID, or accepts a client-selected user. Runit supervises the
foreground Manager, while Core owns App component lifecycle. Preserve the
host's existing platform services and test containment with owned fixtures.

The service-restart operator API is disabled in standalone mode unless a
separately supervised non-root helper implements the same fixed allowlist,
authenticated authorization, replay/rate and audit contract. Do not pipe an
HTTP request into `sv` or `sudo`.

## Default XFCE display allocation

The shipped `xfce-user-desktop` App currently fixes `:1`, RFB 5901 and gateway
39001, with no instance overrides. An existing host desktop can occupy those
resources. Use an **administrator-owned** site setting that selects all
three fixed values coherently before any
runtime is created. Never enable the existing client/instance `display`
override for this singleton. Validate display number range, port ranges,
cross-resource uniqueness, live X socket/lock ownership and bindability;
reject collisions before touching an existing display. Pin the effective
allocation in the runtime manifest. A later config change must not silently
move a live display; use explicit restart/upgrade semantics and verify old
resource cleanup. Preserve 1280×720, 16-bit, 10 FPS, no client resize and
browser scaling unless a separate requirement changes them.

The initial site-only mechanism accepts `-site-display-config PATH` (or
`REMOTEXAPP_SITE_DISPLAY_CONFIG`) with a strict, bounded JSON file, for example:

```json
{
  "schemaVersion": 1,
  "fixedDisplays": {
    "xfce-user-desktop": {"display": 3, "rfbPort": 5903, "gatewayPort": 39003}
  }
}
```

These numbers are examples, not reservations. Choose values after a fresh
collision check. The source App Package remains sealed; the effective site
allocation is pinned in the runtime's resolved spec. Per-instance overrides
remain disallowed.

## Test and publication gates

1. Unit/race/fuzz tests: backend selection, manifest validation, UID/path
   constraints, hostile PID reuse, process-tree stop, partial startup,
   generation fencing, occupied display/ports and no instance override.
2. Isolated real-service tests under a non-systemd PID 1: launch all component
   types, kill Manager, kill each component, refuse shutdown, enforce stop,
   stop-session/relaunch, natural clean and failed session exit with exact
   empty-leaf removal while the server remains pinned, idle lease/expiry,
   managed and anonymous recovery, including immediate managed-state
   reconciliation after required server-Driver loss,
   pinned restart/upgrade/rollback, and failed-start retention. Verify exact
   PIDs/start times and absence of descendants/foreign-socket deletion.
3. Exact-artifact standalone E2E under the selected test UID: host preflight;
   nonconflicting XFCE display; each enabled App, actual browser Viewer, Unicode,
   clipboard, resize/reconnect, control metadata/actions and service faults.
   Compare platform service/display/listener inventory before and after. The
   target owner performs installation, activation, restart and rollback. A real
   reboot is a separate disruptive test, never inferred from simulated markers.
4. Clean Ubuntu 26.04 systemd regression: original user and central selected-
   user installers, user-home bus, all enabled Apps, Manager/runtime restart,
   graceful/forced stop, manifest adoption and upgrade. Systemd remains the
   implicit default. `make check`, race, coverage, vulnerability, package and
   reproducible release gates pass on the exact candidate.
5. Human UAT and formal GitHub publication are separate gates. Record exact
   release/App hashes, host/package identities, sanitized commands/results,
   remaining limitations and rollback rehearsal. Do not claim boot persistence
   unless a separately approved host restart validates it.

Rollback keeps old immutable releases and data. A new standalone-format
manifest must not be loaded by an older Core lacking that backend; before
selector rollback, stop only owned test runtimes or use an explicit versioned
migration. Never delete user-home data or platform X11 locks as cleanup.
