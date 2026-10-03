#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
release_root="${REMOTEXAPP_SHIPPED_E2E_RELEASE_ROOT:-$project_root}"
manager="$release_root/bin/remotexappd"
manager_url="${REMOTEXAPP_SHIPPED_E2E_URL:-http://127.0.0.1:21991}"
listen="${manager_url#http://}"
include_user_home="${REMOTEXAPP_SHIPPED_E2E_USER_HOME:-0}"
edge_vacant_timeout="${REMOTEXAPP_EDGE_E2E_VACANT_TIMEOUT:-}"
work="$(mktemp -d /tmp/remotexapp-shipped-e2e.XXXXXX)"
packages="$work/apps"
enabled="$work/apps-enabled"
state="$work/state"
legacy="$work/legacy"
manager_pid=""
chrome_pids=()
created_ids=()
last_chrome_pid=""

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"

for command in curl google-chrome jq node python3 systemctl xclip xdotool; do
  command -v "$command" >/dev/null || { echo "missing required command: $command" >&2; exit 1; }
done
for path in "$manager" "$release_root/bin/novnc-input" "$release_root/bin/remotexapp-status"; do
  [[ -x "$path" ]] || { echo "missing $path; run make build once" >&2; exit 1; }
done
systemctl --user show-environment >/dev/null
if curl -fsS "$manager_url/readyz" >/dev/null 2>&1; then
  echo "$manager_url is already in use" >&2
  exit 1
fi
if [[ "$include_user_home" == 1 ]] && ss -ltn | awk '{print $4}' | grep -Eq '(^|:)5901$|(^|:)39001$'; then
  echo "user-home validation requires display :1 ports 5901 and 39001 to be free" >&2
  exit 1
fi

mkdir -p "$packages" "$enabled" "$state/documents" "$legacy"
(umask 077; openssl rand -hex 32 > "$work/connections-token")
"$release_root/scripts/install-shipped-apps.sh" "$manager" "$packages" "$enabled"
[[ "$(find "$enabled" -mindepth 1 -maxdepth 1 -type l -printf '%f\n' | sort | paste -sd, -)" == \
  "edge,firefox-esr,kate,kwrite,libreoffice,lightview,mousepad,xfce-user-desktop" ]]
firefox_version="$(jq -r .driverVersion "$release_root/apps/firefox-esr/manifest.json")"
export VALIDATION_FIREFOX_VERSION="$firefox_version"
[[ "$(basename "$(readlink -f "$enabled/firefox-esr")")" == "$firefox_version" ]]
[[ ! -e "$enabled/xfce-desktop" && ! -L "$enabled/xfce-desktop" ]]
if [[ -n "$edge_vacant_timeout" ]]; then
  [[ "$edge_vacant_timeout" =~ ^[1-9][0-9]*s$ ]] || {
    echo "REMOTEXAPP_EDGE_E2E_VACANT_TIMEOUT must be a positive whole number of seconds" >&2
    exit 1
  }
  cp -R "$release_root/apps/edge" "$work/edge-vacancy-fixture"
  python3 - "$work/edge-vacancy-fixture/manifest.json" "$edge_vacant_timeout" <<'PY'
import json, sys
path, timeout = sys.argv[1:]
with open(path, encoding="utf-8") as source:
    manifest = json.load(source)
manifest["driverVersion"] = "1.0.0-e2e"
manifest["session"]["vacantTimeout"] = timeout
with open(path, "w", encoding="utf-8") as target:
    json.dump(manifest, target, indent=2)
    target.write("\n")
PY
  fixture_archive=$("$release_root/scripts/package-app.sh" \
    "$work/edge-vacancy-fixture" "$work/fixture-packages")
  fixture_digest=$(sha256sum "$fixture_archive" | cut -d' ' -f1)
  "$release_root/scripts/install-app.sh" --archive "$fixture_archive" \
    --sha256 "$fixture_digest" --package-root "$packages" \
    --enabled-root "$enabled" >/dev/null
