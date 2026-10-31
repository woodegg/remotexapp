# Optional native UDP: Alpine UAT evidence

Issue [#36](https://github.com/woodegg/remotexapp/issues/36), Draft PR
[#37](https://github.com/woodegg/remotexapp/pull/37), and the
[bounded contract](../../docs/native-udp-uat.md) cover this development experiment.
The [machine-readable record](results-udp-20261031.json) identifies the exact
independent Core, component and edge artifacts. These are UAT candidates, not a
release or a production deployment recommendation.

## Path and ownership

The browser loads pinned HTML, SDK and component code through authenticated
HTTPS. Its reliable control/input channel is WSS through the trusted edge;
optional screen datagrams go directly to the host's public IPv4 UDP endpoints.
The Cloudflare Tunnel carries HTTPS/WSS, not these screen datagrams. There is no
host WebRTC termination service, external STUN server or TURN relay in this
experiment. The host performs UDP proxying; Kasm terminates the authenticated
STUN/DTLS/SCTP negotiation inside the workload.

| Boundary | Configuration and responsibility |
| --- | --- |
| Public host | Deployment-owned allowlist, two fixed UDP ports, persistent guard ordered before Incus/network startup. Deny unmeasured sources; preserve unrelated rules. |
| Incus devices | One non-NAT UDP proxy per display slot, connecting to the workload loopback address; PROXY protocol disabled. |
| Trusted edge container | Loopback-only listener behind the existing Access-verifying connector. Serve hash-pinned browser assets; remove source-bearing HTTP headers and rebuild candidate-free, zero-origin SDP before workload entry. Validate complete bounded native messages, then forward independent binary frames no larger than 16 KiB. |
| Workload container | Unprivileged runtime account, loopback-only native sockets, static Core plus separately pinned musl Kasm component. Manager consumes an explicit finite endpoint catalog; it cannot change host rules or Incus devices. |
| Browser Viewer | One-use grant, authenticated renewal, independent UDP preference and negotiation. Actual UDP bytes/rectangles plus paints determine transport status. WSS remains complete. |

Two Viewers sharing a display share its UDP port, not its credentials. A second
display uses another slot. Closing/revoking one Viewer must not close another.
A slot is reserved durably before launch; failed or unknown ownership prevents
reuse. Verified stop permits another runtime to acquire a new slot epoch.
Residual proxy routing state is not authentication.

## Automated live checks

The isolated Chrome exercised three Viewers on two real X11 displays through
the public authenticated hostname. Tests used changing remote pixels and native
input/file/selection readback, rather than accepting ICE state or a status label
alone. The target was Alpine 3.24 amd64, standalone/runit, Openbox and Mousepad.
Raw captures, credentials, SDP, client addresses and fleet configuration remain
in private operator evidence; the JSON record contains only sanitized summaries
and artifact/evidence hashes.

- Concurrent UDP, independent per-Viewer WSS selection, complete UDP blockage,
  automatic WSS fallback and UDP return without changing the WSS connection epoch.
- Bidirectional random 20% UDP loss and bidirectional dropping of IP packets over
  1100 bytes. These are controlled loss/large-packet faults, not a complete path
  MTU or NAT interoperability matrix. Actual drop counters accompany the repeat.
- Removal/re-addition of one Incus UDP proxy: affected Viewers fall back and
  recover; the other display remains connected. This changes the internal proxy
  tuple, not every possible public NAT mapping.
- Missing, unknown, replayed and stale-generation grants; per-Viewer revocation;
  valid versus missing/bad-integrity/unknown STUN credentials. Suppressed grant
  renewal closes the Viewer after the 90-second server lifetime.
- Normal display stop and port reuse with a new runtime/slot epoch. The old
  credential and a captured authenticated packet receive no success response
  from the new owner.
- Workload-side capture: only loopback UDP peers, no source-bearing HTTP headers,
  and actual forwarded SDP without client candidates or client origin addresses.
  This is evidence for the supported trusted-client path, not a claim that
  arbitrary user-supplied application content cannot contain an address.
- Pointer motion, buttons, double click, drag, wheel, editing/navigation keys and
  focus, using a real X11 probe through both UDP Viewers and WSS fallback.
- Synthetic Chinese composition, Unicode, explicit text clipboard both ways,
  64 KiB UTF-8 boundary, oversized rejection, permission denial, four keyboard
  shortcut profiles, outside/inside focus cycles, and consent reset on reconnect.
  Readback uses the real remote selection and saved application file.
- Manager restart preserves App process identities, component pins, document
  hashes, runtime generations and UDP slots; old channels close and fresh grants
  reconnect. Actual container reboot preserves files/pins/slot identity, advances
  generation and restores the managed display. Its desktop starts on demand when
  attached. The immediate anonymous editor recovers, then obeys its existing
  one-minute vacancy policy; reopening that document creates a new anonymous App.

## Short resource observation and cleanup

After actual reboot, all three isolated-browser Viewers and the user's separate
Linux CDP browser received UDP screen updates. Three remote canvas hashes changed.
The three-Viewer idle check retained the same WSS epochs for approximately 182
seconds; no synthetic App heartbeat was injected.

The target runtime UID initially changed from 205.83 to 215.00 MiB PSS over about
three minutes. After another screen update and quiescence, seven samples over
186 seconds ranged from 213.65 to 213.81 MiB PSS; anonymous PSS ended at 109.82
MiB and aggregate RSS at 346.43 MiB. The same 25 processes remained, with 85
threads and 241–244 file descriptors. One failed initial sampler read was not
accepted; the follow-up contains seven successful reads. This is a short observed
plateau, not a long-duration leak-free or capacity result; no forced GC was used.

Only the intended managed UAT runtime remains active, with one durable manifest.
Owned anonymous Apps, helper processes, packet captures, temporary test packages
and the build container were stopped/removed as applicable. The isolated browser
and its copied scoped Access credential were removed; only the owned tab was
closed in the user's browser. All six pre-existing document hashes were preserved;
the separate qualification document and private evidence remain available. The
requested host proxies, guard, trusted edge and UAT services remain configured.

## Failures and fixture corrections retained

Initial integration found and fixed the adapter's WebSocket options argument,
explicit subprotocol acknowledgement, and translation from a Viewer grant to
the native server's required `binary` protocol. Early idle disconnects motivated
an edge-owned browser Ping/Pong heartbeat; the observation does not establish
one proven cause for every intermediary network closure.

The 64 KiB clipboard exposed a concrete framing defect: the proxy's WebSocket
library emitted continuation frames, which the pinned native decoder ignores.
Keep complete-message validation, then send bounded independent binary messages.
A regression reads physical WebSocket frames, and the real remote clipboard
boundary passed after deploying the revised edge.

Fixture corrections were kept separate from product defects: occluded browser
frames paused paint callbacks; iframe borders affected pointer coordinates; GTK
paste needed a save/readback barrier; a 30-second browser RPC timeout did not
cancel server-side App creation; and a reboot assertion incorrectly expected an
on-demand desktop session to start without a Viewer. Resolve an uncertain create
by reading existing runtime state before creating another. Stop owned duplicates
normally. Do not change App activation or vacancy policy to satisfy a test.

## Acceptance boundary and reproduction

Run `make check`, focused race tests for `internal/nativewire`, the trusted edge
and affected Manager packages, and the applicable component patch tests. Build
with `build-kasm-component.py --platform alpine --transport udp` and the static
Core recipe in [ALPINE.md](ALPINE.md). Record exact immutable artifacts before
provisioning the two-slot dedicated fixture. Repeat the live matrix above with
Access credentials, a CDP browser, private packet captures and scoped host access;
those dependencies are not portable CI prerequisites.

Use the UAT page's real transport statistics while moving/editing the remote App.
A newly connected static screen can still display WSS until the first valid UDP
screen update. UDP is restricted to authenticated measured test egress sources;
a different network may require a measured allowlist update. Blocking UDP must
leave WSS usable.

Human acceptance still covers actual Windows/macOS/Linux input-method switching,
clipboard permissions in the user's browser, pointer feel and reconnect behavior.
This candidate has no new eight-hour soak qualification. Host reboot, arbitrary
NAT/firewall/IPv6/TURN paths, production multi-tenant authentication and quotas,
audio/microphone, rich/file clipboard and embedding-host workspace integration remain
outside this result. Keep the prior WSS candidate and private configuration
snapshots for a controlled stopped rollback; schema-5 UDP state must not be
handed to an older Manager without its documented migration.
