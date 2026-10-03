# Push-based remote IME caret positioning

The remotexapp stack uses an event-driven caret path so the browser's hidden
text input—and therefore the native local IME candidate UI—can follow the
focused remote application's insertion caret.

```text
GTK application / IBus input context
        |
        | do_set_cursor_location(), focus and enable callbacks
        v
per-display remote-unicode IBus engine
        |
        | persistent mode-0600 Unix subscription
        v
per-instance novnc-input gateway
        |
        | broadcast on existing /input WebSockets
        v
RemoteXAppClient hidden textarea
```

No cursor traffic is placed in the RFB framebuffer stream or the durable
application-status API. It belongs to the live input/control plane.

## Event protocol

The Go gateway opens one persistent connection to the private IBus engine and
sends:

```json
{"action":"subscribe-cursor"}
```

The engine immediately sends its cached snapshot and subsequently emits an
event whenever caret location, IBus focus, or engine-enabled state changes:

```json
{
  "type": "cursor-position",
  "sequence": 418,
  "updatedMs": 2976900055,
  "focused": true,
  "enabled": true,
  "cursor": {
    "x": 123,
    "y": 286,
    "width": 1,
    "height": 20
  }
}
```

The engine supplies a source-local sequence, but the Go gateway replaces it
with its own monotonically increasing public `sequence`. This is required
because an engine counter restarts both when an application session is
recreated and when IBus replaces the engine during an input-method switch.
`updatedMs` remains the engine's monotonic timestamp for the latest actual
cursor-location callback; focus/enable events may advance the public sequence
without changing `updatedMs`. Coordinates are X11 root-display pixels.

The gateway caches the newest sequence and broadcasts it to every connected
`/input` WebSocket. A newly connected browser receives the cached snapshot
immediately. P11 makes that broadcast non-blocking: each input peer owns an
independent writer and a capacity-one latest-value cursor queue. If its writer
is busy, a newer snapshot replaces the older queued snapshot. Thus a stalled
peer cannot delay the persistent IBus subscription reader or another browser,
and every peer eventually converges to the newest sequence.

All WebSocket writes remain serialized by one mutex per peer so text
acknowledgements, direct query replies and cursor events never write
concurrently through Gorilla WebSocket. Only pushed cursor snapshots may be
coalesced. Reliable replies are never placed in the replaceable queue. A cursor
write failure unregisters that peer and closes its connection; other peers and
the cached gateway snapshot remain active.

If the private subscription closes—or the session-owned socket does not yet
exist—the persistent gateway reconnects with bounded backoff. It writes one
expected-unavailable diagnostic per outage rather than one per retry, and
resumes silently when the next session creates the socket. The older one-shot
`{"type":"cursor"}` browser request and
`{"action":"cursor"}` Unix request remain supported as recovery mechanisms.

## Browser positioning and freshness

On pointer down, the browser must retain keyboard focus synchronously, so it
temporarily positions the hidden textarea at the click. It records the last
`updatedMs` as a baseline while noVNC delivers the pointer event through RFB.

When a pushed event has `updatedMs` greater than that baseline, the browser:

1. maps remote display coordinates through the current canvas bounding box;
2. moves the fixed-position hidden textarea to the mapped caret rectangle;
3. forces layout so the new geometry is observable to the native IME;
4. renews textarea focus only when composition and keyboard activity have not
   begun; and
5. reports source, freshness, mapped client position, latency, and refocus
   outcome in diagnostics.

It never blur/refocuses during composition, after keyboard activity, or while
text is queued/in flight. Correct input takes priority over popup placement.
If no fresh cursor arrives within 250 ms, the client issues one recovery query;
after 750 ms it retains the click fallback. A five-second watchdog replaces the
old ten-queries-per-second polling loop and covers missed events or subscription
restart.

Since SDK 0.8/P12, ordinary text is queued for 16 ms by default and a completed
composition flushes immediately. Channel replacement clears the pending value
and timer before resetting cursor state, so neither stale text nor a stale
caret refocus can cross an `/input` WebSocket generation. The 40 ms ordinary
compatibility value is available through `textBatchDelay`; caret code must use
the SDK's actual pending/in-flight state rather than assume either interval.

The direct kiosk viewer and reusable `RemoteXAppClient` both use this push-first
behavior. SDK consumers can observe it without reading private DOM state:

```js
client.addEventListener('cursorchange', event => {
  console.log(event.detail.cursor);
});

console.log(client.getDiagnostics().cursor);
```

The console diagnostics include `sequence`, `updatedMs`, `freshForPointer`,
`positionSource`, `clientPosition`, `refocused`, and `latencyMs`.

## Live verification result

The first deployed Mousepad test received an immediate cached event at sequence
11. Six inserted characters and two left-arrow operations then pushed sequences
12 through 19 without browser cursor queries. Reported X coordinates advanced
from 12 to 57 and returned to 39, matching the remote insertion caret movement.

P11 then tested two simultaneous input observers. The first saw sequence 6,
then pushed sequence 7 after committed text; a newly connected observer
immediately received cached sequence 7. Its deterministic slow-peer harness
reduced fast-peer delivery of the newest of 32 snapshots from 324.436 ms to
23.242 us. Reproduction is in `tests/performance/cursor-fanout/`.

P12's real browser run preserved push positioning while testing the new text
timing: exact Chinese/English order, first post-switch characters, pointer,
client resize and reconnect passed, followed by native operating-system IME
acceptance. Reproduction is in `tests/performance/text-batching/`.

P14 then moved the private D-Bus, IBus daemon and engine into the on-demand
session for every production class while the gateway remained in the server
layer. Session stop/start and in-session IME switching demonstrated why the
gateway must own the public sequence. XFCE, Mousepad and Edge all passed the
post-deployment input/readback checks; reproduction is in
`tests/performance/session-owned-ibus/`.

## Limitations and security

- An application must expose an IBus input context and caret rectangle. A
  focused application with no IBus caret reports no usable cursor.
- SDK 0.15 makes the latest primary mouse/touch/pen position effective by
  forcing layout and safely renewing hidden-textarea focus before composition.
  Right, middle, and non-primary pointers do not replace it. The fallback
  remains correlated after its 750 ms recovery window so a late fresh remote
  caret can still supersede it. Composition and queued/in-flight text block
  focus renewal. Deterministic coverage and the real Chrome/Mousepad/IBus
  correction are recorded in P15; native candidate-window placement remains a
  human UAT requirement because synthetic browser events cannot prove it.
  The rc.21 release UAT passed on 2026-08-29.
- Browser/OS IME implementations ultimately decide candidate-window placement;
  the controlled pre-composition refocus gives them the correct element
  geometry without interrupting active composition.
- The Unix socket is per display, owned by the session user, and mode 0600.
- The browser never receives arbitrary D-Bus or Unix-socket access.
- Cursor events contain geometry and focus state only; they must not include
  surrounding document text or other application data.
