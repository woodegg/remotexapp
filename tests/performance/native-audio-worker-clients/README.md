# P20: bounded native audio Worker clients

[#110](https://github.com/woodegg/remotexapp/issues/110) follows the independent
[P19 AudioWorklet retirement](../native-audio-retirement/README.md) repair.
Closing an individual SharedWorker port can leave a native SharedWorkerClient
root alive for the shared runtime's lifetime. Repeating that construction for
each Host grows native wrappers even when its logical references were removed.

The selected worker-v6 architecture caches one native bootstrap per document,
canonical Manager base and worker generation. Each audio controller transfers
an independent disposable MessageChannel to the coordinator. The bootstrap
has no audio route/capture authority. Other controllers and documents retain
their own interests. One inert native bootstrap is deliberately retained for
the document; media WSS and native audio objects retain their separate all-off
and awaited retirement contracts.

Run equal owned-browser controls with the selected source and browser:

```sh
python3 tests/native-audio/browser-worker-hub-retirement.py \
  --browser /path/to/chrome --output /private/control --legacy
python3 tests/native-audio/browser-worker-hub-retirement.py \
  --browser /path/to/chrome --output /private/candidate
```

The harness serves only a temporary loopback test directory, loads the actual
product hub module, keeps another peer usable through fifty retirements, then
retires that peer and idles five seconds before the final native snapshot.
It performs no audio capture, does not enable CDP Network and does not close
the page to obtain its endpoint. Only its owned browser/server are cleaned up.
Raw heaps stay outside Git. `--legacy` changes the construction boundary to
one direct native SharedWorker client per owner, retaining the same logical
echo/disposal control.

| Chrome 149 endpoint | Direct native clients | Document bootstrap |
| --- | ---: | ---: |
| After fifty retirements with one live peer | 51 native clients / 51 ports | 1 native client / 2 ports |
| After final peer retirement and live idle | 51 / 51 | 1 / 1 |

These are browser-native client wrappers; the named shared runtime remains
one in both controls. They are not counts of Worker processes.

An actual supplied Chrome 158 source-module control independently returns
1/2 with a live peer and 1/1 after all logical peers retire. Its private source
and raw-report digests are bound in [results](results.json) and
[manifest](manifest.json). Audio object counts are zero because this minimal
mechanism probe does not create audio; it is not proof of full audio cleanup.

The first development callback closure shared a lexical environment with the
first logical client and retained its port. Moving native-hub creation into a
separate factory removed that root; retain this rejected observation. A
separate idle observer socket closure is not a product-media event.

Accepted scope is bounded native client construction in these controls. Actual
served SDK/Worker pairing, cross-tab speaker/mic continuity, Worker failover,
full resource trends, immutable archive and human UAT are separate gates.
Do not interpret counts as whole-browser RSS/PSS or zero-cost idle behavior.
