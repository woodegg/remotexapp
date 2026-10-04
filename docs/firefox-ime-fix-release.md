# Firefox interactive IME fix release train

> Historical technical record. Dated status and validation statements describe
> their original scope; they do not identify a current deployment. See
> [current source versions](current-state.md). Host labels and runtime IDs in
> historical examples are anonymized.

Status: implemented, exact-candidate automated acceptance passed, and deployed
to local 1991; Human UAT accepted and stable publication authorized on
2026-09-08. Stable `0.5.3` is published and independently verified. Subsequent
explicit fleet approval aligned all eight Managers; the separately requested
runtime replacement is also complete after approved forceful desktop exits.
Scope was locked by the operator on 2026-09-07, then expanded with approval
as **RTM-017**; the expanded scope is locked. Requirements: **FFX-007, RTM-017**.
Candidate: RemoteXApp `0.5.3-rc.1`,
target stable `0.5.3`, with `firefox-esr@2.1.1`. SDK `0.21.1` and App Package
ABI V1 remain unchanged. Goal: deploy to local 1991, validated for Human UAT.

## Problem and evidence

The shipped Firefox driver enables BiDi. Firefox ESR 140.15.0 Remote Agent
applies `focusmanager.testmode=true` unless explicitly overridden. In the
tested interactive X11 session, native IME focus is missing: `sendText()`
receives a successful engine ACK but normal editable fields receive no text.
Password fields are outside the `sendText()` contract and are not this bug.

The [local investigation](../tests/experiments/firefox-sendtext-2026-09-07/README.md)
records a same-profile `false → true → false` preference experiment: normal
input, textarea and contenteditable each received ASCII and Chinese text in
both false rounds (6/6), and none in the true round (0/6). RFB keys and BiDi
navigation/evaluation worked throughout. These are diagnostic observations,
not candidate acceptance evidence.

## Scope: FFX-007

- Set `user_pref("focusmanager.testmode", false);` in the Firefox driver's
  generated `user.js`, for both new and existing persistent profiles on launch.
- Retain BiDi, named dynamic loopback control allocation, status projection,
  and visible-window plus `session.status` readiness.
- Preserve 16-bit/5-fps display, singleton shared default profile, six-hour
  detached stop-instance policy, and all other Firefox template behavior.
- Keep SDK runtime behavior, IBus, App Package ABI V1, and other Apps
  unchanged. Manager changes are limited to RTM-017 below. Include the existing
  `sendText()` code/documentation clarification.
- Do not disable all Firefox recommended automation preferences, add automatic
  input retries/fallback, or treat password rejection as a defect.

## Verification and acceptance

RTM-017 restores pinned endpoint recovery without changing allocations: new
App allocation retains the conservative plain-bind test, while recovery of
the same pinned runtime checks bindability with `SO_REUSEADDR`. On Linux this
accepts closed reusable sockets but still rejects live listeners and sockets
whose prior listener did not enable reuse. Other runtime ownership remains
exclusive; no `SO_REUSEPORT`, protocol-specific handling or port substitution.
The App's normal readiness gate remains authoritative. Cover real kernel
TIME_WAIT with and without reuse, listener conflicts, ownership conflicts,
unchanged ports/identity, and real Firefox restart plus input readback.

1. Add a driver regression checking the explicit preference and retained BiDi
   launch/readiness/security contract; run focused checks and `make check`.
2. Test the exact packaged candidate locally: ordinary input, textarea and
   contenteditable, ASCII and non-ASCII `sendText()`, and physical RFB input.
   Assert actual application values, not just successful ACKs.
3. Cover fresh profile and reused profile previously set to `true`, Firefox
   session restart, complete runtime recreation, Viewer reconnect, and focus
   switching between tabs/windows and native browser chrome. Verify no text
   duplication or delivery to the wrong field.
4. Recheck loopback-only BiDi `session.status`, new session, navigation,
   evaluation and session end, plus returned control information. Exercise
   simultaneous BiDi control and interactive typing with deliberate focus.
5. Run the existing candidate release and target-like real-App gates, including
   Edge/Mousepad/LibreOffice input smoke. Record full commit, archive and App
   checksums, versions and application readbacks using the v1 evidence envelope.
6. Obtain Human UAT on the exact candidate before formal publication.

Follow [development quality](development-quality-process.md) and
[release policy](release-policy.md); no weakened or skipped release gates.

### Development gate finding, 2026-09-07 (UTC evidence: 2026-09-08)

Driver fix and preference-fixture tests are implemented. Fresh-profile and
recreated stale-profile Firefox tests each passed 36 exact application
readbacks, including tab/window focus, native chrome focus return, Viewer
reconnect and BiDi lifecycle. Immediate runtime restart then reproducibly
failed with HTTP 500: `pinned App resource "control" is invalid or busy`.
The pinned BiDi port had TIME_WAIT connections but no active listener; the
generic Manager allocation check treats this as busy. This is separate from
the IME fix and requires a Manager-scope decision, which the locked train
explicitly excludes. Do not omit this gate or deploy the candidate as ready.

The portable gate initially failed on a disk-full linker error. After moving
only completed experiment temporary data to volatile memory-backed retention,
`make check`, coverage (Go 56.9%; SDK lines 83.66%, branches 69.87%, functions
77.04%) and `make release-ci` passed. This was a development-worktree run,
not a clean immutable UAT candidate. See the
[portable recheck](private-history.md).
The live restart blocker remains unresolved and requires scope approval.
See [development evidence](private-history.md).
No local deployment has occurred; 1991 and 2991 remain healthy on 0.5.2.
At this historical gate, implementation was locally committed and publication
had not occurred; subsequent publication is recorded below.

