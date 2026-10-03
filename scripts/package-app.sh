#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="${1:-}"
dist_dir="${2:-$project_root/dist/apps}"
[[ -n "$source_dir" ]] || {
  echo "usage: package-app.sh APP_SOURCE_DIR [DIST_DIR]" >&2
  exit 2
}
source_dir="$(realpath "$source_dir")"
[[ -f "$source_dir/manifest.json" && -f "$source_dir/LICENSE" ]] || {
  echo "App Package source must contain manifest.json and LICENSE" >&2
  exit 1
}
read -r app_id app_version < <(python3 - "$source_dir/manifest.json" <<'PY'
import json, re, sys
with open(sys.argv[1], encoding="utf-8") as source:
    manifest = json.load(source)
app_id = manifest.get("id")
version = manifest.get("driverVersion")
if not isinstance(app_id, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", app_id):
    raise SystemExit("manifest id is not a safe lowercase reference")
if not isinstance(version, str) or not re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?", version):
    raise SystemExit("manifest driverVersion is not semantic")
print(app_id, version)
PY
)
# App Package bytes must not change when an unrelated core commit is created.
# Content changes already change the archive, so a canonical zero epoch is the
# stable default. Reproducible-build callers may supply SOURCE_DATE_EPOCH.
source_date_epoch="${SOURCE_DATE_EPOCH:-0}"

mkdir -p "$dist_dir"
archive="$dist_dir/${app_id}-${app_version}.tar.gz"
tar --sort=name --mtime="@$source_date_epoch" --owner=0 --group=0 --numeric-owner \
  --exclude='./README.md' --exclude='./tests' --exclude='./.remotexapp-package.json' \
  --exclude='__pycache__' --exclude='*.pyc' --exclude='*.pyo' \
  -C "$source_dir" -cf - . | gzip -n >"$archive"
(
  cd "$dist_dir"
  sha256sum "$(basename "$archive")" >"${app_id}-${app_version}.sha256"
)
echo "$archive"
