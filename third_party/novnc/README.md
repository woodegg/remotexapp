# Vendored noVNC

This directory contains the complete `core/` and `vendor/` trees from the
stable upstream release recorded in `UPSTREAM.json`. RemoteXApp bundles these
sources into its embedded browser assets; production hosts do not load them
from the filesystem.

Do not edit upstream files locally. Keep RemoteXApp-specific integration in
`cmd/remotexappd/web/assets-src/novnc-entry.js` and
`novnc-resize-bridge.mjs`. Import a newer stable release with:

```bash
./scripts/update-novnc.sh 1.7.1
make check
```

Review the upstream release notes, the vendored source diff, generated asset
size, and the browser/IME regression matrix before merging. The update script
records the peeled Git tag commit and downloaded archive checksum. Licenses
and attribution shipped by upstream are retained in this directory.
