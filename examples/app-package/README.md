# Example App Package

Copy this directory outside `apps/`, rename the identity and commands, and keep
all application behavior package-owned. The example displays one `xmessage`
window under Matchbox and uses no named ports.

Validate it on a host with its declared dependencies, then create a
deterministic artifact:

```bash
scripts/package-app.sh examples/app-package dist/apps
```

Install with `scripts/install-app.sh`, restart the manager, and create
`{"templateId":"example-app"}`. Do not add application-specific fields or
branches to the manager or SDK.
