#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
release_root="${REMOTEXAPP_APP_E2E_RELEASE_ROOT:-$project_root}"
manager="$release_root/bin/remotexappd"
gateway="$release_root/bin/novnc-input"
status_helper="$release_root/bin/remotexapp-status"
listen="${REMOTEXAPP_APP_E2E_LISTEN:-127.0.0.1:21991}"
base_url="http://$listen"

for path in "$manager" "$gateway" "$status_helper"; do
  [[ -x "$path" ]] || { echo "missing $path; run make build once" >&2; exit 1; }
done
runtime_dir="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
XDG_RUNTIME_DIR="$runtime_dir" systemctl --user show-environment >/dev/null

work="$(mktemp -d /tmp/remotexapp-app-package-e2e.XXXXXX)"
packages="$work/apps"
enabled="$work/apps-enabled"
catalog="$work/legacy-catalog"
state="$work/state"
artifacts="$work/artifacts"
mkdir -p "$packages" "$enabled" "$catalog" "$state" "$artifacts"
manager_pid=""

stop_manager() {
  if [[ -n "$manager_pid" ]] && kill -0 "$manager_pid" 2>/dev/null; then
    kill -TERM "$manager_pid"
    wait "$manager_pid" || true
  fi
  manager_pid=""
}
cleanup() {
  stop_manager
}
trap cleanup EXIT INT TERM

start_manager() {
  "$manager" \
    -listen "$listen" -auth-mode none \
    -state-dir "$state" -class-config "$catalog" \
    -app-package-root "$packages" -apps-enabled "$enabled" \
    -gateway-bin "$gateway" -status-bin "$status_helper" \
    -core-driver-dir "$release_root/drivers/common" \
    -ibus-engine "$release_root/components/remote-unicode-engine/engine.py" \
    >"$work/manager.log" 2>&1 &
  manager_pid=$!
  for _ in $(seq 1 100); do
    curl -fsS "$base_url/readyz" >/dev/null 2>&1 && return
    kill -0 "$manager_pid" 2>/dev/null || { cat "$work/manager.log" >&2; return 1; }
    sleep 0.1
  done
  echo "manager did not become ready" >&2
  return 1
}

json_field() {
  python3 -c 'import json,sys; value=json.load(sys.stdin); print(eval(sys.argv[1], {"value":value}))' "$1"
}

wait_ready() {
  local id=$1
  for _ in $(seq 1 200); do
    payload="$(curl -fsS "$base_url/api/instances/$id")"
    if [[ "$(json_field 'value.get("applicationStatus",{}).get("state","")' <<<"$payload")" == ready ]]; then
      printf '%s' "$payload"
      return
    fi
    sleep 0.1
  done
  echo "instance $id did not become ready" >&2
  return 1
}

core_sha_before="$(sha256sum "$manager" "$gateway" "$status_helper" | sha256sum | cut -d' ' -f1)"
archive_v1="$("$release_root/scripts/package-app.sh" "$project_root/tests/app-package/synthetic" "$artifacts")"
sha_v1="$(sha256sum "$archive_v1" | cut -d' ' -f1)"
"$manager" -install-app-archive "$archive_v1" -install-app-sha256 "$sha_v1" \
  -app-package-root "$packages" -apps-enabled "$enabled" >/dev/null

start_manager
created="$(curl -fsS -H 'Content-Type: application/json' -d '{"templateId":"synthetic-app"}' "$base_url/api/instances")"
v1_id="$(json_field 'value["id"]' <<<"$created")"
v1_ready="$(wait_ready "$v1_id")"
v1_port="$(json_field 'value["resources"]["control"]["port"]' <<<"$v1_ready")"
python3 - "$v1_port" <<'PY'
import json, socket, sys
with socket.create_connection(("127.0.0.1", int(sys.argv[1])), timeout=2) as connection:
    result = json.loads(connection.makefile("rb").readline())
assert result == {"status": "ready", "protocol": "synthetic-json-line-v1"}
PY

stop_manager
start_manager
adopted="$(wait_ready "$v1_id")"
[[ "$(json_field 'value["driverVersion"]' <<<"$adopted")" == 1.0.0 ]]
[[ "$(json_field 'value["resources"]["control"]["port"]' <<<"$adopted")" == "$v1_port" ]]

source_v2="$work/synthetic-v2"
cp -a "$project_root/tests/app-package/synthetic" "$source_v2"
python3 - "$source_v2/manifest.json" <<'PY'
import json, pathlib, sys
path = pathlib.Path(sys.argv[1])
manifest = json.loads(path.read_text(encoding="utf-8"))
manifest["driverVersion"] = "1.1.0"
path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
PY
archive_v2="$("$release_root/scripts/package-app.sh" "$source_v2" "$artifacts")"
sha_v2="$(sha256sum "$archive_v2" | cut -d' ' -f1)"
"$manager" -install-app-archive "$archive_v2" -install-app-sha256 "$sha_v2" \
  -app-package-root "$packages" -apps-enabled "$enabled" >/dev/null

stop_manager
start_manager
still_v1="$(wait_ready "$v1_id")"
[[ "$(json_field 'value["driverVersion"]' <<<"$still_v1")" == 1.0.0 ]]
curl -fsS -X POST "$base_url/api/instances/$v1_id/stop" >/dev/null
created_v2="$(curl -fsS -H 'Content-Type: application/json' -d '{"templateId":"synthetic-app"}' "$base_url/api/instances")"
v2_id="$(json_field 'value["id"]' <<<"$created_v2")"
v2_ready="$(wait_ready "$v2_id")"
[[ "$(json_field 'value["driverVersion"]' <<<"$v2_ready")" == 1.1.0 ]]
curl -fsS -X POST "$base_url/api/instances/$v2_id/stop" >/dev/null
stop_manager

"$manager" -disable-app synthetic-app -app-package-root "$packages" -apps-enabled "$enabled" >/dev/null
[[ "$("$manager" -check-app-catalog -app-package-root "$packages" -apps-enabled "$enabled" | json_field 'value["enabled"]')" == 0 ]]
"$manager" -activate-app synthetic-app@1.0.0 -app-package-root "$packages" -apps-enabled "$enabled" >/dev/null
[[ "$("$manager" -check-app-catalog -app-package-root "$packages" -apps-enabled "$enabled" | json_field 'value["enabled"]')" == 1 ]]

core_sha_after="$(sha256sum "$manager" "$gateway" "$status_helper" | sha256sum | cut -d' ' -f1)"
[[ "$core_sha_before" == "$core_sha_after" ]]
python3 - "$work" "$v1_id" "$v2_id" "$v1_port" "$core_sha_after" <<'PY'
import json, sys
print(json.dumps({
    "result": "passed",
    "workDir": sys.argv[1],
    "v1Instance": sys.argv[2],
    "v2Instance": sys.argv[3],
    "adoptedControlPort": int(sys.argv[4]),
    "coreBuildSHA256": sys.argv[5],
    "checks": ["install", "launch", "status", "control", "adopt", "update", "pin-old", "select-new", "stop", "disable", "rollback", "no-rebuild"],
}, indent=2))
PY
