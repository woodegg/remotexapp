# Managed session recovery — Core 0.14.2

## Failure and safety boundary

On grok-bot-sandbox, managed `sandbox-desktop` kept TigerVNC `:1` and the
gateway after the XFCE session leader disappeared. Helper processes retained
the session cgroup, so its empty-cgroup observer could not notify Core. The
managed safety sweep eventually marked generation 3 failed. The root cause of
the leader exit is unknown; an old Core pin is not evidence of that cause.

Observe both the canonical readiness process and cgroup population. Terminal
events are generation-fenced under the lifecycle lock. An explicit XFCE logout
continues to use `stop-session` and on-attach relaunch. If the leader dies and
the component remains active, preserve it: a child may be an unsaved document.
Report failed/blocked, retain the server, VNC, gateway and profile, and require
operator review. Do not run a generic process-name kill or remove another
generation's socket.

If the component is fully inactive, the next Viewer attach may clean stale
session IPC and start a new session generation on the same pinned runtime.
Persist the recovery intent before launch, limiting this automatic path to
three attempts in a ten-minute window starting with the first attempt.
Exhaustion and populated old components fail closed; an explicit
generation-guarded runtime restart remains
available to an authorized operator. Manager restart must retain the counter.

## Acceptance matrix

- Disposable-UID XFCE: kill only the readiness leader while a child remains;
  assert prompt failure, no component stop, intact HOME and no auto-attach.
- Externally stop the whole session component; assert next Viewer attach starts
  a newer generation without replacing VNC/gateway or borrowing another bus.
- Repeated failed launches and Manager restart cannot reset the three-attempt
  window; stale-generation events cannot stop the new session.
- Repeat normal logout, on-attach relaunch, unsaved document, Manager adoption,
  explicit restart/upgrade, gateway/VNC faults and both lifecycle backends.
- Qualify a clean exact candidate on a disposable systemd UID, then local UAT.
  Grok-bot and other sandbox deployment belong to their owning project.

Resource runaway is intentionally separate. CPU load alone is not proof of
failure or permission to discard user data. Any later cgroup pressure policy
needs explicit host thresholds, throttling/notification, protected-process
handling and its own fault-injection acceptance.

The disposable-UID systemd XFCE test on 2026-10-02 showed that SIGKILL of its
readiness leader also emptied the session cgroup, so the real-host path was
on-attach recovery. The surviving-process safety branch is covered by a
controlled unit fixture, not claimed as real-host fault evidence. The same
real-host test verified that the recovery counter survived a Manager restart.

Local `0.14.2-rc.1` UAT was accepted on 2026-10-02 after both loopback Managers
served the same candidate Core commit, retained the existing XFCE runtime pin,
and passed readiness and disposable Mousepad smoke checks. The candidate was
built locally; the formal clean-commit archive still needs its independent
exact-artifact gate before publication.
