# noVNC + TigerVNC + Matchbox + LibreOffice test

For the evidence, A/B results, IBus switching fix, and Impress input caveats,
read [the lessons-learned record](../../docs/novnc-impress-lessons.md).

This test starts an isolated 1280x720, 16-bit TigerVNC display (`:23` by default)
and publishes it through noVNC. By default it launches a minimal WebKit browser
that contains only an address input and webpage content. The VNC server stays on
loopback (`127.0.0.1:5923`); noVNC is intentionally exposed on `0.0.0.0:1984`
for LAN testing.
TigerVNC accepts noVNC's remote-desktop-size requests, so the browser can resize
the virtual display. Use `VNC_BACKEND=x11vnc` to instead run `Xvfb + x11vnc`;
that lower-memory alternative supports only client-side `resize=scale`.

When `TEST_APP=impress`, the workspace uses a one-row kiosk toolbar for navigation,
undo/redo, and basic text formatting. It hides the menu bar, slide pane, Sidebar,
and LibreOffice status bar. A tiny overlay shows the current slide and total count.
Set `IMPRESS_MINIMAL_UI=0` when starting to retain LibreOffice's full editor chrome.
The default `/kiosk.html` page uses noVNC's native RFB path for pointer, wheel,
navigation, and shortcut keys. Every printable character, including ordinary English
and IME composition, is captured by an in-viewport, nearly invisible browser textarea
and sent through the same-origin `/input` WebSocket. Committed text is pasted using
the X11 clipboard, so
Chinese input does not depend on the server's keyboard layout and no pinyin keystroke
can leak into the target as `v`. The clipboard is committed with `Shift+Insert`:
do not change this to `Ctrl+V`, which can be interpreted as a literal `v` by this
TigerVNC/XKB/LibreOffice combination. Adjacent typed characters are combined before
one clipboard transaction. The validated default keeps TigerVNC loopback-only behind
an internal `websockify` RFB proxy; the Go gateway publishes it with the kiosk, input
bridge, and controlled LibreOffice API on public port `1984`.

## Validated baseline

The following has been tested successfully against this TigerVNC + Matchbox +
LibreOffice Impress environment:

- Full desktop delivery through the custom `/kiosk.html` page on `0.0.0.0:1984`.
  TigerVNC and the internal websockify proxy remain loopback-only.
- Low-latency pointer, wheel, navigation keys, and shortcuts over noVNC's native
  RFB connection.
- Unicode text and Chinese IME commits over the same-origin `/input` WebSocket.
  The browser captures the committed value, the Go gateway acts as a short-lived
  native X11 `CLIPBOARD`/`PRIMARY` selection owner, and persistent native XTEST
  sends `Shift+Insert`. No per-commit `xclip` process is used.
- Consecutive IME commits such as `你` followed by `好` insert as `你好` in Impress.
  Enter text-edit mode first (double-click inside the text object until a caret is
  visible); selecting an object alone is not enough for text insertion.
- Browser-side diagnostic: the lower-left `Text diagnostic` box shows the exact
  JSON-quoted string sent to `/input`. Server-side stages are logged in
  `.runtime/novnc-matchbox/novnc-input.log` as `text input received`, native UTF-8
  selection served (or timeout), and `text input complete`.
- Local baseline measurement: 21 independent Chinese IME commits completed 21/21.
  With the native Go selection owner, server latency was 2.434 ms minimum, 5.893 ms
  p50, 10.259 ms p95, and 22.259 ms maximum. A browser real-IME `text-ack` round
  trip measured 9.9 ms (7.6 ms server time). These local-host values exclude the
  browser's 40 ms text batching delay, WAN/tunnel latency, and VNC video display
  latency. The prior per-commit `xclip` implementation measured 162.472 ms p50,
  which this change replaces.

## One-port Go gateway

The public server is one Go process. It serves noVNC assets and has three separate
same-origin interfaces:

```text
browser noVNC → /websockify → Go WebSocket proxy         → 127.0.0.1:6082 websockify → TigerVNC
browser IME   → /input     → Go native X11 bridge       → focused X11 control
browser API   → /api/uno   → local pyuno adapter        → 127.0.0.1:2002 UNO/URP
```

The kiosk and stock noVNC use `/websockify`. Go's direct `/rfb` bridge is retained
only as an experiment (`RFB_MODE=direct`); it failed the Chinese-input A/B test, so
do not use it for the validated setup.

`/api/uno` is deliberately **not** a raw UNO WebSocket proxy. UNO/URP is not a
browser protocol and its loopback socket has no browser-facing authorization model.
The gateway exposes only this allow-list:

```text
GET  /api/uno                              # current slide, total slides, selection
POST /api/uno {"action":"gotoSlide","slide":5}
POST /api/uno {"action":"replaceSelection","text":"你好"}
```

The final action requires non-empty text selected in the active LibreOffice document;
it replaces that selection with UTF-8 through UNO, not simulated keystrokes. The
adapter is executed locally by Go using LibreOffice's `pyuno` bindings and connects
only to the configured loopback UNO URL. It cannot accept arbitrary UNO methods.

## Next experiments, in order

1. Measure client-visible end-to-end latency over the intended network/tunnel,
   including browser batching and VNC display refresh.
