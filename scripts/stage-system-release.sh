#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
destdir=""

usage() {
  cat <<'EOF'
usage: stage-system-release.sh [--destdir ABSOLUTE_DIRECTORY]

Publish the built core and shipped App Packages into immutable system release
directories without changing any current or enabled selector. The default
target is the live system and requires root. --destdir stages an offline root
and is intended for packaging and tests.
EOF
}

while (( $# > 0 )); do
  case "$1" in
    --destdir)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      destdir="${2%/}"
      shift 2
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

if [[ -z "$destdir" ]]; then
  (( EUID == 0 )) || { echo "live system release staging must run as root" >&2; exit 1; }
else
  [[ "$destdir" == /* && "$destdir" != "/" && -d "$destdir" && ! -L "$destdir" ]] || {
    echo "--destdir must be an existing absolute real directory other than /" >&2
    exit 2
  }
fi

release_version="$(<"$project_root/VERSION")"
[[ "$release_version" =~ ^[0-9]+[.][0-9]+[.][0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || {
  echo "VERSION must contain a safe semantic version: $release_version" >&2
  exit 1
}

for command_name in diff install mktemp rsync; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "missing required command: $command_name" >&2
    exit 1
  }
done
for binary in remotexappd novnc-input remotexapp-status remotexapp-operator-helper; do
  [[ -x "$project_root/bin/$binary" ]] || {
    echo "missing release binary: bin/$binary; run make release-check first" >&2
    exit 1
  }
done

libexec_root="$destdir/usr/local/libexec/remotexapp"
share_root="$destdir/usr/local/share/remotexapp"
enabled_root="$destdir/etc/remotexapp/apps-enabled"
libexec_release="$libexec_root/releases/$release_version"
share_release="$share_root/releases/$release_version"

for target in "$libexec_root" "$share_root" "$enabled_root"; do
  [[ ! -L "$target" ]] || {
    echo "refusing symlinked staging target: $target" >&2
    exit 1
  }
done
install -d -m 0755 "$libexec_root/releases" "$share_root/releases" \
  "$share_root/apps" "$enabled_root"

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
release_manifest_stage="$(mktemp)"
trap 'rm -rf -- "${libexec_stage:-}" "${share_stage:-}"; rm -f -- "${release_manifest_stage:-}"' EXIT
printf '%s\n' \
  '{' \
  '  "schemaVersion": 1,' \
  "  \"version\": \"$release_version\"," \
  '  "requiredExecutables": [' \
  '    "remotexappd",' \
  '    "novnc-input",' \
  '    "remotexapp-status",' \
  '    "remotexapp-operator-helper"' \
  '  ]' \
  '}' >"$release_manifest_stage"
install -m 0644 "$release_manifest_stage" "$libexec_stage/release-manifest.json"
rm -f -- "$release_manifest_stage"
release_manifest_stage=""
install -d -m 0755 "$share_stage/configs" "$share_stage/drivers" \
  "$share_stage/components" "$share_stage/third_party/licenses" "$share_stage/scripts"
install -m 0644 "$project_root/scripts/check-ubuntu-host.py" "$share_stage/scripts/"
install -m 0755 "$project_root/scripts/preflight-standalone.sh" "$share_stage/scripts/"
rsync --archive "$project_root/configs/" "$share_stage/configs/"
rsync --archive "$project_root/drivers/" "$share_stage/drivers/"
rsync --archive "$project_root/components/" "$share_stage/components/"
cp -a "$project_root/third_party/novnc" "$share_stage/third_party/"
install -m 0644 "$project_root/third_party/licenses/gorilla-websocket-LICENSE.txt" \
  "$project_root/third_party/licenses/jezek-xgb-LICENSE.txt" \
  "$project_root/third_party/licenses/golang-x-mod-LICENSE.txt" \
  "$project_root/third_party/licenses/golang-x-sys-LICENSE.txt" \
  "$share_stage/third_party/licenses/"
install -m 0644 "$project_root/LICENSE" "$project_root/NOTICE" \
  "$project_root/THIRD_PARTY_NOTICES.md" "$project_root/VERSION" "$share_stage/"

publish_release() {
  local stage="$1"
  local target="$2"
  if [[ -e "$target" ]]; then
    if ! diff -qr "$stage" "$target" >/dev/null; then
      echo "refusing to modify published release $target; bump VERSION" >&2
      return 1
    fi
    rm -rf -- "$stage"
  else
    mv -- "$stage" "$target"
  fi
}
publish_release "$libexec_stage" "$libexec_release"
publish_release "$share_stage" "$share_release"
chmod 0755 "$libexec_release" "$share_release"
if (( EUID == 0 )); then
  chown -R root:root "$libexec_root" "$share_root"
fi
chmod -R go-w "$libexec_root" "$share_root"

"$project_root/scripts/install-shipped-apps.sh" "$libexec_release/remotexappd" \
  "$share_root/apps" "$enabled_root" --no-activate

printf 'staged immutable RemoteXApp %s; core and App selectors unchanged\n' \
  "$release_version"