fi

stop_manager() {
  if [[ -n "$manager_pid" ]] && kill -0 "$manager_pid" 2>/dev/null; then
    kill -TERM "$manager_pid"
    wait "$manager_pid" || true
  fi
  manager_pid=""
}

cleanup() {
  trap - EXIT INT TERM
  for id in "${created_ids[@]}"; do
    curl -fsS -H 'Content-Type: application/json' -d '{"force":true}' \
      "$manager_url/api/instances/$id/stop" >/dev/null 2>&1 || true
    # An interrupt can terminate the background manager before its HTTP
    # cleanup request. Stop only this harness's exact transient unit names so
    # no isolated process survives a failed validation run.
    systemctl --user stop \
      "remotexapp-$id-session.service" "remotexapp-$id-gateway.service" \
      "remotexapp-$id-server.service" "remotexapp-$id-vnc.service" \
      >/dev/null 2>&1 || true
  done
  for pid in "${chrome_pids[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  stop_manager
  echo "retained evidence: $work" >&2
}
trap cleanup EXIT INT TERM

start_manager() {
  "$manager" \
    -listen "$listen" -auth-mode none -expose-internals=true \
    -connections-token-file "$work/connections-token" \
    -state-dir "$state" -class-config "$legacy" \
    -app-package-root "$packages" -apps-enabled "$enabled" \
    -gateway-bin "$release_root/bin/novnc-input" \
    -status-bin "$release_root/bin/remotexapp-status" \
    -core-driver-dir "$release_root/drivers/common" \
    -ibus-engine "$release_root/components/remote-unicode-engine/engine.py" \
    >"$work/manager.log" 2>&1 &
  manager_pid=$!
  for _ in $(seq 1 200); do
    curl -fsS "$manager_url/readyz" >/dev/null 2>&1 && return
    kill -0 "$manager_pid" 2>/dev/null || { tail -100 "$work/manager.log" >&2; return 1; }
    sleep 0.1
  done
  echo "manager did not become ready" >&2
  return 1
}

wait_status() {
  local id=$1 expected=$2 output=$3
  for _ in $(seq 1 600); do
    payload="$(curl -fsS "$manager_url/api/instances/$id")"
    state_value="$(jq -r '.applicationStatus.state // ""' <<<"$payload")"
    if [[ "$state_value" == "$expected" ]]; then
      printf '%s\n' "$payload" >"$output"
      return
    fi
    if [[ "$state_value" == error ]]; then
      printf '%s\n' "$payload" >&2
      return 1
    fi
    sleep 0.1
  done
  echo "$id did not reach application state $expected" >&2
  return 1
}

launch_chrome() {
  local id=$1 cdp_port=$2
  local profile="$work/chrome-$id-$cdp_port"
  local viewer_url="$manager_url/sdk/minimal.html"
  if [[ -n "$id" ]]; then viewer_url="$manager_url/remotexapps/$id/kiosk.html?diagnostics=on"; fi
  mkdir -p "$profile"
  google-chrome \
    --headless=new --disable-background-networking --disable-default-apps \
    --disable-extensions --disable-sync --metrics-recording-only --no-first-run \
    --no-default-browser-check --remote-debugging-port="$cdp_port" \
    --window-size=1100,760 --user-data-dir="$profile" \
    "$viewer_url" \
    >"$work/chrome-$id.log" 2>&1 &
  last_chrome_pid=$!
  chrome_pids+=("$last_chrome_pid")
}

validate_clipboard() {
  local mode=$1 ports=$2 display=$3 xauthority=$4 output=$5
  VALIDATION_CLIPBOARD_MODE="$mode" VALIDATION_CDP_PORTS="$ports" \
    VALIDATION_DISPLAY="$display" VALIDATION_XAUTHORITY="$xauthority" \
    VALIDATION_TIMEOUT_MS=45000 \
    node "$project_root/tests/go-live-validation/check-clipboard-client.mjs" \
    >"$output"
  jq -e '.result == "passed"' "$output" >/dev/null
}

