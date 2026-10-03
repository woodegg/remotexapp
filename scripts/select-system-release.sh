#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  select-system-release.sh --dedicated VERSION [--start] [--health-url URL] [--health-timeout SECONDS] [--expected-commit COMMIT]
  select-system-release.sh --user USER VERSION [--start] [--health-url URL] [--health-timeout SECONDS] [--expected-commit COMMIT]

Select an already installed immutable system release. The manager is stopped
before both core selectors change. Starting either the selected or previously
active release requires --health-url. A failed service start or health check
restores both previous selectors and verifies the restored release.
EOF
}

mode=""
runtime_user=""
version=""
start_service=false
health_url=""
health_timeout_seconds=120
expected_commit=""

while (( $# > 0 )); do
  case "$1" in
    --dedicated)
      [[ -z "$mode" ]] || { usage >&2; exit 2; }
      mode="dedicated"
      runtime_user="remotexapp"
      shift
      ;;
    --user)
      [[ -z "$mode" && $# -ge 2 ]] || { usage >&2; exit 2; }
      mode="user"
      runtime_user="$2"
      shift 2
      ;;
    --start)
      start_service=true
      shift
      ;;
    --health-url)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      health_url="${2%/}"
      shift 2
      ;;
    --health-timeout)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      health_timeout_seconds="$2"
      shift 2
      ;;
    --expected-commit)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      expected_commit="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --*)
      echo "unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      [[ -z "$version" ]] || { usage >&2; exit 2; }
      version="$1"
      shift
      ;;
  esac
done

