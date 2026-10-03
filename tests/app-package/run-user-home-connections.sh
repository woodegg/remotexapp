#!/usr/bin/env bash
set -euo pipefail
# Explicit live gate: creates a locked temporary UID, never reuses an account.
# Run as the build user with passwordless sudo, never on a production gateway.
release=$(readlink -f "${1:?release root required}")
project_root=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d /var/tmp/remotexapp-conn-user.XXXXXX)
account="rxc$(date +%s)$$"
account_created=false
cleanup() {
  if [[ $account_created == true ]]; then
    # Retain bounded fixture diagnostics before deleting this test's HOME, on
    # failure as well as success. Never copy an existing user's environment.
    mkdir -p "$work/evidence"
    for evidence in served-viewer.json saved-session.json saved-session-viewer.json; do
      if sudo -n test -f "$work/home/test/$evidence"; then
        sudo -n cp "$work/home/test/$evidence" "$work/evidence/$evidence"
        sudo -n chown "$(id -u):$(id -g)" "$work/evidence/$evidence"
      fi
    done
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
    # Only the unique account and home created by this test are removed.
    test "$(getent passwd "$account" | cut -d: -f6)" = "$work/home"
    sudo -n userdel --remove "$account"
  fi
}
trap cleanup EXIT
chmod 755 "$work"
mkdir "$work/release"
for part in bin apps scripts drivers components VERSION; do cp -a "$release/$part" "$work/release/"; done
cp "$project_root/tests/app-package/run-user-home-connections.mjs" "$work/check.mjs"
cp "$project_root/tests/go-live-validation/check-browser-client.mjs" "$work/"
cp "$project_root/tests/go-live-validation/check-sdk-lifecycle.mjs" "$work/"
sudo -n useradd --create-home --home-dir "$work/home" --shell /usr/sbin/nologin "$account"
account_created=true
test_uid=$(id -u "$account")
sudo -n loginctl enable-linger "$account"
sudo -n systemctl start "user@$test_uid.service"
sudo -n -H -u "$account" env XDG_RUNTIME_DIR="/run/user/$test_uid" DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$test_uid/bus" \
  REMOTEXAPP_CONNECTIONS_DISPOSABLE_UID="$test_uid" \
  node "$work/check.mjs" "$work/release" | tee "$work/result.json"
sudo -n cp "$work/home/test/served-viewer.json" "$work/served-viewer.json"
sudo -n chown "$(id -u):$(id -g)" "$work/served-viewer.json"
echo "user-home connection evidence: $work/result.json"