validate_viewer() {
  local id=$1 cdp_port=$2 expect_resize=$3 text_value=$4
  VALIDATION_CDP_PORT="$cdp_port" VALIDATION_EXPECT_RESIZE="$expect_resize" VALIDATION_TIMEOUT_MS=45000 \
    node "$project_root/tests/go-live-validation/check-browser-client.mjs" \
    >"$work/$id-viewer.json"
  VALIDATION_CDP_PORT="$cdp_port" VALIDATION_INSTANCE_ID="$id" VALIDATION_TEXT="$text_value" \
    node "$project_root/tests/go-live-validation/check-sdk-lifecycle.mjs" \
    >"$work/$id-sdk.json"
  jq -e '.connected and .finalState == "connected"' "$work/$id-viewer.json" >/dev/null
  jq -e '.textAck.error == "" and .finalState == "connected"' "$work/$id-sdk.json" >/dev/null
}

assert_generic_status() {
  local path=$1 app=$2 protocol=${3:-}
  jq -e --arg app "$app" '
    .applicationStatus.state == "ready" and
    .applicationStatus.generation == .sessionGeneration and
    .applicationStatus.details.application == $app and
    ((.resources | type) == "object") and
    (has("controlAddress") | not) and (has("controlPort") | not) and
    (has("controlWebSocketUrl") | not)
  ' "$path" >/dev/null
  if [[ -n "$protocol" ]]; then
    jq -e --arg protocol "$protocol" '
      .resources.control.kind == "loopback-tcp" and
      .resources.control.address == "127.0.0.1" and
      (.resources.control.port >= 1024 and .resources.control.port <= 65535) and
      .applicationStatus.details.control.protocol == $protocol and
      .applicationStatus.details.control.address == .resources.control.address and
      .applicationStatus.details.control.port == .resources.control.port
    ' "$path" >/dev/null
  else
    jq -e '.resources == {} and (.applicationStatus.details.control | not)' "$path" >/dev/null
  fi
}

force_stop() {
  local id=$1
  curl -fsS -H 'Content-Type: application/json' -d '{"force":true}' \
    "$manager_url/api/instances/$id/stop" >/dev/null
}

start_manager

# Disposable no-control App: dynamic resize, exact hybrid input, unsaved-close
# refusal, explicit force, and complete process/runtime cleanup.
# Prepare the browser before allocating a five-second-vacancy Mousepad runtime.
# Browser cold startup must not consume the application's real vacancy budget.
launch_chrome '' 9240
for _ in $(seq 1 300); do
  curl -fsS http://127.0.0.1:9240/json/list >/dev/null 2>&1 && break
  sleep 0.1
done
curl -fsS http://127.0.0.1:9240/json/list >/dev/null
VALIDATION_MANAGER_URL="$manager_url" node --input-type=module <<'JS'
const pages=await(await fetch('http://127.0.0.1:9240/json/list')).json();
const page=pages.find(item=>item.type==='page');
if(!page) throw new Error('Prepared browser has no page');
const socket=new WebSocket(page.webSocketDebuggerUrl);
const timer=setTimeout(()=>{console.error('Browser renderer/SDK prewarm timed out');process.exit(1)},45000);
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
let sequence=0;const pending=new Map();
socket.onmessage=event=>{const result=JSON.parse(event.data);pending.get(result.id)?.(result);pending.delete(result.id)};
const evaluate=expression=>new Promise(resolve=>{const id=++sequence;pending.set(id,resolve);socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}))});
const origin=JSON.stringify(new URL(process.env.VALIDATION_MANAGER_URL).origin);
while(true){
  const reply=await evaluate(`location.origin===${origin} && document.readyState==='complete'`);
  if(reply.result?.result?.value===true)break;
  await new Promise(resolve=>setTimeout(resolve,100));
}
const reply=await evaluate("import('/sdk/index.js').then(()=>true)");
if(reply.error||reply.result?.exceptionDetails||reply.result?.result?.value!==true)throw new Error(JSON.stringify(reply));
clearTimeout(timer);socket.close();
JS
mousepad_payload="$(curl -fsS -H 'Content-Type: application/json' \
  -d '{"templateId":"mousepad","profileRef":"e2e-mousepad"}' "$manager_url/api/instances")"
