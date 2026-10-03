#!/bin/sh
set -eu

: "${REMOTEXAPP_RUNTIME:?}"
: "${REMOTEXAPP_PARAMETERS:?}"
: "${REMOTEXAPP_STATUS_PATH:?}"
: "${REMOTEXAPP_DRIVER_CONFIG:?}"
: "${REMOTEXAPP_RESOURCES:?}"
: "${REMOTEXAPP_CORE_DRIVER_DIR:?}"
: "${HOME:?}"

umask 077
profile_dir="$HOME/.mozilla/firefox-remote"
mkdir -p "$REMOTEXAPP_RUNTIME" "$profile_dir"

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
[ "${REMOTEXAPP_SESSION_SERVICES:-}" = core-v1 ] || { echo "Core session services required" >&2; exit 1; }
. "$REMOTEXAPP_CORE_DRIVER_DIR/session-status.sh"

wm_pid=""
firefox_pid=""
shutdown_requested=false

cleanup() {
  trap - EXIT INT TERM
  for child_pid in "$firefox_pid" "$wm_pid"; do
    if [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; then
      kill "$child_pid" 2>/dev/null || true
    fi
  done
  for _ in $(seq 1 10); do
    if { [ -z "$firefox_pid" ] || ! kill -0 "$firefox_pid" 2>/dev/null; } && \
       { [ -z "$wm_pid" ] || ! kill -0 "$wm_pid" 2>/dev/null; }; then
      break
    fi
    sleep 0.1
  done
  for child_pid in "$firefox_pid" "$wm_pid"; do
    if [ -n "$child_pid" ] && kill -0 "$child_pid" 2>/dev/null; then
      kill -KILL "$child_pid" 2>/dev/null || true
    fi
  done

  rm -f "$REMOTEXAPP_RUNTIME/firefox-esr.pid" \
    "$REMOTEXAPP_RUNTIME/firefox-esr-process.pid"
}
request_shutdown() {
  shutdown_requested=true
  cleanup
}
trap cleanup EXIT
trap request_shutdown INT TERM

control_address=$(/usr/bin/jq -er '.control.address | select(. == "127.0.0.1")' "$REMOTEXAPP_RESOURCES")
control_port=$(/usr/bin/jq -er '.control.port | select(type == "number" and . >= 1024 and . <= 65535)' "$REMOTEXAPP_RESOURCES")
control_path=$(/usr/bin/jq -er '.path | select(. == "/session")' "$REMOTEXAPP_DRIVER_CONFIG")
control_protocol=$(/usr/bin/jq -er '.protocol | select(. == "webdriver-bidi")' "$REMOTEXAPP_DRIVER_CONFIG")
if [ "$control_address" != "127.0.0.1" ]; then
  printf '%s\n' 'Firefox WebDriver BiDi control address must be 127.0.0.1' >&2
  exit 1
fi
case "$control_port" in
  ''|*[!0-9]*) printf '%s\n' 'invalid Firefox WebDriver BiDi control port' >&2; exit 1 ;;
esac
if [ "$control_port" -lt 1024 ] || [ "$control_port" -gt 65535 ]; then
  printf '%s\n' 'Firefox WebDriver BiDi control port is outside the allowed range' >&2
  exit 1
fi
control_url="ws://$control_address:$control_port$control_path"
control_json=$(/usr/bin/jq -cn \
  --arg protocol "$control_protocol" \
  --arg address "$control_address" \
  --argjson port "$control_port" \
  --arg webSocketUrl "$control_url" \
  '{protocol:$protocol,address:$address,port:$port,endpoints:{webSocketUrl:$webSocketUrl}}')

start_url=$(/usr/bin/jq -er '.startUrl | strings' "$REMOTEXAPP_PARAMETERS")

session_status_report --state loading --summary "Preparing Firefox ESR session" \
  --detail-string application=firefox-esr \
  --detail-json "control=$control_json"


matchbox-window-manager -use_titlebar no >"$REMOTEXAPP_RUNTIME/matchbox.log" 2>&1 &
wm_pid=$!

# Package updates remain the host administrator's responsibility. These
# preferences suppress first-run and background product prompts inside the
# dedicated RemoteXApp profile without weakening normal web security.
cat >"$profile_dir/user.js" <<'EOF'
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("toolkit.telemetry.enabled", false);
// BiDi's recommended test focus mode skips native widget focus updates.
// Keep native IME focus for interactive viewers while retaining BiDi control.
user_pref("focusmanager.testmode", false);
EOF

# Ubuntu ESR package builds may put the ESR train in application.ini's
# RemotingName, which also changes X11 WM_CLASS after every train upgrade.
# Firefox supports this runtime override; keep the input focus contract stable.
MOZ_APP_REMOTINGNAME=firefox-esr \
MOZ_CRASHREPORTER_DISABLE=1 MOZ_ENABLE_WAYLAND=0 \
  /usr/bin/firefox-esr \
    --no-remote \
    --new-instance \
    --profile "$profile_dir" \
    --remote-debugging-port "$control_port" \
    "$start_url" >"$REMOTEXAPP_RUNTIME/firefox-esr.log" 2>&1 &
firefox_pid=$!
printf '%s\n' "$firefox_pid" >"$REMOTEXAPP_RUNTIME/firefox-esr-process.pid"

window_ready=false
control_ready=false
for _ in $(seq 1 300); do
  if [ -n "$(xdotool search --onlyvisible --pid "$firefox_pid" 2>/dev/null || true)" ]; then
    window_ready=true
  fi
  if /usr/bin/python3 "$script_dir/probe.py" "$control_address" "$control_port" >/dev/null 2>&1; then
    control_ready=true
  fi
  if [ "$window_ready" = true ] && [ "$control_ready" = true ]; then
    break
  fi
  if ! kill -0 "$firefox_pid" 2>/dev/null; then
    printf '%s\n' 'Firefox ESR exited before its browser window became ready' >&2
    exit 1
  fi
  sleep 0.1
done
if [ "$window_ready" != true ] || [ "$control_ready" != true ]; then
  printf '%s\n' 'Firefox ESR browser window or WebDriver BiDi control did not become ready' >&2
  exit 1
fi

# Publish the stable session-owner process only after a PID-owned visible
# window exists and the BiDi endpoint answers session.status. The browser PID
# remains private to application-specific shutdown logic.
printf '%s\n' "$$" >"$REMOTEXAPP_RUNTIME/firefox-esr.pid"
session_status_report --state ready --summary "Firefox ESR is ready" \
  --detail-string application=firefox-esr \
  --detail-json "control=$control_json"

set +e
wait "$firefox_pid"
exit_code=$?
set -e

if [ "$shutdown_requested" = true ]; then
  exit 0
fi
if [ "$exit_code" -eq 0 ]; then
  session_status_report --state exited --summary "Firefox ESR exited" \
    --detail-string application=firefox-esr \
    --detail-json "control=$control_json"
else
  session_status_report --state error --summary "Firefox ESR exited unexpectedly" \
    --error "Firefox ESR exit code $exit_code" \
    --detail-string application=firefox-esr \
    --detail-json "control=$control_json"
fi
exit "$exit_code"
