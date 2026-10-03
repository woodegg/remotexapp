# Go-live and system performance report — 2026-08-27

## Outcome

The P01/P03/P03b driver integrations and P02/P05-P14 compiled features are live
on `0.0.0.0:1991`. The stable console is:

`http://test-host:1991/sdk/console.html`

The manager is an enabled user service named
`remotexapp.service`. Fixed display `:2` is no longer an anonymous
in-memory autostart runtime: persistent registration `test-host-xfce` owns
it. Its server layer stays running, XFCE starts on the first RFB attachment,
and ten seconds after the last detachment only the session layer stops.

Deployed hashes:

| Component | SHA-256 |
|---|---|
| `remotexappd` | `188afc120b3f1b12d3555e7dc7fc63dc608c04f784bc080c40a577ad31f566a6` |
| `novnc-input` | `304f77f9c0452c03195ac2eccd0062d7b46d915c8cff267bcb59ea598f37e8d5` |
| `remotexapp-status` | `3ee10fb239c7f201d773d2d422b6bac96d90e7fb9ef9b442c2714ce028d46a91` |

## Verification gates

- `make backend-test`, all Go tests, 12 SDK tests and the 16-experiment
  documentation consistency check passed.
- `go test -race ./...`, `go vet ./...`, shell syntax, Node syntax and all
  class JSON checks passed.
- Isolated Mousepad passed 600 Unicode commits, exact UTF-8 clipboard readback,
  pointer/scroll, strict resize, reconnect, status and complete five-second
  cleanup.
- Isolated Edge rejected a `file://` URL before allocation, launched the exact
  HTTPS/incognito parameters, used depth 24, resized 900x640 -> 1100x760,
  reconnected in 59.5 ms and cleaned every unit.
- Clean and configured XFCE profiles each produced exactly one session-owned
  Clipman on the private session D-Bus. A host-scale readiness bug was found
  and fixed: clean-profile attach fell from the rejected 20.182-second scan to
  4.506 seconds. Exact text/clipboard, fixed resize, reconnect and session-only
  cleanup passed.
- Fault injection replaced a killed gateway in 722 ms and killed Xtigervnc in
  697 ms. A killed application reached generation-safe error status in 54 ms;
  desired stopped -> running recovered it.
- Manager restart preserved managed runtime IDs, registry inodes and unit PIDs.
  Testing also proved that an anonymous auto XFCE conflicts with its fixed
  display after manager restart; migrating it to the managed registry resolved
  the conflict and is now part of the production topology.
- After deployment, local and `test-host` console/SDK requests returned 200,
  a real systemd restart adopted display `:2` without duplicate units, and both
  full post-live workloads passed again.

## Matched before/after result

Each application used the same workload: 30 seconds static, 600 sequential
Unicode requests at 50 ms intervals, 30 seconds browser-originated scrolling,
strict resize policy, explicit disconnect/reconnect and exact X11
`UTF8_STRING` readback.

| Metric | Mousepad before | Mousepad after | XFCE before | XFCE after |
|---|---:|---:|---:|---:|
| Attached total PSS | 169,585 KiB | 124,410 KiB (-26.6%) | 433,741 KiB | 393,179 KiB (-9.4%) |
| Attach to session | 1,184 ms | 796 ms (-32.8%) | 1,029 ms | 3,597 ms (+249.6%) |
| Static cgroup CPU | 25,995 us | 16,472 us (-36.6%) | 274,776 us | 38,259 us (-86.1%) |
| Input cgroup CPU | 3,013,833 us | 2,663,215 us (-11.6%) | 2,617,639 us | 2,436,058 us (-6.9%) |
| Scroll cgroup CPU | 771,313 us | 717,494 us (-7.0%) | 1,550,550 us | 1,692,970 us (+9.2%) |
| Static RFB down | 0.24 kbit/s | 0.24 kbit/s | 307.79 kbit/s | 0.30 kbit/s |
| Input RFB down | 127.35 kbit/s | 127.63 kbit/s | 82.61 kbit/s | 73.11 kbit/s |
| Scroll RFB down | 35.43 kbit/s | 36.59 kbit/s | 37.22 kbit/s | 40.95 kbit/s |
| Input ACK p50/p95 | 1.3/3.0 ms | 1.0/2.9 ms | 1.3/3.5 ms | 1.0/2.1 ms |
| Reconnect | 31 ms | 25 ms | 43 ms | 35 ms |
| Cold static assets | 45 / 549,477 B | 3 / 182,088 B | 45 / 549,477 B | 3 / 182,088 B |