mousepad_id="$(jq -r .id <<<"$mousepad_payload")"
created_ids+=("$mousepad_id")
VALIDATION_VIEWER_URL="$manager_url/remotexapps/$mousepad_id/kiosk.html?diagnostics=on" node --input-type=module <<'JS'
const pages=await(await fetch('http://127.0.0.1:9240/json/list')).json();
const page=pages.find(item=>item.type==='page');
if(!page) throw new Error('Prepared browser has no page');
const socket=new WebSocket(page.webSocketDebuggerUrl);
const timer=setTimeout(()=>{console.error('Prepared browser navigation timed out');process.exit(1)},10000);
socket.onopen=()=>socket.send(JSON.stringify({id:1,method:'Page.navigate',params:{url:process.env.VALIDATION_VIEWER_URL}}));
socket.onerror=()=>{console.error('Prepared browser navigation failed');process.exit(1)};
socket.onmessage=event=>{const result=JSON.parse(event.data);if(result.id!==1)return;if(result.error||result.result?.errorText)throw new Error(JSON.stringify(result));clearTimeout(timer);socket.close()};
JS
wait_status "$mousepad_id" ready "$work/$mousepad_id-ready.json"
assert_generic_status "$work/$mousepad_id-ready.json" mousepad
node "$project_root/tests/app-package/check-connections.mjs" "$manager_url" "$mousepad_id" "$work/connections-token" > "$work/mousepad-connections.json"
validate_viewer "$mousepad_id" 9240 1 'RemoteXApp ASCII 你好'
mousepad_display="$(jq -r .display "$work/$mousepad_id-ready.json")"
mousepad_xauth="$(jq -r .homePath "$work/$mousepad_id-ready.json")/.Xauthority"
launch_chrome "$mousepad_id" 9250
validate_clipboard full 9240,9250 "$mousepad_display" "$mousepad_xauth" \
  "$work/$mousepad_id-clipboard.json"
mousepad_window="$(DISPLAY="$mousepad_display" XAUTHORITY="$mousepad_xauth" xdotool search --onlyvisible --class Mousepad | tail -1)"
DISPLAY="$mousepad_display" XAUTHORITY="$mousepad_xauth" \
  xdotool windowfocus --sync "$mousepad_window" key --window "$mousepad_window" ctrl+a ctrl+c
sleep 0.25
mousepad_clipboard="$(timeout 3 env DISPLAY="$mousepad_display" XAUTHORITY="$mousepad_xauth" xclip -selection clipboard -target UTF8_STRING -o)"
[[ "$mousepad_clipboard" == 'RemoteXApp ASCII 你好' ]]
mousepad_stop_code="$(curl -sS -o "$work/$mousepad_id-blocked.json" -w '%{http_code}' \
  -H 'Content-Type: application/json' -d '{}' "$manager_url/api/instances/$mousepad_id/stop")"
[[ "$mousepad_stop_code" == 200 ]]
[[ ! -e "$(jq -r .runtimePath "$work/$mousepad_id-ready.json")" ]]

# Browser control protocols remain App-owned and are proven by their real
# WebSocket commands in the package probes.
edge_browser_code="$(curl -sS -o "$work/edge-browser-rejected.json" -w '%{http_code}' \
  -H 'Content-Type: application/json' \
  -d '{"templateId":"edge-browser"}' "$manager_url/api/instances")"
