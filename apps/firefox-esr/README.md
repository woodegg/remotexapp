# Firefox ESR App Package

This package runs Firefox ESR under Matchbox as an anonymous singleton with
shared persistent profile `default`. The session starts on first attach. Six
detached hours stop the complete runtime; the next create reuses the profile.
The dynamic framebuffer starts at 1280x720, depth 16, and 5 FPS and accepts
client resize requests.

The manager allocates a generic loopback `resources.control` port. The driver
binds WebDriver BiDi to it and reports a bounded control object only after a
visible Firefox window and a successful `session.status` exchange. Consumers
must validate the current-generation ready status and use
`applicationStatus.details.control.endpoints.webSocketUrl`; the old top-level
`controlAddress`, `controlPort`, and `controlWebSocketUrl` fields do not exist
in the major API.

`startUrl` accepts HTTP, HTTPS, or exactly `about:blank`:

```json
{"templateId":"firefox-esr","parameters":{"startUrl":"https://example.com"}}
```

Firefox permits one active BiDi session. Automation must send `session.end`
and wait for success before closing its WebSocket. The endpoint can control
pages, cookies, and browser state and must remain loopback-only.
