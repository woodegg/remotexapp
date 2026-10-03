import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { validateEvidence } from './evidence-lib.mjs';

const output = process.argv[2];
if (!output) throw new Error('usage: node scripts/create-candidate-evidence.mjs OUTPUT');

const commit = process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const runId = process.env.GITHUB_RUN_ID ? `github-actions:${process.env.GITHUB_RUN_ID}` : `local:${commit.slice(0, 12)}`;
const startedAt = process.env.CANDIDATE_STARTED_AT || new Date().toISOString();
const completedAt = new Date().toISOString();
const checksumFields = readFileSync('dist/SHA256SUMS', 'utf8').trim().split(/\s+/);
if (checksumFields.length !== 2 || !/^[0-9a-f]{64}$/.test(checksumFields[0])) {
  throw new Error('dist/SHA256SUMS must contain exactly one valid artifact checksum');
}
const [sha256, name] = checksumFields;
const version = readFileSync('VERSION', 'utf8').trim();
const sdk = JSON.parse(readFileSync('cmd/remotexappd/web/sdk/package.json', 'utf8')).version;
const go = execFileSync('go', ['env', 'GOVERSION'], { encoding: 'utf8' }).trim();

const evidence = validateEvidence({
  schemaVersion: 'remotexapp/evidence/v1',
  kind: 'candidate',
  runId,
  commit,
  startedAt,
  completedAt,
  result: 'passed',
  toolchain: { go, node: process.version },
  environment: {
    kind: process.env.GITHUB_ACTIONS === 'true' ? 'github-hosted' : 'local',
    name: process.env.GITHUB_REPOSITORY || 'local-candidate',
  },
  artifact: { name, sha256 },
  scenarios: [
    { id: 'release-ci', result: 'passed' },
    { id: 'generated-source-cleanliness', result: 'passed' },
    { id: 'source-vulnerability-scan', result: 'passed' },
    { id: 'binary-vulnerability-scan', result: 'passed' },
  ],
  details: { version, sdkVersion: sdk },
}, output);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