[[ "$edge_browser_code" == 409 ]]
jq -e '.error | contains("unsupported templateId")' "$work/edge-browser-rejected.json" >/dev/null
edge_payload="$(curl -fsS -H 'Content-Type: application/json' \
  -d '{"templateId":"edge","parameters":{"startUrl":"about:blank","incognito":false}}' "$manager_url/api/instances")"
edge_id="$(jq -r .id <<<"$edge_payload")"
created_ids+=("$edge_id")
edge_duplicate="$(curl -fsS -H 'Content-Type: application/json' \
  -d '{"templateId":"edge","parameters":{"startUrl":"about:blank","incognito":false}}' "$manager_url/api/instances")"
[[ "$(jq -r .id <<<"$edge_duplicate")" == "$edge_id" ]]
launch_chrome "$edge_id" 9241
edge_viewer_pid=$last_chrome_pid
wait_status "$edge_id" ready "$work/$edge_id-ready.json"
assert_generic_status "$work/$edge_id-ready.json" edge cdp
node "$project_root/tests/app-package/check-connections.mjs" "$manager_url" "$edge_id" "$work/connections-token" > "$work/edge-connections.json"
edge_port="$(jq -r .resources.control.port "$work/$edge_id-ready.json")"
python3 "$release_root/apps/edge/probe.py" 127.0.0.1 "$edge_port" >"$work/$edge_id-control.json"
validate_viewer "$edge_id" 9241 1 'Edge ASCII 你好'
edge_display="$(jq -r .display "$work/$edge_id-ready.json")"
edge_xauth="$(jq -r .homePath "$work/$edge_id-ready.json")/.Xauthority"
validate_clipboard smoke 9241 "$edge_display" "$edge_xauth" \
  "$work/$edge_id-clipboard.json"
edge_generation="$(jq -r .sessionGeneration "$work/$edge_id-ready.json")"
jq -r '.vncUnit,.serverUnit,.gatewayUnit,.sessionUnit' "$work/$edge_id-ready.json" | \
  while read -r unit; do systemctl --user show -p MainPID --value "$unit"; done >"$work/$edge_id-pids-before"
stop_manager
start_manager
wait_status "$edge_id" ready "$work/$edge_id-adopted.json"
jq -e --arg id "$edge_id" --argjson generation "$edge_generation" --argjson port "$edge_port" '
  .id == $id and .sessionGeneration == $generation and
  .resources.control.port == $port and .applicationStatus.details.application == "edge"
' "$work/$edge_id-adopted.json" >/dev/null
jq -r '.vncUnit,.serverUnit,.gatewayUnit,.sessionUnit' "$work/$edge_id-adopted.json" | \
  while read -r unit; do systemctl --user show -p MainPID --value "$unit"; done >"$work/$edge_id-pids-after"
cmp "$work/$edge_id-pids-before" "$work/$edge_id-pids-after"

firefox_payload="$(curl -fsS -H 'Content-Type: application/json' \
  -d '{"templateId":"firefox-esr","parameters":{"startUrl":"about:blank"}}' "$manager_url/api/instances")"
firefox_id="$(jq -r .id <<<"$firefox_payload")"
created_ids+=("$firefox_id")
firefox_port="$(jq -r .resources.control.port <<<"$firefox_payload")"
[[ "$firefox_port" != "$edge_port" ]]

