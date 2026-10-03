# noVNC, Go RFB relay, IBus, and Impress: lessons learned

This is the evidence-based record for the local TigerVNC/noVNC experiments.
It distinguishes verified behaviour from open questions. Do not replace a
recorded fact with a plausible explanation without reproducing it first.

## Tested topology

```text
Browser noVNC       ── WebSocket/RFB ──> Go gateway ── TCP/RFB ──> TigerVNC/X11
Browser text/IME    ── WebSocket /input ─> Go native X11 bridge ─> focused app
                                                    └─ Shift+Insert + CLIPBOARD
```

The public gateway can listen on `0.0.0.0`. TigerVNC, LibreOffice UNO, and any
legacy websockify process remain loopback-only. The test is deliberately
unauthenticated only while it is behind the intended internal/Cloudflare Access
boundary.

## Transport conclusions

### `websockify` and Go-compatible relay

| Endpoint | Meaning | Status |
|---|---|---|
| `/websockify` | Go WebSocket proxy to loopback websockify | validated baseline |
| `/rfb` | original minimal Go WebSocket-to-TCP experiment | debugging only |
| `/rfb-compat` | ordered Go WebSocket-to-TCP relay, queue capacity 8 | validated with isolated Mousepad, Impress and the P05 slow-client test |

The initial claim that a Go replacement caused Chinese input failures was false:
the same failures occurred through `/websockify` and `/rfb-compat`. A controlled
Mousepad A/B used two independent TigerVNC/X11 sessions and verified the same
Unicode string by copying it back from each application. The RFB relay does not
interpret text and was not the input bug.

P05 later compared capacities 256, 8 and 1 in five independent processes per
value. Capacity 8 reduced the measured heap increase during a one-second slow
client stall from 16.18 MiB to 0.68 MiB and average source-data age from 1564
ms to 1051 ms. Capacity 1 did not produce a stable latency improvement, so 8
is the accepted default. RFB is an ordered byte stream: this optimization uses
early TCP backpressure and does not drop arbitrary chunks. See the
[`P05 reproduction guide`](../tests/performance/rfb-queue/README.md).

### Do not confuse video latency with RFB input latency

The FFmpeg/fMP4-over-WebSocket fallback is video over TCP and can queue late
media under congestion. noVNC/TigerVNC sends desktop updates and input as RFB.
Mousepad feels quicker than Impress largely because Mousepad inserts text
immediately while Impress performs layout, object, undo, and redraw work.

## Text input design

### Working generic path

Printable text is captured by a small in-viewport browser textarea. The page
sends committed text to `/input`; Go owns the X11 `CLIPBOARD` and `PRIMARY`
selections briefly and emits native XTEST `Shift+Insert` to the focused app.

This supports committed Unicode such as `你好` without requiring a Chinese IME
on the remote X11 desktop. Pinyin keystrokes must never be forwarded to RFB.
Pointer, wheel, navigation keys, and shortcuts remain on the RFB path.

`Ctrl+V` is not an equivalent substitute. In this X11/TigerVNC/LibreOffice
environment it has been interpreted as literal `v`; `Shift+Insert` is the
validated paste gesture.

### Focus is a prerequisite

For Impress, object selection is not text-edit mode. A caret must be visible in
the text object before clipboard input can land. A blank result with successful
`/input` logs can therefore be a focus/selection problem, not transport loss.

Mousepad recovery dialogs were an earlier false negative: the app had focus but
the restore modal owned it. Always inspect the remote session before treating an
empty editor result as an input failure.

### Clipboard side effect

The bridge temporarily replaces the remote X11 `CLIPBOARD` and `PRIMARY`
owners. It does not preserve the prior remote clipboard contents. This is
acceptable for the internal PoC but must be addressed before production, either
by preserving plain-text selection content, building a full selection proxy, or
using a target-specific API/input method.

## Direct Unicode input without clipboard: research result

### Simpler X11 candidate: dynamic Unicode keysyms

`xdotool` is already installed. It has a `type` command which, for a character
not present in the physical keyboard layout, allocates an unused X keycode and
injects it with XTEST. This is not a text/clipboard protocol; it is ordinary
keyboard input carrying an X11 Unicode keysym.

An isolated Xvfb + `xev` test on 2026-08-25 ran:

```text
xdotool type --clearmodifiers --delay 0 '你好'
```

and observed `KeyPress` events with `U4F60` and `U597D`; `XLookupString` and
`XmbLookupString` each returned the expected UTF-8 `你` and `好`. The events
were reported as `synthetic NO`, as expected for XTEST input. The server also
emitted `MappingNotify` around each character: the temporary keycode mapping is
a global X-server resource.

This initially looked like the simplest **generic X11** candidate. It is not.
The Go gateway now has an explicit experimental `-text-backend=keysym` mode
using the installed persistent `libxdo` library, so it does not fork `xdotool`
per commit. Its socket-to-`xev` test delivered `你好 — café` in 14.582 ms
server-side, and all non-emoji characters were decoded correctly by `xev`.

An independent real-app test then disproved generic compatibility:

1. A disposable TigerVNC `:28` (16-bit) + Matchbox + Mousepad session was
   started, focused, and controlled through that Go `/input` mode.
