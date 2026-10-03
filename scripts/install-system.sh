#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
deployment_mode="dedicated"
runtime_user="remotexapp"
listen_override=""
start_service=false

usage() {
  cat <<'EOF'
usage:
  install-system.sh --dedicated [--start]
  install-system.sh --user USER --listen 127.0.0.1:PORT [--start]

--dedicated installs the system service under the locked remotexapp account.
--user provisions the centrally installed user service for an existing account.
EOF
}

while (( $# > 0 )); do
  case "$1" in
    --dedicated)
      deployment_mode="dedicated"
      runtime_user="remotexapp"
      shift
      ;;
    --user)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      deployment_mode="user"
      runtime_user="$2"
      shift 2
      ;;
    --listen)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      listen_override="$2"
      shift 2
      ;;
    --start)
      start_service=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if (( EUID != 0 )); then
  echo "system installation must run as root" >&2
  exit 1
fi

if [[ ! "$runtime_user" =~ ^[a-z_][a-z0-9_-]*[$]?$ ]]; then
  echo "unsafe runtime user name: $runtime_user" >&2
  exit 2
fi
if [[ "$deployment_mode" == "user" && -z "$listen_override" ]]; then
  echo "--user requires an explicit unique loopback --listen address" >&2
  exit 2
fi
if [[ "$deployment_mode" == "dedicated" && -n "$listen_override" ]]; then
  echo "--listen is only valid with --user; edit /etc/remotexapp/remotexapp.env for dedicated mode" >&2
  exit 2
fi
if [[ -n "$listen_override" && ! "$listen_override" =~ ^127[.]0[.]0[.]1:([1-9][0-9]{0,4})$ ]]; then
  echo "--listen must use 127.0.0.1 and a port from 1 to 65535" >&2
  exit 2
fi
if [[ -n "$listen_override" ]]; then
  listen_port="${listen_override##*:}"
  if (( listen_port > 65535 )); then
    echo "--listen port must not exceed 65535" >&2
    exit 2
  fi
fi