edge_home="$(jq -r .homePath "$work/$edge_id-ready.json")"
printf 'profile-persistence\n' >"$edge_home/e2e-profile-marker"
if [[ -n "$edge_vacant_timeout" ]]; then
  kill "$edge_viewer_pid"
  wait "$edge_viewer_pid" 2>/dev/null || true
  edge_stopped=false
  # Anonymous runtimes retain an in-memory stopped result until the manager
  # restarts, while their durable manifest, runtime directory, and units are
  # removed. Observe that terminal state instead of requiring an immediate 404.
  for _ in $(seq 1 600); do
    edge_stop_payload="$(curl -fsS "$manager_url/api/instances/$edge_id")"
    if jq -e '.state == "stopped" and .sessionState == "stopped"' <<<"$edge_stop_payload" >/dev/null; then
      printf '%s\n' "$edge_stop_payload" >"$work/$edge_id-stopped.json"
      edge_stopped=true
      break
    fi
    sleep 0.1
  done
  [[ "$edge_stopped" == true ]]
  [[ ! -e "$(jq -r .runtimePath "$work/$edge_id-stopped.json")" ]]
  jq -r '.vncUnit,.serverUnit,.gatewayUnit,.sessionUnit' "$work/$edge_id-stopped.json" | \
    while read -r unit; do
      ! systemctl --user is-active --quiet "$unit"
    done
  if ss -ltnH "sport = :$edge_port" | grep -q .; then
    echo "Edge CDP port remained open after detached expiry" >&2
    exit 1
  fi
else
  force_stop "$edge_id"
fi
edge_recreated="$(curl -fsS -H 'Content-Type: application/json' \
  -d '{"templateId":"edge","parameters":{"startUrl":"about:blank","incognito":false}}' "$manager_url/api/instances")"
created_ids+=("$(jq -r .id <<<"$edge_recreated")")
[[ "$(jq -r .id <<<"$edge_recreated")" != "$edge_id" ]]
[[ "$(cat "$(jq -r .homePath <<<"$edge_recreated")/e2e-profile-marker")" == profile-persistence ]]
force_stop "$(jq -r .id <<<"$edge_recreated")"

launch_chrome "$firefox_id" 9242
wait_status "$firefox_id" ready "$work/$firefox_id-ready.json"
assert_generic_status "$work/$firefox_id-ready.json" firefox-esr webdriver-bidi
node "$project_root/tests/app-package/check-connections.mjs" "$manager_url" "$firefox_id" "$work/connections-token" > "$work/firefox-connections.json"
jq -e --arg version "$firefox_version" '.driverVersion == $version and .effectivePolicy.display.depth == 16' \
  "$work/$firefox_id-ready.json" >/dev/null
systemctl --user show -p ExecStart --value \
  "$(jq -r .vncUnit "$work/$firefox_id-ready.json")" | grep -F -- '-depth 16' >/dev/null
[[ "$(jq -r .resources.control.port "$work/$firefox_id-ready.json")" == "$firefox_port" ]]
python3 "$release_root/apps/firefox-esr/probe.py" 127.0.0.1 "$firefox_port"
validate_viewer "$firefox_id" 9242 1 'Firefox ASCII 你好'
firefox_display="$(jq -r .display "$work/$firefox_id-ready.json")"
firefox_xauth="$(jq -r .homePath "$work/$firefox_id-ready.json")/.Xauthority"
VALIDATION_MANAGER_URL="$manager_url" VALIDATION_INSTANCE_ID="$firefox_id" \
  VALIDATION_CDP_PORT=9242 node "$project_root/tests/go-live-validation/check-firefox-ime.mjs" \
  >"$work/$firefox_id-ime.json"
validate_clipboard smoke 9242 "$firefox_display" "$firefox_xauth" \
  "$work/$firefox_id-clipboard.json"
force_stop "$firefox_id"

# FFX-007: reuse a persistent profile carrying the formerly problematic setting.
# Only this harness's isolated profile is modified; production profiles are not used.
firefox_home="$(jq -r .homePath "$work/$firefox_id-ready.json")"
node --input-type=module - "$firefox_home" <<'JS'
import { writeFileSync } from 'node:fs';
const home = process.argv[2];
writeFileSync(`${home}/.mozilla/firefox-remote/user.js`, 'user_pref("focusmanager.testmode", true);\n');
writeFileSync(`${home}/ffx007-profile-marker`, 'preserve-profile');
JS
firefox_recreated="$(curl -fsS -H 'Content-Type: application/json' \
  -d '{"templateId":"firefox-esr","parameters":{"startUrl":"about:blank"}}' "$manager_url/api/instances")"
