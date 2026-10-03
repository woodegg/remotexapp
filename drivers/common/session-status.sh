#!/bin/sh

# Shared application-status adapter for session drivers whose class declares:
#
#   "status": { "mode": "driver", ... }
#
# Source this helper; do not execute it. remotexappd creates the initial status
# envelope and schema before the driver starts. The helper enforces that every
# report belongs to the current session generation and delegates validation and
# atomic writes to remotexapp-status.
: "${REMOTEXAPP_STATUS_PATH:?}"
: "${REMOTEXAPP_STATUS_SCHEMA:?}"
: "${REMOTEXAPP_STATUS_HELPER:?}"
: "${REMOTEXAPP_SESSION_GENERATION:?}"

session_status_report() {
  "$REMOTEXAPP_STATUS_HELPER" \
    --path "$REMOTEXAPP_STATUS_PATH" \
    --schema "$REMOTEXAPP_STATUS_SCHEMA" \
    --generation "$REMOTEXAPP_SESSION_GENERATION" \
    --connection-metadata \
    "$@"
}
