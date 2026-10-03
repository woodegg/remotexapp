#!/usr/bin/env bash
set -euo pipefail

required_commands=(getent systemctl systemd-run Xtigervnc xauth dbus-daemon dbus-send ibus ibus-daemon python3 xdotool)
missing=()
for command_name in "${required_commands[@]}"; do
  command -v "$command_name" >/dev/null 2>&1 || missing+=("$command_name")
done
if (( ${#missing[@]} > 0 )); then
  echo "missing required commands: ${missing[*]}" >&2
  exit 1
fi

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -f "$project_root/third_party/novnc/UPSTREAM.json" ]]; then
  echo "missing vendored noVNC source metadata" >&2
  exit 1
fi

check_installed_release_licenses() {
  local share=/usr/local/share/remotexapp/current
  for path in LICENSE NOTICE THIRD_PARTY_NOTICES.md \
    third_party/licenses/gorilla-websocket-LICENSE.txt \
    third_party/licenses/jezek-xgb-LICENSE.txt \
    third_party/licenses/golang-x-mod-LICENSE.txt \
    third_party/licenses/golang-x-sys-LICENSE.txt \
    third_party/novnc/LICENSE.txt third_party/novnc/UPSTREAM.json; do
    test -r "$share/$path" || {
      echo "missing installed release license/provenance file: $path" >&2
      exit 1
    }
  done
  test -d "$share/third_party/novnc/core" || {
    echo "missing installed corresponding noVNC source" >&2
    exit 1
  }
}

check_app_catalog() {
  local manager_bin=$1
  local package_root=$2
  local enabled_root=$3
  local host_checker=$4
  as_runtime_user "$manager_bin" \
    -check-app-catalog \
    -app-package-root "$package_root" \
    -apps-enabled "$enabled_root" >/dev/null
  as_runtime_user python3 -I "$host_checker" \
    --enabled-root "$enabled_root" --user "$runtime_user" --require-linger
}

# Installation administration may be root, but capability probes must use the
# account that will actually run the services. Never place UID switching in Core.
runtime_user="$(id -un)"
as_runtime_user() {
  local runtime_uid
  runtime_uid="$(id -u "$runtime_user")"
  if [[ "$runtime_uid" == "$(id -u)" ]]; then
    "$@"
  elif [[ "$(id -u)" == 0 ]]; then
    runuser -u "$runtime_user" -- env \
      PATH=/usr/local/bin:/usr/bin:/bin \
      XDG_RUNTIME_DIR="/run/user/$runtime_uid" \
      DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$runtime_uid/bus" "$@"
  else
    echo "run preflight as $runtime_user or an installation administrator" >&2
    return 1
  fi
}

# A user manager can be reachable through the correct bus while still holding
# host-wide environment values for another UID. systemd-run inherits that
# manager environment, so catch cross-user runtime/audio paths before Apps
# start (notably on images derived from a configured single-user desktop).
check_user_manager_environment() {
  local expected_uid expected_dir manager_environment key value
  expected_uid="$(id -u "$runtime_user")"
  expected_dir="/run/user/$expected_uid"
  manager_environment="$(as_runtime_user env \
    XDG_RUNTIME_DIR="$expected_dir" \
    DBUS_SESSION_BUS_ADDRESS="unix:path=$expected_dir/bus" \
    systemctl --user show-environment)" || {
    echo "user systemd manager is unavailable for $runtime_user" >&2
    return 1
  }
  while IFS='=' read -r key value; do
    case "$key" in
      XDG_RUNTIME_DIR)
        if [[ -n "$value" && "$value" != "$expected_dir" ]]; then
          echo "user manager XDG_RUNTIME_DIR does not match $runtime_user ($expected_dir)" >&2
          return 1
        fi
        ;;
      DBUS_SESSION_BUS_ADDRESS)
        if [[ -n "$value" && "$value" != "unix:path=$expected_dir/bus" && "$value" != "unix:path=$expected_dir/bus,"* ]]; then
          echo "user manager D-Bus address does not match $runtime_user" >&2
          return 1
        fi
        ;;
      PULSE_SERVER)
        if [[ "$value" == unix:/run/user/* && "$value" != "unix:$expected_dir/"* ]]; then
          echo "user manager PulseAudio socket does not match $runtime_user" >&2
          return 1
        fi
        ;;
    esac
  done <<<"$manager_environment"
}

if [[ "${1:-}" == "--installed-system" ]]; then
  runtime_user="${REMOTEXAPP_SYSTEM_USER:-remotexapp}"
  getent passwd "$runtime_user" >/dev/null || {
    echo "missing system runtime user: $runtime_user" >&2
    exit 1
  }
  [[ "$(id -u "$runtime_user")" != 0 ]] || {
    echo "system runtime user must not be root" >&2
    exit 1
  }
  for file in remotexappd novnc-input remotexapp-status remotexapp-operator-helper; do
    test -x "/usr/local/libexec/remotexapp/current/${file}" || {
      echo "missing installed binary: ${file}" >&2
      exit 1
    }
  done
  test -d /usr/local/share/remotexapp/current/configs/remotexapp-classes
  test -d /usr/local/share/remotexapp/current/drivers
  test -d /usr/local/share/remotexapp/apps
  test -d /etc/remotexapp/apps-enabled
  check_app_catalog /usr/local/libexec/remotexapp/current/remotexappd \
    /usr/local/share/remotexapp/apps /etc/remotexapp/apps-enabled \
    /usr/local/share/remotexapp/current/scripts/check-ubuntu-host.py
  check_installed_release_licenses
  test -r "/etc/remotexapp/remotexapp.env"
  test -r "/etc/systemd/system/remotexapp.service"
  test -r "/etc/systemd/user/remotexapp.service"
  test -r "/etc/systemd/user/remotexapp-operator.service"
  grep -qx 'User=remotexapp' /etc/systemd/system/remotexapp.service || {
    echo "system service must run as the dedicated remotexapp user" >&2
    exit 1
  }
  if grep -Eq '(^|[[:space:]])(sudo|su)([[:space:]]|$)' /etc/systemd/system/remotexapp.service; then
    echo "system service must not use sudo or su" >&2
    exit 1
  fi
  echo "RemoteXApp system installation preflight passed"
  exit 0
fi

if [[ "${1:-}" == "--installed-central-user" ]]; then
  runtime_user="${2:-}"
  [[ -n "$runtime_user" ]] || {
    echo "--installed-central-user requires a user name" >&2
    exit 2
  }
  getent passwd "$runtime_user" >/dev/null || {
    echo "missing runtime user: $runtime_user" >&2
    exit 1
  }
  [[ "$(id -u "$runtime_user")" != 0 ]] || {
    echo "runtime user must not be root" >&2
    exit 1
  }
  for file in remotexappd novnc-input remotexapp-status remotexapp-operator-helper; do
    test -x "/usr/local/libexec/remotexapp/current/${file}" || {
      echo "missing installed binary: ${file}" >&2
      exit 1
    }
  done
  test -d /usr/local/share/remotexapp/current/configs/remotexapp-classes
  test -d /usr/local/share/remotexapp/current/drivers
  test -d /usr/local/share/remotexapp/apps
  test -d /etc/remotexapp/apps-enabled
  check_app_catalog /usr/local/libexec/remotexapp/current/remotexappd \
    /usr/local/share/remotexapp/apps /etc/remotexapp/apps-enabled \
    /usr/local/share/remotexapp/current/scripts/check-ubuntu-host.py
  check_installed_release_licenses
  test -r "/etc/remotexapp/remotexapp.env"
  test -r "/etc/systemd/user/remotexapp.service"
  test -r "/etc/systemd/user/remotexapp-operator.service"
  if grep -Eq '^[[:space:]]*User=' /etc/systemd/user/remotexapp.service; then
    echo "central user service must inherit its user-manager identity" >&2
    exit 1
  fi
  if grep -Eq '(^|[[:space:]])(sudo|su)([[:space:]]|$)' /etc/systemd/user/remotexapp.service; then
    echo "central user service must not use sudo or su" >&2
    exit 1
  fi
  check_user_manager_environment
  echo "RemoteXApp central user installation preflight passed for $runtime_user"
  exit 0
fi

runtime_dir="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
if [[ ! -d "$runtime_dir" ]]; then
  echo "user runtime directory is unavailable: $runtime_dir" >&2
  exit 1
fi
if ! XDG_RUNTIME_DIR="$runtime_dir" DBUS_SESSION_BUS_ADDRESS="unix:path=$runtime_dir/bus" systemctl --user show-environment >/dev/null 2>&1; then
  echo "user systemd manager is unavailable" >&2
  exit 1
fi
check_user_manager_environment

if [[ "${1:-}" == "--installed" ]]; then
  install_root="${HOME}/.local"
  for file in remotexappd novnc-input remotexapp-status remotexapp-operator-helper; do
    test -x "${install_root}/libexec/remotexapp/current/${file}" || {
      echo "missing installed binary: ${file}" >&2
      exit 1
    }
  done
  test -r "${HOME}/.config/remotexapp/remotexapp.env"
  test -r "${HOME}/.config/systemd/user/remotexapp.service"
  test -r "${HOME}/.config/systemd/user/remotexapp-operator.service"
  test -d "${HOME}/.local/share/remotexapp/current/drivers/common"
  test -d "${HOME}/.local/share/remotexapp/apps"
  test -d "${HOME}/.config/remotexapp/apps-enabled"
  check_app_catalog "${install_root}/libexec/remotexapp/current/remotexappd" \
    "${HOME}/.local/share/remotexapp/apps" "${HOME}/.config/remotexapp/apps-enabled" \
    "${HOME}/.local/share/remotexapp/current/scripts/check-ubuntu-host.py"
fi

if [[ "${1:-}" != "--installed" ]]; then
  as_runtime_user python3 -I "$project_root/scripts/check-ubuntu-host.py" --user "$runtime_user"
fi

echo "RemoteXApp preflight passed"
