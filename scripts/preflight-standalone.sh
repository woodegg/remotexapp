#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: preflight-standalone.sh --user USER --cgroup-root DIR --site-display-config FILE --listen 127.0.0.1:PORT [--inside-cgroup]" >&2
}

runtime_user=""
cgroup_root=""
site_display_config=""
listen=""
inside_cgroup=false
while (( $# > 0 )); do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --user) [[ $# -ge 2 ]] || { usage; exit 2; }; runtime_user="$2"; shift 2 ;;
    --cgroup-root) [[ $# -ge 2 ]] || { usage; exit 2; }; cgroup_root="$2"; shift 2 ;;
    --site-display-config) [[ $# -ge 2 ]] || { usage; exit 2; }; site_display_config="$2"; shift 2 ;;
    --listen) [[ $# -ge 2 ]] || { usage; exit 2; }; listen="$2"; shift 2 ;;
    --inside-cgroup) inside_cgroup=true; shift ;;
    *) usage; exit 2 ;;
  esac
done

[[ -n "$runtime_user" && -n "$cgroup_root" && -n "$site_display_config" && -n "$listen" ]] || { usage; exit 2; }
[[ "$(id -un)" == "$runtime_user" && "$(id -u)" != 0 ]] || { echo "run preflight as the selected non-root account" >&2; exit 1; }
[[ "$listen" =~ ^127[.]0[.]0[.]1:([1-9][0-9]{0,4})$ ]] || { echo "standalone listener must be loopback" >&2; exit 1; }
(( ${BASH_REMATCH[1]} <= 65535 )) || { echo "listener port exceeds 65535" >&2; exit 1; }
[[ "$cgroup_root" == /sys/fs/cgroup/* && "$cgroup_root" != *".."* && -d "$cgroup_root" && ! -L "$cgroup_root" ]] || { echo "invalid delegated cgroup root" >&2; exit 1; }
[[ "$(stat -c %u "$cgroup_root")" == "$(id -u)" && "$(stat -f -c %T "$cgroup_root")" == cgroup2fs ]] || { echo "cgroup root has the wrong owner or filesystem" >&2; exit 1; }
[[ -w "$cgroup_root/cgroup.procs" && -r "$cgroup_root/cgroup.events" ]] || { echo "cgroup root is not delegated to $runtime_user" >&2; exit 1; }
[[ -f "$site_display_config" && ! -L "$site_display_config" && -r "$site_display_config" ]] || { echo "site display config is unavailable" >&2; exit 1; }
[[ "$(stat -c %u "$site_display_config")" == 0 ]] || { echo "site display config must be administrator-owned" >&2; exit 1; }
[[ "$(stat -c %a "$site_display_config")" =~ ^[0-7][04][04]$ ]] || { echo "site display config must not be group/world writable" >&2; exit 1; }

runtime_dir="/run/user/$(id -u)"
[[ -d "$runtime_dir" && "$(stat -c %u "$runtime_dir")" == "$(id -u)" ]] || { echo "private user runtime directory is unavailable" >&2; exit 1; }
[[ "$(stat -c %a "$runtime_dir")" == 700 ]] || { echo "user runtime directory must be mode 0700" >&2; exit 1; }
[[ -S "$runtime_dir/bus" ]] || { echo "account D-Bus socket is unavailable" >&2; exit 1; }

for command_name in Xtigervnc xauth dbus-daemon dbus-send ibus ibus-daemon python3 xdotool; do
  command -v "$command_name" >/dev/null 2>&1 || { echo "missing $command_name" >&2; exit 1; }
done
DBUS_SESSION_BUS_ADDRESS="unix:path=$runtime_dir/bus" dbus-send --session --dest=org.freedesktop.DBus --type=method_call --print-reply / org.freedesktop.DBus.ListNames >/dev/null
python3 -I -c 'import gi; gi.require_version("IBus", "1.0"); from gi.repository import GLib, IBus'
python3 -I - "$site_display_config" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as source:
    config = json.load(source)
assert config.get("schemaVersion") == 1
assert isinstance(config.get("fixedDisplays"), dict)
assert "xfce-user-desktop" in config["fixedDisplays"]
PY

if [[ "$inside_cgroup" == true ]]; then
  relative="${cgroup_root#/sys/fs/cgroup}"
  membership="$(sed -n 's/^0:://p' /proc/self/cgroup)"
  [[ "$membership" == "$relative" || "$membership" == "$relative/"* ]] || { echo "process is outside the delegated cgroup subtree" >&2; exit 1; }
fi

echo "standalone host preflight passed for $runtime_user on $listen"