This historical block was superseded by the operator's subsequent approval:
RTM-017 is now implemented and has passed complete candidate validation. The failed
evidence is retained and is not reclassified as a passing run.

## Local 1991 UAT handoff

Candidate commit: `2c3c962b44e8c08b3a7f946308ab711b06daef1f`.
Archive SHA-256: `33c5f35a81492b42823996b2392cafe7f777e72aee5ea8bfd858357a72c93a7f`.
The clean-clone candidate passed `make release-ci`, exact-archive synthetic
ABI and four-App E2E, plus host preflight. Focused real-kernel restart tests
passed 50 race-enabled repetitions. The linked-worktree build was rejected
for missing VCS stamps; it was never deployed. Accepted binaries embed the
exact commit and `vcs.modified=false`.

Local 1991 runs `0.5.3-rc.1`, SDK `0.21.1`, Firefox App `2.1.1`. Installed
and running bytes match the verified archive. Existing public test listen/auth
configuration is unchanged, as are the prior XFCE runtime ID, generation and
profile. Local 2991 remains `0.5.2`; no sandbox was touched.

Exact-candidate fresh, reused and restarted profiles passed 108 actual
ASCII/Chinese readbacks. Deployed startup and immediate restart added 72:
runtime `firefox-esr-EXAMPLE` retained control port `127.0.0.1:21000`
and advanced generation 1→2. Native keyboard, tabs/windows, focus return,
Viewer reconnect and BiDi lifecycle passed. Test Viewer was closed; this
dedicated `ffx007-uat` profile/runtime remains ready for the operator.

Open the local 1991 Console or
`/remotexapps/firefox-esr-EXAMPLE/kiosk.html`. Test English/Chinese input
and `sendText()` in the synthetic editable fields, switch windows, reconnect,
then use Console runtime restart and confirm input still works. Password
fields continue to require direct keyboard input, not `sendText()`.

Evidence: [candidate](private-history.md)
and [exact acceptance/deployment](private-history.md).
Human UAT was pending at this handoff and was subsequently accepted. The local
deployment remains the rc.1 artifact, not a formal stable fleet alignment.

## Formal publication, 2026-09-08

Human UAT accepted; [v0.5.3](private-history.md)
is a normal non-draft, non-prerelease Latest release. Stable commit
`1e4b32e54598b9c9e81ff65f2725deacea40a583` changes only promotion metadata and
acceptance documentation relative to the accepted runtime behavior.
Hosted Verify and candidate gates passed, then the downloaded candidate
passed exact-archive synthetic ABI and four-App E2E, including 108 Firefox
text readbacks over fresh, reused and restarted profiles.

Release workflow 34183810815 published candidate run 34183500632 without
rebuilding. Independent download matched the tested archive byte-for-byte:
SHA-256 `09d9108fe0c4f7cd7c3ce9f641e596222e7d6723910311a319ad672d1f4047a2`.
Firefox App 2.1.1's archive is unchanged from UAT; SDK remains 0.21.1.
See [exact validation](private-history.md)
and [publication evidence](private-history.md).
No deployment occurred during publication: local 1991 remains rc.1, and other
environments remain unchanged pending a separately approved alignment.

## Rollout and boundaries

### 2026-09-08 separately approved fleet alignment

The operator subsequently authorized all-environment deployment and old-runtime
replacement. The exact formal archive now supplies all eight Managers and
enabled Firefox App `2.1.1` selectors. Two Manager start/adoption checks passed
per endpoint before any runtime replacement; configurations and test/production
separation were preserved. All four installed executable files and the running
Manager match the formal artifact; SDK hashes match everywhere.

Normal stop/recreate completed for the local desktop, test-host-c/07 desktop
servers, and test-host-a Firefox, preserving persistent profiles. The local
desktop and test-host-a Firefox passed real RFB negotiation, 16-bit framebuffer,
and application-ready checks; Firefox reports working BiDi readiness and App
`2.1.1`. Previously dormant test-host-c/07 sessions remain on-attach.

test-host-a/03/10 desktops block graceful shutdown. They remain on old pinned
components with desired state restored to running, pending explicit permission
for forced exit. No unsaved state was forcibly discarded. Direct private HTTP
connectivity from the build host timed out; container-loopback verification
passed. Neither gateway nor firewall was changed. See
[evidence](private-history.md).

### 2026-09-08 approved runtime completion

The operator explicitly approved forceful replacement of the three remaining
blocked desktops, including possible unsaved-data loss. Fresh checks found
zero attached clients on each exact old runtime. Managed `force:true` stops
removed the old runtime manifests before desired state returned to running.
All three replacement desktops pin core `0.5.3`, retain user-home profiles,
and pass real RFB negotiation, fixed 1280x720/16-bit policy, XFCE ready, and
four-format bidirectional clipboard capability checks. No Manager restart,
firewall change, or gateway testing was needed. This supersedes the runtime
blocker above, not the unresolved external-network acceptance limitation.
See [completion evidence](private-history.md).

The changed driver requires a new immutable App Package version; never mutate
installed `firefox-esr@2.1.0` or a runtime pinned to it. Installing the package
alone does not update running Firefox. Adoption requires an approved complete
stop/recreate onto the new package, preserving the persistent profile; a
Manager restart alone is insufficient. Verify the runtime's actual package
version and preference after adoption. Retain the old package for rollback.

The original candidate authorization covered implementation, local tests and deployment only to
local 1991 for UAT, followed by separate stable tagging/publication approval.
Local 2991 deployment and sandbox deployments required the subsequent explicit
alignment approval recorded above. test-host-a staging and production always
require explicit human approval. Driver sandboxing and IME-004 stale
cross-application context protection remain separate work, not implicit scope.
