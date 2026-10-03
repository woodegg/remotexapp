# Go-live validation

This catalog normally exercises the integrated production drivers without
touching the port-1991 runtime. The manager listens on 1992 with an isolated
temporary state directory. Full XFCE uses fixed display `:13`, RFB 5913 and
gateway 39013; single-app classes use dynamic free displays and ports. Sections
that explicitly record a live port-1991 deployment are exceptions.

The go-live gate requires:

1. repository build, Go/race, SDK and documentation tests pass;
2. Mousepad has lean IBus, no Clipman, exact Unicode/clipboard, resize,
   reconnect, status and five-second complete cleanup;
3. Edge has lean IBus, no Clipman, typed parameters, 24-bit display, resize,
   reconnect and complete cleanup;
4. XFCE server-only has lean IBus and no Clipman; every attached generation
   has one private session D-Bus and exactly one session Clipman; input,
   clipboard, fixed resize and reconnect pass; detach removes the entire
   session while server/gateway remain;
5. managed gateway/VNC and session fault paths converge, and manager restart
   adopts persistent runtime without duplicating it;
6. isolated ports, processes, displays and temporary state are removed before
   the live switch.

The fixed benchmark and post-go-live comparison live separately under
`tests/system-performance/`.

## Completed gate, 2026-08-27

All six gates passed and the isolated manager/runtime directory was moved to
Trash before the live switch. Retained evidence includes full Mousepad/XFCE
workloads, strict resize checks, the Edge CDP check, clean/configured XFCE
Clipman paths and `candidate-lifecycle-fault-summary.json`.

Validation found two issues before deployment. The first clean XFCE readiness
implementation scanned the host process table repeatedly and took 20.182
seconds; the probe-free grace plus one discovery reduced a never-started
profile to 4.506 seconds. An anonymous fixed-display autostart also prevented
manager restart because its transient units survived without a durable runtime
identity. Migrating fixed XFCE to a desired-running managed registration made
two-runtime restart adoption preserve IDs, registry inodes and all unit PIDs.

Port 1991 is now live. Actual post-live data and rollback details are in
[`docs/go-live-report-2026-08-27.md`](../../docs/go-live-report-2026-08-27.md).

## XFCE Logout lifecycle follow-up

The historical pre-package logout run reused the production XFCE driver on an
isolated manager at `1993`, display `:31`, RFB 5931 and gateway 39031. Its
release-specific class fixture was retired with App Package ABI V1; the
immutable result remains below. A real headless noVNC client
attached before `xfce4-session-logout --logout --fast` was sent through the
session's own private D-Bus. The runtime moved from `running/ready` to
`stopped/exited` with one RFB client still attached and no error. Reconnect
started generation 2 as `running/ready`.

The same test passed on production display `:2`, followed by the normal
ten-second detach cleanup. The final state was `server-ready`, session stopped,
zero attached clients and zero input PID/socket artifacts. Machine-readable
evidence is `results/production-xfce-logout-status.json`.

## noVNC 1.7 upgrade gate

The 2026-08-27 isolated Mousepad gate used the vendored noVNC `v1.7.0` bundle
through manager port 1992, the Go RFB/input gateway, TigerVNC, private IBus and
Google Chrome. It passed opaque/varied framebuffer inspection, remote resize,
pointer and wheel traffic, exact English/Chinese composition order and X11
clipboard readback, an 18.5 ms explicit reconnect, stale-batch suppression and
complete five-second vacancy cleanup. The browser received the exact generated
`novnc-2F7OOK4M.js` bytes. Machine-readable evidence is
`results/novnc-1.7-upgrade.json`.

The deployed commit `cb473fc332b4` then passed the same critical path on the
production managed XFCE display: fixed 1280x720 geometry, varied opaque
framebuffer, pointer/wheel traffic, exact `NoVNC17 中文 input reconnect OK`
clipboard readback, two explicit reconnects, session-only vacancy cleanup and
managed server-layer retention. The previous installation is retained at the
rollback path recorded in `results/novnc-1.7-production.json`. Automated
validation is complete, and human visual and interactive UAT was accepted by
user confirmation on 2026-08-27. No adoption gate remains.

The later central real-user installation migration is recorded separately in
`results/central-user-deployment.json`. It preserved the `tester` state root,
removed the old user-local install without a backup by operator request, and
passed health/readiness, managed adoption, authentication rejection, fixed
framebuffer, RFB/input, reconnect, and vacancy cleanup checks. Its remaining
gate is the permanent authenticated identity proxy, not the RemoteXApp
backend.

## Driver-version lifecycle deployment

The immutable release and per-runtime pinning gate is recorded in
`results/driver-version-lifecycle-production.json`. The `0.1.0-rc.4` manager
adopted a complete running `0.1.0-rc.3` runtime without changing four unit
PIDs, recovered its live session generation, and recreated it from the pinned
old release after injected gateway loss. Session crash/reconnect, XFCE and
Mousepad Unicode clipboard readback, fixed/dynamic resize, Edge typed launch,
pointer/wheel traffic, and both disposable cleanup timers passed. Automated
validation passed, and human visual and interactive UAT was accepted by user
confirmation on 2026-08-27. No lifecycle deployment gate remains.

## Graceful shutdown rc.5 gate

The isolated `0.1.0-rc.5` gate used real Mousepad, Edge, XFCE, TigerVNC, the Go
gateway, private session D-Bus/IBus, and headless Chrome/noVNC. It passed clean
user exit, API close, unsaved-document blocking, warning, reconnect/save to a
durable path, explicit force, timed host force, XFCE logout and generation-2
relaunch, Edge native API close, unexpected `SIGKILL` classification, and
managed blocked-deadline restoration across manager restart.

Testing found and fixed two release blockers: destructive close of Mousepad's
hidden GTK window, and a managed registration left at `shutdown-blocked` after
successful host force. Machine-readable evidence is
`results/graceful-shutdown-rc5.json`. Production deployment and human visual
UAT remain separate gates.

### rc.6 PrivateTmp follow-up

