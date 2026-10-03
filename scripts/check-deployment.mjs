import { readFileSync } from 'node:fs';

function read(path) {
  return readFileSync(path, 'utf8');
}

function requireMatch(text, pattern, description) {
  if (!pattern.test(text)) throw new Error(`deployment check failed: ${description}`);
}

function rejectMatch(text, pattern, description) {
  if (pattern.test(text)) throw new Error(`deployment check failed: ${description}`);
}

const systemUnit = read('deploy/systemd/remotexapp-system.service');
const centralUserUnit = read('deploy/systemd/remotexapp-central-user.service');
const localUserUnit = read('deploy/systemd/remotexapp.service');
const localOperatorUnit = read('deploy/systemd/remotexapp-operator.service');
const centralOperatorUnit = read('deploy/systemd/remotexapp-central-user-operator.service');
const installer = read('scripts/install-system.sh');
const userInstaller = read('scripts/install-user.sh');
const environment = read('deploy/examples/remotexapp-system.env');
const preflight = read('scripts/preflight.sh');
const appInstaller = read('scripts/install-app.sh');
const appManager = read('scripts/manage-app.sh');
const shippedAppInstaller = read('scripts/install-shipped-apps.sh');
const releaseSelector = read('scripts/select-system-release.sh');
const releaseStager = read('scripts/stage-system-release.sh');
const managerMain = read('cmd/remotexappd/main.go');

requireMatch(systemUnit, /^User=remotexapp$/m, 'system service must use the dedicated account');
requireMatch(systemUnit, /^Group=remotexapp$/m, 'system service must use the dedicated group');
requireMatch(systemUnit, /^StateDirectory=remotexapp$/m, 'system service must use managed state');
requireMatch(systemUnit, /^NoNewPrivileges=yes$/m, 'system service must block privilege acquisition');
requireMatch(systemUnit, /^CapabilityBoundingSet=$/m, 'system service must have an empty capability set');
requireMatch(systemUnit, /^ExecStart=\/usr\/local\/libexec\/remotexapp\/current\/remotexappd/m, 'system service must use the active immutable release');
rejectMatch(systemUnit, /(^|\s)(sudo|su)(\s|$)/m, 'system service must not switch users');

rejectMatch(centralUserUnit, /^User=/m, 'real-user service must inherit its user-manager identity');
requireMatch(centralUserUnit, /^EnvironmentFile=-\/etc\/remotexapp\/users\/%u[.]env$/m, 'real-user service must support an administrator-owned user override');
requireMatch(centralUserUnit, /-state-dir %h\/[.]local\/state\/remotexapp/, 'real-user state must remain in its home');
requireMatch(centralUserUnit, /^NoNewPrivileges=yes$/m, 'real-user service must block privilege acquisition');
rejectMatch(centralUserUnit, /(^|\s)(sudo|su)(\s|$)/m, 'real-user service must not switch users');

