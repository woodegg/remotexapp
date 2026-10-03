#!/bin/sh
# Minimal, deterministic text-entry target for RFB/input A/B testing.
set -eu

matchbox-window-manager -use_titlebar no &
exec mousepad --disable-server
