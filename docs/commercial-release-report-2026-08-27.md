# RemoteXApp 0.1.0-rc.1 commercial release report

> Historical evidence: this report describes rc.1 and is superseded for
> current release status by `CHANGELOG.md`, `docs/requirements.md`, and
> `docs/production-handover.md`.

## Outcome

The release candidate is built, installed and running on the internal
`test-host:1991` deployment. Old streaming and A/B prototypes were later
removed from the release branch; production code, components, classes,
drivers, deployment assets and operating documentation now have separate
roots.

This is commercially deployable within the documented single-account,
trusted-identity-proxy boundary. It is not a claim of hostile multi-tenant
isolation or completion of customer-specific legal, SLA, backup, monitoring,
TLS and identity configuration. Those gates are listed in
[`commercial-readiness.md`](commercial-readiness.md).

## Verification performed

- `make release-check`: generated assets, 16-experiment documentation gate,
  all Go tests, 12 SDK tests, `go vet`, production builds, Go race detector and
  host preflight passed.
- systemd templates and shell syntax validated; user installation and rollback
  backup creation passed.
- Process-level authentication test returned 401 without identity, 200 for an
  identity from the trusted loopback proxy CIDR, and 403 for a host-prefix
  cross-origin request.
- Mousepad passed dynamic launch, 16-bit/15 FPS display, resize, RFB and input
  reconnect, Chinese and English text, driver status, instance cap rejection,
  and five-second full cleanup.
- Full XFCE passed fixed 1280x720 behavior, session-owned D-Bus/IBus, Unicode,
  reconnect, intentional Logout as `exited`, generation-2 recreation and
  session-only cleanup.
- Edge passed typed URL/incognito parameters, 24-bit display, resize and
  reconnect.
- The production manager adopted the existing managed display-2 registration,
  then rebuilt it from installed release binaries with zero attached clients.
  A final live XFCE Unicode/reconnect check passed.

Structured E2E evidence is under `tests/commercial-readiness/`; complete
performance samples are under `tests/system-performance/results/`.

## Post-release performance sample

Both samples used 30 seconds static, 600 sequential Unicode commits at 50 ms,
30 seconds scrolling, strict resize, explicit reconnect and exact X11
clipboard readback. Both produced 600/600 commits, zero text errors, exact
clipboard hashes and correct final connection state.

| Metric | Previous Mousepad | RC Mousepad | Previous XFCE | RC XFCE |
|---|---:|---:|---:|---:|
| Input RFB down / 30 s | 478,108 B | 477,389 B (-0.15%) | 274,080 B | 274,992 B (+0.33%) |
| Scroll RFB down / 30 s | 137,362 B | 137,227 B (-0.10%) | 154,243 B | 156,280 B (+1.32%) |
| Static RFB down / 30 s | 892 B | 892 B | 1,120 B | 826 B |
| Input RTT p50 / p95 | 1.0 / 2.9 ms | 2.0 / 8.7 ms | 1.0 / 2.1 ms | 2.2 / 6.2 ms |
| Server input p50 | 0.507 ms | 0.817 ms | 0.514 ms | 0.903 ms |
| Reconnect | 25 ms | 29 ms | 35 ms | 38 ms |
| Attach to ready | 796 ms | 1,364 ms | 3,597 ms | 3,706 ms |
| Manager attached PSS | 9,384 KiB | 11,664 KiB | 11,300 KiB | 12,448 KiB |
| Gateway attached PSS | 4,364 KiB | 4,479 KiB | 8,111 KiB | 9,135 KiB |
| Session attached PSS | 71,805 KiB | 86,804 KiB | 302,778 KiB | 302,719 KiB |

Wire traffic is effectively unchanged, as expected: authentication and request
metadata are manager HTTP concerns and do not process RFB frames. Do not treat
the latency/memory differences as matched regressions. RC samples ran at load
averages roughly 3-7, versus roughly 1-3 in the previous samples, after a much
longer manager/profile exercise history. The Mousepad session variation is
primarily outside the small gateway process. A capacity claim requires repeated
samples on a quiescent dedicated host with controlled profiles.

Detached display-2 inventory after the test recorded manager PSS 12,077 KiB,
VNC PSS 48,718 KiB, server anchor PSS 128 KiB, gateway PSS 11,475 KiB, and no
session cgroup. This preserves the intended lightweight server-only state.

## Deployment state and rollback

- Internal URL: `http://test-host:1991/`
- Console: `http://test-host:1991/sdk/console.html`
- Version endpoint: `0.1.0-rc.1`, source commit `208d4f4140c7`
- Current runtime: `xfce-desktop-48ba769445cd` on display `:2`
- Managed registration: `test-host-xfce`
- Installed unit: `remotexapp.service`
- Unit source: `deploy/systemd/remotexapp.service`
- Live rollback backup:
  `~/.local/state/remotexapp-install-backups/20260827T162800Z-live/`

Final installed hashes (the manager hash includes release build metadata):

| Component | SHA-256 |
|---|---|
| `remotexappd` | `cf24f6c9d9d8516948a01b8409975c967805dbb32d7b71c8033669562fab515c` |
| `novnc-input` | `bb011165332abc9bfb6d617702ad396d2421e32bb94af95e2984e5fc004cd708` |
| `remotexapp-status` | `9a6c680341dca30ad208cbe6670d6a1dc5b6973682f57882f998879c387fb2ba` |

The internal listener deliberately remains unauthenticated per the existing
test policy. It must not be represented as the secure production topology or
published without the trusted identity proxy.

After the performance samples, the unused `/core/` and `/vendor/` filesystem
routes and runtime noVNC directory dependency were removed. The final live
smoke test observed both routes as 404 while bundled viewer connection, fixed
framebuffer, Chinese/English input and reconnect remained correct. The raw
performance JSON therefore identifies the immediately preceding build hashes;
it remains valid for hot-path comparison because this final change only
removed unused HTTP routes and tightened request metadata validation.
