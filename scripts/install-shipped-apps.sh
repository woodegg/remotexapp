#!/usr/bin/env bash
set -euo pipefail

if (( $# < 3 )); then
  echo "usage: install-shipped-apps.sh MANAGER_BIN PACKAGE_ROOT ENABLED_ROOT [--no-activate] [--state-dir DIR]" >&2
  exit 2
fi

manager_bin=$1
package_root=$2
enabled_root=$3
shift 3
activate=true
state_dir=""
while (( $# > 0 )); do
  case "$1" in
    --no-activate)
      activate=false
      shift
      ;;
    --state-dir)
      [[ $# -ge 2 ]] || { echo "--state-dir requires a value" >&2; exit 2; }
      state_dir=$2
      shift 2
      ;;
    *)
      echo "unknown option: $1" >&2
      exit 2
      ;;
  esac
done

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
artifact_root="$project_root/app-packages"
temporary_root=""
retired_apps=(xfce-desktop)

if [[ ! -d "$artifact_root" ]]; then
  temporary_root="$(mktemp -d)"
  artifact_root="$temporary_root"
  for source_dir in "$project_root"/apps/*; do
    [[ -d "$source_dir" ]] || continue
    "$project_root/scripts/package-app.sh" "$source_dir" "$artifact_root" >/dev/null
  done
fi
trap '[[ -z "$temporary_root" ]] || rm -rf -- "$temporary_root"' EXIT

shopt -s nullglob
archives=("$artifact_root"/*.tar.gz)
(( ${#archives[@]} > 0 )) || {
  echo "no shipped App Package artifacts found under $artifact_root" >&2
  exit 1
}

declare -a shipped_ids=()
declare -a shipped_versions=()
declare -A shipped_seen=()
for archive in "${archives[@]}"; do
  read -r app_id app_version < <(python3 - "$archive" <<'PY'
import json, sys, tarfile
with tarfile.open(sys.argv[1], "r:gz") as archive:
    member = next((item for item in archive.getmembers() if item.name in {"manifest.json", "./manifest.json"}), None)
    if member is None or not member.isfile():
        raise SystemExit("App Package archive has no regular manifest.json")
    source = archive.extractfile(member)
    manifest = json.load(source)
app_id = manifest.get("id")
version = manifest.get("driverVersion")
if not isinstance(app_id, str) or not isinstance(version, str):
    raise SystemExit("App Package manifest identity is invalid")
print(app_id, version)
PY
  )
  [[ -z "${shipped_seen[$app_id]:-}" ]] || {
    echo "shipped App Package id is repeated: $app_id" >&2
    exit 1
  }
  shipped_seen[$app_id]=1
  shipped_ids+=("$app_id")
  shipped_versions+=("$app_version")
  archive_sha="$(sha256sum "$archive" | cut -d' ' -f1)"
  "$manager_bin" \
    -install-app-archive "$archive" \
    -install-app-sha256 "$archive_sha" \
    -install-app-activate=false \
    -app-package-root "$package_root" \
    -apps-enabled "$enabled_root" >/dev/null
done

if [[ "$activate" != true ]]; then
  exit 0
fi

transition_ids=("${shipped_ids[@]}")
for retired_id in "${retired_apps[@]}"; do
  if [[ -z "${shipped_seen[$retired_id]:-}" ]]; then
    transition_ids+=("$retired_id")
  fi
done

canonical_package_root="$(realpath "$package_root")"
declare -A old_present=()
declare -A old_versions=()
for app_id in "${transition_ids[@]}"; do
  selector="$enabled_root/$app_id"
  old_present[$app_id]=false
  if [[ -L "$selector" ]]; then
    resolved="$(realpath "$selector")"
    case "$resolved" in
      "$canonical_package_root"/*) relative="${resolved#"$canonical_package_root"/}" ;;
      *) echo "enabled App Package $selector resolves outside $canonical_package_root" >&2; exit 1 ;;
    esac
    IFS=/ read -r target_id target_version extra <<<"$relative"
    [[ "$target_id" == "$app_id" && "$target_version" =~ ^(0|[1-9][0-9]*)[.](0|[1-9][0-9]*)[.](0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$ && -z "${extra:-}" ]] || {
      echo "enabled App Package $selector does not resolve to ID/VERSION" >&2
      exit 1
    }
    old_present[$app_id]=true
    old_versions[$app_id]=$target_version
  elif [[ -e "$selector" ]]; then
    echo "refusing non-symlink enabled App Package selector: $selector" >&2
    exit 1
  fi
done

for retired_id in "${retired_apps[@]}"; do
  if [[ "${old_present[$retired_id]:-false}" == true && -z "$state_dir" ]]; then
    echo "retiring $retired_id requires --state-dir and a stopped manager" >&2
    exit 1
  fi
done

restore_previous_catalog() {
  local restore_failed=0
  for app_id in "${transition_ids[@]}"; do
    if [[ "${old_present[$app_id]:-false}" == true ]]; then
      "$manager_bin" -activate-app "$app_id@${old_versions[$app_id]}" \
        -app-package-root "$package_root" -apps-enabled "$enabled_root" >/dev/null || restore_failed=1
    else
      "$manager_bin" -disable-app "$app_id" \
        -app-package-root "$package_root" -apps-enabled "$enabled_root" >/dev/null || restore_failed=1
    fi
  done
  return "$restore_failed"
}

transition_failed=false
for retired_id in "${retired_apps[@]}"; do
  if [[ "${old_present[$retired_id]:-false}" != true ]]; then
    continue
  fi
  if ! "$manager_bin" -retire-app "$retired_id" -state-dir "$state_dir" \
      -app-package-root "$package_root" -apps-enabled "$enabled_root" >/dev/null; then
    transition_failed=true
    break
  fi
done
if [[ "$transition_failed" != true ]]; then
  for index in "${!shipped_ids[@]}"; do
    if ! "$manager_bin" -activate-app "${shipped_ids[$index]}@${shipped_versions[$index]}" \
        -app-package-root "$package_root" -apps-enabled "$enabled_root" >/dev/null; then
      transition_failed=true
      break
    fi
  done
fi

if [[ "$transition_failed" == true ]]; then
  if restore_previous_catalog; then
    echo "shipped App catalog transition failed; previous selectors restored" >&2
  else
    echo "shipped App catalog transition failed and selector restoration was incomplete" >&2
  fi
  exit 1
fi

printf 'activated %d shipped App Packages; retired %d explicit selector(s)\n' \
  "${#shipped_ids[@]}" "${#retired_apps[@]}"