The first production rc.5 graceful XFCE stop correctly failed safe but exposed
that the session bus was under host `/tmp`, outside the manager's
`PrivateTmp=yes` namespace. Driver 1.2 moves that bus into the per-runtime
`/run/user/<uid>/remotexappd/` directory. An isolated manager with the
production hardening property then completed real XFCE API shutdown in 2.42
seconds. Evidence is `results/graceful-shutdown-rc6-private-tmp.json`.

The same fix was then deployed to production port 1991. Manager restart first
adopted the stopped driver-1.1 runtime without changing its VNC/gateway PIDs;
the explicit stopped-to-running transition applied driver 1.2. A real browser
passed fixed framebuffer, RFB/input and reconnect, the live bus used
`/run/user/1000/remotexappd/`, and managed graceful stop completed in 3.24
seconds without force. The registration was restarted idle/current on driver
1.2. Evidence is `results/graceful-shutdown-rc6-production.json`.

### rc.7 SDK lifecycle follow-up

Driver 1.3 delays Mousepad and Edge `ready` until a visible PID-owned window
exists and reserves one second inside the manager's graceful-close deadline.
The browser SDK also resolves terminal manager state before reconnect, so a
normal application exit emits one `sessionended` event without transient SDK
errors or automatic relaunch.

Isolated `PrivateTmp=yes` and production port-1991 E2E drove Unicode input,
manual disconnect/reconnect, Mousepad Alt+F4 exit, unsaved-document 409 block,
explicit force, immediate Edge stop, managed XFCE manager-restart adoption and
automatic reconnect, and managed stop through the shipped SDK. The complete
release/race gate passed. Evidence is
`results/sdk-e2e-rc7-production.json`; human visual and interactive UAT remains
the final gate.

### rc.10 hybrid keyboard routing follow-up

SDK 0.11 was deployed through the immutable central-user release on production
port 1991 while the manager adopted the running display `:2` runtime. A fresh
Chrome/noVNC client sent `abc12` as five paired RFB key events with no IBus
commit; the Polkit password field displayed five bullets and Backspace cleared
them. A synthetic `你好` composition produced one IBus commit and no RFB
character event. Polkit remained empty, but Mousepad's retained IBus context
received the Chinese text, recording the known non-ASCII secure-widget gap as
IME-004. Automated evidence is `results/hybrid-input-rc10-production.json`;
human interactive UAT was accepted on 2026-08-27. The hybrid route is the
selected production design; no alternative routing experiment remains.

### rc.15 requirement-bundle follow-up

The isolated rc.15 gate covers DEP-010 through DEP-012 and SDK-001 through
SDK-003. It ran the full release/race/package gates, a real fixed-size XFCE
browser, finite and unlimited reconnect cycles, a stripped-prefix nginx mount,
and combined plus independent console/kiosk exposure policies. Evidence is
`results/requirement-bundle-rc15-local.json`. Human visual and interactive UAT
was accepted on 2026-08-28; no rc.15 publication gate remains.

### Unified runtime-manifest cold-restart experiment (superseded)

This section records the first unified-manifest candidate. Its unconditional
cold-restart behavior was superseded before release by the locked adoption
follow-up below; the migration, durability, rollback, and partial-start results
remain relevant historical evidence.

The post-rc.15 isolated gate used the real user systemd manager, TigerVNC, X11,
Go gateway, and manager. A mixed managed/anonymous pair survived a cold manager
restart with stable runtime IDs, new unit PIDs, healthy gateways, normalized
managed desired state, and complete manifest removal after explicit stops.

A second test reproduced issue #4 on fixed `:13`: the runtime manifest was
removed while its three units remained active, modeling a pre-manifest rc.15
anonymous autostart. The new startup migrator stopped only those exact units,
preserved the profile, removed stale runtime state, and successfully autostarted
a replacement on ports 5913/39013 without a manager restart loop. Evidence is
`results/runtime-manifest-cold-restart.json`.

Rollback used the exact immutable GitHub `v0.1.0-rc.15` Linux artifact, not a
mock decoder. It read the candidate's managed compatibility projection,
retained the runtime ID and all three unit PIDs, and served the healthy runtime.
Rolling forward retained the ID, cold-recreated all units with new PIDs, and
returned healthy.

Two fault-injection tests then killed the manager without graceful cleanup.
A healthy anonymous runtime kept all three units alive until restart replaced
their PIDs under the same runtime ID. A separate partial-start checkpoint left
only VNC active with a `starting` manifest; restart removed that stale process
and recreated a healthy server and gateway under the same ID. The non-login
test shell required explicit `XDG_RUNTIME_DIR=/run/user/1000` and
`DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus` to reach user systemd.
Production deployment and human UAT remain separate gates.

The final local browser pass ran the candidate on loopback `2096`, dynamic
Mousepad `:10`, and a validation-only fixed user-home XFCE `:15`; the installed
`1991` service and displays `:1`/`:2` were not modified. Real Chrome proved
fixed-framebuffer scaling, finite and unlimited SDK reconnect policies, cold
restart with a stable runtime ID and replaced unit PIDs, clean XFCE logout and
generation-2 relaunch, Unicode Mousepad input, unsaved-document 409 blocking,
forced cleanup, and manifest removal. The older `observe-reconnect` CDP harness
lost its final event-array response during the restart; independent post-restart
browser and API checks confirmed the client reattached with connected RFB/input
channels. All isolated listeners, units, profiles, and temporary configuration
were removed afterward.

### Locked runtime-adoption follow-up

The final post-rc.15 candidate retained the unified manifest database but
replaced unconditional cold recreation with health-checked adoption. In an
isolated local user-systemd environment, one anonymous Mousepad and one managed
fixed XFCE runtime survived repeated manager restarts with stable runtime IDs,
all unit PIDs, session generations, and application state. A real Chrome SDK
client observed the manager outage and automatically reconnected both RFB and
input channels. Mousepad unsaved content remained present.

