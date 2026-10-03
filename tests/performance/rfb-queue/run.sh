#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)
cd "$project_root"

for capacity in 256 8 1; do
  RFB_QUEUE_CAPACITY=$capacity \
    go test -tags rfbqueueexperiment ./cmd/novnc-input \
      -run '^TestRFBCompatSlowClientExperiment$' -count=1 -v
done
