# XFCE user-home desktop App Package

This package is the dedicated-account desktop. It is managed-only, persistent,
singleton, and uses the manager account's passwd HOME, existing user D-Bus, and
`~/.Xauthority`. Display `:1` is the package default; an administrator-owned
site configuration can fix a different display and matching RFB/gateway ports
before launch. Geometry remains 1280×720, depth 16, 10 FPS. Instance overrides
and client framebuffer resize are disabled; the browser only scales the fixed
framebuffer. Version 3.0.1 allows a longer bounded cold-start window for xfwm4.

The session owns XFCE plus its IBus/Unicode processes but never owns or stops
the account's D-Bus. Logout reports `exited`; reconnect can start the next
session generation while the server remains. The real HOME cannot be purged
through the API.

Register it as a managed instance, for example:

```json
{"id":"sandbox-desktop","templateId":"xfce-user-desktop","desiredState":"running","profileRef":"default"}
```

Use one dedicated Linux account per mutually untrusted tenant.
