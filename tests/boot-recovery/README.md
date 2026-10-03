# Boot-aware recovery acceptance

Portable policy/identity gates: `go test ./cmd/remotexappd -run 'Test(Boot|RuntimeBoot|KernelBoot)'`.
They cover managed/anonymous recovery, durable restart intent, increasing
generations, same-boot no-replay, stop/failure/refusal guards, bounded retries,
private file validation and healthy-adoption backfill.

BR-006 portable gates additionally cover unavailable/invalid directories,
permission/disconnected/stalled probe diagnostics, managed intent restoration,
request rejection and canonical allowlist boundaries:
`go test -race ./cmd/remotexappd -run 'Test(DocumentRoot|ManagedDocument|FileLaunchParameter|ResolveDocumentRoots)'`.

Run `REMOTEXAPP_BOOT_RELEASE_ROOT=/path/to/extracted-release node tests/boot-recovery/run-local-e2e.mjs`
on the provisioned local X11/IBus test host, serially with other live suites.
It owns a temporary Manager on loopback 21996, App packages, runtime IDs and
Mousepad processes. It simulates boot changes by altering only its private
boot markers after stopping its own Manager and units. This is **not** a real
kernel/container reboot. Requires existing systemd-user/X11/IBus/Mousepad and
Node; it does not install dependencies or touch an installed Manager.

The same live fixture starts with a missing root and a non-directory root,
checks explicit journal errors plus HTTP readiness, launches a local document,
then simulates storage arrival/loss/recovery using only its private directories.
It proves real document launch after recovery without Manager restart and
rejects outside/symlink-escape paths. It never accesses real CloudDrive/MyDrive
mounts; directory renames simulate storage outages, not a FUSE integration test.

The actual sandbox00 acceptance must separately record real boot-ID changes,
active managed XFCE before reboot, server-ready/stopped before postboot attach,
same post-cutover runtime ID and newer generations, then actual Viewer/input/
clipboard/connections. Include repeated Manager restarts and container reboots,
preserved HOME/profile data and no extra runtime manifest. Test abnormal
process failures only on owned disposable Apps. Preserve raw failed runs and
label checks that were not executed; /healthz alone is not acceptance.
