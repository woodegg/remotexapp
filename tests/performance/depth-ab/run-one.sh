#!/bin/sh
set -eu

manager_url=${1:?manager URL}
instance_id=${2:?instance ID}

instance_json=$(curl -fsS "$manager_url/api/instances/$instance_id")
display=$(printf '%s' "$instance_json" | jq -r '.display')
home_path=$(printf '%s' "$instance_json" | jq -r '.homePath')
runtime_path=$(printf '%s' "$instance_json" | jq -r '.runtimePath')
vnc_unit=$(printf '%s' "$instance_json" | jq -r '.vncUnit')
gateway_unit=$(printf '%s' "$instance_json" | jq -r '.gatewayUnit')

user_cgroup=/sys/fs/cgroup/user.slice/user-1000.slice/user@1000.service/app.slice
vnc_cgroup="$user_cgroup/$vnc_unit"
gateway_cgroup="$user_cgroup/$gateway_unit"
health_url="$manager_url/remotexapps/$instance_id/healthz"
viewer_url="$manager_url/remotexapps/$instance_id/kiosk.html"
chrome_profile="$runtime_path/headless-chrome-profile"
chrome_pid=""

cleanup() {
  trap - EXIT INT TERM
  if [ -n "$chrome_pid" ] && kill -0 "$chrome_pid" 2>/dev/null; then
    kill "$chrome_pid" 2>/dev/null || true
    wait "$chrome_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

mkdir -p "$chrome_profile"
google-chrome \
  --headless=new \
  --disable-background-networking \
  --disable-default-apps \
  --disable-extensions \
  --disable-sync \
  --metrics-recording-only \
  --no-first-run \
  --no-default-browser-check \
  --window-size=1280,720 \
  --user-data-dir="$chrome_profile" \
  "$viewer_url" \
  >"$runtime_path/headless-chrome.log" 2>&1 &
chrome_pid=$!

attached=false
for _ in $(seq 1 200); do
  current=$(curl -fsS "$manager_url/api/instances/$instance_id")
  if [ "$(printf '%s' "$current" | jq -r '.attachedClients')" -gt 0 ] && \
     [ "$(printf '%s' "$current" | jq -r '.sessionState')" = running ]; then
    attached=true
    break
  fi
  if ! kill -0 "$chrome_pid" 2>/dev/null; then
    echo "headless Chrome exited before RFB attach" >&2
    exit 1
  fi
  sleep 0.1
done
if [ "$attached" != true ]; then
  echo "headless noVNC client did not attach" >&2
  exit 1
fi

sleep 2

cpu_usage() {
  awk '$1=="usage_usec"{print $2}' "$1/cpu.stat"
}

health_before_static=$(curl -fsS "$health_url")
vnc_cpu_before_static=$(cpu_usage "$vnc_cgroup")
gateway_cpu_before_static=$(cpu_usage "$gateway_cgroup")
memory_current=$(cat "$vnc_cgroup/memory.current")
tasks_current=$(cat "$vnc_cgroup/pids.current")

sleep 10

health_after_static=$(curl -fsS "$health_url")
vnc_cpu_after_static=$(cpu_usage "$vnc_cgroup")
gateway_cpu_after_static=$(cpu_usage "$gateway_cgroup")

health_before_scroll=$health_after_static
vnc_cpu_before_scroll=$vnc_cpu_after_static
gateway_cpu_before_scroll=$gateway_cpu_after_static

DISPLAY="$display" XAUTHORITY="$home_path/.Xauthority" \
  x11perf -sync -repeat 1 -time 30 -scroll500 \
  >"$runtime_path/x11perf-scroll500.log" 2>&1

health_after_scroll=$(curl -fsS "$health_url")
vnc_cpu_after_scroll=$(cpu_usage "$vnc_cgroup")
gateway_cpu_after_scroll=$(cpu_usage "$gateway_cgroup")

static_down_before=$(printf '%s' "$health_before_static" | jq -r '.rfbToBrowserBytes')
static_down_after=$(printf '%s' "$health_after_static" | jq -r '.rfbToBrowserBytes')
static_up_before=$(printf '%s' "$health_before_static" | jq -r '.browserToRfbBytes')
static_up_after=$(printf '%s' "$health_after_static" | jq -r '.browserToRfbBytes')
scroll_down_before=$(printf '%s' "$health_before_scroll" | jq -r '.rfbToBrowserBytes')
scroll_down_after=$(printf '%s' "$health_after_scroll" | jq -r '.rfbToBrowserBytes')
scroll_up_before=$(printf '%s' "$health_before_scroll" | jq -r '.browserToRfbBytes')
scroll_up_after=$(printf '%s' "$health_after_scroll" | jq -r '.browserToRfbBytes')
x11perf_summary=$(grep 'reps @' "$runtime_path/x11perf-scroll500.log" | tail -n 1)

jq -n \
  --arg instanceId "$instance_id" \
  --arg display "$display" \
  --arg x11perf "$x11perf_summary" \
  --argjson memoryCurrent "$memory_current" \
  --argjson tasks "$tasks_current" \
  --argjson staticDownBytes "$((static_down_after-static_down_before))" \
  --argjson staticUpBytes "$((static_up_after-static_up_before))" \
  --argjson staticVncCPUUsec "$((vnc_cpu_after_static-vnc_cpu_before_static))" \
  --argjson staticGatewayCPUUsec "$((gateway_cpu_after_static-gateway_cpu_before_static))" \
  --argjson scrollDownBytes "$((scroll_down_after-scroll_down_before))" \
  --argjson scrollUpBytes "$((scroll_up_after-scroll_up_before))" \
  --argjson scrollVncCPUUsec "$((vnc_cpu_after_scroll-vnc_cpu_before_scroll))" \
  --argjson scrollGatewayCPUUsec "$((gateway_cpu_after_scroll-gateway_cpu_before_scroll))" \
  '{instanceId:$instanceId,display:$display,memoryCurrent:$memoryCurrent,tasks:$tasks,
    static:{seconds:10,downBytes:$staticDownBytes,upBytes:$staticUpBytes,vncCPUUsec:$staticVncCPUUsec,gatewayCPUUsec:$staticGatewayCPUUsec},
    scroll:{test:"x11perf -sync -repeat 1 -time 30 -scroll500",downBytes:$scrollDownBytes,upBytes:$scrollUpBytes,vncCPUUsec:$scrollVncCPUUsec,gatewayCPUUsec:$scrollGatewayCPUUsec,x11perf:$x11perf}}'
