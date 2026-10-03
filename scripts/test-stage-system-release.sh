#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_root="$(mktemp -d)"
trap 'rm -rf -- "$test_root"' EXIT
offline_root="$test_root/root"
mkdir -p "$offline_root"

# Offline staging validates immutable package installation rather than the
# runner's desktop application inventory. Shim only declared executables that
# are absent from PATH; live catalog loading and preflight continue to check the
# real host and fail on every missing dependency.
fake_bin="$test_root/app-dependency-bin"
mkdir -p "$fake_bin"
true_path="$(type -P true)"
real_python="$(type -P python3)"
[[ -x "$true_path" ]]
[[ -x "$real_python" ]]
mapfile -t app_commands < <(python3 - "$project_root/apps" <<'PY'
import json, pathlib, sys

names = set()
for path in pathlib.Path(sys.argv[1]).glob("*/manifest.json"):
    with path.open(encoding="utf-8") as source:
        names.update(json.load(source)["dependencies"]["executables"])
print("\n".join(sorted(names)))
PY
)
mapfile -t app_python_modules < <("$real_python" - "$project_root/apps" <<'PY'
import json, pathlib, sys

names = set()
for path in pathlib.Path(sys.argv[1]).glob("*/manifest.json"):
    with path.open(encoding="utf-8") as source:
        names.update(json.load(source)["dependencies"]["pythonModules"])
print("\n".join(sorted(names)))
PY
)
for command_name in "${app_commands[@]}"; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    ln -s "$true_path" "$fake_bin/$command_name"
  fi
done

# The manager probes declared Python modules with an isolated interpreter, so
# PYTHONPATH cannot provide an offline fixture. Put a narrowly matching wrapper
# first in PATH: it satisfies only the manager's exact dependency probe for a
# module declared by a shipped manifest and forwards every other invocation to
# the real interpreter.
python_modules_file="$test_root/declared-python-modules"
printf '%s\n' "${app_python_modules[@]}" >"$python_modules_file"
export REMOTEXAPP_OFFLINE_REAL_PYTHON="$real_python"
export REMOTEXAPP_OFFLINE_PYTHON_MODULES_FILE="$python_modules_file"
install -m 0755 /dev/stdin "$fake_bin/python3" <<'SH'
#!/usr/bin/env bash
set -euo pipefail

