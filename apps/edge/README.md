# Microsoft Edge App Package

This package is the V1 reference for an application-owned control protocol. It
runs Microsoft Edge under Matchbox in shared, singleton, persistent profile
`default`. The display is dynamic 1280×720, depth 16, 5 FPS, and client resize
is allowed. Six hours without a viewer stops the complete runtime while keeping
the browser profile.

The manager allocates `resources.control` as a loopback TCP port. The driver
starts CDP on that exact endpoint and reports ready only after a visible Edge
window, `/json/version`, a WebSocket handshake, and `Browser.getVersion` all
succeed. Protocol URLs live only in
`applicationStatus.details.control`; RemoteXApp never proxies this
unauthenticated endpoint.

`startUrl` accepts HTTP, HTTPS, or exactly `about:blank`; `incognito` is a
boolean. Example:

```json
{"templateId":"edge","parameters":{"startUrl":"https://example.com"}}
```

Use the generic allocation and current-generation ready status together. Never
publish the raw CDP address outside the trusted host boundary.

Before launch and after owned-process shutdown, Driver 2.0.4 checks Chromium's
`SingletonLock`, `SingletonSocket`, and `SingletonCookie`. It quarantines those
links only when no same-UID process uses the exact profile, no socket is
reachable, and any local PID identity is absent or mismatched. A live or
ambiguous owner fails closed without changing the profile. Quarantine is mode
0700, serialized, retained inside the profile, and bounded to the newest four
records. Rotation removes only a structurally validated Driver-owned record;
unknown quarantine content fails closed. Cookies and every unrelated profile
file remain untouched.

If initial readiness fails, the Driver publishes whether the visible window
or CDP probe was missing before Core's deadline. Core keeps the unattached
anonymous runtime for a fixed two-minute diagnostic window, then force-cleans
its units and retains a private bounded failure summary. Successful sessions
still use the six-hour detached timeout.
