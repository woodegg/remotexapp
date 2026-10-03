# P07 bundled web-asset experiment

This directory reproduces the controlled comparison behind the bundled,
content-hashed SDK/noVNC assets served by `remotexappd`.

## Scope

The baseline and candidate use the same accepted P01/P03 Mousepad server,
P05 capacity-8 RFB relay, P06 SDK behavior, display geometry/depth/frame rate,
TigerVNC session and warmed application. The only primary variable is browser
static-asset delivery:

- baseline: the SDK and installed noVNC source module graph;
- candidate: one minified SDK bundle, one lazily loaded noVNC bundle, and a
  41-byte stable `/sdk/index.js` loader.

Both managers run on isolated port 1992 and use separate state directories.
The live port-1991 process is not rebuilt or restarted.

## Build

`make web-assets` runs the vendored-source compatibility check and
`scripts/build-web-assets.mjs`. It requires Node and `esbuild` at build time;
the noVNC source and exact upstream provenance are in `third_party/novnc/`.
The generated files and manifest live in `cmd/remotexappd/web/assets/` and are
embedded in the Go manager binary. Runtime clients do not invoke Node or
esbuild.

The accepted 2026-08-27 measurements below used Debian noVNC `1:1.3.0-2` and
remain historical P07 evidence. The current vendored noVNC `v1.7.0` bundle is
189,149 bytes before HTTP compression versus the recorded 150,961-byte P07
bundle. Treat this new value as the upgrade baseline and repeat the five-profile
measurement before claiming a new transfer or connection-time improvement.

The stable loader is served with `Cache-Control: no-cache` and an ETag. Its
content-hashed dependencies are allow-listed from the embedded manifest and
served with `Cache-Control: public, max-age=31536000, immutable` plus ETags.
Unbundled `/sdk/`, `/core/`, and `/vendor/` paths remain available for source
diagnostics but are no longer on the normal viewer path.

## Reproduction

Open an already-warmed isolated viewer in a fresh Chrome profile with remote
debugging enabled, then run:

```bash
P07_CDP_PORT=9225 node tests/performance/assets-bundle/measure-load-cdp.mjs
```

The script records the fresh-profile load and one same-profile reload. Repeat
in five independent profiles for each build; do not count the first attachment
that starts Mousepad. To verify SDK text and reconnection behavior:

```bash
P07_CDP_PORT=9225 node tests/performance/assets-bundle/verify-interaction-cdp.mjs
```

The interaction harness sends mixed Unicode/ASCII text, deliberately
disconnects and reconnects the SDK client, then sends more text. The accepted
run additionally selected all in Mousepad and read the X11 clipboard to prove
the exact final application text. `xdotool` and `xclip` were test probes only;
they are not in the runtime input path.

## Accepted result

Five independent fresh Chrome profiles produced these medians over local HTTP:

| Metric | Source modules | Bundled assets | Change |
|---|---:|---:|---:|
| Fresh-profile connection | 537.6 ms | 387.5 ms | -27.9% |
| Same-profile reload connection | 129.7 ms | 78.2 ms | -39.7% |
| Static requests | 45 | 3 | -93.3% |
| Fresh-profile static transfer | 551,233 B | 181,399 B | -67.1% |
| Reload static transfer | 45,181 B | 300 B | -99.3% |

The candidate committed `P07 中文 input`, explicitly disconnected, restored
both RFB and input channels in 40.8 ms, committed ` reconnect OK`, and yielded
the exact Mousepad clipboard value `P07 中文 input reconnect OK`. The two
server acknowledgements took 7.876 ms and 2.461 ms.

Machine-readable samples are in
[`results-2026-08-27.json`](results-2026-08-27.json). The candidate is accepted
in repository source. A manager already running from an older binary continues
to serve its embedded source graph until it is deliberately rebuilt/restarted.
