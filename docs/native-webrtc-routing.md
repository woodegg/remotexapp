# Native WebRTC transport modes

RemoteXApp's reliable WSS path carries authentication, input, clipboard, control
and baseline display. WebRTC optionally accelerates the Kasm display rectangles.
The Host SDK keeps the same open and attach operations.

## Deployment configuration

Set `-webrtc-mode` for new Kasm runtimes. An omitted mode on a fresh installation
or `-webrtc-mode off` uses WSS. Direct and TURN require a
`kasm-routed-udp-clipboard-v2` component. Configure one bounded
`-webrtc-ports FIRST-LAST` range per Manager in its network namespace.
Manager automatically selects a free port during runtime creation and pins its
address, port and epoch. Active and durable owners fence reuse across Manager
restarts. Verified runtime retirement releases the port. A full range falls
back to WSS and reports `endpoint-pool-full`.

| Mode | Address and routing |
| --- | --- |
| `off` | No UDP listener or Viewer ICE negotiation for new runtimes. |
| `direct` | Set `-webrtc-address` to the externally reachable IPv4. Bind UDP to `-webrtc-bind`, loopback by default. For host-local ingress select `-webrtc-interface NAME` or set the specific receiving IPv4. For containers preconfigure one same-port range to the listener. Use non-NAT proxying without PROXY protocol when the backend must not see the browser source IP. |
| `turn` | By default, discover the unique private IPv4 on an active non-loopback interface when starting each runtime. With multiple interfaces use `-webrtc-interface NAME` to select the relay-facing network. The bind address is also advertised as the TURN peer. Containers with different private IPs may reuse the same port range. |

Use `-webrtc-bind` for an explicit IPv4 when a selected interface has multiple
eligible addresses. The explicit bind and interface options are mutually
exclusive. When discovery finds no unique eligible address, the runtime starts
on WSS and reports `interface-ipv4-unavailable`. Subsequent runtimes discover
again. Active runtimes keep the address in their lease. Provisioning must keep
the edge backend route, coturn peer rules and firewall aligned with the
current container IP before starting a new runtime on a changed address.

TURN's public listener and private relay range are independent of the Manager
range. When the browser is the TURN client and all Kasm peers are on the relay
network, publish the TURN listener and allow the private relay range only on
that network. For example, an edge can expose just `3478/udp` to browsers.
The coturn relay interface and its `min-port`/`max-port` range then remain
private, alongside the Manager's separate `-webrtc-ports` range. Kasm talks
to the private relay as a peer. The browser gets its TURN URL from the same
authenticated edge that serves Viewer grants. HTTPS and WSS keep their own
ingress. If Kasm peers must reach public relay candidates, publish and map the
relay port range one-to-one and configure coturn's external address.

## Authorization and observations

Use a trusted authenticated edge to augment successful native Viewer grant and
lease responses on the same origin. `webRTCMode: "turn"` marks an authorized
TURN runtime. The edge adds `turn: {urls, username, credential}` using the grant
identity and time-limited TURN REST credentials. The [reference edge](../tests/kasm-native/edge/)
reads the TURN URL and a private signing key from its operator configuration.
Serve these responses with `Cache-Control: no-store`. Keep signing material
away from the RemoteXApp/App UID, and restrict coturn peers and private firewall
access to the approved Kasm IPs and ports. Per-Viewer ICE and DTLS remain bound
to existing generation and WSS grant retirement. TURN authentication and
application authorization have separate lifetimes. Budget and monitor active
TURN allocations and their expiry.

The paired Viewer uses relay-only ICE for TURN, retains sanitized WSS signaling,
and falls back to WSS when credentials, negotiations or UDP traffic fail.
Renewal keeps credentials fresh for subsequent negotiations. Existing
`transport: "webrtc-udp"` remains stable. SDK 0.33.0 adds optional
`webRTCPath` for `direct` or `turn` once UDP rectangles have painted. The paired
adapter requests up to three initial full refreshes when an idle shared display
has completed RFB setup
and has yet to paint. A ready Viewer still requires a real frame.

## Migration and rollback

A Manager upgrade can adopt compatible WSS-only Kasm runtimes with no UDP
lease, including legacy manifests reporting `endpoints-not-configured`.
Those runtimes retain their component, generation and transport.

Retire runtimes using the previous manually configured UDP slots before
running this version. Capture the configuration of any managed registration that
pins a legacy slot, then unregister it without purging its profile. Register
it again under the new mode after the Manager starts. Remove the
`-udp-endpoints` flag and configure the desired mode and range. New routed
leases use manifest schema 7.
Before rolling back to a pre-schema-7 Manager, orderly retire routed
runtimes and verify cleanup. A transport mode change takes effect for newly
created runtimes. Review endpoint reachability, selected ICE candidate,
real paint, multi-Viewer independence, private source and WSS fallback.