2. Two gateway requests (`你好 — café`, then ` ASCII-OK`) acknowledged in
   11.585 ms and 12.406 ms, but the Mousepad screen remained empty.
3. As a control, direct `xdotool type` in the same focused Mousepad session
   produced only `caf ASCII-OK` on copy-back. Chinese, em dash, and `é` were
   absent.

Therefore a correct X11 `KeyPress`/`XLookupString` sequence is not equivalent
to a GTK text/IME commit. Mousepad's input context rejects or does not
translate dynamically mapped Unicode keysyms even though `xev` sees them.
Emoji is an additional `libxdo` 3 limitation: it does not create an emoji
keysym at all. Treat `keysym` as a diagnostic backend only, leave clipboard as
the default, and do not advance it to Impress as a replacement.

The relevant `xdotool` documentation confirms its use of XTEST and warns that
unusual symbols under non-US keybindings can be wrong:
[xdotool(1)](https://manpages.debian.org/testing/xdotool/xdotool.1.en.html).

### There is no drop-in “Unicode socket IME” package

As of 2026-08-25, the Ubuntu package catalogue contains ordinary IBus engines
(for example `ibus-libpinyin`) and the Fcitx5 framework, but no engine whose
supported interface is “accept an arbitrary UTF-8 string over a Unix/TCP socket
and commit it to the focused application”. Those engines convert local key
events into text; they are not a safe remote-text API.

Do not mistake `fcitx5-remote` for such an API. It controls/query the Fcitx
daemon; it does not select an arbitrary focused input context and insert a
caller-supplied string.

### Best generic candidate: a small custom IBus commit engine

IBus is already installed here (`ibus` 1.5.29, `ibus-gtk3`,
`gir1.2-ibus-1.0`, and Python GObject bindings). Its supported engine API has
an explicit `commit_text` operation, documented as committing text to the
active IBus client. Therefore a deliberately narrow `remote-unicode` engine can
be written without installing Fcitx5:

```text
browser committed Unicode → existing /input endpoint → 0600 Unix socket
→ remote-unicode IBus engine → IBus commit_text → focused app input context
```

The engine must accept messages only while its IBus input context has focus and
must use a per-VNC-session Unix socket (never a public TCP listener). This
gives ordinary GTK/Qt/XIM-aware applications a real IME commit, so it avoids
both the clipboard overwrite and `Shift+Insert`/LibreOffice PasteSpecial race.
It does **not** make focus optional: input still belongs to whichever remote
application currently owns the IBus context.

This is a custom, testable component rather than an unverified claim that an
installed pinyin engine exposes a socket. IBus documents both the input-engine
abstraction and [`ibus_engine_commit_text`](https://ibus.github.io/docs/ibus-1.5/IBusEngine.html),
whose contract is to commit output to the IBus client.

### Custom IBus engine: end-to-end result

The candidate was implemented in `components/remote-unicode-engine/engine.py` and
wired into the Go gateway as an opt-in `-text-backend=ibus` mode. It is **not**
the default yet; `clipboard` remains the proven generic fallback.

The private protocol is deliberately small:

```text
browser text event → Go /input → focused-window allow-list → 0600 Unix socket
→ per-session IBus engine → IBus commit_text → focused application input context
```

The socket accepts only `{"text":"..."}` JSON, up to 4096 UTF-8 bytes, rejects
NUL and empty strings, and returns a synchronous `{ok,error}` response. It
does not expose D-Bus or permit arbitrary commands. Its owner-only filesystem
permissions and per-session path are required properties, not optional hardening.

Two disposable TigerVNC + Matchbox sessions were tested on 2026-08-25:

| Target | Input | Evidence | Result |
|---|---|---|---|
| Mousepad | `你好 — café 😀 via Go` | application copy-back exactly matched; Go acknowledgement 0.551 ms | pass |
| LibreOffice Impress, actual text-edit caret | `你好 — café 😀 via IBus` | UNO read the shape text exactly; screen showed all characters; Go acknowledgement 1.089 ms | pass |

The IBus route did not modify the X11 `CLIPBOARD`: in the Mousepad test a
`clipboard-sentinel` selection remained byte-for-byte unchanged before and
after the commit. This is the first tested path that handles CJK, accented
letters, punctuation, and emoji in both GTK and Impress without a paste race
or clipboard replacement.

There are two distinct focus checks. IBus itself refuses the request unless its
engine is enabled and it has an IBus input context. That is insufficient on its
own: when an `xmessage` window was focused, IBus retained Mousepad's prior
context and would otherwise have committed into Mousepad. The Go gateway now
also obtains the current X11 `WM_CLASS` with `XGetInputFocus`/`XGetClassHint`
and requires an explicit `-ibus-focus-class` policy. The test correctly
rejected a commit with `Xmessage` focused. For Impress the actual class is
`libreoffice-impress`; the `libreoffice` instance string seen in `xprop` is not
the class used by the guard. A later live test created a LibreOffice Writer
document and correctly exposed the complementary class,
`libreoffice-writer`: the original Impress-only allow-list rejected it before
IBus with a visible error. Adding it explicitly allowed
`Writer 中文输入：你好 — café 😀` to commit successfully. A multi-app desktop
may deliberately use `*` when its class is defined as a trusted full desktop;
this accepts every non-empty focused `WM_CLASS` and trades away protection
against a stale IBus context targeting a previously focused application.
Single-app classes must retain an explicit allow-list.

The final Impress test also caught a useful false positive: IBus can return a
successful commit while Impress has selected a text object but has not entered
text-edit mode. In that state its input context accepts the commit but the
shape text does not change. A real caret/text-edit mode is therefore a hard
precondition; use visible-caret or UNO selection-state validation before
reporting delivery. Once the text object was entered, the exact same request
appeared in the document and was confirmed through UNO.

The custom IME client must also restore noVNC's lost-key cleanup. Calling
`rfb._keyboard.ungrab()` removes noVNC Keyboard's `window.blur` listener as
well as its key listeners. A host Super/Meta shortcut can then take focus
before `keyup`, leaving Mod4 held for that RFB connection; subsequent
`Ctrl+V` arrives at X11 as `Super+Ctrl+V`. The custom client therefore calls
its own `releaseRemoteModifiers()` on both `window.blur` and hidden-document
`visibilitychange`. Restarting the gateway disconnects an already
contaminated RFB connection so TigerVNC clears that client's held keys.

Window blur is not guaranteed during a host input-language switch. On Windows,
`Meta+Space` can expose `MetaLeft keydown`, consume its keyup, and leave the
page focused. The next shortcut must reconcile tracked modifiers against that
new DOM event's `shiftKey`, `ctrlKey`, `altKey`, and `metaKey` booleans before
flushing pending keys. Composition start also releases every remote modifier,
because the host-switch chord must never leak into the remote application.

Run this experimental stack only with a fresh session, for example:

```text
REMOTE_UNICODE_RUNTIME=/secure/private/runtime \
REMOTE_UNICODE_SOCKET=/secure/private/runtime/remote-unicode.sock \
PPTX_PATH=/path/to/test.pptx LIBREOFFICE_PROFILE=/secure/private/lo-profile \
UNO_PORT=2102 vncserver :29 -geometry 1280x720 -depth 24 \
  -xstartup tests/ibus-remote-unicode/xstartup-impress.sh

novnc-input -display :29 -vnc-addr 127.0.0.1:5929 \
  -text-backend=ibus -ime-socket=/secure/private/runtime/remote-unicode.sock \
  -ibus-focus-class=libreoffice-impress
```

Use a runtime directory owned by the VNC/session user, not `/tmp` shared by
unrelated users. The production design should also bind the Go HTTP gateway to
the desired access boundary and add an app/window focus policy appropriate to
the tenant; the test's class allow-list is intentionally narrow, not universal.

### Important deployment condition: start the target in the IM session

This cannot reliably be attached to an already-running LibreOffice process.
The current `:27` Impress process has `DISPLAY=:27` but no
`GTK_IM_MODULE`, `QT_IM_MODULE`, `XMODIFIERS`, or session D-Bus environment.
The next test must create a new isolated VNC session, start its session D-Bus
and IBus daemon, then launch LibreOffice with at least:

```text
GTK_IM_MODULE=ibus
QT_IM_MODULE=ibus
XMODIFIERS=@im=ibus
DBUS_SESSION_BUS_ADDRESS=<that VNC session's bus>
```

This matches the normal X11 IBus integration requirements. It is also why a
global desktop IBus daemon must not be reused for multiple tenant VNC desktops:
engine state and focus would be shared incorrectly.

### Target-specific alternative: AT-SPI

The current `:27` session already exposes LibreOffice Impress through a
separate AT-SPI D-Bus socket at
`~/.cache/at-spi/bus_27`; read-only inspection found the `soffice` application
and its Impress frame there. AT-SPI's `EditableText` interface supports direct
Unicode `insert_text`, and GNOME documents LibreOffice as an AT-SPI-supported
application. This is a promising **LibreOffice-only** bridge that also avoids
clipboard, but it is not a general desktop input method: it must locate the
correct focused editable accessibility object and will not cover arbitrary
non-accessible X11 controls.

The narrow next experiment should first verify `EditableText` on a fresh
Impress text caret (likely installing the small `python3-pyatspi` binding),
then compare it with the custom IBus engine. The authoritative interface
contract is [`AtspiEditableText.insert_text`](https://gnome.pages.gitlab.gnome.org/at-spi2-core/libatspi/iface.EditableText.html);
the [Orca accessibility overview](https://help.gnome.org/orca/introduction.html)
lists LibreOffice among supported AT-SPI applications.

### Decision

For the generic remote desktop: retain the current native selection bridge as
the proven fallback, and prototype the per-session custom IBus engine next.
For an Impress-only kiosk: test AT-SPI/UNO direct insertion first; it may be
simpler and faster but intentionally gives up generic-app compatibility.

## IBus input-method switching: reproduced and fixed

The configured local IBus trigger is `Ctrl+Space`.

### Evidence

With a real Edge tab, the real IBus trigger, and `xev` focused in an isolated
TigerVNC desktop, the old client did this:

1. Browser emitted `ControlLeft keydown`.
2. IBus consumed the rest of the `Ctrl+Space` chord.
3. Browser never emitted `ControlLeft keyup`.
4. The page had already called `rfb.sendKey(Control_L, down=true)`.
5. `xev` recorded a remote `Control_L KeyPress` and no matching release.
6. The next clipboard operation reached X11 as `Ctrl+Shift+Insert`, rather than
   `Shift+Insert`.

This exactly explained the symptom “switching Chinese/English makes keyboard or
text input stop until a hard refresh.” It happened equally through websockify
and Go relay because it was entirely in the shared browser client.

### Fix

Modifier keydowns (`Ctrl`, `Shift`, `Alt`, `Meta`) are held locally. They are
sent only when a following non-modifier key establishes a real remote shortcut.
A modifier consumed by an IME hotkey is never sent to RFB. Releases are held
until active non-modifiers have been released, preserving unusual event order.
Before a clipboard text transaction, the page releases all remote modifiers as
a safety repair.

The exact same Edge + IBus + xev test verified both properties:

- `Ctrl+Space` sends no remote Ctrl press.
- A normal `Ctrl+A` sends `Ctrl down → A down → A up → Ctrl up`.

### First-English-character bug: reproduced and fixed

The old client set `discardNextInput = true` unconditionally on
`compositionend`. The actual 1989 gateway trace showed:

```text
Chinese compositionend: 老师
first English i: keydown + beforeinput + input, but no /input request
second English i: keydown + beforeinput + input, then /input request
```

In this browser/IBus sequence there is no trailing `input` event after the
Chinese commit, so the flag discarded the first real English character. The
flag was removed. Do not reintroduce a generic “discard next input” workaround.

## Impress paste reliability

### Observed race

For reported missing English characters, gateway logs showed every stage:

```text
browser input → /input message → X11 selection target requested
→ UTF-8 served → text ack
```

Therefore those characters were not lost in browser capture, WebSocket, or RFB.
The native selection owner previously released `CLIPBOARD` immediately after the
first selection request, commonly 3–10 ms. Impress processes PasteSpecial on its
main loop; the next `Shift+Insert` could arrive while the previous paste was
still pending.

### Current mitigation

After serving a text selection, the native bridge keeps selection ownership for
a 25 ms settle window and serializes the next transaction behind it. This adds
at most about 25 ms per independent clipboard transaction, while a burst of
ordinary characters is combined by the browser's separate text batching
window (16 ms by default since P12; 40 ms compatibility mode is available).

This was chosen over a large fixed `xclip` delay. Historic Mousepad measurements
for the immediate native bridge were roughly 5.9 ms p50 server-side, compared
with about 162 ms p50 for a per-commit `xclip` process. Those old numbers do not
include the newer 25 ms Impress settle window.

### LibreOffice crash: record, not conclusion

One isolated Impress test session aborted with SIGABRT. The LibreOffice stack
was in:

```text
EditEngine::InsertText → EditView::PasteSpecial → OutlinerView::Paste
```

TigerVNC exited afterward because its xstartup process waited on LibreOffice.
The Go gateway stayed up and then correctly logged TCP connection refusals.
Do not label this an RFB crash. A fresh isolated session accepted one controlled
bridge insertion and then 21 sequential one-character insertions (5.51–34.73
ms server-side, 13.75 ms mean) without crashing. The crash has not yet been
reproduced deterministically; retain logs and test it separately if it recurs.

## Observability and debugging method

The kiosk can explicitly enable a short browser event trace and send it to the
Go log as `client event`. It covers focus, `keydown`, `beforeinput`, `input`,
composition events, and RFB key sends. This tracing is off by default.

Since P13, gateway text logging also defaults to `errors`: successful commits
produce counters but no log lines or text content. An operator may explicitly
select `metadata` for stages/timing without values or `content` for the older
sensitive diagnostic detail. Clipboard-backend X11 selection-target messages
are native metadata and do not contain the selection value.

Use this order when diagnosing a missed character:

1. Did browser `keydown/beforeinput/input` occur?
2. Did a `/input` text message reach the gateway?
3. Did the target request an X11 selection target, and was it served?
4. Was a remote modifier stuck? Use `xev` in a separate X11 test session.
5. Was the target actually in text-edit/caret mode?
6. Only then inspect RFB transport or application-specific behaviour.

Browser event tracing and gateway `content` mode contain typed text. They are
appropriate only for a short authorized diagnostic session with test data;
normal operation must keep tracing off and `-gateway-text-log errors`.

## WeChat on `lxd-host:app-container`

### Isolated deployment and cleanup

On 2026-08-25, an isolated native Linux WeChat test was launched in the LXD
container `lxd-host:app-container`. The container already had `wechat 4.1.1.4`,
TigerVNC, noVNC, IBus, and an unrelated XFCE/TigerVNC `:1` service using
loopback `5901` and websockify `6081`.

The test deliberately did **not** reuse that existing session. It created
TigerVNC `:2` with loopback RFB `5902`, a per-session D-Bus + IBus daemon, the
private `remote-unicode` Unix socket, Matchbox, and WeChat. The Go gateway was
the only public listener, on `0.0.0.0:1984`; it was configured with
`-ibus-focus-class wechat`. The real top-level X11 class was verified as
`wechat`, with window title `Weixin`.

HTTP returned 200 and the Go-compatible RFB relay returned `RFB 003.008` from
outside the container. WeChat itself reached its saved-account/login screen and
then its chat UI. A controlled Unicode commit into a chat composer was **not**
recorded in this run, so do not claim generic WeChat text support from the
startup/RFB test alone; it requires a focused composer and a separately
recorded IBus commit.

The test service was subsequently stopped: `:2`, `5902`, and `1984` are no
longer listening. The pre-existing `:1`, `5901`, and `6081` services were
verified still running.

### Electron colour path

The first virtual-X startup rendered WeChat with a strong cyan/green colour
shift. This was reproduced in an X11 root screenshot. The working combination
was:

```text
TigerVNC: -depth 24 -pixelformat rgb888
environment: LIBGL_ALWAYS_SOFTWARE=1
WeChat: --disable-gpu --disable-gpu-compositing
```

The screenshot then showed normal colours. Do not use the low-bandwidth
`rgb565` profile for this Electron application without retesting its colours.

### Kiosk resize with Matchbox

For a browser-driven virtual desktop resize, both endpoints are necessary:

```text
TigerVNC: -AcceptSetDesktopSize=1
noVNC:    ?rfb=compat&resize=remote
```

This resizes the X root; it does not promise that an application window follows
it. Matchbox's documented options do not include automatic maximise-on-root-
resize behaviour. In this test WeChat initially retained a `934x885` window
inside a resized root, producing a black right-side margin. An explicit
`wmctrl -x -r wechat.wechat -e 0,0,0,<root-width>,<root-height>` request proved
that WeChat accepts live X11 geometry changes and eliminated the margin.

`xstartup-wechat.sh` therefore contains a session-local watcher. It observes
the X root size, waits for two matching 200 ms samples, sends one resize only
when the stable size changes, and keeps a 6 px right/bottom gap. The debounce
is necessary: continuously issuing the same `wmctrl` request caused visible
Electron/noVNC jitter. The observed steady state was, for example:

```text
root:    1059x943
WeChat: 1053x937
```

The gap prevents boundary rounding feedback while remaining visually minimal.

SDK 0.15 adds a separate browser-side control for how often the X root itself
is resized. noVNC 1.7's one-in-flight/100 ms throttle is not a trailing
debounce; a long browser gesture can still cause repeated application reflow
and flashing. `resizeDebounce` and `resizeMaxWait` now coalesce that gesture,
locally scale the old framebuffer while waiting, and allow explicit
`flushResize()` at gesture end. This does not replace an application-specific
Matchbox watcher: the SDK schedules framebuffer/root changes, while the driver
still owns application-window geometry. P15 contains the controlled browser
measurements.

### Memory measurement

Use PSS rather than RSS when estimating many sessions. On `app-container` during
the test:

| Component | PSS |
|---|---:|
| TigerVNC `:1`, 1280x720, 16-bit | 31 MB |
| TigerVNC `:2`, 1280x720, 24-bit/rgb888 | 58 MB |
| Matchbox | 6 MB |
| WeChat Electron process tree | about 450 MB |

The expensive part of a persistent WeChat session is Electron, not TigerVNC.
For a multi-account design, keep Matchbox, create displays on demand, and
destroy idle sessions while retaining the account profile. A 16-bit VNC server
halves much of the VNC cost but is not presently acceptable for WeChat because
of the verified colour failure. Sharing one X display between tenants saves a
VNC server but forfeits focus, clipboard, IBus-context, and account isolation;
do not use it for independent users.

### Docker packaging design (not yet runtime-tested)

The same stack can be packaged as one Docker container per WeChat account:

```text
TigerVNC + Matchbox + per-session D-Bus/IBus + Go/noVNC gateway + WeChat
```

Set `HOME=/home/wechat` inside the container and persist a **distinct** named
volume or bind mount at `/home/wechat` for each account. That preserves both
the sensitive login/profile tree (`.xwechat`) and the user media/download tree
(`xwechat_files` in the fresh-HOME test; a legacy profile used
`Documents/xwechat_files`) across container replacement. Persisting the whole
redirected HOME avoids relying on that application-selected path. Never mount
the host user's full home directory, and never share one `.xwechat` volume
between accounts.

Only the Go/noVNC HTTP endpoint (normally container port `1984`) should be
published. Keep RFB, LibreOffice/other app sockets, D-Bus, and the IBus Unix
socket inside the container or loopback-only. Authentication remains the
responsibility of the external access layer; an unauthenticated `1984` must
not be exposed directly to the Internet.

A practical service shape is:

```yaml
services:
  wechat:
    image: your-wechat-vnc-image
    ports: ["1984:1984"]
    volumes: ["wechat-home:/home/wechat"]
    environment: ["HOME=/home/wechat"]
    shm_size: 1gb
```

The larger shared-memory allocation is prudent for Electron. Start the app as
an unprivileged container user and retain the software-rendering workaround
until GPU passthrough is explicitly tested. Docker provides reproducible
per-account lifecycle and filesystem isolation; it does not materially reduce
the measured Electron memory cost. Use on-demand start and idle shutdown for
that. This design has not yet been built or run, so package compatibility,
login persistence, and Chinese IBus input must be verified before promotion.

### `systemd-run` redirected-HOME experiment (verified)

On 2026-08-25, the same host user started a fresh WeChat stack with two
transient **user** units and a dedicated mode-0700 HOME:

```text
HOME=/home/tester/wechat-systemd-test
wechat-systemd-test-vnc.service     TigerVNC :2 + Matchbox + IBus + WeChat
wechat-systemd-test-gateway.service Go/noVNC gateway on 0.0.0.0:1984
```

The VNC unit used `systemd-run --user --remain-after-exit`; this matters because
`tigervncserver` itself exits after spawning its process tree, while the
transient unit must retain and own that cgroup. The gateway was a separate
long-running transient unit. Both units supplied `HOME`, the XDG config/cache/
data/state directories, and the private IBus socket path.

The test was successful end-to-end: the HTTP endpoint returned `200`, the VNC
desktop showed a new WeChat QR-login screen, and the actual spawned processes
used `/home/tester/wechat-systemd-test/.xwechat` for crash/profile data and
`/home/tester/wechat-systemd-test/xwechat_files` for WeChat files. The existing
`/home/tester/.xwechat` and `Documents/xwechat_files` were not reused.

This subsection records the verified historical standalone command. The later
P08 manager experiment replaced the resident Perl wrapper for managed
instances: systemd now directly supervises `Xtigervnc`, a bound server-driver
unit owns the startup script, and the manager creates the mode-0600
Xauthority. That path reduced the measured lean server layer by about 10.2 MiB
MemoryCurrent and passed failure injection plus interactive regression. Keep
the command below for standalone reproduction or wrapper fallback; use the
manager's accepted direct default for new managed deployments.

P09a tightened the manager side of that deployment. An unchanged healthy
managed registration is no longer rewritten every five seconds, and the
durable runtime snapshot is used only to adopt an absent runtime after manager
restart. It must not overwrite live session state or client counts: doing so
was reproduced as an SDK reconnect failure because the manager attempted to
create a transient session unit that was already loaded. The corrected path
passed manager restart, gateway fault recovery, exact Unicode readback and
explicit SDK reconnect. See `tests/performance/managed-persistence/` for the
evidence; repeated `xdpyinfo`/HTTP health observation was kept as the separate
P09b experiment described below.

The 2026-08-27 integrated deployment applies these accepted paths to port
1991. The manager is an enabled user-systemd unit, and fixed display `:2` is
durable managed registration `test-host-xfce`. The live switch and matched
system comparison are documented in
[`go-live-report-2026-08-27.md`](go-live-report-2026-08-27.md).

P09b uses cgroup-v2 `cgroup.events` with one host-wide inotify
reader instead of a permanent five-second subprocess/HTTP loop. It watches the
VNC and gateway units because those match the former health boundary, qualifies
events by runtime ID to discard late signals, and restores watches during
manager restart adoption. A 4-6 minute full check remains necessary for a
process that is alive but hung. Automated lifecycle/input checks and the final
interactive matrix passed; the accepted gateway journal contained 50 completed
text requests and no text errors or client trace events.

P10 reused that same inotify reader for transient session units. The old
readiness-PID monitor opened/parsed one PID file and called `kill(pid, 0)` twice
per second for every running session; a controlled 30-second window measured
60 of each. A session-unit `cgroup.events` watch reduced both to zero and
removed the recurring per-session goroutine, while adding only one watch
descriptor. Events must carry both instance ID and session generation, and
explicit stop must remove the watch before stopping the unit so a deliberate
cleanup is not reported as a crash. Manager restart must also restore the
watch for an adopted running session. `-session-observer=poll` remains the
tested fallback; cgroup emptiness detects exit, not a living-but-hung app.

P11 removed a separate multi-client latency hazard from the live IME path.
Previously the IBus subscription reader wrote each caret snapshot directly to
every `/input` WebSocket; one peer could block the publisher for its 500 ms
write deadline. Each peer now has an independent writer and a capacity-one
latest-value cursor queue. In the deterministic 32-event/10 ms slow-writer
test, publisher time fell from 324.437 ms to 13.211 us and the fast peer saw
the newest position in 23.242 us. The slow peer still converged to the newest
sequence. Keep this replacement rule limited to `cursor-position` snapshots:
text acknowledgements and ordered RFB bytes remain reliable. See
`tests/performance/cursor-fanout/` for resource and browser evidence.

P12 then removed the fixed 40 ms browser delay from completed compositions and
reduced the ordinary-input default to 16 ms. A composition result is a complete
semantic transaction: append it after any older ordinary pending text and
flush immediately. Do not independently debounce `compositionend` in a kiosk
or application wrapper. Five deterministic runs reduced median composition
timer overhead from 40.307 ms to 8.5 us and ordinary single-event delay from
40.490 to 16.278 ms. Five ordinary values spaced 10 ms apart still produced
one request; 8 and 0 ms candidates produced five and were rejected as defaults.

Pending ordinary text is connection-generation state. Clear it and cancel its
timer before replacing or closing `/input`; never let an old callback send
through the new WebSocket. Replaying is also unsafe because delivery on the old
channel may have completed without its acknowledgement. SDK tests and a real
Mousepad/noVNC/IBus run verified both switch directions, the first English
character, composition order, exact application readback, shortcuts, pointer,
resize and reconnect. The final native operating-system IME test worked and
logged 59 successful commits with no errors or input-event trace records. See
`tests/performance/text-batching/`.

P13 removed journald from each successful IBus commit without weakening error
semantics. In a matched 600-request run, the old four-lines-per-request path
wrote 2,400 lines/135,947 bytes; `errors` mode wrote zero, while exact
application readback and ACK p50/p95 remained 1.2/3.7 ms. Gateway write syscalls
fell 29.6%, but CPU ticks and latency were effectively unchanged, so treat this
as an I/O/privacy improvement rather than a speed claim. `/healthz` now carries
non-content request/error/byte/cumulative-time counters. A deliberately invalid
request still returned an ACK error and wrote one content-free rejection log.
The final native IME session worked and produced five requests with zero
success/content/client-event log records. Reproduction is in
`tests/performance/text-logging/`.

That zero-log statement is specifically about the Go gateway journal. The
private Python IBus engine still appends one content-free byte/character-count
record to `engine.log` per successful commit, using one open/append/close. P13
held it constant; test any change to that path independently.

P14 established the production ownership boundary for that input stack. Keep
the VNC display and Go gateway in the server layer, but start the private
D-Bus, lean IBus daemon and remote-unicode engine from the application session
driver. This lets a persistent display remain attachable without retaining the
input processes while vacant, and gives temporary Matchbox applications the
same complete-cleanup boundary. The common helper is
`drivers/common/session-input.sh`; all repository classes use it.

Because the gateway outlives and reconnects to these session-owned engines,
it—not an engine—must assign the public caret `sequence`. Engine sequences
restart on session recreation and may also restart during an input-method
switch. Treat the absent Unix socket as an expected vacant state: retry with
backoff and one diagnostic per outage, then resume from the new engine without
restarting the gateway. The isolated and live three-driver evidence is in
`tests/performance/session-owned-ibus/`.

Application-session exit needs a separate semantic signal from cgroup
emptiness. A real XFCE Logout and a crash both eventually remove every process
from the session unit. The production fix uses the existing atomic,
generation-safe driver status: the driver writes `exited` before returning
zero, writes `error` for a non-zero exit, and only then lets the cgroup become
empty. The manager maps the former to stopped and the latter to failed.
Re-publish the class status schema before every session start so a persistent
runtime created before status was enabled can upgrade without a manual file.
The reusable contract and skeleton are in `drivers/README.md`.

This is **profile separation and lifecycle management, not a security
boundary**: the application still runs under the same Linux UID and can in
principle read that user's other files. Use a distinct Linux user, LXD
container, or Docker container when account data needs access control. The
test services can be stopped together with:

```bash
systemctl --user stop wechat-systemd-test-gateway.service \
  wechat-systemd-test-vnc.service
```

### Reproducible setup: fresh WeChat HOME with `systemd-run`

The following is the tested shape for one **new** profile. Run it as the Linux
user that will own the WeChat account (not as root). It uses a separate VNC
display and only publishes the Go gateway. It intentionally does not delete or
alter an existing WeChat profile.

#### 1. Prerequisites

Install the native WeChat client separately, then make these components
available in the target environment:

```text
wechat
tigervncserver, dbus-launch, ibus-daemon
python3 + PyGObject/IBus bindings
matchbox-window-manager, wmctrl, xdpyinfo
noVNC static files at /usr/share/novnc
```

On Debian/Ubuntu, the supporting packages normally include
`tigervnc-standalone-server`, `dbus-x11`, `ibus`, `python3-gi`,
`gir1.2-ibus-1.0`, `matchbox-window-manager`, `wmctrl`,
`x11-xserver-utils`, and `novnc`. The Go binary is linked to X11/XTest, so its
runtime X11 libraries must also be installed.

Build the gateway from this repository, and keep the startup script and IBus
engine beside it (or adjust the paths in the next step):

```bash
APP_DIR=/opt/remotexapp              # checked-out repository
(cd "$APP_DIR" && go build -o "$APP_DIR/novnc-input" ./cmd/novnc-input)
test -x "$APP_DIR/novnc-input"
test -x "$APP_DIR/tests/ibus-remote-unicode/xstartup-wechat.sh"
test -r "$APP_DIR/components/remote-unicode-engine/engine.py"
```

For a user service launched without a graphical login shell, ensure that user
systemd is available first. `systemctl --user is-active default.target` must
work for the owning user. In a remote shell that commonly means exporting the
user-runtime values below before running `systemd-run`:

```bash
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
```

#### 2. Allocate a new profile and private runtime paths

Choose values that do not collide with another active display, HTTP port, or
profile. The guard below refuses to reuse an existing test HOME; choose a new
name rather than deleting an account directory by accident.

```bash
APP_DIR=/opt/remotexapp
INSTANCE=wechat-systemd-test
SESSION_HOME="$HOME/$INSTANCE"
DISPLAY_NUM=2
RFB_PORT=5902
HTTP_PORT=1984
RUNTIME_DIR="$SESSION_HOME/.cache/remotexapp"
IME_SOCKET="$RUNTIME_DIR/remote-unicode.sock"
VNC_UNIT="$INSTANCE-vnc"
GATEWAY_UNIT="$INSTANCE-gateway"

test ! -e "$SESSION_HOME" || {
  echo "refusing to reuse existing HOME: $SESSION_HOME" >&2
  exit 1
}
install -d -m 0700 "$SESSION_HOME" "$SESSION_HOME/.config" \
  "$SESSION_HOME/.cache" "$SESSION_HOME/.local/share" \
  "$SESSION_HOME/Documents"
```

#### 3. Start the VNC, desktop, IBus, and WeChat cgroup

For this historical standalone wrapper flow, `--remain-after-exit` is required:
`tigervncserver` launches its children and
then exits, but systemd must retain the cgroup to manage the VNC server,
Matchbox, IBus engine, and Electron process tree together.

```bash
systemd-run --user --unit="$VNC_UNIT" --remain-after-exit --collect \
  --property="WorkingDirectory=$SESSION_HOME" \
  --setenv="HOME=$SESSION_HOME" \
  --setenv="XDG_CONFIG_HOME=$SESSION_HOME/.config" \
  --setenv="XDG_CACHE_HOME=$SESSION_HOME/.cache" \
  --setenv="XDG_DATA_HOME=$SESSION_HOME/.local/share" \
  --setenv="XDG_STATE_HOME=$SESSION_HOME/.local/state" \
  --setenv="REMOTE_UNICODE_RUNTIME=$RUNTIME_DIR" \
  --setenv="REMOTE_UNICODE_SOCKET=$IME_SOCKET" \
  --setenv="REMOTE_UNICODE_ENGINE=$APP_DIR/components/remote-unicode-engine/engine.py" \
  -- /usr/bin/tigervncserver ":$DISPLAY_NUM" \
  -geometry 1280x720 -depth 24 -pixelformat rgb888 \
  -localhost=1 -SecurityTypes None -AcceptSetDesktopSize=1 \
  -xstartup "$APP_DIR/tests/ibus-remote-unicode/xstartup-wechat.sh"
```

The VNC server is deliberately loopback-only. Use 24-bit `rgb888` for WeChat;
the 16-bit `rgb565` configuration was visibly colour-corrupt in the test.
`xstartup-wechat.sh` supplies the software-rendering flags, Matchbox, the
private IBus engine, and the debounced WeChat resize watcher.

Wait until the IBus socket is available before starting the gateway:

```bash
for _ in $(seq 1 100); do
  test -S "$IME_SOCKET" && break
  sleep 0.1
done
test -S "$IME_SOCKET" || {
  journalctl --user -u "$VNC_UNIT" --no-pager -n 100
  exit 1
}
```

#### 4. Start the public Go/noVNC gateway

The gateway opens the X display for mouse/keyboard control and relays RFB
directly to loopback TigerVNC. Its IBus mode accepts committed browser IME text
only when the active X11 window has the `wechat` class.

```bash
systemd-run --user --unit="$GATEWAY_UNIT" --collect \
  --property="WorkingDirectory=$SESSION_HOME" \
  --setenv="HOME=$SESSION_HOME" \
  --setenv="XAUTHORITY=$SESSION_HOME/.Xauthority" \
  -- "$APP_DIR/novnc-input" \
  -listen "0.0.0.0:$HTTP_PORT" \
  -display ":$DISPLAY_NUM" \
  -vnc-addr "127.0.0.1:$RFB_PORT" \
  -text-backend ibus \
  -ime-socket "$IME_SOCKET" \
  -ibus-focus-class wechat
```

For this internal test, open:

```text
http://SERVER_ADDRESS:1984/kiosk.html?rfb=compat&resize=remote
```

`resize=remote` requests browser-driven VNC resizing. The Matchbox/WeChat
watcher leaves a six-pixel right/bottom margin to avoid a resize feedback loop.
The service has no authentication; do not expose this listener directly to the
Internet. Put it behind the intended authenticated reverse proxy/access layer.

#### 5. Verify, inspect, and stop

```bash
systemctl --user --no-pager status "$VNC_UNIT" "$GATEWAY_UNIT"
curl -fsSI "http://127.0.0.1:$HTTP_PORT/kiosk.html"
test -S "$IME_SOCKET"
journalctl --user -u "$VNC_UNIT" -u "$GATEWAY_UNIT" --no-pager -n 100
```

Expected results are an HTTP `200`, a new QR-login window, an owner-only IBus
socket, and the two units active (`$VNC_UNIT` reports `active (exited)` because
of `--remain-after-exit`; its child cgroup remains active). The redirected HOME
will accumulate `.xwechat` and WeChat's selected file directory, so retain it
to preserve a login or stop the units when the test is finished:

```bash
systemctl --user stop "$GATEWAY_UNIT.service" "$VNC_UNIT.service"
```

## Test discipline

- Use independent VNC/X11/application sessions for A/B comparisons. Sharing one
  desktop contaminates focus, clipboard ownership, and document state.
- Visually check for recovery dialogs before interpreting an empty result.
- Confirm actual application state, not only a successful WebSocket ack. For
  Mousepad, copy text back; for Impress, inspect a visible text caret/object or
  use a controlled UNO query where applicable.
- Validate a proposed root cause with the real input method and an OS-level
  observer such as `xev`; do not promote an uncollected event sequence to a
  conclusion.
- Restarting TigerVNC invalidates any Go process holding an X11 connection to
  that display. Restart the corresponding gateway after recreating the VNC/X11
  server.

## Current test endpoints

| Endpoint | Purpose |
|---|---|
| `:1986/input-ab.html` | Mousepad baseline: Go → websockify → TigerVNC |
| `:1987/kiosk.html?rfb=compat` | Mousepad Go-compatible RFB relay |
| `:1989/kiosk.html?rfb=compat` | Isolated Impress with Go-compatible relay |