requireMatch(localUserUnit, /^ExecStart=%h\/[.]local\/libexec\/remotexapp\/current\/remotexappd/m, 'local user service must use its active immutable release');
for (const [name, unit, binary] of [
  ['local operator', localOperatorUnit, '%h/.local/libexec/remotexapp/current/remotexapp-operator-helper'],
  ['central operator', centralOperatorUnit, '/usr/local/libexec/remotexapp/current/remotexapp-operator-helper'],
]) {
  requireMatch(unit, new RegExp(`^ExecStart=${binary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm'), `${name} helper must use the active immutable release`);
  requireMatch(unit, /-unit remotexapp[.]service/, `${name} helper must have one fixed service allowlist entry`);
  requireMatch(unit, /^NoNewPrivileges=yes$/m, `${name} helper must block privilege acquisition`);
  requireMatch(unit, /^RestrictAddressFamilies=AF_UNIX$/m, `${name} helper needs only the user-manager Unix bus`);
  rejectMatch(unit, /(^|\s)(sudo|su)(\s|$)/m, `${name} helper must not switch users`);
  rejectMatch(unit, /^User=/m, `${name} helper must inherit its non-root user-manager identity`);
}
for (const [name, unit] of [['system', systemUnit], ['central user', centralUserUnit], ['local user', localUserUnit]]) {
  requireMatch(unit, /^Environment=REMOTEXAPP_APP_PACKAGE_ROOT=/m, `${name} unit must load immutable App Packages`);
  requireMatch(unit, /^Environment=REMOTEXAPP_APPS_ENABLED=/m, `${name} unit must load only enabled App Packages`);
  requireMatch(unit, /^Environment=REMOTEXAPP_CORE_DRIVER_DIR=/m, `${name} unit must pin common App Package ABI helpers`);
  rejectMatch(unit, /\s-(app-package-root|apps-enabled|core-driver-dir)\s/, `${name} ExecStart must remain compatible with retained pre-V1 binaries`);
}
requireMatch(appInstaller, /-install-app-sha256/, 'App Package installer must verify the caller-provided archive checksum');
requireMatch(appInstaller, /-install-app-activate=/, 'App Package installer must make activation explicit');
requireMatch(appManager, /--activate ID@VERSION \| --disable ID \| --retire ID --state-dir DIR/, 'App Package manager must support activation, rollback, disable, and reference-safe retirement');
requireMatch(shippedAppInstaller, /-install-app-sha256/, 'shipped App Packages must use the checksummed generic installer');
requireMatch(shippedAppInstaller, /-install-app-archive/, 'existing shipped App Package versions must be revalidated through the idempotent installer');
requireMatch(shippedAppInstaller, /--no-activate/, 'shipped App Packages must support selector-free staging');
requireMatch(shippedAppInstaller, /-install-app-activate=false/, 'shipped App bytes must be fully installed before selector transition');
requireMatch(shippedAppInstaller, /retired_apps=\(xfce-desktop\)/, 'the retired shipped selector must be explicit rather than inferred from missing source');
requireMatch(shippedAppInstaller, /-retire-app "\$retired_id" -state-dir "\$state_dir"/, 'retirement must use durable runtime and managed-reference validation');
requireMatch(shippedAppInstaller, /restore_previous_catalog/, 'a failed shipped App transition must restore previous selectors');
requireMatch(installer, /install-shipped-apps[.]sh/, 'system installation must publish shipped Apps through the package boundary');
requireMatch(preflight, /-check-app-catalog/, 'preflight must validate enabled package-owned dependencies generically');
for (const appDependency of ['matchbox-window-manager', 'fuser', 'libreoffice', 'firefox-esr']) {
  rejectMatch(preflight, new RegExp(`required_commands=.*${appDependency}`), `core preflight must not hard-code ${appDependency}`);
}
requireMatch(installer, /--user USER --listen 127[.]0[.]0[.]1:PORT/, 'installer must document real-user mode');
requireMatch(installer, /refusing to use UID 0/, 'installer must reject root as a runtime identity');
requireMatch(installer, /if \[\[ ! -e "\$config_root\/remotexapp[.]env" \]\]/, 'installer must preserve existing administrator configuration');
requireMatch(installer, /stage-system-release[.]sh/, 'system installation must use the selector-free immutable stager');
requireMatch(installer, /ln -sfn "releases\/\$release_version" "\$share_root\/current"/, 'initial system installation must activate releases through a selector');
requireMatch(userInstaller, /refusing to modify published user release/, 'user installer must reject changes to a published release');
requireMatch(userInstaller, /ln -sfn "releases\/\$release_version" "\$share_root\/current"/, 'user installer must activate immutable releases through a selector');
requireMatch(userInstaller, /install-shipped-apps[.]sh/, 'user installation must publish shipped Apps through the package boundary');
requireMatch(userInstaller, /--state-dir "\$HOME\/[.]local\/state\/remotexapp"/, 'user installation must check durable state before retiring an App');
requireMatch(userInstaller, /remotexapp-operator-helper/, 'user installation must publish the optional operator helper');
requireMatch(userInstaller, /remotexapp-operator[.]service/, 'user installation must install but not enable the optional operator helper unit');
requireMatch(installer, /remotexapp-central-user-operator[.]service/, 'system installation must publish the central-user operator helper unit');
requireMatch(installer, /--state-dir "\$runtime_state_dir"/, 'system installation must check the selected runtime account state before retiring an App');
requireMatch(releaseSelector, /system release selection must run as root/, 'release selection must require root');
requireMatch(releaseSelector, /systemctl --user/, 'release selection must support central real-user mode');
requireMatch(releaseSelector, /release-manifest[.]json/, 'release selection must recognize versioned release content manifests');
requireMatch(releaseSelector, /required_executables=\(remotexappd novnc-input remotexapp-status\)/, 'release selection must retain the legacy three-binary rollback contract');
requireMatch(releaseSelector, /required_executables[+]\=\(remotexapp-operator-helper\)/, 'manifested releases must require the optional helper recorded by their format');
requireMatch(releaseSelector, /stop remotexapp[.]service/, 'release selection must stop the manager before selector changes');
requireMatch(releaseSelector, /mv -T "\$libexec_tmp" "\$libexec_root\/current"/, 'release selection must atomically switch the binary selector');
requireMatch(releaseSelector, /mv -T "\$share_tmp" "\$share_root\/current"/, 'release selection must atomically switch the shared selector');
requireMatch(releaseSelector, /restore_previous/, 'release selection must restore both previous selectors on activation failure');
requireMatch(releaseSelector, /if \[\[ "\$should_start" == true \]\]; then\n    "\$\{service\[@\]\}" start remotexapp[.]service/, 'failed pre-stopped selection with --start must restart the restored release');
requireMatch(releaseSelector, /--health-url is required when release selection starts the service/, 'release selection must not report an unverified service start');
requireMatch(releaseSelector, /wait_for_health "\$old_version" ""/, 'release selection must verify the restored previous release');
requireMatch(releaseSelector, /health_timeout_seconds=120/, 'release selection must allow bounded cold runtime recovery before failing health');
requireMatch(releaseSelector, /health timeout must be an integer from 1 through 600 seconds/, 'release selection must bound operator health timeouts');
rejectMatch(releaseStager, /\/current/, 'release staging must not change a core selector');
requireMatch(releaseStager, /--no-activate/, 'release staging must not change an App selector');
requireMatch(releaseStager, /refusing to modify published release/, 'release staging must reject changed bytes under a published version');
requireMatch(releaseStager, /remotexapp-operator-helper/, 'release staging must include the optional operator helper binary');
requireMatch(releaseStager, /release-manifest[.]json/, 'release staging must describe the exact executable contract');
requireMatch(read('scripts/package-release.sh'), /scripts\/select-system-release[.]sh/, 'release archive must carry the core selector used by paired rollback');
requireMatch(read('scripts/package-release.sh'), /scripts\/stage-system-release[.]sh/, 'release archive must carry selector-free system staging');
requireMatch(releaseStager, /third_party\/licenses\/gorilla-websocket-LICENSE[.]txt/, 'system staging must retain the compiled Go dependency license');
requireMatch(releaseStager, /third_party\/licenses\/jezek-xgb-LICENSE[.]txt/, 'system staging must retain the compiled X11 dependency license');
requireMatch(releaseStager, /third_party\/novnc/, 'system staging must retain corresponding noVNC source and licenses');
requireMatch(environment, /^REMOTEXAPP_AUTH_MODE=trusted-header$/m, 'central default must require trusted proxy identity');
requireMatch(environment, /^REMOTEXAPP_ALLOW_INSECURE_PUBLIC=false$/m, 'central default must reject insecure public mode');
requireMatch(environment, /^REMOTEXAPP_DISABLE_CONSOLE=false$/m, 'central default must preserve the built-in console unless explicitly disabled');
requireMatch(environment, /^REMOTEXAPP_DISABLE_KIOSK=false$/m, 'central default must preserve the built-in kiosk unless explicitly disabled');
requireMatch(environment, /^REMOTEXAPP_ENABLE_SERVICE_RESTART=false$/m, 'service restart must remain disabled by default');
requireMatch(environment, /^REMOTEXAPP_SHUTDOWN_GRACE_TIMEOUT=15s$/m, 'central default must bound graceful shutdown hooks');
requireMatch(environment, /^REMOTEXAPP_SHUTDOWN_BLOCKED_WARNING_AFTER=1h$/m, 'central default must warn on blocked shutdown');
requireMatch(environment, /^REMOTEXAPP_SHUTDOWN_FORCE_AFTER=0$/m, 'central default must not automatically discard user work');
for (const [name, unit] of [['system', systemUnit], ['central user', centralUserUnit], ['local user', localUserUnit]]) {
  requireMatch(unit, /^Environment=REMOTEXAPP_SHUTDOWN_FORCE_AFTER=0$/m, `${name} unit must remain safe when an older environment file lacks shutdown policy`);
  requireMatch(unit, /^Environment=REMOTEXAPP_DISABLE_CONSOLE=false$/m, `${name} unit must preserve console compatibility when an older environment file lacks web policy`);
  requireMatch(unit, /^Environment=REMOTEXAPP_DISABLE_KIOSK=false$/m, `${name} unit must preserve kiosk compatibility when an older environment file lacks web policy`);
  requireMatch(unit, /^Environment=REMOTEXAPP_ENABLE_SERVICE_RESTART=false$/m, `${name} unit must keep service restart disabled when an older environment file lacks operator policy`);
  requireMatch(unit, /-disable-console=\$\{REMOTEXAPP_DISABLE_CONSOLE\}/, `${name} unit must pass console exposure policy`);
  requireMatch(unit, /-disable-kiosk=\$\{REMOTEXAPP_DISABLE_KIOSK\}/, `${name} unit must pass kiosk exposure policy`);
  rejectMatch(unit, /-enable-service-restart/, `${name} unit must remain executable by retained binaries that predate service restart`);
  requireMatch(unit, /-shutdown-grace-timeout \$\{REMOTEXAPP_SHUTDOWN_GRACE_TIMEOUT\}/, `${name} unit must pass host shutdown policy`);
  rejectMatch(unit, /^(PrivateMounts|PrivateTmp|PrivateDevices|ProtectClock|ProtectControlGroups|ProtectHome|ProtectHostname|ProtectKernelLogs|ProtectKernelModules|ProtectKernelTunables|ProtectSystem|ReadOnlyPaths|ReadWritePaths|InaccessiblePaths)=/m, `${name} manager unit must share the host mount namespace needed for validated same-UID procfs reads`);
}
requireMatch(systemUnit, /^UnsetEnvironment=REMOTEXAPP_ENABLE_SERVICE_RESTART$/m, 'dedicated system service must remove administrator attempts to enable user-service restart');
rejectMatch(centralUserUnit, /^UnsetEnvironment=REMOTEXAPP_ENABLE_SERVICE_RESTART$/m, 'central user service must retain administrator-owned restart policy');
rejectMatch(localUserUnit, /^UnsetEnvironment=REMOTEXAPP_ENABLE_SERVICE_RESTART$/m, 'local user service must retain user-owned restart policy');
requireMatch(managerMain, /booleanEnvironmentDefault\("REMOTEXAPP_ENABLE_SERVICE_RESTART", false\)/, 'current manager must read service-restart policy without a rollback-breaking ExecStart argument');

console.log('deployment architecture check passed');
