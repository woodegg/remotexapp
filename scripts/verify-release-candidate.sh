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

for path in "$archive" "$checksums" "$evidence"; do
  [[ -f "$path" ]] || { echo "candidate input not found: $path" >&2; exit 1; }
done
[[ "$expected_commit" =~ ^[0-9a-f]{40}$ ]] || {
  echo "expected commit must be a full lowercase Git SHA" >&2
  exit 1
}

archive_name="$(basename "$archive")"
checksum_lines="$(awk -v name="$archive_name" '$2 == name || $2 == "*" name { print $1 }' "$checksums")"
[[ "$checksum_lines" =~ ^[0-9a-f]{64}$ ]] || {
  echo "SHA256SUMS must contain exactly one valid entry for $archive_name" >&2
  exit 1
}
actual_sha="$(sha256sum "$archive" | cut -d' ' -f1)"
[[ "$actual_sha" == "$checksum_lines" ]] || {
  echo "candidate archive checksum mismatch" >&2
  exit 1
}

node "$project_root/scripts/verify-candidate-evidence.mjs" \
  "$evidence" "$archive" "$expected_commit"

archive_entries="$(tar -tzf "$archive")"
if grep -Eq '(^/|(^|/)\.\.(/|$))' <<<"$archive_entries"; then
  echo "candidate archive contains an unsafe path" >&2
  exit 1
fi
roots="$(cut -d/ -f1 <<<"$archive_entries" | sort -u)"
[[ -n "$roots" && "$roots" != *$'\n'* ]] || {
  echo "candidate archive must contain exactly one root directory" >&2
  exit 1
}

stage="$(mktemp -d)"
trap 'rm -rf -- "$stage"' EXIT
tar -xzf "$archive" -C "$stage"
release_root="$stage/$roots"
version="$(<"$release_root/VERSION")"
[[ "$roots" == "remotexapp-$version-linux-amd64" ]] || {
  echo "candidate root $roots does not match VERSION $version and linux-amd64" >&2
  exit 1
}
[[ "$archive_name" == "$roots.tar.gz" ]] || {
  echo "candidate archive name does not match its root" >&2
  exit 1
}

for binary in remotexappd novnc-input remotexapp-status remotexapp-operator-helper; do
  path="$release_root/bin/$binary"
  [[ -x "$path" ]] || { echo "candidate binary missing: $binary" >&2; exit 1; }
  build_info="$(go version -m "$path")"
  grep -Eq ': go1\.26\.8$' <<<"$(head -n 1 <<<"$build_info")" || {
    echo "$binary was not built with go1.26.8" >&2
    exit 1
  }
  grep -Fq $'\tbuild\tvcs.revision='"$expected_commit" <<<"$build_info" || {
    echo "$binary does not embed candidate commit $expected_commit" >&2
    exit 1
  }
  grep -Fq $'\tbuild\tvcs.modified=false' <<<"$build_info" || {
    echo "$binary was built from a modified worktree" >&2
    exit 1
  }
done

echo "release candidate verification passed: $archive_name ($actual_sha)"
