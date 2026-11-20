# P18: native Viewer retirement

Repeated native Viewer release left detached canvas/input trees retained by
BroadcastChannel callbacks and global Window listeners. SDK owner counters
returned to zero, so the initial functional harness passed while resource
review failed. The selected client patch closes owned channels, removes global
listeners and clears pending gesture/resize timers. Native server binaries and
libraries remain bit-identical to the verified parent component.

The [results](results.json) retain the original resource samples and failed
channels-only attempt. The [manifest](manifest.json) binds the result, patch and
current harness. Compare within-run deltas; the page's warm-up node count differs
between the diagnostic probes. The baseline and both twenty-cycle probes use
Core source `6c5e5309a947`; final qualification uses `89697ec59743` and the new
component. The harness gained resource assertions and another twenty-cycle
block after resource review found that owner counts alone were insufficient.

| Case | Released Viewers | Additional DOM nodes | Additional listeners |
| --- | --- | --- | --- |
| Original component | 20 | 300 | 240 |
| Channels-only repair, rejected | 20 | 300 | 220 |
| Complete repair on the same Core | 20 | 0 | 0 |
| Final qualified pair | 40 | 0 | 0 |

Provision the isolated native host from
[the recovery qualification](../../kasm-native/RECOVERY-EXPERIENCE-20261120.md)
with the exact Core/component pins and an owned Chrome CDP browser. Run the
following serially, without other suites using that container:

```sh
node tests/kasm-native/browser-recovery-cycles.mjs "$fixture"
```

Every cycle requires real paint before release. After warm-up and each block,
diagnostic GC precedes DOM/listener/heap sampling. One explicit background task
retains the App; there are zero Views/canvases and idle audio. Logout then releases
that last owner. Final DOM/listener values are 97/26 at all three samples; heap
is 1.732, 2.318 and 2.376 MiB. No forced-GC policy is added to ordinary clients.
This demonstrates removal of the identified retention roots, without proving
long-duration heap, CPU, PSS/RSS or arbitrary workload behavior.

The full native regression separately passes input/readback, clipboard, synthetic
audio, reconnect and UDP checks on the final pair. Owned test Apps/browsers are
closed and fault containers stopped. The original non-test Manager/display
identities remain unchanged; project-owned local UAT retains the qualified pair.
This is development acceptance of the resource repair, not human UAT or release.
