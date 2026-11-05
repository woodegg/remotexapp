# Optional native UDP: second-region qualification

The owner's 2026-10-31 request extends [Issue #36](https://github.com/woodegg/remotexapp/issues/36)
and Draft [PR #37](https://github.com/woodegg/remotexapp/pull/37) to a fresh China
regional fixture. The [result record](results-udp-china-20261031.json) binds its
checks to the same immutable artifacts as the [first-region experiment](UDP.md).
This is bounded development UAT; human acceptance and release qualification
remain separate.

## Deployment differences

The new unprivileged Alpine 3.24.2 container has one CPU and a 1 GiB memory limit,
a dedicated network segment shared with its trusted edge, and a non-root runtime
account. Openbox, Mousepad and the native display component supply the X11
fixture. Four Core executables are static; Kasm is a separately pinned musl
component with explicit graphical shared-library dependencies. No compiler or
new product build was required on the target.

Core `f074cb9c6114`, component manifest `22273bc7867a…` and trusted edge
`80815e5df839` retain their original archive hashes. All 21 Core manifest files,
42 component files and 12 edge archive files were checked after installation.
The prior regional PoC and existing gateway routes remain running. The additional
HTTPS hostname uses the existing wildcard Access application and an
Access-verifying connector; anonymous requests redirect to Access.

Unlike a public address bound directly to a host interface, this host's public
EIP is translated upstream. The two Incus proxies therefore listen on host IPv4
interfaces, while the Manager catalog advertises the public EIP. Cloud ingress
and the host guard must both permit the selected UDP ports. Actual public probes
verified both ports before browser qualification. The persistent host guard
restricts them to authenticated, measured test egress sources.

Each display still owns one non-NAT UDP proxy to its container loopback socket,
with PROXY protocol disabled. The trusted edge removes source-bearing HTTP
metadata and rebuilds the permitted SDP fields before workload entry. The host
does not terminate WebRTC; the Tunnel carries HTTPS/WSS while optional screen
datagrams use the direct UDP path. Existing unrelated firewall rules and routes
were retained. Container reboot was tested; host reboot was not.

## Live evidence

An isolated Linux Chrome exercised three Viewers on two displays, including two
Viewers sharing one display. The separate user-supplied Linux Chrome also
received UDP screen updates after the actual container reboot.

- Changing canvas pixels and UDP counters; independent transport preferences;
  complete UDP blockage, WSS fallback and automatic UDP return with unchanged
  WSS epochs; configured 20% bidirectional loss and drops above 1100 IP bytes.
  Actual drop counters were nonzero in both directions. These controlled faults
  do not qualify every public NAT or MTU path.
- Scoped proxy removal/recreation, grant replay/expiry/revocation, valid and
  invalid STUN controls, full-pool WSS fallback, port reuse with a new owner/epoch,
  and rejection of a captured packet from the previous owner.
- Workload capture of 400 UDP packets with only loopback peers; 31 checked HTTP
  requests without source/authentication headers, and four forwarded SDP offers
  without client candidates or original client addresses. This covers the
  supported trusted-client path, not arbitrary application-supplied content.
- Actual remote pointer, buttons, selection, wheel, navigation and focus through
  both UDP Viewers and WSS fallback. Synthetic Chinese composition, Unicode file
  readback, explicit text clipboard both ways, the 64 KiB UTF-8 boundary,
  oversized/permission rejection, four shortcut profiles and focus cycles.
- Manager adoption preserves App processes, pins, generations, slots and
  document hashes. Actual container reboot preserves documents/pins/slots,
  advances generation and restores the managed display; Viewer attachment starts
  its on-demand desktop. The anonymous editor also reattached after reboot.

During the 180.9-second idle resource observation, the same 25 processes and
85 threads remained. PSS changed from 186.84 to 187.46 MiB, anonymous PSS from
84.78 to 85.41 MiB, and aggregate RSS from 318.83 to 319.46 MiB; descriptors
changed from 248 to 241. These are target runtime UID totals; RSS counts shared
pages more than once. No forced GC was used. This short observation is not an
eight-hour leak or capacity qualification.
Only the managed UAT runtime is retained after cleanup; owned test Apps, helper
processes, temporary test dependencies, captures and the isolated browser/profile
are cleaned up. Synthetic qualification documents and private evidence remain.

## Retained failures and acceptance boundary

One zero-interval synthetic double-click attempt delivered only one remote
button pair and failed selection. Four diagnostic repetitions with zero or
80 ms spacing selected correctly. The full pointer matrix subsequently passed
with explicit 80 ms spacing. The initial cause is unproven: retain this failure
and require physical double-click testing instead of claiming it was fixed.

The fresh fixture initially lacked several native libraries and the App
dependencies `jq`/`xprop`; these were installed before launch. Other rejected
attempts were a capture read before ICE negotiation produced packets, a harness
query before iframe navigation completed, and a resource read racing a terminating
helper. Readiness was awaited without repeating the port-reuse mutation. The
resource repeat excludes only observed terminal processes; its successful samples
had no such exclusions. No product source or App vacancy policy changed.

Human UAT should cover actual input-method switching, clipboard permissions,
double-click/drag feel and reconnect in the user's browser. A different network
may require an authenticated measured UDP allowlist update; WSS remains complete.
The [first-region exclusions](UDP.md#acceptance-boundary-and-reproduction) still
apply, including physical Windows/macOS IME, a new eight-hour soak, host reboot,
IPv6/TURN, production tenant controls, audio, file clipboard and embedding-host
integration. Raw addresses, SDP, credentials, packet captures and fleet
configuration remain in private operator evidence.
