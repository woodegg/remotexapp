#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
install_root="${HOME}/.local"
share_root="${install_root}/share/remotexapp"
libexec_root="${install_root}/libexec/remotexapp"
config_root="${HOME}/.config/remotexapp"
unit_root="${HOME}/.config/systemd/user"
release_version="$(<"$project_root/VERSION")"

if [[ ! "$release_version" =~ ^[0-9]+[.][0-9]+[.][0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  echo "VERSION must contain a safe semantic version: $release_version" >&2
  exit 1
fi
for binary in remotexappd novnc-input remotexapp-status remotexapp-operator-helper; do
  [[ -x "$project_root/bin/$binary" ]] || {
    echo "missing release binary: bin/$binary; run make release-check first" >&2
    exit 1
  }
done

"$project_root/scripts/preflight.sh"
if [[ -e "$HOME/.config/remotexapp/apps-enabled/xfce-desktop" || \
      -L "$HOME/.config/remotexapp/apps-enabled/xfce-desktop" ]]; then
  runtime_dir="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
  if XDG_RUNTIME_DIR="$runtime_dir" DBUS_SESSION_BUS_ADDRESS="unix:path=$runtime_dir/bus" \
      systemctl --user is-active --quiet remotexapp.service; then
    echo "stop remotexapp.service before retiring xfce-desktop" >&2
    exit 1
  fi
fi
mkdir -p "$libexec_root/releases" "$share_root/releases" "$share_root/apps" \
  "$config_root/apps-enabled" "$unit_root"

libexec_release="$libexec_root/releases/$release_version"
share_release="$share_root/releases/$release_version"
libexec_stage="$(mktemp -d "$libexec_root/releases/.${release_version}.XXXXXX")"
share_stage="$(mktemp -d "$share_root/releases/.${release_version}.XXXXXX")"
trap 'rm -rf -- "${libexec_stage:-}" "${share_stage:-}"' EXIT
chmod 0755 "$libexec_stage" "$share_stage"

install -m 0755 "$project_root/bin/remotexappd" "$libexec_stage/remotexappd"
install -m 0755 "$project_root/bin/novnc-input" "$libexec_stage/novnc-input"
install -m 0755 "$project_root/bin/remotexapp-status" "$libexec_stage/remotexapp-status"
install -m 0755 "$project_root/bin/remotexapp-operator-helper" "$libexec_stage/remotexapp-operator-helper"
install -m 0755 "$project_root/scripts/install-app.sh" "$libexec_stage/install-app.sh"
install -m 0755 "$project_root/scripts/manage-app.sh" "$libexec_stage/manage-app.sh"
install -m 0644 "$project_root/VERSION" "$libexec_stage/VERSION"

mkdir -p "$share_stage/configs" "$share_stage/drivers" "$share_stage/components" \
  "$share_stage/third_party/licenses" "$share_stage/scripts"
install -m 0644 "$project_root/scripts/check-ubuntu-host.py" "$share_stage/scripts/"
cp -a "$project_root/configs/." "$share_stage/configs/"
cp -a "$project_root/drivers/." "$share_stage/drivers/"
cp -a "$project_root/components/." "$share_stage/components/"
cp -a "$project_root/third_party/novnc" "$share_stage/third_party/"
install -m 0644 "$project_root/third_party/licenses/gorilla-websocket-LICENSE.txt" \
  "$project_root/third_party/licenses/jezek-xgb-LICENSE.txt" \
  "$project_root/third_party/licenses/golang-x-mod-LICENSE.txt" \
  "$project_root/third_party/licenses/golang-x-sys-LICENSE.txt" \
  "$share_stage/third_party/licenses/"
install -m 0644 "$project_root/LICENSE" "$project_root/NOTICE" \
  "$project_root/THIRD_PARTY_NOTICES.md" "$project_root/VERSION" "$share_stage/"

publish_user_release() {
  local stage=$1
  local target=$2
  if [[ -e "$target" ]]; then
    if ! diff -qr "$stage" "$target" >/dev/null; then
      echo "refusing to modify published user release $target; bump VERSION" >&2
      return 1
    fi
    rm -rf -- "$stage"
  else
    mv -- "$stage" "$target"
  fi
}
publish_user_release "$libexec_stage" "$libexec_release"
publish_user_release "$share_stage" "$share_release"

install -m 0644 "$project_root/deploy/systemd/remotexapp.service" "$unit_root/remotexapp.service"
install -m 0644 "$project_root/deploy/systemd/remotexapp-operator.service" "$unit_root/remotexapp-operator.service"
if [[ ! -e "$config_root/remotexapp.env" ]]; then
  install -m 0600 "$project_root/deploy/examples/remotexapp.env" "$config_root/remotexapp.env"
fi
"$project_root/scripts/install-shipped-apps.sh" "$libexec_release/remotexappd" \
  "$share_root/apps" "$config_root/apps-enabled" \
  --state-dir "$HOME/.local/state/remotexapp"
ln -sfn "releases/$release_version" "$libexec_root/current"
ln -sfn "releases/$release_version" "$share_root/current"

runtime_dir="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
XDG_RUNTIME_DIR="$runtime_dir" DBUS_SESSION_BUS_ADDRESS="unix:path=$runtime_dir/bus" systemctl --user daemon-reload
"$project_root/scripts/preflight.sh" --installed

echo "installed immutable RemoteXApp $release_version user release"
echo "review $config_root/remotexapp.env, then run: systemctl --user enable --now remotexapp.service"
echo "service restart remains disabled unless trusted-header auth is configured and remotexapp-operator.service is explicitly enabled"