2. Only if the target is guaranteed to be LibreOffice Impress, evaluate an
   application-specific UNO text-insertion path. It can be faster, but it is not a
   generic desktop-input mechanism.

## Input design decision record

### Recommended default

For the current scope—browser client, TigerVNC/X11 desktop, Chinese input, and a
mixture of standard desktop applications—the default is the **in-process Go X11
clipboard bridge plus XTEST `Shift+Insert`**. It is the best tested balance of
implementation cost, speed, and compatibility.

```text
Client OS IME → browser composition/input → /input WebSocket
  → Go X11 CLIPBOARD/PRIMARY selection owner → XTEST Shift+Insert
  → focused remote text control
```

The remote server does not run a Chinese IME and does not receive pinyin key
sequences. It receives only browser-committed Unicode text. Pointer, wheel,
navigation, and shortcut keys remain on noVNC's native RFB path.

### Measured and considered alternatives

| Method | Implementation cost | Measured server latency | Compatibility | Decision |
|---|---:|---:|---|---|
| Go native X11 selection + `Shift+Insert` | Medium | 5.893 ms p50, 10.259 ms p95 | High for standard X11 text controls | Current default |
| `xclip` process + `Shift+Insert` | Low | 162.472 ms p50, 164.534 ms p95 | High for standard X11 text controls | Replaced |
| XTEST per-key typing | Low | Low for key events | Low for Unicode text | Use only for pointer, navigation, and shortcuts |
| Virtual XIM input-method server | High | Not implemented or measured | Medium; only clients configured for that IM server | Fallback research only |
| App-specific API (LibreOffice UNO, AT-SPI) | Medium to high | Not measured | Low; target-specific | Consider only for a fixed target app |

The native bridge avoids the per-commit process startup and fixed negotiation wait
of `xclip`. It now retains the X11 selection for a 25 ms post-request settle
window: this prevents a following `Shift+Insert` from racing Impress'
asynchronous `PasteSpecial` work. The earlier immediate-return latency numbers
above are therefore historical Mousepad measurements, not current Impress timing.

### Why XTEST alone is not a text-input solution

XTEST reliably injects low-level X keyboard and pointer events. It does not inject
the higher-level instruction “insert this UTF-8 string.” Interpretation of a sequence
such as `Ctrl+V` depends on active XKB layout, modifier state, current focus, and the
target toolkit/application. In this environment, `Ctrl+V` was sometimes interpreted
by LibreOffice as a literal `v`; `Shift+Insert` was validated instead. Do not use
XTEST as the generic Chinese-text transport.

### XIM / IBus / Fcitx option

Traditional X11 input methods use XIM: an application creates an input context, gives
it focus, and its IM server emits a committed UTF-8 string after preedit/candidate
handling. GTK and Qt expose comparable toolkit input contexts; IBus/Fcitx may be used
behind them. A virtual IM server could therefore commit text directly into an
application without using the clipboard.

That requires a full XIM server implementation and applications must choose it when
they start (normally through locale and `XMODIFIERS`). It cannot generically attach to
an arbitrary already-running application. The XIM protocol uses the root-window
`XIM_SERVERS` directory, server selection ownership, input contexts, event flow, and
commit/preedit messages. See the [X.Org XIM protocol](https://www.x.org/releases/X11R7.6/doc/libX11/specs/XIM/xim.pdf).

This is not justified merely for speed: the current bridge is already about 6 ms
server-side. It becomes worthwhile only for a target that deliberately rejects paste
but supports a controlled XIM configuration.

### Clipboard side effect and mitigation options

The current bridge temporarily owns the remote X11 session's `CLIPBOARD` and
`PRIMARY` selections, then releases them after serving the inserted UTF-8 text. It
therefore **overwrites and does not restore** the remote session's previous clipboard
content. It does not directly alter the browser machine's clipboard, although VNC
clipboard synchronization can make the effect visible there.

If preserving the remote clipboard is a requirement, choose one of these explicitly:

1. Preserve and restore plain text (`UTF8_STRING`) in the Go bridge. This covers most
   ordinary copy/paste, with moderate implementation cost.
2. Build a full selection proxy that preserves and re-serves every advertised target
   (text, HTML, images, INCR transfers, and so on). This is substantially more
   complex.
3. Use an app-specific input API or XIM for applications where clipboard mutation is
   unacceptable.

### Observability and privacy

For this internal test, the browser diagnostic displays the exact JSON-quoted text it
sends, and `novnc-input.log` records the input value and selection stages. This is
useful for separating client-IME, transport, selection, and target-focus failures.
It also means text can be present in browser screenshots and server logs. Remove or
redact value logging before any production use.

```bash
./tests/novnc-matchbox/start.sh
```

TigerVNC runs with no VNC password for this internal test. Because noVNC and the
input bridge are exposed without authentication on `0.0.0.0:1984`, restrict them
to a trusted network or put them behind your Cloudflare Access policy before broader
use. `/vnc.html` remains available for comparison, but it is normal read/write
noVNC; use `/kiosk.html` for the custom input experiment.
Stop only this test session with:

```bash
./tests/novnc-matchbox/stop.sh
```

Override the defaults when needed:

```bash
VNC_DISPLAY=:24 VNC_PORT=5924 NOVNC_PORT=1985 PPTX_PATH=/absolute/file.pptx \
  TEST_APP=impress ./tests/novnc-matchbox/start.sh
```