In the P01-P13 matched run, the largest idle saving was the fixed XFCE
server-only layer: total PSS fell
156,537 -> 80,903 KiB (-48.3%), and cgroup MemoryCurrent fell 142,700,544 ->
33,792,000 bytes (-76.3%). Direct Xtigervnc, a separate lean server unit and
the removal of server-layer Clipman account for the topology change.

The material regression is XFCE cold-session attach. The old display kept more
desktop support resident and reported ready in about one second. The new
server-only state creates a private session D-Bus and exactly one Clipman on
demand before publishing readiness, taking 3.597 seconds in the matched live
run. This trades cold-start latency for much lower detached memory and clean
session ownership. Mousepad, which has no Clipman requirement, became faster.

Scroll traffic/CPU varied by +3.3%/+10.0% traffic and -7.0%/+9.2% CPU for
Mousepad/XFCE. These modest single-run changes are workload-sensitive and are
not claimed as improvements. Static XFCE traffic changed by three orders of
magnitude and is large enough to be operationally meaningful.

## Deployment and rollback

The installed unit source at the time was the pre-RemoteXApp user unit, now
available only from Git history. Runtime binaries live under
`.runtime/`; the pre-switch binaries and checksums are retained in the path
named by `.runtime/go-live-backup-current`. A rollback must stop the manager,
stop the exact managed runtime units, restore the three backed-up binaries,
and restart the manager service. Do not delete the persistent XFCE profile or
managed registry during binary rollback.

P14 subsequently moved D-Bus, IBus and the Unicode engine out of every
persistent server unit and into each on-demand session. The live detached XFCE
server unit is now one `sleep` anchor at 212,992 B `MemoryCurrent`/one task,
down from the immediately pre-P14 16,887,808 B/18 tasks. All three repository
drivers passed live text, clipboard and lifecycle checks. The controlled P14
comparison and its separate rollback snapshot are documented in
[`session-input-go-live-2026-08-27.md`](session-input-go-live-2026-08-27.md).

Full XFCE subsequently enabled the same generation-safe application-status
contract as Mousepad. Real Logout is now `stopped/exited` rather than `failed`;
real isolated and production tests kept the RFB client attached, then started
generation 2 on reconnect and returned to exact server-only vacancy cleanup.
The manager also republishes status schemas per generation for safe upgrades
of existing persistent runtimes.

Normal vacancy cleanup currently makes systemd label transient driver units
`failed` when their shell receives SIGTERM even though manager state, cgroups,
ports and application cleanup are correct. This is log/status noise, not a
runtime leak; it is retained as a follow-up rather than changing shutdown
semantics after the performance freeze.

Authoritative raw data:

- `tests/system-performance/results/pre-go-live-*.json`
- `tests/system-performance/results/post-go-live-*.json`
- `tests/system-performance/results/post-go-live-summary.json`
- `tests/go-live-validation/results/candidate-lifecycle-fault-summary.json`

## Commercial RC migration

Later on 2026-08-27, 0.1.0-rc.1 replaced the source-tree binaries while
preserving the managed registry and persistent XFCE profile. The formal
RemoteXApp cutover subsequently consolidated the host onto the single
`remotexapp.service` identity. This internal host deliberately uses the
authorized no-auth `0.0.0.0:1991` policy; new installations use loopback
listening, trusted-proxy identity authentication and redacted API responses by
default.

The manager first adopted `xfce-desktop-688676b680f5`, proving state
compatibility. With zero clients, desired state was changed to stopped and back
to running so every per-instance process used the installed release. The first
RC runtime was `xfce-desktop-fa8b782d5f1d`; final route hardening rebuilt it as
`xfce-desktop-48ba769445cd`. A live headless browser then passed
fixed framebuffer policy, Chinese and English committed text, and reconnect.
The rollback snapshot is
`~/.local/state/remotexapp-install-backups/20260827T162800Z-live/`.

Hashes used for the recorded 90-second RC performance samples:

| Component | SHA-256 |
|---|---|
| `remotexappd` | `21463405ada7c0cefe1f018a18baf4fa374c0bdd8a3c446975fe99f78656bb26` |
| `novnc-input` | `f9a62c66311f9f8901c31f891937e67d670ff156603e72d57511c55fa53412f7` |
| `remotexapp-status` | `302d1bf92612543bb8a6f1f3eeda72898b54c272b8615fea810c592a7c8fff4b` |

Full release evidence and the load-qualified performance comparison are in
[`commercial-release-report-2026-08-27.md`](commercial-release-report-2026-08-27.md).
