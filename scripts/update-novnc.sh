#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "usage: $0 VERSION (for example: 1.7.1)" >&2
  exit 2
fi

version="$1"
tag="v${version}"
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
third_party_root="${project_root}/third_party"
target="${third_party_root}/novnc"
stage="$(mktemp -d)"
candidate="${third_party_root}/.novnc.new.$$"
backup="${third_party_root}/.novnc.old.$$"

cleanup() {
  rm -rf -- "$stage" "$candidate"
}
trap cleanup EXIT

if [[ ! -f "${target}/README.md" ]]; then
  echo "missing existing vendored noVNC policy at ${target}/README.md" >&2
  exit 1
fi
if git -C "$project_root" rev-parse --is-inside-work-tree >/dev/null 2>&1 &&
   [[ -n "$(git -C "$project_root" status --porcelain -- third_party/novnc)" ]]; then
  echo "refusing to overwrite uncommitted changes under third_party/novnc" >&2
  exit 1
fi

refs="$(git ls-remote https://github.com/novnc/noVNC.git \
  "refs/tags/${tag}" "refs/tags/${tag}^{}")"
commit="$(awk -v ref="refs/tags/${tag}^{}" '$2 == ref { print $1 }' <<<"$refs")"
if [[ -z "$commit" ]]; then
  commit="$(awk -v ref="refs/tags/${tag}" '$2 == ref { print $1 }' <<<"$refs")"
fi
if [[ ! "$commit" =~ ^[0-9a-f]{40}$ ]]; then
  echo "unable to resolve upstream tag ${tag}" >&2
  exit 1
fi

archive_url="https://github.com/novnc/noVNC/archive/${commit}.tar.gz"
archive="${stage}/novnc-${tag}.tar.gz"
curl --fail --location --proto '=https' --tlsv1.2 "$archive_url" --output "$archive"
archive_sha256="$(sha256sum "$archive" | awk '{print $1}')"

if tar -tzf "$archive" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo "upstream archive contains an unsafe path" >&2
  exit 1
fi
tar -xzf "$archive" -C "$stage"
source_dir="${stage}/noVNC-${commit}"
if [[ ! -d "${source_dir}/core" || ! -d "${source_dir}/vendor" ]]; then
  echo "upstream archive is missing core/ or vendor/" >&2
  exit 1
fi

package_version="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).version" \
  "${source_dir}/package.json")"
if [[ "$package_version" != "$version" ]]; then
  echo "tag ${tag} contains package version ${package_version}" >&2
  exit 1
fi

mkdir -p "${candidate}/docs"
cp -a "${source_dir}/core" "${source_dir}/vendor" "${candidate}/"
cp "${source_dir}/AUTHORS" "${source_dir}/LICENSE.txt" \
  "${source_dir}/package.json" "${candidate}/"
cp "${source_dir}"/docs/LICENSE.* "${candidate}/docs/"
cp "${target}/README.md" "${candidate}/README.md"
printf '%s\n' \
  '{' \
  '  "schemaVersion": 1,' \
  '  "project": "novnc/noVNC",' \
  "  \"release\": \"${tag}\"," \
  "  \"version\": \"${version}\"," \
  "  \"commit\": \"${commit}\"," \
  "  \"archiveUrl\": \"${archive_url}\"," \
  "  \"archiveSha256\": \"${archive_sha256}\"," \
  "  \"importedAt\": \"$(date -u +%Y-%m-%d)\"," \
  '  "license": "MPL-2.0"' \
  '}' >"${candidate}/UPSTREAM.json"

NOVNC_VENDOR_ROOT="$candidate" node "${project_root}/scripts/check-novnc-vendor.mjs"
mv "$target" "$backup"
if ! mv "$candidate" "$target"; then
  mv "$backup" "$target"
  exit 1
fi
rm -rf -- "$backup"

make -C "$project_root" web-assets
echo "Imported noVNC ${tag} at ${commit}. Run make check and the documented live browser/IME regression."