The restarted manager restored the XFCE session observer: native Logout was
immediately persisted as application `exited` and session `stopped`, and the SDK
emitted `sessionended` without reconnecting a terminal generation. Explicit
forced anonymous stop and managed desired-state stop removed manifests and
exact units.

A separate stopped-session fault test changed the loaded catalog from simulated
driver `1.5.0`/1280×720 to `9.9.0`/1024×768, then stopped the recorded gateway.
Startup rejected adoption and recreated the same runtime ID with new unit PIDs,
but correctly retained the manifest-locked `1.5.0`/1280×720 snapshot. The
installed service on port 1991 stayed on rc.13 and was neither restarted nor
modified. Evidence is `results/runtime-manifest-adoption.json`; production
deployment and human UAT remain separate gates.

After the final live-session safety guard was added, the release-gate binary
received one more local real-browser pass on loopback `2097`. Healthy restart
kept the Mousepad application and all four unit PIDs. With the gateway then
deliberately inactive, another restart exposed degraded health but preserved
the exact still-live session and unsaved application instead of invoking
automatic teardown. Explicit force removed the manifest and all units. This
proves automatic locked reconstruction is limited to runtimes with no live
application to protect.

The same final binary then repeated the real unsaved-Mousepad shutdown path on
loopback `2098`. The application hook returned HTTP 409, the durable manifest
kept `desiredState=running` plus `shutdown-blocked`, and every unit stayed active
until explicit force removed both manifest and units. Focused read-only-state
tests separately prove that neither a shutdown driver nor forced teardown runs
when its prerequisite durable write fails.

### Managed blocked-to-force rc.22 follow-up

The isolated rc.22 candidate repeated this path for a managed persistent
Mousepad on loopback `2098`. Exact SDK/noVNC/IBus text made the document
unsaved, and normal desired-stop returned HTTP 409 while the managed record was
`stopped/shutdown-blocked` and the runtime manifest remained desired-running.
With no attached browser, manager restart adopted the same runtime ID and all
four exact unit PIDs. Repeating desired-stop with `force: true` returned HTTP
200 in 163 ms, converged the registration to stopped, removed every runtime
unit, port, directory, and manifest, and preserved the persistent profile. A
separate automatic browser reattachment correctly cancelled the first blocked
request, preserving the existing reconnect contract. Evidence is
`results/managed-blocked-force-rc22-local.json`.

### Fresh local port-1991 deployment

On 2026-08-28 the local rc.13 central-user installation, runtime state and old
installation backups were removed without creating a replacement backup. The
working-tree candidate reporting `0.1.0-rc.15` at `113ef1189384` was installed
fresh as the same non-root user service. Only the rc.15 release tree remains;
the temporary test policy is `0.0.0.0:1991`, `auth-mode=none`.

The auto-start fixed XFCE runtime created a mode-0600 unified manifest. Manager
restart changed only the manager PID and adopted the same runtime ID plus exact
server/VNC/gateway PIDs. A real headless Chrome/noVNC Mousepad then passed exact
`Local rc15 中文 123` clipboard readback, explicit SDK reconnect, manager-restart
automatic reconnect, and preservation of all four live unit PIDs. The unsaved
document path returned HTTP 409 with the session connected and durable
`shutdown-blocked` state; explicit force removed its manifest, units, runtime
directory and test browser. A final manager restart removed the stopped API
record, leaving only the healthy idle XFCE server runtime. Evidence is
`results/runtime-manifest-adoption-local-1991.json`.

### LibreOffice template candidate

The isolated candidate on loopback port 2099 loaded only the new `libreoffice`
template and left the installed port-1991 service unchanged. A real
Chrome/noVNC attachment started Matchbox and LibreOffice Writer, opened the
exact manager-authorized ODT, and reached `ready` only after a separate Python
UNO client connected to the returned `controlPort`. The listener was
loopback-only. Two active instances received distinct ports 21000 and 21001.

An outside-root path was rejected before any instance existed. Browser resize
changed the depth-16 framebuffer from 1280x720 to 900x553. Manager restart
preserved runtime ID, four unit/application PIDs, session generation, UNO port,
and browser connectivity. A clean API stop completed without force; a separate
browser detach triggered the 60-second `stop-instance` path and removed every
unit, internal listener, runtime directory, and ephemeral profile. All
candidate units, files, and listeners were removed afterward. A final-current
driver pass modified Writer through UNO without saving: graceful stop returned
409 and retained the session, while explicit force returned 200 in about 1.1
seconds and removed all ports. Evidence is
`results/libreoffice-template-local.json`; human document/control UAT remains
pending.

### Local rc.16 LibreOffice deployment

The working-tree rc.16 candidate was published as a new immutable central
real-user release and activated on the existing port-1991 service. Its
temporary local policy remains `0.0.0.0`, `auth-mode=none`. Two manager restarts
adopted the existing fixed XFCE runtime without changing its VNC, server, or
gateway PIDs, while the catalog grew from four to five templates.

Three non-sensitive Office fixture files were installed mode 0600 under the
default approved `STATE_DIR/documents` root. Real Chrome/noVNC opened the PPTX
through the deployed `libreoffice` template. Matchbox was the active window
manager, status reached `ready`, and an independent UNO probe identified the
exact document as `SdXImpressDocument` through returned port 21000 bound to
127.0.0.1. Native close completed without force and removed every smoke-test
unit, listener, runtime directory, and ephemeral profile. Evidence is
`results/libreoffice-template-local-1991.json`; human UAT remains pending.

### Sandbox rc.17 central real-user deployment

The rc.17 release artifact was centrally installed for the existing non-root
`sandbox` account. Its intentional test policy listens on `0.0.0.0:1991` with
`auth-mode=none`; identity headers are therefore inactive. The managed
`sandbox-desktop` registration maps to `xfce-user-desktop`, runs in `user-home`
mode on fixed display `:1`, and remained attached to the same VNC/XFCE runtime
through manager replacement and restart. A real Edge/noVNC connection reached
the desktop successfully.

