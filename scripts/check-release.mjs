import { existsSync, readFileSync, statSync } from 'node:fs';

function read(path) {
  return readFileSync(path, 'utf8');
}

function fail(message) {
  throw new Error(`release metadata check failed: ${message}`);
}

function requireFile(path) {
  if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size === 0) {
    fail(`missing required file: ${path}`);
  }
}

const version = read('VERSION').trim();
if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  fail(`VERSION is not semantic: ${version}`);
}

if (existsSync('archive')) {
  fail('obsolete archive/ prototypes must remain in Git history, not the release tree');
}

if (read('go.mod').split(/\r?\n/, 1)[0] !== 'module github.com/woodegg/remotexapp') {
  fail('go.mod does not use the canonical GitHub module path');
}

for (const path of [
  'README.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'SECURITY.md', 'LICENSE', 'NOTICE',
  'THIRD_PARTY_NOTICES.md', 'docs/integration-guide.md',
  'docs/release-policy.md', 'docs/release-process.md',
  'docs/development-quality-process.md', 'docs/current-state.md',
  'scripts/check-sensitive-data.sh',
  'scripts/verify-release-candidate.sh',
  '.github/workflows/candidate.yml',
  '.github/workflows/release.yml',
  'third_party/licenses/gorilla-websocket-LICENSE.txt',
  'third_party/licenses/golang-x-mod-LICENSE.txt',
  'third_party/licenses/golang-x-sys-LICENSE.txt',
  'third_party/licenses/jezek-xgb-LICENSE.txt',
]) requireFile(path);

if ((statSync('scripts/package-release.sh').mode & 0o111) === 0) {
  fail('scripts/package-release.sh is not executable');
}
if ((statSync('scripts/check-sensitive-data.sh').mode & 0o111) === 0) {
  fail('scripts/check-sensitive-data.sh is not executable');
}

const changelog = read('CHANGELOG.md');
const unreleased = changelog.match(/^## Unreleased\s*$([\s\S]*?)(?=^##\s)/m)?.[1] ?? '';
const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const releasedHeading = changelog.match(new RegExp(`^## ${escapedVersion}(?: — [^\\n]+)?\\s*$`, 'm'));
let released = '';
if (releasedHeading) {
  const sectionStart = releasedHeading.index + releasedHeading[0].length;
  const remainder = changelog.slice(sectionStart);
  const nextHeading = remainder.search(/^##\s/m);
  released = nextHeading === -1 ? remainder : remainder.slice(0, nextHeading);
}
if (![unreleased, released].some((section) => section.includes(`Target: \`${version}\`.`))) {
  fail(`CHANGELOG does not target current version ${version}`);
}

const sdkPackage = JSON.parse(read('cmd/remotexappd/web/sdk/package.json'));
const sdkSource = read('cmd/remotexappd/web/sdk/index.js');
const sdkTypes = read('cmd/remotexappd/web/sdk/index.d.ts');
if (!sdkSource.includes(`SDK_VERSION = '${sdkPackage.version}'`)) {
  fail('SDK source version does not match package.json');
}
if (!sdkTypes.includes(`SDK_VERSION: '${sdkPackage.version}'`)) {
  fail('SDK declaration version does not match package.json');
}

const manifest = JSON.parse(read('cmd/remotexappd/web/assets/manifest.json'));
for (const asset of [manifest.sdk, manifest.console, manifest.novnc]) {
  requireFile(`cmd/remotexappd/web/assets/${asset}`);
}
const generatedURLs = read('cmd/remotexappd/web/sdk/generated-asset-urls.js');
if (!generatedURLs.includes(`/assets/${manifest.novnc}`)) {
  fail('generated noVNC URL does not match the asset manifest');
}

const upstream = JSON.parse(read('third_party/novnc/UPSTREAM.json'));
if (manifest.novncVersion !== upstream.version || manifest.novncCommit !== upstream.commit ||
    manifest.novncArchiveSha256 !== upstream.archiveSha256) {
  fail('generated noVNC provenance does not match UPSTREAM.json');
}

const releaseTag = process.env.RELEASE_TAG || '';
if (releaseTag && releaseTag !== `v${version}`) {
  fail(`tag ${releaseTag} does not match VERSION v${version}`);
}

console.log(`release metadata check passed for RemoteXApp ${version} and SDK ${sdkPackage.version}`);
