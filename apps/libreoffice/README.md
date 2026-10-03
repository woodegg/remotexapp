# LibreOffice App Package

This package optionally opens one manager-authorized document in an isolated HOME on a
dynamic 1280×720 depth-16 display. Matchbox owns the window, client resize is
enabled, and 60 seconds without a viewer stops the complete instance.

`parameters.filePath` is optional and uses the manager's `file` type. The
manager canonicalizes it inside configured document roots. The driver repeats
no-follow regular-file checks, acquires a per-document lease, safely removes a
stale LibreOffice lock, and refuses concurrent ownership.

Omitting `filePath` opens Start Center: readiness requires a visible window
and a usable UNO Desktop service, not an active file document. Invalid supplied
paths still fail. No initial-document lock or lease is derived or cleaned for
the no-file path. Documents later opened through UI/UNO are not automatically
covered by the initial-file lease.

The manager allocates generic `resources.control`; the driver binds UNO to that
loopback port and reports `protocol: libreoffice-uno` in bounded ready status.
The raw UNO endpoint is unauthenticated and must never be reverse-proxied.

```json
{"templateId":"libreoffice","parameters":{"filePath":"/srv/documents/report.odt"}}
```

Stop is intentionally destructive: the shutdown driver kills LibreOffice,
removes its exact document lock and lease, and never sends Ctrl+S. Call UNO to
save before stopping when changes must persist. The committed profile seed is
minimal and portable; do not replace it with generated user state.