The deployed catalog exposes both ID and public name as `libreoffice`. A real
Edge/noVNC connection launched the approved PPTX on dynamic display `:10`,
status reached `ready`, and an independent UNO probe verified the exact active
document through returned loopback port 21000. Graceful stop released the port
and left only `sandbox-desktop` active. Evidence is
`results/sandbox-single-user-rc17.json`; human document/control UAT remains
pending.

### Sandbox LibreOffice driver 1.1 formalization candidate

The sandbox-only driver 1.1 candidate changed LibreOffice session activation to
`immediate`, published four loading stages, revalidated and opened the canonical
document immediately before launch, removed the exact document lock, and used a
dedicated destructive shutdown hook. The dynamic 1280x720 depth-16, 10 FPS,
client-resizable display contract remained unchanged.

Five create-to-ready runs were 9.661, 8.950, 9.276, 9.260, and 7.952 seconds
(9.0198-second average). A generated full profile seed did not improve the
8.9154-second prior create-plus-attach observation; because activation differed,
this is not a controlled performance claim. The formal repository seed therefore
keeps only portable locale and setup-complete settings.

The candidate removed a stale lock before opening the exact UNO document,
rejected an unremovable lock and files made missing or unreadable after manager
validation before starting LibreOffice, and stopped an UNO-modified unsaved
document without changing the source bytes. Normal stop averaged 0.353 seconds
and removed the lock, application processes, runtime, and loopback control port.
Evidence is `results/libreoffice-driver-v1.1-sandbox.json`; human interaction
UAT remains pending for the formal repository build. The sandbox bundle's
`1.1.0` label was provisional; formal review promotes the repository driver to
`2.0.0` because destructive normal stop is an incompatible lifecycle contract.

### Formal local LibreOffice driver 2.0 validation

The exact repository build ran through an isolated manager at
`127.0.0.1:2099`; the existing port-1991 service was not changed. Immediate
create reached exact-document visible/UNO readiness in 3.982 seconds. A real
headless Chrome/noVNC SDK client connected, resized the dynamic framebuffer
from 1280x720 to 900x640, and reconnected in 93.597 ms.

After UNO made an unsaved Writer change, an ordinary non-force stop completed
in 209 ms, left the source hash unchanged, and removed the document lock,
application processes, runtime, and control listener. A final-component symlink
replacement and an unremovable lock were rejected in 579 ms and 550 ms,
respectively, without starting LibreOffice. The manager retained the exact
current-generation driver error instead of replacing it with a readiness
timeout. All isolated units/listeners were removed and both temporary trees
were moved to trash. Evidence is
`results/libreoffice-driver-v2-formal-local.json`; human application UAT remains
pending.

### Sandbox LibreOffice driver 2.0.1 contention validation

The sandbox-only `2.0.1-sandbox.1` overlay exercised the exact owner-lease code
promoted to repository driver 2.0.1. A free document reached visible-window and
UNO readiness in 7.085 seconds. A concurrent RemoteXApp launch of the same
canonical document returned HTTP 409 with the precise active-session error in
766 ms. A deliberately dead lease plus stale LibreOffice lock was recovered,
and the document reached ready in 8.372 seconds.

The cross-version case kept an attached 2.0.0 LibreOffice session ready while a
2.0.1 launch of its document returned HTTP 409 in 816 ms. Its lock content was
unchanged, its process retained the file, and the failed candidate left no
lease. Force-stopping all candidates removed their manifests, runtimes,
ephemeral profiles, listeners, locks, and leases. Evidence is
`results/libreoffice-driver-v2.0.1-sandbox.json`; human application UAT remains
pending.

### Local rc.18 persistent Firefox ESR candidate

An isolated loopback port-2099 candidate loaded only `firefox-esr`. A real
Chrome/noVNC client started Matchbox and Firefox ESR on first attachment,
resized its depth-24 framebuffer from 1280x720 to 900x640, and received a
successful mixed ASCII/Chinese input acknowledgement. Ubuntu's package-derived
`firefox-esr-esr140` WM_CLASS was stabilized to `firefox-esr` through Firefox's
runtime remoting-name override, keeping the IBus allow-list independent of ESR
train upgrades.

Manager restart preserved runtime ID, VNC/server/gateway/session PIDs, Firefox,
and session generation while the SDK automatically reconnected. Graceful API
stop removed runtime state and preserved the profile. A new runtime ID reused
the same profile; duplicate active creates returned the singleton. User
Alt+F4 reported `exited`, stopped the complete instance immediately, and left
the SDK disconnected. Three-second overrides proved both last-detach and
never-attached idle cleanup, while remaining attached cancelled the timer. All
candidate units, temporary state, and listeners were removed afterward.
Evidence is `results/firefox-esr-template-local-rc18.json`; human shared-browser
UAT remains pending.

### Local port-1991 rc.18 Firefox ESR deployment

The committed rc.18 archive passed its checksum and was published as a new
root-owned immutable release for the `ubuntu` real-user service. The temporary
test policy remains `0.0.0.0:1991`, `auth-mode=none`. The existing fixed XFCE
runtime retained the same VNC, server, and gateway PIDs across installation and
both manager restarts.

A real Chrome/noVNC client launched deployed Firefox ESR, verified the stable
WM_CLASS, resized 1280x720 to 900x640, and received a mixed ASCII/Chinese input
acknowledgement. Manager restart retained every Firefox runtime/application PID
and session generation while the SDK automatically reconnected. Last detach
with an eight-second test override removed the runtime and retained profile
`default`; a new runtime reused it. User Alt+F4 then reported `exited`, stopped
the complete second runtime, emitted `sessionended`, and did not reconnect.
Final hygiene left only the original XFCE runtime active. Evidence is
`results/firefox-esr-template-local-1991-rc18.json`; human shared-browser UAT
remains pending.

### Local rc.19 Firefox WebDriver BiDi candidate

An isolated loopback port-2099 candidate loaded only `firefox-esr`. Its create
response allocated `127.0.0.1:21000` and returned the complete
`ws://127.0.0.1:21000/session` URL before the on-attach application existed; no
listener was present until a real Chrome/noVNC client started Firefox. Driver
status reached ready only after the visible-window and protocol probes, and its
address, port, and URL exactly matched the instance response.

