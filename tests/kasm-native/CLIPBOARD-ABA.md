# Native clipboard A-B-A regression

Issue [#117](https://github.com/woodegg/remotexapp/issues/117) records the original
SDK stale-echo defect; [#119](https://github.com/woodegg/remotexapp/issues/119) now
owns systematic repair/qualification. Tests use actual NativeClipboard with
synthetic browser/display APIs and content. They do not mutate an OS clipboard
or prove a particular WeChat incident's cause.

1. Enable both directions and acquire the focused baseline.
2. Copy local A; sync uploads A. An immediate actual echo is a no-op.
3. Copy remote B; sync writes B locally.
4. Copy remote A again. Expected: local becomes A without an upload loop.
   The old lastSent marker ignored this new A, leaving local B.
5. A later explicit paste could upload stale B and overwrite remote A.

The development repair removes permanent payload-based echo suppression. Actual
local-value/baseline comparison suppresses no-op echoes and protects concurrent
local copies; a new remote A replaces an older pending B. Run the mandatory tests:

```sh
node --test cmd/remotexappd/web/sdk/native-clipboard.test.mjs \
  cmd/remotexappd/web/sdk/native-clipboard-data.test.mjs
```

There are no A-B-A TODOs or opt-in flags now. The original d4eecb4 reproduction
had four desired assertions marked TODO by default and a strict environment flag
that produced four failures. That historical mode is not the current gate.
Current cases cover text, HTML plus text, PNG plus text, the subsequent paste,
rapid B/A offers, A arriving during B's delivery, a conflicting new local copy
and 100 repeated remote cycles. The genuine-echo controls must still pass.
PNG here tests representation identity, not decoding or a physical image copy.

[Real Chrome/X11 old/new control](../native-audio/results-clipboard-aba-20261128.json)
reproduces stale overwrite on the original SDK and passes on the development
module with 20 further cycles. It deliberately uses the same archived Core/Kasm
pair while changing the served SDK; it is not exact-release qualification.
Final immutable-candidate browser/format/normalization/size/multi-owner and
combined-fault qualification remains part of #119. Do not weaken assertions to
expect stale B or infer that the distinct concurrent-upload race is fixed.
