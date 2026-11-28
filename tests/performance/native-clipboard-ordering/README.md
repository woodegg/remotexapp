# P21: native clipboard destination ordering (planned)

Issue #119 selects atomic native admission for the unannounced remote-owner
race. [Results](results.json) are explicitly pending; this is not in the completed
experiment register. [Manifest](manifest.json) pins the current proposed inputs.
The [contract](../../../docs/native-clipboard-ordering.md) defines the invariant.

Hold runtime, synthetic content, browser and observation settings fixed while
comparing ordinary unconditional submission with the new admission strategy.
The baseline must reproduce destination loss; a green ordinary sequential copy
does not reproduce it. Keep the earlier prototype build failure separately.

Measure actual X11 owner/snapshot/INCR timing, native admission and destination
readback. Include two Viewers and repeated same-owner A-B-A. Freeze/stall a test
receiver while producing rapid owner changes: count wire metadata, pending state
and queues, then verify current data on resume. One unacknowledged notification,
one admission and bounded input are acceptance constraints, not measured savings.

Throttle only an owned fixture to exercise large representations and verify
fresh paste, finite deadlines and cancellation. Keep browser I/O, transfer and
input budgets distinct. Confirm idle traffic, normal latency probes and unrelated
audio/display routes. No payload, digest or address belongs in public diagnostics.

Sample ownership-verified PSS/anonymous PSS/SwapPss/RSS, heap/DOM/listeners, FDs,
buffers and channel counts without periodic GC in natural runs. Keep native
retirement diagnostics separate. Report startup/steady/peak/tail and failed
attempts; neither a low final RSS nor a fixed object count proves leak freedom.
Complete real native, natural/stress and final-candidate gates before recording
an outcome in the completed register. Models and a successfully compiled component
are separate evidence, not this experiment's acceptance.
