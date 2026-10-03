#!/usr/bin/env bash
set -euo pipefail
# Live destructive tests, confined to a newly created, locked temporary UID.
# No existing Manager, desktop, account bus, package selector or profile is used.
release=$(readlink -f "${1:?usage: run-state-matrix.sh RELEASE_ROOT [template,...] [main|interaction|transport]}")
project_root=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d /var/tmp/remotexapp-svc-matrix.XXXXXX)
account="rxm$(date +%s)$$"
account_created=false
cleanup() {
  if [[ $account_created == true ]]; then
    # Preserve evidence before removing only this test's disposable HOME.
    sudo -n cp -a "$work/home/matrix" "$work/evidence" || true
    sudo -n chown -R "$(id -u):$(id -g)" "$work/evidence" || true
    sudo -n loginctl terminate-user "$account" || true
    sudo -n loginctl disable-linger "$account"
    sudo -n systemctl stop "user@$test_uid.service"
    for attempt in {1..50}; do
      if ! pgrep -u "$test_uid" >/dev/null; then break; fi
      sleep 0.1
    done
    if pgrep -u "$test_uid" >/dev/null; then
      echo "Temporary UID still has processes; refusing account deletion" >&2
      return 1
    fi
    test "$(getent passwd "$account" | cut -d: -f6)" = "$work/home"
    sudo -n userdel --remove "$account"
  fi
  echo "State-matrix evidence: $work/evidence/result.json"
}
trap cleanup EXIT
chmod 755 "$work"
mkdir -p "$work/release/tests/session-services" "$work/release/cmd/remotexappd/web/sdk"
for part in bin apps scripts drivers components VERSION; do cp -a "$release/$part" "$work/release/"; done
cp "$project_root/tests/session-services/run-state-matrix.mjs" "$work/release/tests/session-services/"
cp "$project_root/cmd/remotexappd/web/sdk/remotexapp-manager.js" "$work/release/cmd/remotexappd/web/sdk/"
sudo -n useradd --create-home --home-dir "$work/home" --shell /usr/sbin/nologin "$account"
account_created=true
test_uid=$(id -u "$account")
sudo -n loginctl enable-linger "$account"
sudo -n systemctl start "user@$test_uid.service"
sudo -n -H -u "$account" env XDG_RUNTIME_DIR="/run/user/$test_uid" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$test_uid/bus" \
  REMOTEXAPP_MATRIX_DISPOSABLE_UID="$test_uid" \
  node "$work/release/tests/session-services/run-state-matrix.mjs" "$work/release" "${2:-all}" "${3:-main}" | tee "$work/run.jsonl"
