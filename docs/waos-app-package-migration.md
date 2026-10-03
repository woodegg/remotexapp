# WAOS migration for App Package ABI v1

Status: required and scope-locked on 2026-08-29. This is the WAOS delivery task
for APP-006 and APP-013, not a separate RemoteXApp requirement. WAOS now tracks
it as TASK-20260829-018 / RUNTIME-017 / BROWSER-007 / EDITOR-009 / QA-063. The
downstream source adaptation, exact RemoteXApp/SDK lock, clean integration
branch, 143 frontend tests, `make verify`, serial complete `make verify-all`
component set, focused rendered Browser/File Editor/Desktop QA, rendered Edge
prompt check, and race gate pass. A literal final-candidate `make verify-all`,
local paired activation/rollback/restore, immutable WAOS release, sandbox00
staging, production activation, read-only acceptance, and Human UAT all pass
for exact WAOS v2.0.91 / RemoteXApp rc.4. The operator accepted UAT on
2026-08-30, separately approved ordered follower promotion, and the
byte-identical pair passed deployment and acceptance on sandbox02, sandbox03,
sandbox07, and sandbox10. Their managed Desktop runtimes were deliberately
restarted at the package-major boundary and are server-ready on driver 2.0.0.
TASK-20260829-018 is explicitly independent of WAOS's completed five-child
RELEASE-002 scope.

The RemoteXApp `0.2.0` stable-train provider review on 2026-09-01 found no
change to App Package ABI V1, its core parser/tests, or the six App sources
relative to accepted tag `v0.2.0-rc.4`. SDK 0.18 retains the SDK 0.17 public
surface and adds manager operations without changing the existing viewer/input
client. The isolated provider build-once gate passed without rebuilding or
changing WAOS. Therefore stable publication does not require a new WAOS build
or release. WAOS keeps its accepted exact rc.4 lock until it independently
adopts `0.2.0`, at which point it updates that lock and reruns affected flows
under the change-routing policy below.

## Outcome and ownership

RemoteXApp owns the generic allocation and status envelope. WAOS owns protocol
interpretation, user-facing behavior, and Agent prompts. Migrating the envelope
must not turn BiDi, CDP, and UNO into one false generic control protocol.

WAOS must update its exact RemoteXApp release, commit, artifact checksum, SDK
module graph/checksum, required template IDs, and control-protocol assertions.
A RemoteXApp candidate and its matching WAOS candidate are released and rolled
back as one tested pair; mixed old/new API versions are not supported.

This document is the provider-side handoff contract. The single downstream
execution plan is WAOS
`docs/superpowers/plans/2026-08-29-remotexapp-app-package-v1-migration.md`.
RemoteXApp records provider evidence here and in its own changelog; WAOS owns
its branch, adapter evidence, release status, and exact consumer lock. A branch
name or human-readable version never proves that the other repository is
ready.

## Cross-repository development management

### Change routing

| Change | Required coordination |
| --- | --- |
| Ordinary App Package/driver change that preserves V1 and adds no WAOS-specific behavior | RemoteXApp package-only delivery; WAOS is unchanged |
| Compatible RemoteXApp core/SDK fix | RemoteXApp patch; WAOS updates its exact lock and reruns affected flows only when it adopts the patch |
| New control protocol or specialized WAOS Agent/UI behavior | Coordinated provider fixtures plus a dedicated WAOS adapter task |
| Breaking ABI or SDK projection | Paired-major RemoteXApp and WAOS release; mixed versions are rejected |
| WAOS-only UI change with an unchanged contract | Independent WAOS release against the retained exact lock |

### Provider freeze and downstream invalidation

RemoteXApp freezes one handoff tuple only after its core, SDK, App Package,
release, confidentiality, installation, and rollback gates pass. The tuple
contains the RemoteXApp version and source commit, release artifact SHA-256,
SDK module/asset graph and SHA-256, API version, template IDs, protocol tags,
and canonical positive/negative fixtures.

WAOS writes that complete tuple into `deploy/remotexapp-runtime.env` on an
independent branch based on its latest completed `main`. Floating branches,
`latest` artifacts, runtime downloads, and copied RemoteXApp source are not a
dependency mechanism. Any provider byte or identity change invalidates WAOS
evidence, even if the version label is unchanged; WAOS must update its lock and
rerun every affected dependency, fixture, rendered, and paired test.

### Paired activation and rollback boundary

