#!/usr/bin/env python3
"""Disposable X11 GUI probe; all output is private synthetic test evidence."""
import argparse
import json
import os
from pathlib import Path
import signal
import tkinter as tk

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--purpose', required=True, choices=['remotexapp-d2-disposable'])
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
assert os.environ.get('DISPLAY'), 'Use only the selected disposable display'
os.umask(0o077)
root = tk.Tk()
root.title('RemoteXApp input regression probe')
root.geometry('600x420+40+60')
root.attributes('-topmost', True)
root.configure(background='#dce5ee')
entries = {}
for name, x, initial in [('a', 20, 'ABCD'), ('b', 310, 'EFGH')]:
    tk.Label(root, text='Input target '+name.upper()).place(x=x, y=10)
    entry = tk.Entry(root, name='entry_'+name, font=('monospace', 16))
    entry.place(x=x, y=35, width=260, height=35)
    def select_all(event):
        event.widget.selection_range(0, 'end')
        event.widget.icursor('end')
        return 'break'
    entry.bind('<Control-a>', select_all)
    entry.insert(0, initial)
    entries[name] = entry
count = 0
def increment():
    global count
    count += 1
    button.configure(text='Clicked '+str(count))
button = tk.Button(root, text='Click target', command=increment)
button.place(x=20, y=90, width=170, height=40)
area = tk.Frame(root, name='pointer_area', background='#aac3df')
area.place(x=310, y=90, width=260, height=80)
listing = tk.Listbox(root, name='listing')
listing.place(x=20, y=180, width=550, height=200)
for i in range(60):
    listing.insert('end', 'Row '+str(i))
events = []
def observe(event):
    if len(events) >= 2000:
        del events[:1000]
    events.append({'type':str(event.type), 'widget':str(event.widget),
                   'x':getattr(event, 'x_root', -1), 'y':getattr(event, 'y_root', -1),
                   'localX':getattr(event, 'x', -1), 'localY':getattr(event, 'y', -1),
                   'time':getattr(event, 'time', None),
                   'button':getattr(event, 'num', None), 'key':getattr(event, 'keysym', None),
                   'state':getattr(event, 'state', 0)})
for kind in ['<Motion>', '<ButtonPress>', '<ButtonRelease>', '<KeyPress>', '<KeyRelease>', '<FocusIn>']:
    root.bind_all(kind, observe, add='+')
def geometry(widget):
    return {'x':widget.winfo_rootx(), 'y':widget.winfo_rooty(),
            'width':widget.winfo_width(), 'height':widget.winfo_height()}
def snapshot():
    data = {'pid':os.getpid(), 'clicks':count, 'focus':str(root.focus_get()),
            'entries':{}, 'geometry':{'button':geometry(button), 'area':geometry(area), 'list':geometry(listing)},
            'listSelection':list(listing.curselection()), 'listView':list(listing.yview()), 'events':events}
    for name, entry in entries.items():
        selection = [entry.index('sel.first'), entry.index('sel.last')] if entry.selection_present() else []
        data['entries'][name] = {'value':entry.get(), 'cursor':entry.index('insert'), 'selection':selection}
        data['geometry'][name] = geometry(entry)
        data['geometry'][name]['characterBoxes'] = [entry.bbox(i) for i in range(len(entry.get()))]
    temp = args.output.with_suffix('.tmp')
    temp.write_text(json.dumps(data))
    temp.replace(args.output)
    root.after(40, snapshot)
root.after(50, snapshot)
# Keep a normal managed window: bypassing the window manager would let Matchbox
# return keyboard focus to its main App despite pointer events reaching us.
signal.signal(signal.SIGTERM, lambda *_:root.destroy())
root.mainloop()