A direct client completed `session.new`, `browsingContext.getTree`,
`script.evaluate` with result `2`, and `session.end`. The listener was visible
only on IPv4 loopback. Manager restart preserved Firefox, server, gateway,
session generation, and control port; a new protocol probe passed afterward.
Graceful API stop released the listener and removed the runtime manifest and
directory while preserving profile `default`. The isolated manager and Chrome
units were stopped, and ports 2099/21000 were released. Evidence is
`results/firefox-webdriver-bidi-local-rc19.json`.

### Local port-1991 rc.20 Firefox WebDriver BiDi deployment

The clean rc.20 commit passed the publication gate, archive sensitive-data
scan, and checksum verification, then was installed as a new root-owned
immutable central real-user release. The approved temporary local policy
remains `0.0.0.0:1991`, `auth-mode=none`. Manager replacement adopted the
existing fixed XFCE runtime without changing its VNC, server, or gateway PID.

A real Chrome/noVNC client started deployed Firefox and received matching
`127.0.0.1:21000` endpoint data from the instance and driver status. The BiDi
listener was absent before attach and bound only IPv4 loopback after ready. A
controller completed `session.new`, context discovery, script evaluation with
result 42, and `session.end`; `session.status.ready` returned to true. Manager
restart preserved the Firefox/server/gateway/session PIDs, generation, and
control port, and Chrome reattached through normal SDK reconnect.

An intentional controller crash after `session.new` also confirmed Firefox's
single-session rule: a replacement session was rejected until normal instance
stop/recreate. That recovery released the orphan and preserved profile
`default`; rc.20 integration and operations guidance therefore requires
`session.end`. Final graceful cleanup released the control port and removed the
runtime manifest/directory, leaving only the pre-existing XFCE runtime active.
Evidence is `results/firefox-webdriver-bidi-local-1991-rc20.json`.

### Local port-1991 rc.21 IME and resize deployment

The exact clean commit `1e0b0ad49c8b` passed `make check`, race, host release,
portable publication, package checksum, artifact-content, and sensitive-data
gates. It was installed as root-owned immutable release `0.1.0-rc.21` for the
central `ubuntu` real-user service. The approved temporary UAT policy remains
`0.0.0.0:1991`, `auth-mode=none`. Manager replacement adopted the existing
fixed XFCE runtime without changing its VNC, server, or gateway PID.

Three fresh Chrome profiles exercised the installed SDK 0.15 and real
Mousepad stack. Compatibility-zero resize, 300 ms trailing debounce, 400 ms
maximum-wait progress, explicit flush, immediate reconnect negotiation, local
scaling, final-size convergence, primary-pointer IME fallback, late remote
caret authority, excluded right click, composition safety, and exact `P15中`
input all passed. Forced cleanup removed the automated dynamic runtime and all
of its processes, units, display, ports, and browser profiles; the fixed XFCE
runtime remained healthy.

Machine evidence is `results/ime-resize-rc21-local-1991.json`. Native
candidate-window and interactive resize UAT was accepted by user confirmation
on 2026-08-29; no rc.21 publication gate remains.

### Local port-1991 rc.23 application-environment deployment

The rc.23 Manager and SDK expose only the generation-qualified named EXP-007
environment lookup. Unit, SDK, deployment, race, release-package and
sensitive-data gates passed before the immutable central-user installation was
replaced on loopback port 1991. Existing rc.21 Mousepad and Firefox sessions
were adopted first and returned exact procfs environments without changing
their locked drivers.

Fresh current-driver sessions then exercised all six shipped templates through
the RFB WebSocket path. Every SDK result exactly matched the canonical process's
complete environment and working directory without printing or retaining any
value. Edge initially exposed that its browser process overwrites its procfs
environment with a process title; the released driver bundles now publish the
stable session owner and keep application PIDs private to template-specific
shutdown. All six normal shutdown paths passed, LibreOffice removed its test
lock, and managed `xfce-user-desktop` returned the same exact result after a
manager restart adopted its runtime and generation. Evidence is
`results/application-environment-rc23-local-1991.json`. Human UAT was accepted
on 2026-08-29; no rc.23 publication gate remains.

### Rc.24 explicit public sandbox opt-in correction

The committed rc.24 candidate makes the existing administrator-owned
`allow-insecure-public` opt-in authoritative for EXP-007. Focused tests prove a
non-loopback no-auth manager without the flag still returns `403`, while the
explicit opt-in returns the complete response. Full Go, SDK, vet, deployment,
race, release-package and sensitive-data gates passed.

The exact artifact was installed first on local port 1991 and then sandbox00,
both with `0.0.0.0:1991`, `auth-mode=none` and the explicit opt-in. Fresh real
RFB sessions returned HTTP 200 through SDK/API paths; their complete
environments and cwd matched the canonical process procfs data exactly without
printing or retaining any value. Sandbox00 retained fixed 1280x720 user-home
policy, rejected a stale generation with `409`, and had zero attached clients
after validation. One final response-structure request passed through the
production zerotrust gateway; no aggressive test used that gateway. Evidence
is `results/application-environment-rc24-public-sandbox00.json`. The operator
accepted the scoped rc.24 validation and authorized formal publication on
2026-08-29; no rc.24 publication gate remains.

### Rc.5 managed runtime recovery correction

Core `0.2.0-rc.5` commit `8c03c485adc5` fixes Issue #5 without changing SDK
0.17, App Packages, templates, drivers, or WAOS. The full unit matrix covers
same-ID replacement, failed-creation retry, unit and directory cleanup
failures, restart crash points, legacy duplicate selection, and fail-closed
multiple-live ambiguity. `make release-ci` passed and produced artifact SHA-256
`a011a513c36ce6f3b0bf7cf491bcdeee91f0da1fdd33d1058685306cd63af7ad`.

