# Mousepad App Package

This no-control reference package runs one Mousepad window under Matchbox. Each
instance has a dynamic 1280x720/16-bit/10-FPS display and isolated ephemeral
HOME. The session starts immediately; 60 seconds without a Viewer stops the
entire instance. Client resize remains enabled.

The manifest deliberately declares an empty `ports` object. Public instances
therefore return `"resources": {}` and prove that an ordinary App does not
need manager or SDK protocol fields. The driver publishes generation-safe
`loading`, `ready`, `exited`, and `error` status through the pinned core helper.

Create it with:

```json
{"templateId":"mousepad"}
```

Optional `parameters.filePath` opens an existing readable file authorized by
the Manager's document roots. Omission opens a blank editor; empty/invalid
supplied paths fail instead of silently opening a blank document. The Driver
rechecks the regular file without following a replacement symlink. Concurrent
instances are allowed; there is no same-document exclusivity lease.

Normal and idle instance stops are destructive: force exit without saving or
waiting for save confirmation. Save manually beforehand when needed. Never use
`--tempfile` or delete the source document. The application is launched with
`--disable-server` to prevent forwarding to an unrelated editor process.

The package owns Matchbox and Mousepad launch/readiness behavior. Core policy
contains no Mousepad-specific branch.
