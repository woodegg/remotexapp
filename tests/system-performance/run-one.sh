#!/bin/sh
set -eu

manager_url=${BENCH_MANAGER_URL:-http://127.0.0.1:1991}
class_id=${1:?class id: mousepad or xfce-user-desktop}
label=${2:?result label}
output_dir=${BENCH_OUTPUT_DIR:-tests/system-performance/results}
cdp_port=${BENCH_CDP_PORT:-9235}
static_seconds=${BENCH_STATIC_SECONDS:-30}
input_requests=${BENCH_INPUT_REQUESTS:-600}
input_interval_ms=${BENCH_INPUT_INTERVAL_MS:-50}
scroll_seconds=${BENCH_SCROLL_SECONDS:-30}

case "$class_id" in
  mousepad) expect_resize=1 ;;
  xfce-user-desktop) expect_resize=0 ;;
  *) echo "unsupported benchmark class: $class_id" >&2; exit 2 ;;
esac

mkdir -p "$output_dir"
output_dir=$(realpath "$output_dir")
result_path="$output_dir/$label-$class_id.json"
node_result=$(mktemp "/tmp/remotexapp-system-bench-node.XXXXXX")
clipboard_result=$(mktemp "/tmp/remotexapp-system-bench-clipboard.XXXXXX")
chrome_profile=$(mktemp -d "/tmp/remotexapp-system-bench-chrome.XXXXXX")
chrome_log=$(mktemp "/tmp/remotexapp-system-bench-chrome-log.XXXXXX")
chrome_pid=""
instance_id=""
created_instance=false
benchmark_app_pid=""