runtime_group="remotexapp"
install_prefix="/usr/local"
libexec_root="${install_prefix}/libexec/remotexapp"
share_root="${install_prefix}/share/remotexapp"
doc_root="${install_prefix}/share/doc/remotexapp"
config_root="/etc/remotexapp"
system_unit_root="/etc/systemd/system"
user_unit_root="/etc/systemd/user"
state_root="/var/lib/remotexapp"
backup_root="/var/lib/remotexapp-install-backups/$(date -u +%Y%m%dT%H%M%SZ)-$$"
release_version="$(<"$project_root/VERSION")"
if [[ ! "$release_version" =~ ^[0-9]+[.][0-9]+[.][0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
  echo "VERSION must contain a safe semantic version: $release_version" >&2
  exit 1
fi
libexec_release="$libexec_root/releases/$release_version"
share_release="$share_root/releases/$release_version"

required_commands=(diff getent install loginctl rsync runuser sed systemctl useradd)
for command_name in "${required_commands[@]}"; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "missing required command: $command_name" >&2
    exit 1
  }
done

for binary in remotexappd novnc-input remotexapp-status remotexapp-operator-helper; do
  if [[ ! -x "${project_root}/bin/${binary}" ]]; then
    echo "missing release binary: bin/${binary}; run make release-check first" >&2
    exit 1
  fi
done

if getent passwd "$runtime_user" >/dev/null; then
  runtime_uid="$(id -u "$runtime_user")"
  if [[ "$runtime_uid" == 0 ]]; then
    echo "refusing to use UID 0 for $runtime_user" >&2
    exit 1
  fi
elif [[ "$deployment_mode" == "dedicated" ]]; then
  useradd --system --user-group --home-dir "$state_root" --no-create-home \
    --shell /usr/sbin/nologin "$runtime_user"
  runtime_uid="$(id -u "$runtime_user")"
else
  echo "real-user deployment requires an existing account: $runtime_user" >&2
  exit 1
fi

runtime_home="$(getent passwd "$runtime_user" | cut -d: -f6)"
if [[ "$runtime_home" != /* || "$runtime_home" == "/" ]]; then
  echo "runtime user has an unsafe HOME: $runtime_home" >&2
  exit 1
fi
runtime_state_dir="$state_root"
if [[ "$deployment_mode" == "user" ]]; then
  runtime_state_dir="$runtime_home/.local/state/remotexapp"
fi
if [[ "$deployment_mode" == "user" ]]; then
  local_user_unit="$runtime_home/.config/systemd/user/remotexapp.service"
  local_user_dropins="$runtime_home/.config/systemd/user/remotexapp.service.d"
  if [[ -e "$local_user_unit" || -d "$local_user_dropins" ]]; then
    echo "a user-owned remotexapp unit or drop-in would shadow the central unit for $runtime_user" >&2
    echo "back it up and remove it before selecting --user mode: $local_user_unit" >&2
    exit 1
  fi
fi

retired_selector="$config_root/apps-enabled/xfce-desktop"
if [[ -e "$retired_selector" || -L "$retired_selector" ]]; then
  if [[ "$deployment_mode" == "dedicated" ]]; then
    manager_active_command=(systemctl is-active --quiet remotexapp.service)
  else
    manager_active_command=(runuser -u "$runtime_user" -- env
      "XDG_RUNTIME_DIR=/run/user/$runtime_uid"
      "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$runtime_uid/bus"
      systemctl --user is-active --quiet remotexapp.service)
  fi
  if "${manager_active_command[@]}"; then
    echo "stop remotexapp.service before retiring xfce-desktop" >&2
    exit 1
  fi
fi

if [[ "$deployment_mode" == "dedicated" && "$(id -gn "$runtime_user")" != "$runtime_group" ]]; then
  echo "$runtime_user must have primary group $runtime_group" >&2
  exit 1
fi

for target in "$libexec_root" "$share_root" "$doc_root" "$config_root" "$system_unit_root" "$user_unit_root" "$state_root"; do
  if [[ -L "$target" ]]; then
    echo "refusing symlinked installation target: $target" >&2
    exit 1
  fi
done

backup_created=false
backup_target() {
  local source="$1"
  local name="$2"
  if [[ -e "$source" ]]; then
    install -d -m 0700 "$backup_root"
    cp -a "$source" "$backup_root/$name"
    backup_created=true
  fi
}
backup_target "$libexec_root" libexec
backup_target "$share_root" share
backup_target "$user_unit_root/remotexapp.service" remotexapp-user.service
backup_target "$user_unit_root/remotexapp-operator.service" remotexapp-operator-user.service
if [[ "$deployment_mode" == "dedicated" ]]; then
  backup_target "$system_unit_root/remotexapp.service" remotexapp-system.service
fi

install -d -m 0755 "$libexec_root/releases" "$share_root/releases" "$share_root/apps" "$doc_root" "$config_root/users" "$config_root/apps-enabled" "$system_unit_root" "$user_unit_root"
if [[ "$deployment_mode" == "dedicated" ]]; then
  install -d -m 0700 -o "$runtime_user" -g "$runtime_group" "$state_root"
fi
"$project_root/scripts/stage-system-release.sh"
chown -R root:root "$libexec_root" "$share_root" "$doc_root"
chmod -R go-w "$libexec_root" "$share_root" "$doc_root"

"$project_root/scripts/install-shipped-apps.sh" "$libexec_release/remotexappd" \
  "$share_root/apps" "$config_root/apps-enabled" \
  --state-dir "$runtime_state_dir"
ln -sfn "releases/$release_version" "$libexec_root/current"
ln -sfn "releases/$release_version" "$share_root/current"

install -m 0644 "$project_root/docs/operations.md" "$doc_root/operations.md"
install -m 0644 "$project_root/deploy/systemd/remotexapp-central-user.service" "$user_unit_root/remotexapp.service"
install -m 0644 "$project_root/deploy/systemd/remotexapp-central-user-operator.service" "$user_unit_root/remotexapp-operator.service"
if [[ ! -e "$config_root/remotexapp.env" ]]; then
  install -m 0644 -o root -g root \
    "$project_root/deploy/examples/remotexapp-system.env" "$config_root/remotexapp.env"
elif grep -qx 'REMOTEXAPP_CLASS_CONFIG=/usr/local/share/remotexapp/configs/remotexapp-classes' "$config_root/remotexapp.env"; then
  sed -i 's|^REMOTEXAPP_CLASS_CONFIG=/usr/local/share/remotexapp/configs/remotexapp-classes$|REMOTEXAPP_CLASS_CONFIG=/usr/local/share/remotexapp/current/configs/remotexapp-classes|' "$config_root/remotexapp.env"
fi

if ! runuser -u "$runtime_user" -- test -r "$config_root/remotexapp.env"; then
  echo "$config_root/remotexapp.env must be readable by $runtime_user" >&2
  exit 1
fi

if [[ "$deployment_mode" == "dedicated" ]]; then
  install -m 0644 "$project_root/deploy/systemd/remotexapp-system.service" "$system_unit_root/remotexapp.service"
else
  user_override="$config_root/users/${runtime_user}.env"
  if [[ ! -e "$user_override" ]]; then
    temporary_override="$(mktemp)"
    printf '%s\n' \
      '# Administrator-owned RemoteXApp overrides for this Unix user.' \
      "REMOTEXAPP_LISTEN=${listen_override}" >"$temporary_override"
    install -m 0644 -o root -g root "$temporary_override" "$user_override"
    rm -f "$temporary_override"
  elif ! grep -qx "REMOTEXAPP_LISTEN=${listen_override}" "$user_override"; then
    echo "existing $user_override does not match --listen $listen_override; preserving it" >&2
    exit 1
  fi
fi

loginctl enable-linger "$runtime_user"
systemctl daemon-reload
systemctl start "user@${runtime_uid}.service"

if [[ "$deployment_mode" == "dedicated" ]]; then
  "$project_root/scripts/preflight.sh" --installed-system
  service_command="systemctl enable --now remotexapp.service"
else
  "$project_root/scripts/preflight.sh" --installed-central-user "$runtime_user"
  user_systemctl=(runuser -u "$runtime_user" -- env \
    "XDG_RUNTIME_DIR=/run/user/${runtime_uid}" \
    "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${runtime_uid}/bus" \
    systemctl --user)
  "${user_systemctl[@]}" daemon-reload
  service_command="systemctl --user enable --now remotexapp.service (as $runtime_user)"
fi

if [[ "$start_service" == true ]]; then
  if [[ "$deployment_mode" == "dedicated" ]]; then
    systemctl enable --now remotexapp.service
  else
    "${user_systemctl[@]}" enable --now remotexapp.service
  fi
fi

echo "installed and activated immutable RemoteXApp $release_version in $deployment_mode mode for $runtime_user (UID $runtime_uid)"
if [[ "$backup_created" == true ]]; then
  echo "previous system installation backup: $backup_root"
fi
if [[ "$start_service" != true ]]; then
  echo "review $config_root/remotexapp.env and any user override, then run: $service_command"
fi
