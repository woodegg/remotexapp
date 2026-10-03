#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
runtime_dir="${NOVNC_TEST_RUNTIME_DIR:-${root_dir}/.runtime/novnc-matchbox}"
display_file="$runtime_dir/display"
backend_file="$runtime_dir/backend"
backend="x11vnc"
[[ -f "$backend_file" ]] && backend="$(<"$backend_file")"

# LibreOffice detaches from the X session, so stop only the processes belonging
# to this test's disposable profiles before destroying its VNC display.
while read -r office_pid; do
  kill "$office_pid" 2>/dev/null || true
done < <(ps -eo pid=,args= | awk -v marker="$runtime_dir/libreoffice-profile." \
  'index($0, marker) && /soffice\.bin/ { print $1 }')

while read -r browser_pid; do
  kill "$browser_pid" 2>/dev/null || true
done < <(ps -eo pid=,comm=,args= | awk -v script="$root_dir/tests/novnc-matchbox/minimal-browser.py" \
  '$2 == "python3" && index($0, script) { print $1 }')

for process_name in app slide-counter novnc-input websockify websockify-ab x11vnc xvfb; do
  process_file="$runtime_dir/${process_name}.pid"
  if [[ -f "$process_file" ]]; then
    process_pid="$(<"$process_file")"
    if kill -0 "$process_pid" 2>/dev/null; then
      kill "$process_pid"
    fi
    unlink "$process_file"
  fi
done

if [[ -f "$display_file" ]]; then
  vnc_display="$(<"$display_file")"
  display_number="${vnc_display#:}"
  if [[ "$backend" == "tigervnc" ]]; then
    tigervncserver -kill "$vnc_display" || true
  fi
  unlink "$display_file"
  if [[ "$backend" == "x11vnc" ]]; then
    # Xvfb normally removes these. Clear only this test display's stale socket
    # after its recorded process has been stopped.
    if [[ -S "/tmp/.X11-unix/X${display_number}" ]]; then
      unlink "/tmp/.X11-unix/X${display_number}"
    fi
    if [[ -f "/tmp/.X${display_number}-lock" ]]; then
      unlink "/tmp/.X${display_number}-lock"
    fi
  fi
fi
if [[ -f "$backend_file" ]]; then
  unlink "$backend_file"
fi
