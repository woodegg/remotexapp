import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("host_check", ROOT / "scripts/check-ubuntu-host.py")
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)


class HostTests(unittest.TestCase):
    def test_selected_packages_and_toolkits(self):
        mousepad = host.load_manifests("mousepad")
        packages = host.package_list(mousepad, "26.04")
        self.assertIn("ibus-gtk3", packages)
        self.assertNotIn("ibus-gtk4", packages)
        self.assertNotIn("libreoffice", packages)
        self.assertNotIn("xclip", packages)
        self.assertNotIn("xvfb", packages)
        self.assertIn("ibus-gtk4", host.package_list(mousepad, "26.04", True))
        self.assertIn("libqt6gui6", host.package_list(host.load_manifests("kate"), "26.04"))
        self.assertIn("libqt5gui5t64", host.package_list(host.load_manifests("kwrite"), "24.04"))
        self.assertEqual(len(host.load_manifests("all")), 8)
        self.assertEqual(host.load_manifests("core"), [])
        with self.assertRaises(ValueError):
            host.load_manifests("mousepad,../unknown")

    def test_installed_catalog_including_custom_app(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "packages").mkdir()
            manifest = {"id": "custom", "dependencies": {"pythonModules": ["json"]}}
            (root / "packages/manifest.json").write_text(json.dumps(manifest))
            (root / "enabled").mkdir()
            (root / "enabled/custom").symlink_to(root / "packages")
            self.assertEqual(host.load_manifests("all", root / "enabled"), [manifest])
            with self.assertRaises(ValueError):
                host.package_list([manifest], "26.04")

    def test_capabilities_not_presence_only(self):
        with patch.object(host.shutil, "which", return_value="/fixture/exe"), \
             patch.object(host, "python_probe", return_value=True), \
             patch.object(host, "run_probe", return_value=True), \
             patch.object(host, "toolkit_module", return_value=True), \
             patch.object(host, "qt_major", return_value="6"):
            result = {name: ok for name, ok, _ in host.check_host(host.load_manifests("all"), True)}
            for name in ("Python import: uno", "GI/GLib/IBus import", "GTK3 IBus module", "GTK4 IBus module",
                         "kate Qt IBus module", "kwrite Qt IBus module", "pidfd open/signal owned child", "borrowed user D-Bus"):
                self.assertTrue(result[name], name)
            with patch.object(host, "python_probe", return_value=False), \
                 patch.object(host, "toolkit_module", return_value=False), \
                 patch.object(host, "run_probe", return_value=False):
                result = {name: ok for name, ok, _ in host.check_host(host.load_manifests("all"), True)}
                self.assertTrue(result["command: python3"])
                for name in ("Python import: uno", "GI/GLib/IBus import", "native library: X11", "native library: Xtst",
                             "native library: xdo", "GTK3 IBus module", "GTK4 IBus module", "kate Qt IBus module",
                             "pidfd open/signal owned child", "runtime user manager", "borrowed user D-Bus"):
                    self.assertFalse(result[name], name)

    def test_missing_commands_and_isolated_bus_scope(self):
        with patch.object(host.shutil, "which", return_value=None), \
             patch.object(host, "python_probe", return_value=True), \
             patch.object(host, "run_probe", return_value=True), \
             patch.object(host, "toolkit_module", return_value=True):
            result = {name: ok for name, ok, _ in host.check_host(host.load_manifests("mousepad"))}
            self.assertFalse(result["command: mousepad"])
            self.assertNotIn("borrowed user D-Bus", result)
            self.assertNotIn("GTK4 IBus module", result)

    def test_renamed_desktop_still_requires_gtk3_and_borrowed_bus(self):
        desktop = host.load_manifests("xfce-user-desktop")
        desktop[0]["id"] = "site-desktop"
        with patch.object(host.shutil, "which", return_value="/fixture/exe"), \
             patch.object(host, "python_probe", return_value=True), \
             patch.object(host, "run_probe", return_value=True), \
             patch.object(host, "toolkit_module", return_value=False):
            result = {name: ok for name, ok, _ in host.check_host(desktop)}
            self.assertFalse(result["GTK3 IBus module"])
            self.assertTrue(result["borrowed user D-Bus"])

    def test_qt_version_is_actual_executable_not_host_guess(self):
        with patch.object(host.shutil, "which", return_value="/fixture/kate"):
            for output, expected in (("libQt6Gui.so.6", "6"), ("libQt5Gui.so.5", "5"),
                                     ("not a dynamic executable", None), ("libQt5Gui.so.5 libQt6Gui.so.6", None)):
                with patch.object(host.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, output)):
                    self.assertEqual(host.qt_major("kate"), expected)
            with patch.object(host.subprocess, "run", side_effect=subprocess.TimeoutExpired("ldd", 5)):
                self.assertIsNone(host.qt_major("kate"))

    def test_module_must_load_not_just_exist(self):
        with patch.object(host.glob, "glob", return_value=["/fixture/im-ibus.so"]), \
             patch.object(host, "load_library", return_value=False):
            self.assertFalse(host.toolkit_module("/fixture/*"))

    def test_probe_failure_timeout_and_no_output(self):
        for failure in (OSError("private path"), subprocess.TimeoutExpired("private argv", 5)):
            with patch.object(host.subprocess, "run", side_effect=failure):
                self.assertFalse(host.run_probe(["fixture"]))
        with patch.object(host.subprocess, "run", return_value=subprocess.CompletedProcess([], 1)) as run:
            self.assertFalse(host.run_probe(["fixture"]))
            self.assertEqual(run.call_args.kwargs["timeout"], 5)
            self.assertEqual(run.call_args.kwargs["stderr"], subprocess.DEVNULL)

    def test_real_pidfd_probe_reaps_only_its_child(self):
        self.assertTrue(host.python_probe(host.PIDFD_PROBE))
        # Same cleanup path must run even when pidfd access is denied.
        denied = 'os.pidfd_open = lambda pid: (_ for _ in ()).throw(PermissionError())\n'
        code = host.PIDFD_PROBE.replace('fd = None\n', 'fd = None\n' + denied)
        self.assertFalse(host.python_probe(code))

    def test_real_import_error_and_success(self):
        code = "import importlib, sys; importlib.import_module(sys.argv[1])"
        self.assertTrue(host.python_probe(code, "json"))
        self.assertFalse(host.python_probe(code, "__remotexapp_missing_module__"))

    def test_cli_identity_and_package_only_mode(self):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()), \
             patch.object(host.os, "geteuid", return_value=0):
            self.assertEqual(host.main(["--print-packages", "--ubuntu", "26.04", "--apps", "all"]), 0)
            with self.assertRaises(SystemExit) as error:
                host.main(["--apps", "core"])
            self.assertEqual(error.exception.code, 2)
        with contextlib.redirect_stderr(io.StringIO()), patch.object(host.os, "geteuid", return_value=43210), \
             patch.object(host.pwd, "getpwnam", return_value=type("User", (), {"pw_uid": 12345})()):
            with self.assertRaises(SystemExit):
                host.main(["--apps", "core", "--user", "fixture"])

    def test_release_and_preflight_wire_up_target_user(self):
        script = (ROOT / "scripts/preflight.sh").read_text()
        catalog = script.split("check_app_catalog() {", 1)[1].split("\n}", 1)[0]
        self.assertIn('as_runtime_user "$manager_bin"', catalog)
        self.assertIn('as_runtime_user python3 -I', catalog)
        self.assertIn('--enabled-root "$enabled_root"', catalog)
        self.assertIn('runuser -u "$runtime_user"', script)
        self.assertIn('/usr/local/share/remotexapp/current/scripts/check-ubuntu-host.py', script)
        for installer in ("install-user.sh", "stage-system-release.sh"):
            self.assertIn('scripts/check-ubuntu-host.py" "$share_stage/scripts/"', (ROOT / "scripts" / installer).read_text())
        self.assertIn('scripts/check-ubuntu-host.py', (ROOT / "scripts/package-release.sh").read_text())


if __name__ == "__main__":
    unittest.main()