dependency_probe='import importlib,sys;importlib.import_module(sys.argv[1])'
if (( $# == 4 )) && [[ "$1" == "-I" && "$2" == "-c" && "$3" == "$dependency_probe" ]]; then
  while IFS= read -r declared_module; do
    if [[ -n "$declared_module" && "$4" == "$declared_module" ]]; then
      exit 0
    fi
  done <"$REMOTEXAPP_OFFLINE_PYTHON_MODULES_FILE"
fi
exec "$REMOTEXAPP_OFFLINE_REAL_PYTHON" "$@"
SH
export PATH="$fake_bin:$PATH"
python_dependency_probe='import importlib,sys;importlib.import_module(sys.argv[1])'
for module_name in "${app_python_modules[@]}"; do
  python3 -I -c "$python_dependency_probe" "$module_name"
done
if python3 -I -c "$python_dependency_probe" __remotexapp_undeclared_module_fixture__; then
  echo "offline staging Python fixture accepted an undeclared module" >&2
  exit 1
fi
python3 -c 'import json'
for command_name in "${app_commands[@]}"; do
  command_path="$(type -P "$command_name")"
  [[ -x "$command_path" ]] || {
    echo "offline staging dependency shim is not executable: $command_name" >&2
    exit 1
  }
done

"$project_root/scripts/stage-system-release.sh" --destdir "$offline_root"
version="$(<"$project_root/VERSION")"
libexec_release="$offline_root/usr/local/libexec/remotexapp/releases/$version"
share_release="$offline_root/usr/local/share/remotexapp/releases/$version"
cmp "$project_root/scripts/check-ubuntu-host.py" "$share_release/scripts/check-ubuntu-host.py"
enabled_root="$offline_root/etc/remotexapp/apps-enabled"

[[ -x "$libexec_release/remotexappd" ]]
[[ -x "$libexec_release/remotexapp-operator-helper" ]]
jq -e --arg version "$version" '
  .schemaVersion == 1 and .version == $version and
  .requiredExecutables == [
    "remotexappd", "novnc-input", "remotexapp-status",
    "remotexapp-operator-helper"
  ]
' "$libexec_release/release-manifest.json" >/dev/null
[[ -d "$share_release/components" && -d "$share_release/drivers" ]]
[[ -r "$share_release/third_party/licenses/gorilla-websocket-LICENSE.txt" ]]
[[ -r "$share_release/third_party/licenses/jezek-xgb-LICENSE.txt" ]]
[[ -r "$share_release/third_party/licenses/golang-x-mod-LICENSE.txt" ]]
[[ -r "$share_release/third_party/licenses/golang-x-sys-LICENSE.txt" ]]
[[ -r "$share_release/third_party/novnc/LICENSE.txt" ]]
[[ ! -e "$offline_root/usr/local/libexec/remotexapp/current" ]]
[[ ! -e "$offline_root/usr/local/share/remotexapp/current" ]]
if find "$enabled_root" -mindepth 1 -print -quit | grep -q .; then
  echo "offline staging unexpectedly activated an App Package" >&2
  exit 1
fi
package_count="$(find "$offline_root/usr/local/share/remotexapp/apps" \
  -mindepth 3 -maxdepth 3 -name manifest.json -type f | wc -l)"
[[ "$package_count" == 8 ]] || {
  echo "offline staging published $package_count App Packages, expected 8" >&2
  exit 1
}

# Reproduce a 0.2 catalog with Firefox 2.0.0 and the now-retired
# xfce-desktop selector. A durable reference must block the entire selector
# transaction. With no reference, the exact eight-App catalog activates and an
# independently installed App remains untouched. Explicit rollback can restore
# the retained 0.2 package selectors.
package_root="$offline_root/usr/local/share/remotexapp/apps"
state_dir="$test_root/state"
mkdir -p "$state_dir/runtime-manifests"
make_fixture() {
  local source_id=$1 target_id=$2 target_version=$3 target_depth=$4
  local source="$project_root/apps/$source_id"
  local target="$test_root/source-$target_id-$target_version"
  cp -R "$source" "$target"
  python3 - "$target/manifest.json" "$target_id" "$target_version" "$target_depth" <<'PY'
import json, sys
path, app_id, version, depth = sys.argv[1:]
with open(path, encoding="utf-8") as source:
    manifest = json.load(source)
manifest["id"] = app_id
manifest["name"] = "Catalog transition fixture " + app_id
manifest["driverVersion"] = version
manifest["server"]["depth"] = int(depth)
with open(path, "w", encoding="utf-8") as target:
    json.dump(manifest, target, indent=2)
    target.write("\n")
PY
  "$project_root/scripts/package-app.sh" "$target" "$test_root/fixture-packages"
}
install_fixture() {
  local archive=$1
  local digest
  digest="$(sha256sum "$archive" | cut -d' ' -f1)"
  "$project_root/bin/remotexappd" -install-app-archive "$archive" \
    -install-app-sha256 "$digest" -app-package-root "$package_root" \
    -apps-enabled "$enabled_root" >/dev/null
}

old_firefox_archive="$(make_fixture firefox-esr firefox-esr 2.0.0 24)"
retired_xfce_archive="$(make_fixture mousepad xfce-desktop 2.0.0 16)"
independent_archive="$(make_fixture mousepad independent-app 9.0.0 16)"
install_fixture "$old_firefox_archive"
install_fixture "$retired_xfce_archive"
install_fixture "$independent_archive"
for app_id in edge libreoffice mousepad xfce-user-desktop; do
  active="$app_id@$(jq -r .driverVersion "$project_root/apps/$app_id/manifest.json")"
  "$project_root/bin/remotexappd" -activate-app "$active" \
    -app-package-root "$package_root" -apps-enabled "$enabled_root" >/dev/null
done
baseline_ids="$(find "$enabled_root" -mindepth 1 -maxdepth 1 -type l -printf '%f\n' | sort | paste -sd, -)"
[[ "$baseline_ids" == "edge,firefox-esr,independent-app,libreoffice,mousepad,xfce-desktop,xfce-user-desktop" ]]
[[ "$(basename "$(readlink -f "$enabled_root/firefox-esr")")" == 2.0.0 ]]

python3 - "$state_dir/runtime-manifests/xfce-desktop-001122334455.json" <<'PY'
import json, os, sys
record = {
    "runtime": {"id": "xfce-desktop-001122334455", "classId": "xfce-desktop", "templateId": "xfce-desktop"},
    "resolvedSpec": {"id": "xfce-desktop"},
    "appPackage": {"id": "xfce-desktop"},
}
with open(sys.argv[1], "w", encoding="utf-8") as target:
    json.dump(record, target)
    target.write("\n")
os.chmod(sys.argv[1], 0o600)
PY
if "$project_root/scripts/install-shipped-apps.sh" "$project_root/bin/remotexappd" \
    "$package_root" "$enabled_root" --state-dir "$state_dir"; then
  echo "catalog transition retired an App with a durable runtime reference" >&2
  exit 1
fi
[[ "$(basename "$(readlink -f "$enabled_root/firefox-esr")")" == 2.0.0 ]]
[[ -L "$enabled_root/xfce-desktop" && -L "$enabled_root/independent-app" ]]

rm "$state_dir/runtime-manifests/xfce-desktop-001122334455.json"
"$project_root/scripts/install-shipped-apps.sh" "$project_root/bin/remotexappd" \
  "$package_root" "$enabled_root" --state-dir "$state_dir" >/dev/null
active_ids="$(find "$enabled_root" -mindepth 1 -maxdepth 1 -type l -printf '%f\n' | sort | paste -sd, -)"
[[ "$active_ids" == "edge,firefox-esr,independent-app,kate,kwrite,libreoffice,lightview,mousepad,xfce-user-desktop" ]]
[[ "$(basename "$(readlink -f "$enabled_root/firefox-esr")")" == "$(jq -r .driverVersion "$project_root/apps/firefox-esr/manifest.json")" ]]
[[ ! -e "$enabled_root/xfce-desktop" && ! -L "$enabled_root/xfce-desktop" ]]

"$project_root/bin/remotexappd" -activate-app firefox-esr@2.0.0 \
  -app-package-root "$package_root" -apps-enabled "$enabled_root" >/dev/null
"$project_root/bin/remotexappd" -activate-app xfce-desktop@2.0.0 \
  -app-package-root "$package_root" -apps-enabled "$enabled_root" >/dev/null
[[ "$(basename "$(readlink -f "$enabled_root/firefox-esr")")" == 2.0.0 ]]
[[ -L "$enabled_root/xfce-desktop" && -L "$enabled_root/independent-app" ]]

# Exact repeated staging is idempotent, but changed bytes under an existing
# version must fail closed.
"$project_root/scripts/stage-system-release.sh" --destdir "$offline_root"
mousepad_version="$(jq -r .driverVersion "$project_root/apps/mousepad/manifest.json")"
package_manifest="$offline_root/usr/local/share/remotexapp/apps/mousepad/$mousepad_version/manifest.json"
cp "$package_manifest" "$test_root/mousepad-manifest.json"
printf '\n' >>"$package_manifest"
if "$project_root/scripts/stage-system-release.sh" --destdir "$offline_root"; then
  echo "staging accepted changed App Package content under an immutable version" >&2
  exit 1
fi
mv "$test_root/mousepad-manifest.json" "$package_manifest"
printf '\ncorrupt-test-byte\n' >>"$libexec_release/remotexapp-status"
if "$project_root/scripts/stage-system-release.sh" --destdir "$offline_root"; then
  echo "staging accepted changed content under an immutable version" >&2
  exit 1
fi

echo "system release staging test passed"
