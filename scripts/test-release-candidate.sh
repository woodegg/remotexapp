#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 4 ]]; then
  echo "usage: $0 ARCHIVE SHA256SUMS EVIDENCE EXPECTED_COMMIT" >&2
  exit 2
fi

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
archive="$(readlink -f "$1")"
checksums="$(readlink -f "$2")"
evidence="$(readlink -f "$3")"
expected_commit=$4

"$project_root/scripts/verify-release-candidate.sh" \
  "$archive" "$checksums" "$evidence" "$expected_commit"

stage="$(mktemp -d)"
trap 'rm -rf -- "$stage"' EXIT
tar -xzf "$archive" -C "$stage"
release_root="$stage/$(basename "$archive" .tar.gz)"

REMOTEXAPP_APP_E2E_RELEASE_ROOT="$release_root" \
  "$project_root/tests/app-package/run-local-e2e.sh"
REMOTEXAPP_SHIPPED_E2E_RELEASE_ROOT="$release_root" \
  "$project_root/tests/app-package/run-shipped-local-e2e.sh"
REMOTEXAPP_SHIPPED_E2E_RELEASE_ROOT="$release_root" \
  node "$project_root/tests/app-package/run-document-local-e2e.mjs"
REMOTEXAPP_SHIPPED_E2E_RELEASE_ROOT="$release_root" \
  node "$project_root/tests/app-package/run-upgrade-kde-local-e2e.mjs"
REMOTEXAPP_SHIPPED_E2E_RELEASE_ROOT="$release_root" \
  node "$project_root/tests/app-package/run-actions-local-e2e.mjs"

bash "$project_root/tests/app-package/run-user-home-connections.sh" "$release_root"
REMOTEXAPP_SVC_RELEASE_ROOT="$release_root" \
  node "$project_root/tests/session-services/run-local-e2e.mjs"
REMOTEXAPP_BOOT_RELEASE_ROOT="$release_root" \
  node "$project_root/tests/boot-recovery/run-local-e2e.mjs"

echo "exact release candidate E2E passed: $(basename "$archive")"
