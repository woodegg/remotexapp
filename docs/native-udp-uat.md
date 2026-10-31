# Bounded native UDP UAT

Issue [#36](https://github.com/woodegg/remotexapp/issues/36) implements the owner's
2026-10-31 approval of the bounded IPv4 D4 slice on the standalone Alpine test
fixture. It builds on #34/#35 and the [UDP architecture](kasm-native-architecture.md#udp-design).
This is development UAT; production qualification and a formal release remain
separate. WSS stays complete and is the default without an explicitly configured
UDP-capable component and deployment-owned endpoint catalog.

## Implementation contract

- One immutable Kasm server/client pair declares optional UDP capability. Retain
  the frozen research fixes for authenticated STUN/DTLS, exact negotiation
  ownership/retirement and bounded retries; bind its UDP socket to loopback.
- The deployment owner supplies a finite IPv4 endpoint catalog and non-NAT Incus
  proxy devices with PROXY protocol disabled. Manager never receives Incus or
  firewall privileges. Each display owns a durable slot/epoch before launch;
  multiple Viewers share its port but have distinct authenticated negotiations.
  Missing/full pools fall back to WSS. Unknown/failed ownership blocks reuse.
- The trusted edge serves immutable browser assets, strips source-bearing HTTP
  metadata before entering the workload namespace, and checks the bounded native
  client stream. Rebuild SDP from allowed ICE/DTLS/SCTP fields before forwarding;
  preserve the browser's actual localDescription. Unknown messages/SDP fail closed.
  This protects the supported trusted-client path, not arbitrary malicious code
  controlling the trusted edge or user-supplied application traffic.
- A one-use Viewer grant binds authenticated principal, runtime, generation,
  component, Viewer and connection epoch. It is delivered in an authenticated
  response, used in a WebSocket protocol header, never a URL or ordinary log.
  Grants expire in 90 seconds and active Viewers renew every 20 seconds through
  authenticated HTTP. Control loss, explicit revoke, generation retirement or
  expiry closes the owned WSS and retires its UDP negotiation. Manager restart
  drops grants and clients reattach; it does not restart healthy Apps.
- SDK transport preference is per Viewer. UDP failure keeps the same WSS and
  bounded retry. Report actual datagram/paint evidence, screen transport and
  separate WSS/UDP counters; do not label configured preference or ICE state alone
  as UDP success. Audio and rich clipboard are outside this slice.

A native UDP manifest schema must fence older Managers and preserve locked
endpoint identity through restart/recovery. Old WSS manifests remain supported.
Normal stop must verify old owned component termination before its slot can be
reassigned; stale credentials and delayed datagrams must fail against the new
negotiation. Proxy routing state is not authorization; test reuse with old packets
and retain a failed/unknown owner's reservation rather than guessing it is free.

## Qualification

Build immutable static Core and Alpine-native Kasm artifacts off the target.
Use two displays and three Viewers, including two Viewers sharing one display.
Require actual changing pixels and UDP bytes, pointer/keyboard/text clipboard
regression, pool full/reuse, old/missing/wrong credentials, fragmented signaling,
address stripping, independent disconnect, UDP blockage/fallback/return, loss,
MTU/NAT changes, proxy/Manager restart and actual container reboot. Keep public
UDP restricted to measured test sources until this candidate's negative and
resource checks pass. Inspect both host and container evidence without publishing
raw SDP, credentials, client addresses or private fleet configuration.

Retain the preceding immutable WSS candidate and private route/configuration
snapshots. Upgrade/restart only owned test runtimes and preserve their documents.
Record exact hashes, failed attempts, cleanup and unverified physical/network/
long-duration scope in the final evidence. Research passes are not new-product
acceptance and a running experiment is not a test pass.
