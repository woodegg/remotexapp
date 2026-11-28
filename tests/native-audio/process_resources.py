"""Read-only Linux accounting for an identity-qualified owned process family.

Raw PID, cgroup and command-line records belong in private evidence. A family
sample reports exits/changes instead of interpreting an unreadable process as
zero memory. Profile-qualified detached crash handlers can be included by a
private command-line marker; unrelated account processes are never included.
"""
import os
from pathlib import Path
import shlex
import time


MEMORY_FIELDS = ('Rss', 'Pss', 'Pss_Anon', 'Pss_File', 'Pss_Shmem',
                 'Private_Clean', 'Private_Dirty', 'Shared_Clean', 'Shared_Dirty',
                 'Anonymous', 'AnonHugePages', 'LazyFree', 'Swap', 'SwapPss')


def identity(pid):
    path = Path('/proc', str(pid))
    raw = (path / 'stat').read_text()
    fields = raw[raw.rfind(')') + 1:].split()
    return {'pid': int(pid), 'uid': path.stat().st_uid, 'parent': int(fields[1]),
            'startTicks': int(fields[19]), 'cpuTicks': int(fields[11]) + int(fields[12]),
            'state': fields[0]}


def arguments(pid):
    values = [value.decode(errors='replace') for value in
              Path('/proc', str(pid), 'cmdline').read_bytes().split(bytes([0])) if value]
    # Chrome rewrites a child's process title into argv[0]. Treat that form as
    # a diagnostic command line, rather than labelling every child a browser.
    # The root's start-time/UID qualification remains independent of this label.
    if len(values) == 1:
        try:
            title = shlex.split(values[0])
            if title and Path(title[0]).name in ('chrome', 'chromium', 'chromium-browser'):
                return title
        except ValueError:
            pass
    return values


def role(args):
    if not args:
        return 'exited'
    if Path(args[0]).name == 'chrome_crashpad_handler':
        return 'crashpad'
    kind = next((arg.split('=', 1)[1] for arg in args if arg.startswith('--type=')), 'browser')
    if kind == 'utility':
        service = next((arg.split('=', 1)[1] for arg in args if arg.startswith('--utility-sub-type=')), '')
        return kind + ':' + service
    return kind


class ProcessFamily:
    def __init__(self, pid, *, root_argument=None, detached_marker=None):
        self.root = identity(pid)
        self.root_argument = root_argument
        self.detached_marker = detached_marker
        self._verify_root()

    def _verify_root(self):
        current = identity(self.root['pid'])
        if any(current[key] != self.root[key] for key in ['uid', 'startTicks']):
            raise RuntimeError('Owned root identity changed')
        if self.root_argument is not None and self.root_argument not in arguments(current['pid']):
            raise RuntimeError('Owned root command-line qualification changed')
        return current

    def members(self):
        self._verify_root()
        table = {}
        for path in Path('/proc').glob('[0-9]*'):
            try:
                value = identity(int(path.name))
                if value['uid'] == self.root['uid']:
                    table[value['pid']] = value
            except (OSError, ValueError, IndexError):
                pass
        family = {self.root['pid']}
        if self.detached_marker is not None:
            for pid in table:
                try:
                    args = arguments(pid)
                    if args and Path(args[0]).name == 'chrome_crashpad_handler' and any(
                            self.detached_marker in arg for arg in args):
                        family.add(pid)
                except OSError:
                    pass
        while True:
            more = {pid for pid, value in table.items() if value['parent'] in family}
            if more <= family:
                break
            family |= more
        return {pid: table[pid] for pid in family if pid in table}

    def sample(self):
        started = time.monotonic()
        before = self.members()
        records, exited, unreadable = [], [], []
        for pid, expected in sorted(before.items()):
            path = Path('/proc', str(pid))
            try:
                args = arguments(pid)
                raw = (path / 'smaps_rollup').read_text()
                values = {key: int(value.strip().split()[0]) for key, value in
                          (line.split(':', 1) for line in raw.splitlines() if ':' in line)
                          if key in MEMORY_FIELDS}
                status = dict(line.split(':', 1) for line in (path / 'status').read_text().splitlines() if ':' in line)
                current = identity(pid)
                if current['startTicks'] != expected['startTicks'] or current['uid'] != expected['uid']:
                    raise RuntimeError('Sampled PID identity changed')
                required = {'Rss', 'Pss', 'Pss_Anon', 'SwapPss'}
                if not required <= values.keys():
                    raise RuntimeError('Required proportional memory counters unavailable')
                records.append({**current, 'role': role(args), 'memoryKiB': values,
                                'fdCount': len(list((path / 'fd').iterdir())),
                                'threads': int(status['Threads']),
                                'cgroup': (path / 'cgroup').read_text().splitlines()})
            except FileNotFoundError:
                exited.append(pid)
            except (OSError, RuntimeError, ValueError) as error:
                unreadable.append({'pid': pid, 'error': type(error).__name__ + ': ' + str(error)})
        after = self.members()
        changed = [pid for pid in before.keys() | after.keys() if
                   pid not in before or pid not in after or
                   before[pid]['startTicks'] != after[pid]['startTicks']]
        self._verify_root()
        totals = {key: sum(record['memoryKiB'].get(key, 0) for record in records) for key in MEMORY_FIELDS}
        totals['PssAnonPlusSwapPss'] = totals['Pss_Anon'] + totals['SwapPss']
        return {'at': time.time(), 'durationSeconds': time.monotonic() - started,
                'root': self.root, 'completeStableFamily': not exited and not unreadable and not changed,
                'exitedDuringSample': exited, 'unreadable': unreadable, 'membershipChanged': changed,
                'processes': records, 'totalsKiB': totals,
                'totalFDs': sum(row['fdCount'] for row in records),
                'totalThreads': sum(row['threads'] for row in records),
                'clockTicksPerSecond': os.sysconf('SC_CLK_TCK')}