The immutable candidate was activated first on local port 1991. Stopping the
managed Desktop gateway triggered real cgroup recovery under the same runtime
ID and original creation time with one manifest and no manager restart. A real
Chrome/noVNC client then passed fixed-framebuffer scaling, explicit reconnect,
and automatic SDK reconnect across a manager restart.

Sandbox00 production had zero clients and a stopped Desktop session before the
same exact-unit fault was injected. Recovery retained
`xfce-user-desktop-2e3cb747be7b`, its creation time, and exactly one manifest;
manager `NRestarts` stayed zero. A final manager restart adopted all three
Desktop units with unchanged PIDs. Final state is six templates, two healthy
idle runtimes, zero clients, and zero warning-level journal entries. No
production gateway was used. Machine evidence for this phase is
`results/managed-runtime-recovery-rc5.json`.

After separate operator approval, the exact artifact was activated on
sandbox02, sandbox03, sandbox07, and sandbox10 and every application runtime
was recreated from its preserved template, profile, parameters, and overrides.
Sandbox07 entered with three Desktop manifests and sandbox10 with two; both
were in pre-rc.5 manager restart loops. Rc.5 selected each durable managed
pointer, retired only stale exact runtime state, preserved sandbox10's
anonymous Firefox and Edge records, and restored the API before the explicit
runtime restarts. Final state is one Desktop runtime on sandbox02/03/07 and
Firefox, Edge, plus Desktop on sandbox10, with one manifest per runtime, zero
clients, stopped sessions, `NRestarts=0`, and no warning after the final
manager restart. Container loopback passed; the build-host private-IP path
timed out, so no firewall change or production-gateway substitution was made.
Evidence is `results/managed-runtime-recovery-rc5-followers.json`; human UAT
remains pending.

### Stable 0.2.0 local candidate gate

The immutable `0.2.0` candidate at `7430689f05cb` passed rc.10 upgrade,
verified rollback, final activation, exact runtime/PID adoption, all six App
paths, browser input/resize/reconnect, XFCE Logout and generation-2 relaunch,
Mousepad blocked/forced shutdown, Edge CDP/vacancy/profile behavior, Firefox
BiDi, LibreOffice UNO/destructive no-save cleanup, and complete test hygiene.

Issue #4 was reproduced with surviving fixed-display units and a deliberately
removed manifest on isolated display `:13`; startup removed only the legacy
runtime, preserved its profile, and autostarted a healthy replacement without a
loop. Issue #5 was repeated by stopping a managed gateway after clean Logout;
recovery retained the runtime ID and creation time with one manifest, unchanged
manager PID, and zero service restarts. Exact evidence is
`results/stable-0.2.0-local-1991.json`. Unified Console UAT is accepted;
Firefox and LibreOffice Human UAT remain pending.

The first approved sandbox00 stable staging exposed a release-tooling defect:
the new selector retroactively required the optional operator helper in rc.5.
A focused local reproduction also found that the new shared unit passed a flag
unknown to rc.5. Sandbox00 was restored to rc.5 with its runtime identity and
child PIDs intact. DEP-015 fixes both boundaries through a strict manifest for
new releases, the legacy three-binary fallback, and environment-native optional
policy that does not change the retained binary command line.

Replacement candidate `ca1d0b26bf8f` passed the complete release gates and
reproduced archive SHA-256
`a6f3baae356bd45c5d45fcee3cf937d0295ec4ec3384bc6c1cd757536c901cfd`.
Local rc.10→candidate→rc.5→candidate activation preserved both runtime records
and all seven active child PIDs. Shipped Apps, real browser reconnect policies,
environment-owned service-restart configuration, Issues #4/#5, and cleanup all
passed. Exact evidence is
`results/stable-0.2.0-replacement-local-1991.json`. Sandbox00 remains on rc.5
and requires a new staging approval for this replacement.

The operator then ordered formal GitHub publication and alignment of all five
sandboxes. Tag `v0.2.0-rc.5` points to accepted commit `8c03c485adc5`; the
release workflow, including history secret scan and all portable gates, passed.
The downloaded formal archive matched `SHA256SUMS` at
`f31ef87b9a845c9cc88e1fe86a64f3ab69f959eefc8462fa1d637e0ded622ccb`.
It differs from the candidate because GitHub used a clean checkout and
go1.22.12, while the candidate used go1.22.2 and included local untracked empty
driver directories.

Every sandbox retained its candidate core trees, installed the formal archive
without overwriting an immutable directory, recreated all runtimes from
preserved launch intent, and passed an idempotent restage plus final manager
restart. Sandbox00's zero-client XFCE session refused graceful logout, so the
operator-approved deployment used host enforcement for that Desktop only;
Edge and Firefox stopped normally. All five ended with exact formal binary
hashes, one manifest per runtime, stopped sessions, zero clients,
`NRestarts=0`, and no warning after the final restart. Evidence is
`results/managed-runtime-recovery-rc5-formal.json`; Human UAT remains pending.

Local port 1991 was subsequently aligned to the same formal bytes. Its one
attached client disconnected through a successful graceful shutdown; no force
was used. The managed user-home Desktop and anonymous isolated XFCE runtime
were recreated from preserved intent, and the final manager restart adopted
both. The last legacy `edge-browser@2.0.0` selector was replaced with
`edge@1.0.0`, matching the five sandboxes and formal catalog. Final local state
is two server-ready runtimes, two manifests, stopped sessions, zero clients,
`NRestarts=0`, exact formal binary hashes, and no warning after restart.

### Stable 0.2.0 formal publication and local alignment

The accepted stable commit `9ef470c01399` passed local host and portable gates,
GitHub Verify, and the tag-triggered Release workflow. Annotated tag `v0.2.0`
is a normal Latest release. The downloaded formal linux/amd64 archive and its
attached `SHA256SUMS` passed at
`7d8665d5e477542ecea79cc4c20dac23797fa8f3c82b78022408a4d55a3e0123`;
the manager embeds the exact tag commit and the archive passed the repository
sensitive-data gate. GitHub used Go 1.22.12, so this formal digest differs from
the same-commit local Go 1.22.2 gate artifact recorded in the tag annotation.

