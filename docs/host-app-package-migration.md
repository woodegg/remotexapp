# Host application migration for App Package ABI v1

This guide preserves the APP-006/APP-013 integration contract. It describes
provider/consumer responsibilities, not acceptance or deployment of a specific
downstream product. Check [current source versions](current-state.md) and use
your chosen release's exact compatibility and artifact identities.

## Outcome and ownership

RemoteXApp owns the generic allocation and status envelope. The host application owns protocol
interpretation, user-facing behavior, and Agent prompts. Migrating the envelope
must not turn BiDi, CDP, and UNO into one false generic control protocol.

The host application must update its exact RemoteXApp release, commit, artifact checksum, SDK
module graph/checksum, required template IDs, and control-protocol assertions.
A RemoteXApp candidate and its matching host application candidate are released and rolled
back as one tested pair; mixed old/new API versions are not supported.

The host application owns its adapter code, integration tests, release status
and exact provider lock. The provider supplies public API fixtures and artifact
identity. A branch name or version string alone does not prove compatibility.

## Cross-repository development management

### Change routing

| Change | Required coordination |
| --- | --- |
| Ordinary App Package/driver change that preserves V1 and adds no host application-specific behavior | RemoteXApp package-only delivery; host application is unchanged |
| Compatible RemoteXApp core/SDK fix | RemoteXApp patch; host application updates its exact lock and reruns affected flows only when it adopts the patch |
| New control protocol or specialized host application Agent/UI behavior | Coordinated provider fixtures plus a dedicated host application adapter task |
| Breaking ABI or SDK projection | Paired-major RemoteXApp and host application release; mixed versions are rejected |
| host application-only UI change with an unchanged contract | Independent host application release against the retained exact lock |

### Provider freeze and downstream invalidation

RemoteXApp freezes one handoff tuple only after its core, SDK, App Package,
release, confidentiality, installation, and rollback gates pass. The tuple
contains the RemoteXApp version and source commit, release artifact SHA-256,
SDK module/asset graph and SHA-256, API version, template IDs, protocol tags,
and canonical positive/negative fixtures.

The host application writes that complete tuple into the host application's dependency lock on an
independent branch based on its latest completed `main`. Floating branches,
`latest` artifacts, runtime downloads, and copied RemoteXApp source are not a
dependency mechanism. Any provider byte or identity change invalidates host application
evidence, even if the version label is unchanged; host application must update its lock and
rerun every affected dependency, fixture, rendered, and paired test.

### Paired activation and rollback boundary

Install both immutable artifacts side by side before changing selectors. Stop
or quiesce host application so it cannot serve requests while versions are mixed, activate
and verify RemoteXApp, then activate and start host application. Local acceptance must
exercise the exact pair and then rehearse rollback by stopping host application, restoring
the pre-upgrade root/Home state snapshot before both old selectors/locks,
starting and verifying RemoteXApp before host application, and repeating health,
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

The host application must require a current-generation `ready` status, exact loopback address,
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

## Host application adapters

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

Desktop does not interpret `details.control`. Its managed `primary-desktop`,
`xfce-user-desktop`, generation, run-mode, display, and application-environment
checks remain intact apart from the coordinated SDK/release lock update.

The host application may share a small envelope validator, but each adapter owns its allowed
template IDs, protocol tags, endpoint fields, contention behavior, and Agent
prompt. Adding a future App requires host application work only when host application intentionally
provides a specialized adapter or Agent workflow for it.

## Delivery sequence

1. RemoteXApp passes its provider gates and freezes the complete handoff tuple,
   including instance/status fixtures and the SDK candidate.
2. The host application updates Browser and File Editor against those fixtures; Desktop runs
   its unchanged contract against the new SDK.
3. The host application updates the host application's dependency lock to the exact candidate version,
   commit, artifact checksum, SDK graph/checksum, templates, and protocols.
4. Each repository passes its own gates, then the exact candidates complete
   local paired activation, rollback, restore, rendered, and live integration.
5. Only after the required explicit approval may the exact pair enter
   the deployment owner's staging or production acceptance. Publication records the tested
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
- Rendered host application tests verify Browser, File Editor, and Desktop behavior and
  confirm that protocol-specific Agent prompts never cross adapters.
- Release evidence records the exact RemoteXApp and host application commits, artifacts,
  SDK assets, fixtures, live results, and human UAT decision.

These checks define APP-013 acceptance for a breaking integration. Compatible
updates need only the affected regression scope and their exact dependency lock.
