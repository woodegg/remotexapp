#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

version="$(<VERSION)"
goos="$(go env GOOS)"
goarch="$(go env GOARCH)"
artifact="remotexapp-${version}-${goos}-${goarch}"
dist_dir="${DIST_DIR:-$project_root/dist}"
source_date_epoch="${SOURCE_DATE_EPOCH:-$(git log -1 --format=%ct)}"

node scripts/check-release.mjs
for binary in remotexappd novnc-input remotexapp-status remotexapp-operator-helper; do
  [[ -x "bin/$binary" ]] || { echo "missing bin/$binary; run make build" >&2; exit 1; }
done

stage="$(mktemp -d)"
trap 'rm -rf -- "$stage"' EXIT
root="$stage/$artifact"
install -d -m 0755 "$root/bin" "$root/docs" "$root/scripts" "$root/third_party/licenses" "$root/app-packages"
install -m 0755 bin/remotexappd bin/novnc-input bin/remotexapp-status bin/remotexapp-operator-helper "$root/bin/"
cp -a apps components configs deploy drivers "$root/"
install -m 0755 scripts/install-system.sh scripts/install-app.sh scripts/install-shipped-apps.sh scripts/manage-app.sh scripts/package-app.sh scripts/preflight.sh scripts/preflight-standalone.sh scripts/select-system-release.sh scripts/stage-system-release.sh scripts/verify-release-candidate.sh "$root/scripts/"
install -m 0644 scripts/check-evidence.mjs scripts/evidence-lib.mjs scripts/verify-candidate-evidence.mjs "$root/scripts/"
install -m 0644 scripts/check-ubuntu-host.py "$root/scripts/"
for app_source in apps/*; do
  [[ -d "$app_source" ]] || continue
  scripts/package-app.sh "$app_source" "$root/app-packages" >/dev/null
done
install -m 0644 README.md CHANGELOG.md SECURITY.md LICENSE NOTICE THIRD_PARTY_NOTICES.md VERSION "$root/"
install -m 0644 docs/operations.md docs/integration-guide.md docs/release-policy.md docs/release-process.md docs/development-quality-process.md docs/current-state.md "$root/docs/"
install -m 0644 docs/runtime-upgrade-api.md docs/runtime-upgrade-release.md docs/kate-kwrite-control-research.md docs/agent-connections.md "$root/docs/"
install -m 0644 docs/console-connections-release.md "$root/docs/"
install -m 0644 docs/app-actions-release.md "$root/docs/"
install -m 0644 docs/session-services-release.md "$root/docs/"
install -m 0644 docs/ubuntu-host-compatibility-release.md "$root/docs/"
install -m 0644 docs/clipboard-prompt-consistency-release.md "$root/docs/"
install -m 0644 docs/connection-mask-release.md docs/browser-sdk.md docs/dependencies.md docs/project-positioning.md "$root/docs/"
install -m 0644 docs/runtime-coordinator-release.md docs/release-pending.md "$root/docs/"
install -m 0644 docs/standalone-runit-release.md "$root/docs/"
install -m 0644 docs/waos-runtime-coordinator-migration.md "$root/docs/"
cp -a third_party/novnc "$root/third_party/"
install -m 0644 third_party/licenses/gorilla-websocket-LICENSE.txt "$root/third_party/licenses/"
install -m 0644 third_party/licenses/jezek-xgb-LICENSE.txt "$root/third_party/licenses/"
install -m 0644 third_party/licenses/golang-x-mod-LICENSE.txt "$root/third_party/licenses/"
install -m 0644 third_party/licenses/golang-x-sys-LICENSE.txt "$root/third_party/licenses/"

mkdir -p "$dist_dir"
archive="$dist_dir/$artifact.tar.gz"
tar --sort=name --mtime="@$source_date_epoch" --owner=0 --group=0 --numeric-owner \
  --exclude='__pycache__' --exclude='*.pyc' --exclude='*.pyo' \
  -C "$stage" -cf - "$artifact" | gzip -n > "$archive"
(
  cd "$dist_dir"
  sha256sum "$(basename "$archive")" > SHA256SUMS
)
./scripts/check-sensitive-data.sh "$archive"
echo "release artifact: $archive"
