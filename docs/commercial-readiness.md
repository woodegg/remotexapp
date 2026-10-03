# Commercial readiness

## Release scope

Version `0.5.1` is the accepted stable software target for one Linux amd64
Ubuntu/systemd/X11 host. It supports a dedicated service account or independent
managers under approved real Unix users, persistent managed desktops,
disposable single-application sessions, App Package ABI V1, the same-origin
SDK `0.21.1`, opt-in bounded rich clipboard synchronization, per-Viewer
input-active local clipboard detection, and the multi-window Unified Console.
Exact `0.5.1-rc.1` behavior passed release gates, real-browser validation, and
Human UAT and was approved for promotion to stable `v0.5.1` without functional
changes. It does not claim hostile
multi-tenant isolation inside one account or validation on other platforms.

The supported publication topology is:

```text
browser -> TLS + identity proxy -> remotexappd (loopback)
                                  -> per-instance Go gateway (loopback)
                                  -> TigerVNC (loopback)
                                  -> X11 session + private D-Bus/IBus
```

## Stable software controls

- Old WebRTC, FFmpeg, H.264/WebSocket, and input A/B PoCs are removed from the
  release branch as well as production builds and routes.
- The manager defaults to loopback and trusted-header authentication. It only
  trusts the identity header from configured proxy CIDRs.
- Origin validation compares parsed hosts exactly. Manager and gateway add
  browser hardening headers.
- Host paths, internal RFB/gateway ports, socket paths and transient unit names
  are hidden from API responses by default. Explicit application-control
  endpoints are returned only as loopback addresses for same-host consumers.
- The manager caps active instances; each gateway caps RFB and input clients.
- Request bodies, WebSocket messages, frame queues, HTTP headers and shutdown
  time are bounded.
- Health and readiness endpoints are explicit. Version, commit and build time
  are compiled into release binaries.
- Manager and gateway use HTTP timeouts and graceful signal handling.
- TigerVNC, gateways, Xauthority, state, profile and Unicode sockets retain
  their loopback/private permission boundaries.
- Text content logging remains disabled by default; UNO and Firefox WebDriver
  BiDi are opt-in template controls that remain loopback-only.
- noVNC release source, upstream commit, archive checksum, attribution, and
  license texts are vendored together; normal builds do not fetch moving code.
- Central dedicated-account and real-user installers, environment files,
  preflight checks, rollback backups, and hardened systemd units are versioned
  in `deploy/` and `scripts/`. Both runtime modes are non-root and contain no
  runtime user switching.

## Required production decisions outside this repository

Before treating an installation as production-ready, its operator must
complete:

1. Configure TLS and an identity proxy that strips client-supplied identity
   headers. Verify unauthenticated HTTP and WebSocket requests are rejected.
2. Decide tenant isolation. Use one UID/container per trust boundary.
3. Review licenses for TigerVNC, noVNC, IBus, desktop environments, browsers,
   and hosted applications with legal counsel.
4. Define backup/retention for persistent profiles and managed registry data;
   run restore and rollback drills.
5. Add organization-specific monitoring, alert routing, vulnerability update,
   incident response, privacy, support, and SLA policies.
6. Load-test the actual host size and application mix. The default 32-instance
   cap is a guardrail, not a capacity promise.

These are deployment and business controls; the stable software tag cannot
certify them. A private test deployment may explicitly retain the
development no-auth mode while it is not a production/public endpoint.

The `user-home` run mode and `xfce-user-desktop` template completed automated
deployment validation and human UAT on 2026-08-27. See the current changelog,
requirements register, and
[`rich-clipboard-requirement.md`](rich-clipboard-requirement.md); the 0.3.0,
0.2.0, and earlier candidate records remain historical evidence.
