# LightView App Package

LightView 1.0.13 is a shared singleton browser package with persistent profile
`default`. It starts on first Viewer attach, uses a dynamic 1280×720, depth-16,
5 FPS display with client resize, and stops the complete runtime after six
detached hours while preserving website data.

Every launch passes LightView's `--low-memory` default. Its 384 MiB value is a
WebKit per-process memory-pressure target, not a hard runtime memory limit. The
mode keeps normal website images enabled while disabling WebRTC, WebGL and
accelerated 2D canvas. Media playback, Media Source, encrypted media and
WebAudio remain enabled so ordinary and streaming sites work reliably.
Website downloads are accepted without a destination prompt and written to
the runtime user's standard `Downloads` directory. Existing files are
preserved by adding a numeric suffix; the browser status bar reports progress,
completion or failure. This is upstream Lightview behavior, not a Manager API.

Memory protection and thresholds are user choices, not control-interface health
requirements. Since 1.0.10, disabling protection or changing a threshold does
not block startup, navigation or graceful exit. Since 1.0.11, `openUrl` also
wakes an idle-hibernated WebKit engine: it verifies the main process and private
socket, dispatches native `open`, then waits for `ready` and a completed load.
Other unready states still fail closed. Quit verifies its target without
requiring page readiness.

Since 1.0.13, Viewer transition hooks wake the engine before the first Viewer
connects and inhibit native idle hibernation while a Viewer is attached. The
last detach restores the previous idle interval; Manager adoption reconciles
that policy. These hooks require Core 0.14.1 or later.

Public status reports `launchLowMemory:true` only as a launch setting. It no
longer advertises fixed live `lowMemory`, `memoryLimitMiB` or
`memoryKillThresholdMiB` fields. Trusted local Agents can query current policy
through the native socket's `status` command. No background policy reset is added.

Lightview 0.1.8 adds a 3072 MiB last-resort termination threshold for each
WebKit process and supervised recovery. A manual reset, WebKit crash, or
memory-limit termination replaces the WebKit worker while preserving the
LightView main PID, GTK window, persistent profile, and control-socket path.
Page DOM, JavaScript state, history, unsaved form content, media playback, and
active downloads may be lost. Recovery never replays an agent command or the
last page automatically; trusted local automation can inspect status and
explicitly decide what to retry.

The package reports its same-UID Unix socket only through protected CONN-001
metadata. `openUrl` is the only Manager action and accepts HTTP(S). Raw `eval`
remains available only to trusted local Agents that explicitly retrieve and
revalidate the private descriptor. Never proxy this socket over a network.

Starting with App Package 1.0.9, the separately installed Lightview executable
is not restricted by a version number or banner. The Driver launches it with
the existing flags and accepts it only when the required window, identity,
private socket and control readiness checks pass. Older or
newer programs lacking those capabilities still fail readiness. This is not
automatic downloading/upgrading or a guarantee of compatibility with every
future release. Operators must provision and verify their chosen host build.

App Package 1.0.9 passed the isolated 15-scenario Viewer/control/lifecycle
suite with formal `Lightview 0.1.9` (WebKitGTK 2.52.6). Its tested binary SHA-256
is `b3a2ff625c65d50f66f2c91016757f47bf89bfc7bcb59090e0818827eea70b94`;
the upstream Ubuntu 24.04 x86_64 archive SHA-256 is
`3ca10b3ec2bf07fc17451356735d1e6faf73875dd358025214717ecb9bc90fd9`.

The previous App's historical real-program baseline was `Lightview 0.1.8`, SHA-256
`0923e2b920e5e239166b35bb237377c98895278c039bd544581bb58d722d8461`
and reports WebKitGTK 2.52.6. It is not embedded in this App Package. Operators
must verify the checksum for their approved build before activation. The
baseline 0.1.8 upstream archive SHA-256 is
`6f0e1914857e6ce71dbf82ba0da33bd1cb04352a0c9be72b1d10fbc2f5619bae`.
Hosts intended for media playback also require the GStreamer bad and libav
plugin packages; without them, YouTube can render its player but reject the
selected video stream.
Readiness requires the exact launched PID, a visible window, a private owned
socket and valid native readiness status.
