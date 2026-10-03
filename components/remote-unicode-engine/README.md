# Remote Unicode IBus engine

`engine.py` is the product IBus component used by every supported class. It
accepts owner-only local Unix-socket commits and calls IBus `commit_text()` on
the focused application. Cursor updates are pushed over the same private
socket to the per-instance Go gateway.

The socket is instance-local below `/run/user/$UID/remotexappd`, and the class
focus allow-list remains mandatory. See `docs/ime-caret-push.md` before
changing its protocol.
