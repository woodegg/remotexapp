#!/bin/sh
set -eu

: "${REMOTEXAPP_PARAMETERS:?}"
: "${REMOTEXAPP_RUNTIME:?}"

document_path=$(/usr/bin/jq -er 'if has("filePath") then .filePath | strings | select(length > 0) else "" end' "$REMOTEXAPP_PARAMETERS")
document_lock=""
if [ -n "$document_path" ]; then
case "$document_path" in
  /*) ;;
  *) printf '%s\n' 'LibreOffice filePath is not absolute' >&2; exit 1 ;;
esac
document_lock=$(dirname -- "$document_path")/.~lock.$(basename -- "$document_path")#
fi

pid=$(cat "$REMOTEXAPP_RUNTIME/libreoffice-process.pid" 2>/dev/null || true)
case "$pid" in
  ''|*[!0-9]*) pid="" ;;
esac

if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
  kill -KILL "$pid"
  attempts=50
  while [ "$attempts" -gt 0 ] && kill -0 "$pid" 2>/dev/null; do
    attempts=$((attempts - 1))
    sleep 0.1
  done
  if kill -0 "$pid" 2>/dev/null; then
    printf 'LibreOffice process did not exit after SIGKILL: %s\n' "$pid" >&2
    exit 1
  fi
fi

if [ -e "$document_lock" ] || [ -L "$document_lock" ]; then
  if ! rm -f -- "$document_lock"; then
    printf 'Unable to remove LibreOffice document lock: %s\n' "$document_lock" >&2
    exit 1
  fi
fi
if [ -e "$document_lock" ] || [ -L "$document_lock" ]; then
  printf 'LibreOffice document lock remains after cleanup: %s\n' "$document_lock" >&2
  exit 1
fi
