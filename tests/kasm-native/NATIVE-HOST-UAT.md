# Consolidated native host UAT

This is one end-to-end acceptance session for [NHI-001–010](../../docs/native-host-integration.md).
Use the candidate and evidence in [native host qualification](NATIVE-HOST.md).
Automation does not mark these human checks passed. Record browser/OS, input
method, physical audio devices, candidate identity, result and reproducible failures.

## Entry points and fixtures

Open the authenticated `/rx/sdk/host.html` reference workbench. The deployment
handoff provides the protected URLs; credentials and private host addresses are
not part of this repository. The complete-template Ubuntu fixture exposes all
eight shipped Apps. Regional Alpine AMD64/ARM64 fixtures expose their installed
Mousepad, Writer, desktop and audio test Apps. Missing distribution-specific
Apps are not inferred to work from another platform's result.

The complete-template fixture uses WSS. Regional fixtures additionally exercise
optional IPv4 WebRTC UDP. Keep the live statistics sidebar visible beside the
application. UDP changes screen delivery; keyboard/control and audio are separate
reliable channels. UDP block loss is not an IP-packet loss measurement.

Use files under the fixture account's configured `documents` directory and
synthetic content. A browser-local path is not a remote path. This workbench does
not upload files or folders. Start with new Apps to use the qualified candidate;
already running Apps intentionally retain their immutable component pins.

## One acceptance sequence

1. **Catalog and application workflows.** Launch Mousepad, Kate, KWrite and
   LibreOffice using an allowed remote file. Type, save, close the window, reopen
   the same file and check persistence. Launch Edge, Firefox ESR and LightView;
   invoke their advertised `openUrl` action and verify the intended shared
   browser is reused. Inspect action/control metadata without treating a
   loopback descriptor as a browser-accessible URL.
2. **Desktop lifecycle.** Expand existing/managed targets and explicitly start
   the test desktop if stopped. Select its template in the main catalog and use
   **连接托管桌面** to attach; open it twice and check that both windows share the
   same desktop. Close a window and attach again. Explicitly stop it;
   observation and workspace switching must not restart it. Start it again only
   with the explicit start action; the catalog button must explain a stopped
   desktop rather than start it. Automated fault/reboot checks are recorded
   separately; do not inject faults into an active human session.
3. **Windows, workspaces and tasks.** Duplicate a window, move one to workspace 2
   and switch repeatedly. Verify pointer, focus and independent display stats.
   Unload/restore one display. Retain a background task, close both windows and
   verify the App remains owned; release that task separately. Closing one
   owner's window must not stop another owner. Stop App is a separate action.
4. **Input and display.** Select the local keyboard/IME policy. Exercise Chinese
   composition, English/Chinese switching outside and inside the Viewer,
   Win+Space / the selected platform shortcut, arrows, editing shortcuts,
   pointer drag and resize. Try native text/shortcut controls. Open a read-only
   window and confirm it paints while refusing input. Compare native resize
   with scale-only; use only one resize owner for a shared framebuffer.
5. **Clipboard.** Opt in to automatic directions and grant browser permission.
   Exercise local→remote and remote→local plain text, HTML and PNG, including a
   Writer document. Switch between two Viewers and another Tab: only the active
   target should synchronize. Try manual/off modes, an over-2-MiB payload and a
   denied permission. Existing destination content must survive a refusal.
   Files/folders remain unsupported. Reconnect requires fresh clipboard opt-in.
6. **Speaker and microphone.** Prepare audio interest, then explicitly enable
   Speaker or Mic. Use a remote tone/music source and remote recording/playback
   to test the real devices. Open two sessions and the same session in another
   Tab: switches are per remote session, duplicate Tabs share its desired
   route, and there is one selected playback/capture owner. Exercise explicit
   mic takeover. Workspace switching or display unload must retain separately
   held audio. All switches off must release transport and microphone tracks.
7. **Transport and connection state.** On regional fixtures create moving pixels,
   confirm actual UDP counters, then disable UDP and verify WSS still paints and
   accepts input/clipboard/audio. Re-enable UDP; use Ping and inspect RTT,
   bandwidth, paint FPS and scoped loss. Disconnect/reconnect once. Failure and
   stale data must remain visible; an old generation must not control its
   replacement, and submitted input must not be replayed.
8. **Finish.** Save documents before explicit App stop. Several shipped editors'
   shutdown hooks terminate without saving; they do not promise an unsaved-work
   veto. Release windows/tasks/audio and use logout. Export the content-free
   workbench record and report one overall UAT result with any failed steps.

Physical IME/device behavior, actual downstream product integration, browser
variants not exercised here, long-duration/load testing of this new host layer,
IPv6 and automatic multi-container UDP orchestration are not implied by the
bounded automated results. The [migration guide](../../docs/native-host-migration.md)
lists the downstream changes still required after this functional simulation.