firefox_new_id="$(jq -r .id <<<"$firefox_recreated")"
created_ids+=("$firefox_new_id")
[[ "$firefox_new_id" != "$firefox_id" ]]
[[ "$(jq -r .homePath <<<"$firefox_recreated")" == "$firefox_home" ]]
[[ "$(cat "$firefox_home/ffx007-profile-marker")" == preserve-profile ]]
launch_chrome "$firefox_new_id" 9245
wait_status "$firefox_new_id" ready "$work/$firefox_new_id-ready.json"
grep -F 'user_pref("focusmanager.testmode", false);' "$firefox_home/.mozilla/firefox-remote/user.js" >/dev/null
VALIDATION_MANAGER_URL="$manager_url" VALIDATION_INSTANCE_ID="$firefox_new_id" \
  VALIDATION_CDP_PORT=9245 node "$project_root/tests/go-live-validation/check-firefox-ime.mjs" \
  >"$work/$firefox_new_id-ime-reused-profile.json"
firefox_generation="$(jq -r .sessionGeneration "$work/$firefox_new_id-ready.json")"
curl --fail-with-body -sS -H 'Content-Type: application/json' \
  -d "{\"sessionGeneration\":$firefox_generation,\"force\":true}" \
  "$manager_url/api/instances/$firefox_new_id/restart" >"$work/$firefox_new_id-restart.json" || {
    cat "$work/$firefox_new_id-restart.json" >&2
    exit 1
  }
wait_status "$firefox_new_id" ready "$work/$firefox_new_id-restarted-ready.json"
jq -e --argjson previous "$firefox_generation" '.sessionGeneration > $previous' \
  "$work/$firefox_new_id-restarted-ready.json" >/dev/null
jq -e --slurpfile before "$work/$firefox_new_id-ready.json" \
  '.id == $before[0].id and .resources == $before[0].resources and .homePath == $before[0].homePath and .driverVersion == $before[0].driverVersion' \
  "$work/$firefox_new_id-restarted-ready.json" >/dev/null
VALIDATION_MANAGER_URL="$manager_url" VALIDATION_INSTANCE_ID="$firefox_new_id" \
  VALIDATION_CDP_PORT=9245 node "$project_root/tests/go-live-validation/check-firefox-ime.mjs" \
  >"$work/$firefox_new_id-ime-restarted.json"
force_stop "$firefox_new_id"

# LibreOffice proves a required file parameter, UNO, resize, unsaved input,
# destructive no-save shutdown, and lock/lease cleanup.
printf 'RemoteXApp LibreOffice E2E\n' >"$work/e2e.txt"
mkdir -p "$work/lo-convert-profile"
libreoffice --headless "-env:UserInstallation=file://$work/lo-convert-profile" \
  --convert-to odt --outdir "$state/documents" "$work/e2e.txt" >"$work/lo-convert.log" 2>&1
document="$state/documents/e2e.odt"
document_sha="$(sha256sum "$document" | cut -d' ' -f1)"
libreoffice_payload="$(jq -cn --arg file "$document" \
  '{templateId:"libreoffice",profileRef:"e2e-libreoffice",parameters:{filePath:$file}}' | \
  curl -fsS -H 'Content-Type: application/json' -d @- "$manager_url/api/instances")"
