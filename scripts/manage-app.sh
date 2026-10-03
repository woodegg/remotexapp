#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "$script_dir/.." && pwd)"
default_manager="$project_root/bin/remotexappd"
if [[ -x "$script_dir/remotexappd" ]]; then
  default_manager="$script_dir/remotexappd"
fi
manager_bin="${REMOTEXAPPD_BIN:-$default_manager}"
package_root=""
enabled_root=""
operation=""
value=""
state_dir=""

usage() {
  echo "usage: manage-app.sh (--activate ID@VERSION | --disable ID | --retire ID --state-dir DIR) --package-root DIR --enabled-root DIR" >&2
}

while (( $# > 0 )); do
  case "$1" in
    --activate|--disable|--retire)
      [[ $# -ge 2 && -z "$operation" ]] || { usage; exit 2; }
      operation="${1#--}"
      value="$2"
      shift 2
      ;;
    --state-dir)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      state_dir="$2"
      shift 2
      ;;
    --package-root)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      package_root="$2"
      shift 2
      ;;
    --enabled-root)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      enabled_root="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

[[ -n "$operation" && -n "$value" && -n "$package_root" && -n "$enabled_root" ]] || {
  usage
  exit 2
}
if [[ "$operation" == retire && -z "$state_dir" ]]; then
  echo "--retire requires --state-dir" >&2
  exit 2
fi
[[ -x "$manager_bin" ]] || {
  echo "RemoteXApp manager binary is not executable: $manager_bin" >&2
  exit 1
}

args=(
  "-${operation}-app" "$value"
  -app-package-root "$package_root"
  -apps-enabled "$enabled_root"
)
if [[ "$operation" == retire ]]; then
  args+=(-state-dir "$state_dir")
fi
exec "$manager_bin" "${args[@]}"