cleanup() {
  trap - EXIT INT TERM
  if [ -n "$chrome_pid" ] && kill -0 "$chrome_pid" 2>/dev/null; then
    kill "$chrome_pid" 2>/dev/null || true
    wait "$chrome_pid" 2>/dev/null || true
  fi
  if [ -n "$benchmark_app_pid" ] && kill -0 "$benchmark_app_pid" 2>/dev/null; then
    kill "$benchmark_app_pid" 2>/dev/null || true
  fi
  if [ "$created_instance" = true ] && [ -n "$instance_id" ]; then
    curl -fsS -X POST "$manager_url/api/instances/$instance_id/stop" >/dev/null 2>&1 || true
  fi
  for temporary in "$node_result" "$clipboard_result" "$chrome_profile" "$chrome_log"; do
    if [ -e "$temporary" ]; then
      gio trash "$temporary" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT INT TERM

if ss -ltn | awk '{print $4}' | grep -Eq "(^|:)$cdp_port$"; then
  echo "CDP port already in use: $cdp_port" >&2
  exit 1
fi

manager_pid=$(ss -ltnp | sed -n "s/.*:${manager_url##*:} .*pid=\\([0-9][0-9]*\\).*/\\1/p" | head -n 1)
if [ -z "$manager_pid" ]; then
  manager_pid=$(pgrep -n -f 'remotexappd.*-listen.*1991' || true)
fi

create_started_ns=$(date +%s%N)
if [ "$class_id" = mousepad ]; then
  profile_ref="system-benchmark-$label"
  instance_json=$(curl -fsS -X POST -H 'Content-Type: application/json' \
    --data "{\"templateId\":\"mousepad\",\"profileRef\":\"$profile_ref\"}" \
    "$manager_url/api/instances")
  created_instance=true
else
  instance_json=$(curl -fsS "$manager_url/api/instances" | \
    jq -c '[.[] | select(.classId == "xfce-user-desktop" and (.state == "server-ready" or .state == "ready"))][0]')
  if [ "$instance_json" = null ] || [ -z "$instance_json" ]; then
    echo "xfce-user-desktop singleton is not running" >&2
    exit 1
  fi
fi
create_finished_ns=$(date +%s%N)
instance_id=$(printf '%s' "$instance_json" | jq -r '.id')

instance_json=$(curl -fsS "$manager_url/api/instances/$instance_id")
display=$(printf '%s' "$instance_json" | jq -r '.display')
home_path=$(printf '%s' "$instance_json" | jq -r '.homePath')
runtime_path=$(printf '%s' "$instance_json" | jq -r '.runtimePath')
socket_runtime_path=$(printf '%s' "$instance_json" | jq -r '.socketRuntimePath')
vnc_unit=$(printf '%s' "$instance_json" | jq -r '.vncUnit')
server_unit=$(printf '%s' "$instance_json" | jq -r '.serverUnit // empty')
gateway_unit=$(printf '%s' "$instance_json" | jq -r '.gatewayUnit')
session_unit=$(printf '%s' "$instance_json" | jq -r '.sessionUnit')
user_cgroup=/sys/fs/cgroup/user.slice/user-1000.slice/user@1000.service/app.slice
vnc_cgroup="$user_cgroup/$vnc_unit"
server_cgroup=""
if [ -n "$server_unit" ]; then server_cgroup="$user_cgroup/$server_unit"; fi
gateway_cgroup="$user_cgroup/$gateway_unit"
session_cgroup="$user_cgroup/$session_unit"
viewer_url="$manager_url/remotexapps/$instance_id/kiosk.html"

google-chrome \
  --headless=new \
  --disable-background-networking \
  --disable-default-apps \
  --disable-extensions \
  --disable-sync \
  --metrics-recording-only \
  --no-first-run \
  --no-default-browser-check \
  --remote-debugging-port="$cdp_port" \
  --window-size=1280,720 \
  --user-data-dir="$chrome_profile" \
  "$viewer_url" >"$chrome_log" 2>&1 &
chrome_pid=$!

attach_started_ns=$(date +%s%N)
attached=false
for _ in $(seq 1 300); do
  current=$(curl -fsS "$manager_url/api/instances/$instance_id")
  if [ "$(printf '%s' "$current" | jq -r '.attachedClients')" -gt 0 ] && \
     [ "$(printf '%s' "$current" | jq -r '.sessionState')" = running ]; then
    attached=true
    break
  fi
  if ! kill -0 "$chrome_pid" 2>/dev/null; then
    echo "Chrome exited before RFB attach; log: $chrome_log" >&2
    exit 1
  fi
  sleep 0.1
done
attach_finished_ns=$(date +%s%N)
if [ "$attached" != true ]; then
  echo "instance did not attach and start its session" >&2
  exit 1
fi

# The Full XFCE template intentionally launches only the desktop. Start the
# same benchmark editor with the session environment so the full-desktop
# workload has a real focused application. The harness tracks this short-lived
# process separately and adds its PSS/CPU to the comparison; normal product
# launch behavior is unchanged.
if [ "$class_id" = xfce-user-desktop ]; then
  for _ in $(seq 1 100); do
    [ -s "$runtime_path/session-dbus-address" ] && break
    sleep 0.05
  done
  session_bus=$(cat "$runtime_path/session-dbus-address")
  benchmark_xdg="$chrome_profile/xfce-benchmark-app"
  mkdir -p "$benchmark_xdg/config" "$benchmark_xdg/cache" "$benchmark_xdg/data"
  env DISPLAY="$display" XAUTHORITY="$home_path/.Xauthority" HOME="$home_path" \
    XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/1000}" \
    XDG_CONFIG_HOME="$benchmark_xdg/config" \
    XDG_CACHE_HOME="$benchmark_xdg/cache" \
    XDG_DATA_HOME="$benchmark_xdg/data" \
    DBUS_SESSION_BUS_ADDRESS="$session_bus" \
    IBUS_ADDRESS="unix:path=$socket_runtime_path/ibus.sock" \
    GTK_IM_MODULE=ibus QT_IM_MODULE=ibus XMODIFIERS=@im=ibus \
    mousepad --disable-server >/dev/null 2>&1 &
  benchmark_app_pid=$!
  app_ready=false
  for _ in $(seq 1 200); do
    benchmark_window=""
    client_ids=$(env DISPLAY="$display" XAUTHORITY="$home_path/.Xauthority" \
      xprop -root _NET_CLIENT_LIST 2>/dev/null | sed 's/^[^#]*#//' | tr ',' ' ')
    for candidate in $client_ids; do
      if env DISPLAY="$display" XAUTHORITY="$home_path/.Xauthority" \
        xprop -id "$candidate" WM_CLASS 2>/dev/null | grep -q '"Mousepad"'; then
        candidate_height=$(env DISPLAY="$display" XAUTHORITY="$home_path/.Xauthority" \
          xwininfo -id "$candidate" 2>/dev/null | awk '$1=="Height:"{print $2}')
        if [ "${candidate_height:-0}" -ge 300 ]; then
          benchmark_window=$candidate
          break
        fi
      fi
    done
    if [ -n "$benchmark_window" ]; then
      app_ready=true
      break
    fi
    if ! kill -0 "$benchmark_app_pid" 2>/dev/null; then
      echo "XFCE benchmark Mousepad exited before its window became ready" >&2
      exit 1
    fi
    sleep 0.05
  done
  if [ "$app_ready" != true ]; then
    echo "XFCE benchmark Mousepad window did not become ready" >&2
    exit 1
  fi
  env DISPLAY="$display" XAUTHORITY="$home_path/.Xauthority" \
    xdotool windowfocus --sync "$benchmark_window"