libreoffice_id="$(jq -r .id <<<"$libreoffice_payload")"
created_ids+=("$libreoffice_id")
launch_chrome "$libreoffice_id" 9243
wait_status "$libreoffice_id" ready "$work/$libreoffice_id-ready.json"
assert_generic_status "$work/$libreoffice_id-ready.json" libreoffice libreoffice-uno
node "$project_root/tests/app-package/check-connections.mjs" "$manager_url" "$libreoffice_id" "$work/connections-token" > "$work/libreoffice-connections.json"
libreoffice_port="$(jq -r .resources.control.port "$work/$libreoffice_id-ready.json")"
python3 "$release_root/apps/libreoffice/probe.py" "$libreoffice_port" "$document"
validate_viewer "$libreoffice_id" 9243 1 ' LibreOffice 你好'
libreoffice_display="$(jq -r .display "$work/$libreoffice_id-ready.json")"
libreoffice_xauth="$(jq -r .homePath "$work/$libreoffice_id-ready.json")/.Xauthority"
launch_chrome "$libreoffice_id" 9253
validate_clipboard full 9243,9253 "$libreoffice_display" "$libreoffice_xauth" \
  "$work/$libreoffice_id-clipboard.json"
force_stop "$libreoffice_id"
[[ "$(sha256sum "$document" | cut -d' ' -f1)" == "$document_sha" ]]
[[ ! -e "$(dirname "$document")/.~lock.$(basename "$document")#" ]]

# Optional no-file LibreOffice must be visible and UNO-ready before any Viewer.
blank_lo=$(curl -fsS -H 'Content-Type: application/json' -d '{"templateId":"libreoffice"}' "$manager_url/api/instances" | jq -er .id)
created_ids+=("$blank_lo")
wait_status "$blank_lo" ready "$work/libreoffice-blank-ready.json"
node "$project_root/tests/app-package/check-connections.mjs" "$manager_url" "$blank_lo" "$work/connections-token" > "$work/libreoffice-blank-connections.json"
python3 "$release_root/apps/libreoffice/probe.py" "$(jq -r .resources.control.port "$work/libreoffice-blank-ready.json")" ""
curl -fsS -H 'Content-Type: application/json' -d '{}' "$manager_url/api/instances/$blank_lo/stop" >/dev/null

if [[ "$include_user_home" == 1 ]]; then
  managed_payload="$(curl -fsS -H 'Content-Type: application/json' \
    -d '{"id":"e2e-user-desktop","templateId":"xfce-user-desktop","desiredState":"running"}' \
    "$manager_url/api/managed-instances")"
  user_home_id="$(jq -er .runtime.id <<<"$managed_payload")"
  launch_chrome "$user_home_id" 9244
  wait_status "$user_home_id" ready "$work/$user_home_id-ready.json"
  assert_generic_status "$work/$user_home_id-ready.json" xfce-desktop
  node "$project_root/tests/app-package/check-connections.mjs" "$manager_url" "$user_home_id" "$work/connections-token" > "$work/xfce-connections.json"
  jq -e --arg home "$HOME" '
    .homePath == $home and .display == ":1" and
    .effectivePolicy.runMode == "user-home" and
    .effectivePolicy.display.size == "1280x720" and
    (.effectivePolicy.display.allowClientResize | not)
  ' "$work/$user_home_id-ready.json" >/dev/null
  validate_viewer "$user_home_id" 9244 0 'User home ASCII 你好'
  validate_clipboard smoke 9244 :1 "$HOME/.Xauthority" \
    "$work/$user_home_id-clipboard.json"
  curl -fsS -X PATCH -H 'Content-Type: application/json' \
    -d '{"desiredState":"stopped","force":true}' \
    "$manager_url/api/managed-instances/e2e-user-desktop" >/dev/null
fi

python3 - "$work" "$include_user_home" <<'PY'
import json, sys
apps = ["edge", "firefox-esr", "libreoffice", "mousepad"]
if sys.argv[2] == "1":
    apps.append("xfce-user-desktop")
print(json.dumps({
    "result": "passed",
    "workDir": sys.argv[1],
    "userHomeIncluded": sys.argv[2] == "1",
    "apps": apps,
    "checks": ["input", "resize", "readiness", "generic-status", "control-probes", "clipboard-rebound", "prompt-layout", "exit", "shutdown", "restart-adoption", "profile-persistence", "cleanup"],
}, indent=2))
PY
