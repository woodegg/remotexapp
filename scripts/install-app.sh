#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "$script_dir/.." && pwd)"
default_manager="$project_root/bin/remotexappd"
if [[ -x "$script_dir/remotexappd" ]]; then
  default_manager="$script_dir/remotexappd"
fi
manager_bin="${REMOTEXAPPD_BIN:-$default_manager}"
archive=""
sha256=""
package_root=""
enabled_root=""
activate=true

usage() {
  echo "usage: install-app.sh --archive FILE --sha256 HEX --package-root DIR --enabled-root DIR [--no-activate]" >&2
}

while (( $# > 0 )); do
  case "$1" in
    --archive)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      archive="$2"
      shift 2
      ;;
    --sha256)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      sha256="$2"
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
    --no-activate)
      activate=false
      shift
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

[[ -n "$archive" && -n "$sha256" && -n "$package_root" && -n "$enabled_root" ]] || {
  usage
  exit 2
}
[[ -x "$manager_bin" ]] || {
  echo "RemoteXApp manager binary is not executable: $manager_bin" >&2
  exit 1
}

exec "$manager_bin" \
  -install-app-archive "$archive" \
  -install-app-sha256 "$sha256" \
  -install-app-activate="$activate" \
  -app-package-root "$package_root" \
  -apps-enabled "$enabled_root"
