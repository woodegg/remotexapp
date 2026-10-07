import { readFileSync, readdirSync } from 'node:fs';

const workflowDir = '.github/workflows';
const workflowFiles = readdirSync(workflowDir)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .sort();
if (workflowFiles.length === 0) throw new Error('no GitHub workflows found');

for (const name of workflowFiles) {
  const source = readFileSync(`${workflowDir}/${name}`, 'utf8');
  for (const match of source.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)) {
    const action = match[1];
    if (!/@[0-9a-f]{40}$/.test(action)) {
      throw new Error(`${name} uses a mutable action reference: ${action}`);
    }
  }
}

const candidate = readFileSync(`${workflowDir}/candidate.yml`, 'utf8');
for (const required of ['make release-ci', 'candidate-evidence.json', 'verify-release-candidate.sh', 'release-candidate-${{ github.sha }}']) {
  if (!candidate.includes(required)) throw new Error(`candidate.yml is missing ${required}`);
}

const ignoredPaths = new Set(readFileSync('.gitignore', 'utf8').split(/\r?\n/));
if (!ignoredPaths.has('/results.sarif')) {
  throw new Error('Gitleaks results.sarif must be ignored before candidate binaries are built');
}

const release = readFileSync(`${workflowDir}/release.yml`, 'utf8');
for (const forbidden of ['make release-ci', 'make build', 'go build']) {
  if (release.includes(forbidden)) throw new Error(`release.yml rebuilds the candidate via ${forbidden}`);
}
for (const required of [
  'apt-get install --yes ripgrep',
  'git cat-file -t',
  'candidate.yml',
  'gh run download',
  'verify-release-candidate.sh',
]) {
  if (!release.includes(required)) throw new Error(`release.yml is missing ${required}`);
}

for (const name of ['ci.yml', 'candidate.yml', 'nightly.yml', 'release.yml']) {
  const source = readFileSync(`${workflowDir}/${name}`, 'utf8');
  if (!source.includes('go-version: "1.27.1"')) {
    throw new Error(`${name} does not pin Go 1.27.1`);
  }
}

console.log(`workflow check passed: ${workflowFiles.length} workflow(s), immutable action refs`);
