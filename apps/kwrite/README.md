# KWrite App Package

Independent isolated editor package, version 1.0.0. Omit optional `filePath`
for a blank editor; supplied paths must be authorized existing readable files.
Uses Matchbox, immediate startup, dynamic 1280x720/16-bit/10 FPS with resize,
and stops the entire instance after 60 seconds detached. Stop forcibly exits
without saving: explicitly save first if required. No automatic document lease
or safe concurrent editing of the same file is promised.

The driver verifies its foreground PID, visible window and private D-Bus owner.
Control is reported privately via CONN-001, not a TCP port or public control
field. See [control contract](../../docs/kate-kwrite-control-research.md).
`openInput` creates a new document; it does not insert into the current one.
Raw D-Bus control is only for trusted local Agents.
