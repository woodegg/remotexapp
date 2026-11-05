#!/usr/bin/env python3
"""Synthetic X11 clipboard owner for a disposable rich-clipboard fixture only.

Spec contains synthetic representations as base64, optional INCR chunk size and
per-target delay. Results contain request/transfer metadata, never content.
"""
import argparse
import base64
import json
import select
import time
from pathlib import Path
from Xlib import X, Xatom, display, protocol

parser = argparse.ArgumentParser()
parser.add_argument('--spec', required=True)
parser.add_argument('--result', required=True)
args = parser.parse_args()
spec = json.loads(Path(args.spec).read_text())
assert spec.get('purpose') == 'synthetic-remotexapp-rich-clipboard'
d = display.Display()
window = d.screen().root.create_window(0, 0, 1, 1, 0, X.CopyFromParent, X.InputOnly, X.CopyFromParent)
clipboard, targets, incr = [d.intern_atom(x) for x in ['CLIPBOARD', 'TARGETS', 'INCR']]
values = {d.intern_atom(k): base64.b64decode(v, validate=True) for k, v in spec['formats'].items()}
assert len(values) <= 8 and sum(len(v) for v in values.values()) <= 4 * 1024 * 1024
requests, chunks, pending = [], {}, []
window.set_selection_owner(clipboard, X.CurrentTime)
d.sync()
result = {'ready': True, 'requests': [], 'completed': 0}
Path(args.result).write_text(json.dumps(result))
end = time.monotonic() + min(120, spec.get('seconds', 30))

def respond(event):
    name = d.get_atom_name(event.target)
    requests.append(name)
    prop = event.property or event.target
    requestor = event.requestor
    if event.target == targets:
        requestor.change_property(prop, Xatom.ATOM, 32, [targets, *values])
    elif event.target in values and name != spec.get('failTarget'):
        data = values[event.target]
        step = spec.get('chunkBytes', 0)
        if step and len(data) > step:
            requestor.change_attributes(event_mask=X.PropertyChangeMask)
            chunks[(requestor.id, prop)] = [requestor, event.target, data, 0, step]
            requestor.change_property(prop, incr, 32, [len(data)])
        else:
            requestor.change_property(prop, event.target, 8, data)
    else:
        prop = X.NONE
    requestor.send_event(protocol.event.SelectionNotify(time=event.time, requestor=requestor,
        selection=event.selection, target=event.target, property=prop), propagate=False)
    d.flush()

try:
    while time.monotonic() < end:
        now = time.monotonic()
        for when, event in pending[:]:
            if when <= now:
                pending.remove((when, event))
                try: respond(event)
                except Exception: result['retiredRequestor'] = True
        if not d.pending_events():
            select.select([d.fileno()], [], [], .02)
            continue
        event = d.next_event()
        if event.type == X.SelectionRequest:
            name = d.get_atom_name(event.target)
            delay = min(6, spec.get('delay', {}).get(name, 0))
            if delay: pending.append((now + delay, event))
            else: respond(event)
        elif event.type == X.PropertyNotify and event.state == X.PropertyDelete:
            key = (event.window.id, event.atom)
            transfer = chunks.get(key)
            if transfer:
                requestor, target, data, offset, step = transfer
                piece = data[offset:offset+step]
                requestor.change_property(event.atom, target, 8, piece)
                transfer[3] += len(piece)
                if not piece:
                    del chunks[key]
                    result['completed'] += 1
                d.flush()
        result['requests'] = requests
        Path(args.result).write_text(json.dumps(result))
finally:
    d.close()