Local port 1991 retained the stable candidate under a commit-qualified name,
installed the downloaded formal bytes into a new canonical immutable tree, and
restarted only the manager. The two original runtime IDs, generations, states,
and seven active child PIDs remained exact. Six App selectors stayed fixed; a
temporary Mousepad reached server-ready with formal component paths and was
fully cleaned. A second adoption restart removed its in-memory stopped record,
left the original two manifests and runtimes, and produced no warning. Evidence
is `results/stable-0.2.0-formal-publication-local.json`.

### Stable 0.2.0 formal sandbox00 production alignment

After a separate explicit production approval, sandbox00 retained candidate
`ca1d0b26bf8f` under `0.2.0-candidate-ca1d0b26bf8f` and selected the downloaded
formal `v0.2.0` bytes at commit `9ef470c01399`. The same-version immutable-tree
procedure recreated the zero-client managed Desktop as
`xfce-user-desktop-c9c926c84d0f`. It is server-ready with one manifest; the
on-attach session remains stopped until a real RFB viewer connects. A second
manager restart recovered that same runtime and creation identity with
`NRestarts=0`.

All installed and running core hashes, six App selectors, fixed Desktop policy,
three active server-side child units, inactive session unit, routes,
configuration, and zero-warning journal passed. The first attempt was safely
rolled back because the validation script incorrectly treated REST attach as
an RFB attachment; this was a test invariant error, not a product failure.
Container-loopback verification passed. The build host's private HTTP path is
still blocked by the pre-existing UFW allowlist; no firewall or production
gateway change was made. Evidence is
`results/stable-0.2.0-formal-sandbox00-production.json`.

### Stable 0.2.0 formal follower production alignment

After the stable train completed, the operator separately approved sandbox02,
sandbox03, sandbox07, and sandbox10. Each target independently verified the
downloaded `v0.2.0` archive, passed central-user preflight, selected the new
immutable tree, and adopted its zero-client managed Desktop through two manager
restarts. Runtime IDs, creation identity, generation, state, and child PIDs did
not change. Formal installed and running manager hashes, six App selectors,
configuration, fixed Desktop policy, routes, one-manifest state, `NRestarts=0`,
and zero-warning journals passed on every target.

The adopted runtime components stay locked to rc.5 until normal runtime
recreation, while the active manager and selectors are stable `0.2.0`.
Sandbox10's manifestless stopped history disappeared on manager restart as
expected; its running Desktop session was preserved. Sandbox07's always-on
configuration was not changed. Private build-host HTTP remained blocked by the
existing UFW allowlists, so validation used container loopback and never the
production gateway. Evidence is
`results/stable-0.2.0-formal-followers-production.json`.

### 0.3.0-rc.1 template catalog local UAT candidate

Candidate `cfddd717e14d` passed `make release-check`, `make release-ci`, the
sensitive-data gate, and the complete shipped real-X11/browser suite for the
five-App catalog. A real local transition exercised formal `0.2.0` → rc.1 →
`0.2.0` → rc.1. The retained managed user-home Desktop kept its identity and
all four child PIDs across every manager restart. An injected commit mismatch
also proved that a pre-stopped selection requested with `--start` restores,
starts, and verifies the prior release.

The final `0.0.0.0:1991` deployment exposes exactly five selectors and no
durable `xfce-desktop` reference. Firefox `2.1.0` passed actual VNC depth-16,
BiDi, dynamic resize, reconnect, Unicode input acknowledgement, and complete
forced cleanup. The managed Desktop passed fixed 1280x720 browser scaling and
reconnect. The clean final restart left one managed runtime, zero clients,
`NRestarts=0`, and no warning. Human UAT was accepted on 2026-09-02 and formal
GitHub publication was authorized. Automated evidence is
`results/template-catalog-0.3.0-rc.1-local-1991.json`; acceptance is
`results/template-catalog-0.3.0-rc.1-human-uat.json`.

### Stable 0.3.0 formal publication

Final commit `c719df9bb88c` changed only version metadata, acceptance evidence,
and current support documentation from the accepted rc.1 behavior. Local
`make release-check` and two identical `make release-ci` packages passed; main
Verify and the tag-triggered Release workflow passed on GitHub. Annotated
`v0.3.0` is a normal Latest release, not a prerelease.

The downloaded formal linux/amd64 archive matched its attached `SHA256SUMS` at
`3b4c49afc8fec2aec6121822d573170f022a09bd0667de0ed93fd58001c3de69`.
Its sensitive-data scan, embedded commit, four binaries, five depth-16 Apps,
and absence of `xfce-desktop` passed. The formal Go 1.22.12 bytes differ from
the same-commit local Go 1.22.2 gate artifact; the attached formal checksum is
authoritative. No local or sandbox deployment was performed by publication.
Evidence is `results/template-catalog-0.3.0-formal-publication.json`.

### 0.4.0-rc.3 rich clipboard Human UAT

The full CLP-001 through CLP-016 data plane remains covered by the rc.1 and
rc.2 local port-1991 evidence. Exact rc.3 commit `d6373f083257` additionally
passed `make release-check`, `make release-ci`, and an isolated loopback
real-Chromium permission test. A real button click made
`requestReadAccess()` report `granted` and `verified=true`; both it and
side-effect-free `checkAccess()` left a browser clipboard marker unchanged.

The operator accepted Human UAT and authorized formal GitHub publication on
2026-09-02. This did not replace local port 1991, which remains rc.2, and did
not authorize any sandbox deployment. Evidence is
`results/rich-clipboard-0.4.0-rc.3-human-uat.json`.

### 0.4.0-rc.3 formal publication

Accepted commit `e66a7273aa87` passed the hosted Verify and tag-triggered
Release workflows. Annotated `v0.4.0-rc.3` is a GitHub prerelease. The
independently downloaded linux/amd64 archive matched its attached checksum at
`fa99973cb0fc25011ddd2a8f61f9a98544e7b762216932bd94942a4ac5cea454`;
its sensitive-data scan, embedded revision, SDK `0.20.0` assets, and all five
App Package checksums passed. No local or sandbox deployment was performed.
Evidence is `results/rich-clipboard-0.4.0-rc.3-formal-publication.json`.

