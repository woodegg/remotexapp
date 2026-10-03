# Core driver ABI helpers

This directory contains only manager-owned helpers that form part of the
`remotexapp/v1` App Package ABI. Application drivers belong under
`apps/<app-id>/` and are installed, versioned, tested, and activated with their
own manifest.

- `common/x11-server.sh` provides the normal server-layer readiness anchor.
- The pinned `remotexapp-status --supervise-session` owns session D-Bus/IBus/
  Unicode. Drivers require `session.services: "core-v1"`; never start, stop or
  remove these services or their socket/PID files themselves.
- `common/session-status.sh` publishes generation-safe bounded status.
- `common/window-close.sh` implements the shared graceful-close primitive.

The manager passes the pinned helper directory as
`REMOTEXAPP_CORE_DRIVER_DIR` and records it in every App Package runtime
snapshot. Package drivers must source helpers through that variable; they must
not copy or discover a mutable checkout path.

To add an application, copy `examples/app-package/`, choose an immutable
semantic `driverVersion`, declare dependencies and override policy, then run:

```bash
scripts/package-app.sh examples/app-package dist/apps
scripts/install-app.sh --archive dist/apps/example-app-1.0.0.tar.gz \
  --sha256 SHA256_FROM_PACKAGE_OUTPUT \
  --package-root .runtime/apps --enabled-root .runtime/apps-enabled
```

See [`docs/app-package-major-release.md`](../docs/app-package-major-release.md)
for the trust, lifecycle, status, resource, and verification contracts.
For the mandatory Core 0.12 ownership change, follow the
[Driver migration checklist](../docs/session-services-release.md#driver-migration-checklist).
