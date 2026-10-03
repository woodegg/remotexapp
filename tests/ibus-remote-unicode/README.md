# Private IBus Unicode input test

This is an experimental, per-VNC-session Unicode text path. It is designed for
text already committed by the browser IME, not for raw keyboard events.

```text
browser → Go /input → owner-only Unix socket → custom IBus engine → app
```

`engine.py` registers the `remote-unicode` IBus engine and listens only on the
socket passed with `--socket`. It accepts one JSON request per connection:

```json
{"text":"你好 — café 😀"}
```

The engine accepts at most 4096 UTF-8 bytes, rejects NUL/empty strings, and
returns `{"ok":true}` or a short error. The caller must use a fresh,
mode-0600 socket directory owned by the VNC user. Never make this a TCP
listener or forward the session D-Bus socket to the browser.

The same socket also supports `{"action":"subscribe-cursor"}` as a persistent
caret-event stream. The Go gateway caches its newest sequence. Since P11 it
offers pushed `cursor-position` snapshots to one independent capacity-one
queue per `/input` peer, so a slow browser cannot block this Unix subscription
or another browser. This coalescing rule does not apply to committed-text
responses.

`xstartup-mousepad.sh` and `xstartup-impress.sh` create a session D-Bus and
IBus daemon before starting the target. Targets must inherit
`GTK_IM_MODULE=ibus`, `QT_IM_MODULE=ibus`, and `XMODIFIERS=@im=ibus`.

Start the Go gateway with `-text-backend=ibus`, the exact private
`-ime-socket`, and an explicit `-ibus-focus-class` allow-list. IBus focus alone
is insufficient: a stale IBus input context may survive an X11 focus change.
The Go gateway independently checks the active X11 `WM_CLASS` before it calls
the engine. For the test targets, use `Mousepad`, `libreoffice-impress`, or
`libreoffice-writer`; include only the applications the session is meant to
control.

The known successful test sent `你好 — café 😀 via IBus` to a real LibreOffice
Impress text caret and verified the resulting shape text through UNO. Object
selection is not text-edit mode; require a caret before treating a successful
engine acknowledgement as successful document delivery.
