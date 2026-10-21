# Managed recovery 0.15.0 candidate UAT

Core 0.15.0 / SDK 0.30.0 is a candidate until the release qualification owner
records acceptance. [Issue #3](https://github.com/woodegg/remotexapp/issues/3)
identifies the selected full commit, archive SHA-256, exact-archive checks,
both-backend faults, actual container reboots and the private test entrypoint.
The deployment-owning project retains sandbox/production responsibility.

The [automated qualification record](managed-recovery-0.15.0-qualification.md)
identifies the UAT-ready archive and completed checks. Human acceptance remains
pending.

## Preparation

Install the unchanged verified candidate into a new immutable directory on a
project-owned test account. Keep its listener loopback-only and use an
authenticated access path when access crosses a host boundary. Preserve the
prior archive and pre-upgrade state snapshot; schema-3 state cannot be read by
older Cores. Do not substitute a rebuild after automated qualification.

The automated qualification should already cover no-Viewer/attached-Viewer
recovery, protected-process blockers, retries, Manager adoption, pinned boot
reconstruction and generation safety. Record real reboots separately from
marker simulation. Physical power loss is not implied by container restart.

## Human acceptance

1. Verify the Console reports Core 0.15.0 and SDK 0.30.0 and the handoff's exact
   artifact identity matches the installation. Connect to the test desktop.
2. Open an editor and check ordinary typing, shortcuts, pointer focus, Chinese
   IME composition and committed Unicode. Save a disposable test document.
3. Copy/paste plain text and Unicode in both directions using the supported
   browser permission flow. Check that reconnect does not replay old clipboard
   offers or leave an input channel controlling an old session.
4. Disconnect/reconnect and resize the browser. Confirm the desktop's configured
   framebuffer/resize policy, focus and connection curtain behave normally.
5. Review recovery phase, explanation, attempts and next time in the Console.
   Use the supplied disposable fault scenario to observe automatic recovery,
   then **Recheck recovery**. It must not request force, erase the budget or
   skip a scheduled cooldown. Protected processes must remain preserved.
6. Log out normally and reconnect. Normal logout must retain on-attach behavior;
   it must not become an immediate automatic desktop relaunch. Verify the
   saved document and persistent desktop configuration remain.
7. Check the supplied Manager restart and actual reboot results against the
   same artifact identity. Verify the post-reboot desktop remains usable.
8. Record acceptance or specific failures with candidate commit/checksum. If
   implementation changes, qualify a new candidate and repeat affected UAT.

Recovery preserves persistent HOME, identity and locked versions; it cannot
restore process memory or unsaved edits lost with a failed process. Fault
scenarios must use disposable test applications and documents.

## Completion boundary

Human acceptance authorizes the separately reviewed publication step only when
the owner requests it. Publish the accepted bytes without rebuilding, then
verify a fresh download and record downstream handoff. UAT readiness alone
does not publish a release or authorize operations in existing environments.