Install both immutable artifacts side by side before changing selectors. Stop
or quiesce WAOS so it cannot serve requests while versions are mixed, activate
and verify RemoteXApp, then activate and start WAOS. Local acceptance must
exercise the exact pair and then rehearse rollback by stopping WAOS, restoring
the pre-upgrade root/Home state snapshot before both old selectors/locks,
starting and verifying RemoteXApp before WAOS, and repeating health,
provenance, retained-runtime/profile, and core-flow checks. Restore and retest
the new pair through the same sequence. An older core must never be started on
forward-written incompatible state. State accepted after the snapshot is not
preserved by downgrade. Any mixed response, residue, unexplained state change,
or rollback failure blocks release.

## Locked V1 envelope

The protocol-neutral allocation is authoritative for address and port:

```json
{
  "resources": {
    "control": {
      "kind": "loopback-tcp",
      "address": "127.0.0.1",
      "port": 21001
    }
  }
}
```

Application status is authoritative for readiness and protocol metadata:

```json
{
  "applicationStatus": {
    "state": "ready",
    "generation": 1,
    "details": {
      "application": "edge-browser",
      "control": {
        "protocol": "cdp",
        "address": "127.0.0.1",
        "port": 21001,
        "endpoints": {}
      }
    }
  }
}
```

WAOS must require a current-generation `ready` status, exact loopback address,
integer port from 1024 through 65535, and equality between the allocation and
status address/port. It fails closed on missing fields, stale generation,
unknown protocol, endpoint mismatch, or malformed JSON.

The following major-version replacements are mandatory:

| Old field | App Package ABI v1 field |
| --- | --- |
| `instance.controlAddress` | `instance.resources.control.address` |
| `instance.controlPort` | `instance.resources.control.port` |
| `instance.controlWebSocketUrl` | App-owned `applicationStatus.details.control.endpoints` entry |
| `status.details.controlAddress` | `status.details.control.address` |
| `status.details.controlPort` | `status.details.control.port` |
| `status.details.controlWebSocketUrl` | App-owned `status.details.control.endpoints` entry |

There is no legacy-field fallback in the new major integration.

## WAOS adapters

Browser keeps distinct template/protocol validation:

- Firefox ESR requires `protocol: "webdriver-bidi"` and
  `endpoints.webSocketUrl`; it retains `session.status`, ownership, one-session,
  and `session.end` rules.
- Microsoft Edge requires `protocol: "cdp"`, `endpoints.versionUrl`, and
  `endpoints.browserWebSocketUrl`; it uses CDP ownership and cleanup rules, not
  the Firefox BiDi prompt or `session.status`.

File Editor requires `protocol: "libreoffice-uno"`, validates the generic
loopback allocation, and constructs its UNO connection string from the
validated address/port. Its document identity, lease, save, and destructive
shutdown behavior remain application-specific.

Desktop does not interpret `details.control`. Its managed `sandbox-desktop`,
`xfce-user-desktop`, generation, run-mode, display, and application-environment
checks remain intact apart from the coordinated SDK/release lock update.

WAOS may share a small envelope validator, but each adapter owns its allowed
template IDs, protocol tags, endpoint fields, contention behavior, and Agent
prompt. Adding a future App requires WAOS work only when WAOS intentionally
provides a specialized adapter or Agent workflow for it.

## Delivery sequence

1. RemoteXApp passes its provider gates and freezes the complete handoff tuple,
   including instance/status fixtures and the SDK candidate.
2. WAOS updates Browser and File Editor against those fixtures; Desktop runs
   its unchanged contract against the new SDK.
3. WAOS updates `deploy/remotexapp-runtime.env` to the exact candidate version,
   commit, artifact checksum, SDK graph/checksum, templates, and protocols.
4. Each repository passes its own gates, then the exact candidates complete
   local paired activation, rollback, restore, rendered, and live integration.
5. Only after the required explicit approval may the exact pair enter
   sandbox00 staging or production acceptance. Publication records the tested
   pair; rollback restores both exact locks.

## Required verification

- Fixture tests cover Firefox BiDi, Edge CDP, LibreOffice UNO, and no-control
  Desktop instances.
- Negative tests cover legacy-only fields, public/non-loopback endpoints,
  invalid ports, stale generation, mismatched allocation/status, unknown
  protocol, missing endpoint, malformed or oversized status, and terminal App
  state.
- Live tests cover initial launch, reconnect, manager restart/adoption,
  application restart with a new generation, contention, clean exit, forced
  cleanup, and rollback for every specialized adapter.
- Rendered WAOS tests verify Browser, File Editor, and Desktop behavior and
  confirm that protocol-specific Agent prompts never cross adapters.
- Release evidence records the exact RemoteXApp and WAOS commits, artifacts,
  SDK assets, fixtures, live results, and human UAT decision.

Completion of this guide's checks is a blocking gate for APP-013 and the major
release. It does not modify or reopen the accepted `0.1.0-rc.24` integration.
