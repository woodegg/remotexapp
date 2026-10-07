# Security policy

## Supported boundary

RemoteXApp 0.14.x is supported as a single-host service running either under the
dedicated `remotexapp` account or as one independent manager per approved real
Unix user, behind an authenticated reverse proxy. Code may be installed by
root, but the manager and its instances must never run as root or change UID at
runtime. Treat every identity authorized to one manager as an operator of
every instance owned by that manager's account. Use separate Linux UIDs or LXD
containers for mutually untrusted tenants.

TigerVNC and per-instance gateways listen on loopback. The public manager uses
`trusted-header` authentication by default and accepts its identity header only
when the TCP peer is in `-trusted-proxies`. The proxy must delete client-sent
copies of that header before inserting its authenticated value.

`-auth-mode none -allow-insecure-public` exists solely for explicit internal
testing. It is not a production configuration.

Production candidates are built with exact Go `1.27.1`. The repository checks
reachable source call paths and all four packaged binaries with the pinned Go
vulnerability scanner, and verifies the toolchain plus embedded clean VCS
identity before publication. A published release is not automatically deployed;
operators must verify its artifact and authorize deployment separately.

## Sensitive data

- State, profiles, Xauthority files, registries, and Unix sockets are mode
  0700/0600 and must not be shared between service accounts.
- API responses hide host paths, internal ports, and systemd units unless the
  operator explicitly enables `-expose-internals`.
- Keep `-gateway-text-log errors`. `content` logs user text and is allowed only
  during a short, authorized diagnostic window.
- TLS and public authentication belong at the reverse proxy. Do not publish a
  per-instance gateway or TigerVNC port.
- Central environment files contain routing and policy, not secrets. Keep
  credentials in the reverse proxy or a purpose-built systemd credential
  mechanism rather than an `EnvironmentFile`.
- Do not commit real document names, user HOME paths, deployment hostnames, or
  captured user content. `make sensitive-data-check` scans tracked files, and
  release packaging scans the final archive; `make public-docs-check` also
  rejects operational disclosures and broken local links in readable guides.
  GitHub CI separately scans full history with Gitleaks. Current-file cleanup
  does not remove historical copies or previously published release assets.

## Reporting

Report a suspected vulnerability through a private GitHub security advisory
for this repository, or privately to the system owner when the deployment is
not maintained through GitHub. Include the version from `/api/version`,
reproduction steps, and whether the service used the supported trusted-proxy
topology. Do not include user-entered text or profile contents unless necessary
and authorized. Do not open a public issue before maintainers have assessed the
report.