fi

BENCH_MANAGER_URL="$manager_url" \
BENCH_INSTANCE_ID="$instance_id" \
BENCH_CDP_PORT="$cdp_port" \
BENCH_MANAGER_PID="$manager_pid" \
BENCH_APP_PID="$benchmark_app_pid" \
BENCH_VNC_CGROUP="$vnc_cgroup" \
BENCH_SERVER_CGROUP="$server_cgroup" \
BENCH_GATEWAY_CGROUP="$gateway_cgroup" \
BENCH_SESSION_CGROUP="$session_cgroup" \
BENCH_STATIC_SECONDS="$static_seconds" \
BENCH_INPUT_REQUESTS="$input_requests" \
BENCH_INPUT_INTERVAL_MS="$input_interval_ms" \
BENCH_SCROLL_SECONDS="$scroll_seconds" \
BENCH_EXPECT_RESIZE="$expect_resize" \
node tests/system-performance/measure-cdp.mjs >"$node_result"

clipboard_ok=false
if [ "${BENCH_DIAG_NATIVE_COPY:-0}" = 1 ] && [ "$class_id" = xfce-user-desktop ]; then
  env DISPLAY="$display" XAUTHORITY="$home_path/.Xauthority" \
    xdotool key --window "$benchmark_window" ctrl+a ctrl+c
  sleep 0.25
fi
if timeout 3 env DISPLAY="$display" XAUTHORITY="$home_path/.Xauthority" \
  xclip -selection clipboard -target UTF8_STRING -o >"$clipboard_result" 2>/dev/null; then
  clipboard_sha=$(sha256sum "$clipboard_result" | awk '{print $1}')
  expected_sha=$(jq -r '.expected.sha256' "$node_result")
  if [ "$clipboard_sha" = "$expected_sha" ]; then clipboard_ok=true; fi
else
  clipboard_sha=""
fi

runtime_hashes=$(jq -n \
  --arg manager "$(sha256sum "/proc/$manager_pid/exe" | awk '{print $1}')" \
  --arg gateway "$(gateway_pid=$(head -n 1 "$gateway_cgroup/cgroup.procs"); sha256sum "/proc/$gateway_pid/exe" | awk '{print $1}')" \
  '{manager:$manager,gateway:$gateway}')

jq -n \
  --arg label "$label" \
  --arg classId "$class_id" \
  --arg instanceId "$instance_id" \
  --arg collectedAt "$(date --iso-8601=seconds)" \
  --arg display "$display" \
  --argjson createMs "$(((create_finished_ns-create_started_ns)/1000000))" \
  --argjson attachToSessionMs "$(((attach_finished_ns-attach_started_ns)/1000000))" \
  --arg clipboardSha256 "$clipboard_sha" \
  --argjson clipboardExact "$clipboard_ok" \
  --argjson runtimeHashes "$runtime_hashes" \
  --slurpfile measurement "$node_result" \
  '{schemaVersion:1,label:$label,classId:$classId,instanceId:$instanceId,collectedAt:$collectedAt,
    display:$display,createOrLookupMs:$createMs,attachToSessionMs:$attachToSessionMs,
    clipboard:{exact:$clipboardExact,sha256:$clipboardSha256},runtimeHashes:$runtimeHashes,
    measurement:$measurement[0]}' >"$result_path"

cat "$result_path"

kill "$chrome_pid" 2>/dev/null || true
wait "$chrome_pid" 2>/dev/null || true
chrome_pid=""

if [ "$created_instance" = true ]; then
  curl -fsS -X POST "$manager_url/api/instances/$instance_id/stop" >/dev/null
  for _ in $(seq 1 100); do
    if ! stopped_json=$(curl -fsS "$manager_url/api/instances/$instance_id" 2>/dev/null); then break; fi
    if [ "$(printf '%s' "$stopped_json" | jq -r '.state')" = stopped ]; then break; fi
    sleep 0.1
  done
  created_instance=false
else
  for _ in $(seq 1 200); do
    state=$(curl -fsS "$manager_url/api/instances/$instance_id" | jq -r '.sessionState')
    if [ "$state" = stopped ]; then break; fi
    sleep 0.1
  done
fi
