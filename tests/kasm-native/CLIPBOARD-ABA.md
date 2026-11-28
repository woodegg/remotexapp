# Native clipboard A-B-A known failure

Issue [#117](https://github.com/woodegg/remotexapp/issues/117) tracks this unfixed
SDK state-machine defect. The tests use actual `NativeClipboard` with synthetic
browser/display APIs and content; they do not mutate an OS clipboard or prove
the cause of a particular WeChat incident. No timing sleeps or large payloads
are needed to reproduce it.

1. Acquire the focused clipboard baseline and enable both directions.
2. Copy local A; sync uploads A. Its immediate server echo is correctly ignored.
3. Copy remote B; sync writes B locally.
4. Copy remote A again. Expected: local becomes A, without an upload loop.
   Current: `lastSent` still contains the earlier A, so `offer()` ignores the
   legitimate new A. Local stays B.
5. Explicit paste can now upload the stale B and overwrite remote A.

The stable tests are in
[`native-clipboard.test.mjs`](../../cmd/remotexappd/web/sdk/native-clipboard.test.mjs).
They assert the **desired** behavior for plain text, HTML plus text, PNG plus
text and the subsequent paste. PNG is a representation-identity control, not
image decoding, normalization or a physical browser image test. A separate
passing control checks genuine echo suppression and later distinct delivery.

Run the unresolved assertions as strict red tests:

```sh
REMOTEXAPP_TEST_CLIPBOARD_ABA=1 node --test \
  cmd/remotexappd/web/sdk/native-clipboard.test.mjs
```

On the unfixed implementation this exits nonzero with four failed desired
assertions. Without the variable, the regular suite reports those four as TODO,
not successful regressions; existing controls still fail normally if broken.
This keeps the defect visible without falsely changing its status to fixed or
breaking unrelated CI work. A repair must remove `knownABA`/the TODO options,
pass the strict assertions, retain ordinary echo suppression and test delayed
self-echo, focus/reset/reconnect, concurrent changes and real browser/X11
delivery. Do not weaken the assertions to expect B or classify every later
same-value copy as an old echo.