[[ $EUID -eq 0 ]] || { echo "system release selection must run as root" >&2; exit 1; }
[[ -n "$mode" && -n "$version" ]] || { usage >&2; exit 2; }
[[ "$runtime_user" =~ ^[a-z_][a-z0-9_-]*[$]?$ ]] || {
  echo "unsafe runtime user name: $runtime_user" >&2
  exit 2
}
[[ "$version" =~ ^[0-9]+[.][0-9]+[.][0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || {
  echo "unsafe release version: $version" >&2
  exit 2
}
[[ -z "$expected_commit" || "$expected_commit" =~ ^[A-Fa-f0-9]{7,64}$ ]] || {
  echo "expected commit must be a 7-64 character hexadecimal ID" >&2
  exit 2
}
[[ -z "$health_url" || "$health_url" =~ ^https?://[^[:space:]]+$ ]] || {
  echo "health URL must be an absolute HTTP(S) URL" >&2
  exit 2
}
[[ "$health_timeout_seconds" =~ ^[1-9][0-9]*$ ]] &&
  (( health_timeout_seconds <= 600 )) || {
  echo "health timeout must be an integer from 1 through 600 seconds" >&2
  exit 2
}

for command_name in curl date flock jq readlink runuser systemctl; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "missing required command: $command_name" >&2
    exit 1
  }
done
getent passwd "$runtime_user" >/dev/null || {
  echo "runtime user does not exist: $runtime_user" >&2
  exit 1
}
runtime_uid="$(id -u "$runtime_user")"
[[ "$runtime_uid" != 0 ]] || { echo "refusing to use UID 0" >&2; exit 1; }

libexec_root=/usr/local/libexec/remotexapp
share_root=/usr/local/share/remotexapp
libexec_release="$libexec_root/releases/$version"
share_release="$share_root/releases/$version"
required_executables=(remotexappd novnc-input remotexapp-status)
release_manifest="$libexec_release/release-manifest.json"
if [[ -e "$release_manifest" ]]; then
  [[ -f "$release_manifest" && ! -L "$release_manifest" ]] || {
    echo "release manifest must be a regular file: $release_manifest" >&2
    exit 1
  }
  if ! jq -e --arg version "$version" '
    .schemaVersion == 1 and .version == $version and
    .requiredExecutables == [
      "remotexappd", "novnc-input", "remotexapp-status",
      "remotexapp-operator-helper"
    ]
  ' "$release_manifest" >/dev/null; then
    echo "release manifest is invalid: $release_manifest" >&2
    exit 1
  fi
  required_executables+=(remotexapp-operator-helper)
fi
for binary in "${required_executables[@]}"; do
  [[ -x "$libexec_release/$binary" ]] || {
    echo "release binary is missing: $libexec_release/$binary" >&2
    exit 1
  }
done
[[ -f "$libexec_release/VERSION" && "$(<"$libexec_release/VERSION")" == "$version" ]] || {
  echo "libexec release VERSION does not match $version" >&2
  exit 1
}
[[ -f "$share_release/VERSION" && "$(<"$share_release/VERSION")" == "$version" ]] || {
  echo "share release VERSION does not match $version" >&2
  exit 1
}
[[ -d "$share_release/drivers" && -d "$share_release/components" ]] || {
  echo "share release is incomplete: $share_release" >&2
  exit 1
}

exec 9>/run/lock/remotexapp-release-select.lock
flock -n 9 || { echo "another RemoteXApp release selection is active" >&2; exit 1; }

if [[ "$mode" == "dedicated" ]]; then
  service=(systemctl)
else
  service=(runuser -u "$runtime_user" -- env
    "XDG_RUNTIME_DIR=/run/user/$runtime_uid"
    "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$runtime_uid/bus"
    systemctl --user)
fi

old_libexec_link="$(readlink "$libexec_root/current")"
old_share_link="$(readlink "$share_root/current")"
[[ "$old_libexec_link" =~ ^releases/[0-9A-Za-z._-]+$ ]] || {
  echo "unsafe current libexec selector: ${old_libexec_link:-missing}" >&2
  exit 1
}
[[ "$old_share_link" =~ ^releases/[0-9A-Za-z._-]+$ ]] || {
  echo "unsafe current share selector: ${old_share_link:-missing}" >&2
  exit 1
}
[[ -d "$libexec_root/$old_libexec_link" && -d "$share_root/$old_share_link" ]] || {
  echo "current selectors do not resolve to retained releases" >&2
  exit 1
}

was_active=false
if "${service[@]}" is-active --quiet remotexapp.service; then
  was_active=true
fi
should_start=$start_service
if [[ "$was_active" == true ]]; then
  should_start=true
fi
if [[ "$should_start" == true && -z "$health_url" ]]; then
  echo "--health-url is required when release selection starts the service" >&2
  exit 2
fi

old_version="${old_libexec_link#releases/}"
[[ "$old_share_link" == "releases/$old_version" ]] || {
  echo "current libexec and share selectors name different releases" >&2
  exit 1
}

libexec_tmp="$libexec_root/.current.$$.new"
share_tmp="$share_root/.current.$$.new"
cleanup() {
  rm -f -- "$libexec_tmp" "$share_tmp"
}
trap cleanup EXIT

select_links() {
  local libexec_link="$1"
  local share_link="$2"
  rm -f -- "$libexec_tmp" "$share_tmp"
  ln -s "$libexec_link" "$libexec_tmp"
  ln -s "$share_link" "$share_tmp"
  mv -T "$libexec_tmp" "$libexec_root/current"
  mv -T "$share_tmp" "$share_root/current"
}

wait_for_health() {
  local wanted_version="$1"
  local wanted_commit="$2"
  local body
  local deadline
  deadline="$(( $(date +%s) + health_timeout_seconds ))"
  while (( $(date +%s) <= deadline )); do
    if body="$(curl --max-time 2 --fail --silent --show-error "$health_url/api/version" 2>/dev/null)"; then
      if jq -e --arg version "$wanted_version" --arg commit "$wanted_commit" '
        .version == $version and ($commit == "" or .commit == $commit)
      ' <<<"$body" >/dev/null; then
        return 0
      fi
    fi
    sleep 0.25
  done
  return 1
}

restore_previous() {
  echo "restoring previous RemoteXApp selectors" >&2
  "${service[@]}" stop remotexapp.service >/dev/null 2>&1 || true
  select_links "$old_libexec_link" "$old_share_link"
  if [[ "$should_start" == true ]]; then
    "${service[@]}" start remotexapp.service
    if ! wait_for_health "$old_version" ""; then
      "${service[@]}" stop remotexapp.service >/dev/null 2>&1 || true
      echo "previous RemoteXApp $old_version failed its restore health check" >&2
      return 1
    fi
  fi
}

fail_and_restore() {
  local message="$1"
  if restore_previous; then
    echo "$message; previous release restored and verified" >&2
    exit 1
  fi
  echo "$message; previous selectors were restored but service recovery failed" >&2
  exit 1
}

"${service[@]}" stop remotexapp.service
if ! select_links "releases/$version" "releases/$version"; then
  fail_and_restore "RemoteXApp $version selector update failed"
fi
if [[ "$should_start" == true ]]; then
  if ! "${service[@]}" start remotexapp.service; then
    fail_and_restore "RemoteXApp $version failed to start"
  fi
  if ! wait_for_health "$version" "$expected_commit"; then
    fail_and_restore "RemoteXApp $version failed its version/commit health check"
  fi
fi

printf 'selected RemoteXApp %s for %s; service_active=%s\n' \
  "$version" "$runtime_user" "$should_start"