### Stable 0.4.0 acceptance

The operator approved promoting the exact accepted rc.3 behavior to stable
`0.4.0` without functional changes. The stable commit may change only core
version metadata, acceptance evidence, and current support/release
documentation; SDK `0.20.0`, App Package ABI V1, App versions, generated assets,
source, and dependencies remain fixed. Stable publication and independent
artifact verification are required. Local and sandbox deployment are not
authorized. Evidence is
`results/rich-clipboard-0.4.0-stable-acceptance.json`.

### Stable 0.4.0 formal publication

Stable commit `292a20ba5d7e` preserved the exact accepted rc.3 runtime, SDK,
App, dependency, and generated-asset inputs. Local and hosted release gates
passed, and annotated `v0.4.0` is the normal Latest GitHub Release. The
independently downloaded linux/amd64 archive matched its attached checksum at
`c12ccf4db75ee693ef27142786439086f22b6209ad63f8be0e21c5a7d114d871`;
its sensitive-data scan, embedded revision, SDK `0.20.0` assets, and all five
App Package checksums passed. Local 1991 remains rc.2 and no sandbox changed.
Evidence is `results/rich-clipboard-0.4.0-formal-publication.json`.

### 0.5.0-rc.1 client-active clipboard and multi-window Console

The scope-locked candidate passed `make release-ci` and was activated on both
local managers. Port 1991 retained its temporary public no-auth test policy and
port 2991 retained its loopback, Console-disabled, kiosk-enabled policy. A
headed Chrome test opened three Console Viewer windows across two Mousepad
runtimes, including two Viewers of the same runtime. It proved inactivity,
activation-time reconciliation and offer lifetime, background-connect safety,
remote fanout, source and per-Client loop suppression, scoped reconnect,
move/minimize/`Ctrl+F6`, and Viewer-only close. Port 2991 independently passed
real Firefox RFB/input, dynamic resize, and reconnect through kiosk mode.

Run the focused browser matrix against an already opened Console target with:

```bash
VALIDATION_CDP_PORT=9241 \
  node tests/go-live-validation/check-client-active-clipboard.mjs
```

The harness creates and cleans up its own Mousepad runtimes. Exact machine and
deployment evidence is
`results/client-active-clipboard-0.5.0-rc.1-local.json`. Human UAT was accepted
and formal GitHub prerelease publication authorized on 2026-09-03; evidence is
`results/client-active-clipboard-0.5.0-rc.1-human-uat.json`.

Annotated `v0.5.0-rc.1` was then published by the tag workflow. The
independently downloaded archive matched `SHA256SUMS`, reported commit
`b3d4018a68d1`, exposed SDK `0.21.0` and the expected hashed SDK/Console
assets, passed the sensitive-data scan, and validated all five App Package
archives and seals. Exact evidence is
`results/client-active-clipboard-0.5.0-rc.1-formal-publication.json`.

### 0.5.0 stable promotion

The operator accepted promotion of the exact `v0.5.0-rc.1` behavior to stable
`v0.5.0` without functional changes. SDK `0.21.0`, App Package ABI V1, all five
App versions, and generated assets remain unchanged. Stable publication and a
post-publication byte-identical rollout are separately authorized for local
1991/2991, sandbox00 1991/2991, and sandbox02/03/07/10 production 1991 only.
Exact approval is
`results/client-active-clipboard-0.5.0-stable-acceptance.json`.

### 0.5.1-rc.1 clipboard prompt reliability

Candidate commit `b6e6b2fb19e4` passed the complete release gate, an isolated
four-App real-browser suite, and the post-deployment two-Viewer clipboard
matrix on local 1991 and 2991. The tests cover wildcard-child CSS geometry,
direction-specific prompts, LibreOffice-style omitted-RTF rebound suppression,
genuine local changes, XFixes fanout, permissions, reconnect, and cleanup.
Exact machine evidence is
`results/clipboard-prompt-reliability-0.5.1-rc.1-local.json`. Human UAT was
accepted and formal GitHub prerelease publication authorized on 2026-09-03;
evidence is
`results/clipboard-prompt-reliability-0.5.1-rc.1-human-uat.json`. Sandbox
deployment is not authorized.

Annotated `v0.5.1-rc.1` was subsequently published by the tag workflow. Both
hosted workflows passed, and the independently downloaded linux/amd64 archive
matched its attached checksum, embedded commit, SDK `0.21.1`, generated
SDK/Console assets, and all five App Package seals. Its isolated manager passed
five-template startup, health, and readiness checks. Exact evidence is
`results/clipboard-prompt-reliability-0.5.1-rc.1-formal-publication.json`.

### 0.5.1 stable promotion and alignment

The operator accepted promotion of the exact `v0.5.1-rc.1` behavior to stable
`v0.5.1` without functional changes. SDK `0.21.1`, App Package ABI V1, all five
App versions, dependencies, and generated assets remain unchanged. Stable
publication and a post-publication byte-identical alignment are authorized for
local 1991/2991, sandbox00 1991/2991, and sandbox02/03/07/10 production 1991
only. Exact approval is
`results/clipboard-prompt-reliability-0.5.1-stable-acceptance.json`.

Normal Latest `v0.5.1` subsequently passed both hosted workflows and
independent checksum, identity, sensitive-data, SDK, App Package, catalog,
health, and readiness verification. Its exact formal bytes were selected on
all eight authorized endpoints. Every endpoint reports commit `48b9da84a351`;
production runtime identities and manifest cardinality were preserved through
two Manager starts, both isolated managers retained their four-App/Console-off
policy, and no warning or configuration/catalog drift was found. Evidence is
`results/clipboard-prompt-reliability-0.5.1-formal-publication.json` and
`results/clipboard-prompt-reliability-0.5.1-alignment.json`.
