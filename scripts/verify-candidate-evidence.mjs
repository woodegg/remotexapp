import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { readFileSync } from 'node:fs';
import { validateEvidence } from './evidence-lib.mjs';

const [evidencePath, archivePath, expectedCommit] = process.argv.slice(2);
if (!evidencePath || !archivePath || !expectedCommit) {
  throw new Error('usage: node scripts/verify-candidate-evidence.mjs EVIDENCE ARCHIVE EXPECTED_COMMIT');
}
if (!/^[0-9a-f]{40}$/.test(expectedCommit)) {
  throw new Error('EXPECTED_COMMIT must be a full lowercase Git commit SHA');
}

const evidence = validateEvidence(JSON.parse(readFileSync(evidencePath, 'utf8')), evidencePath);
if (evidence.kind !== 'candidate' || evidence.result !== 'passed') {
  throw new Error('evidence must describe a passed candidate');
}
if (evidence.toolchain.go !== 'go1.27.1') {
  throw new Error(`candidate toolchain ${evidence.toolchain.go} is not go1.27.1`);
}
if (evidence.commit !== expectedCommit) {
  throw new Error(`candidate commit ${evidence.commit} does not match ${expectedCommit}`);
}
if (evidence.artifact.name !== basename(archivePath)) {
  throw new Error(`candidate artifact name ${evidence.artifact.name} does not match ${basename(archivePath)}`);
}
if (!evidence.details || typeof evidence.details.version !== 'string' ||
    evidence.artifact.name !== `remotexapp-${evidence.details.version}-linux-amd64.tar.gz`) {
  throw new Error('candidate artifact name does not match its recorded version and platform');
}
const sha256 = createHash('sha256').update(readFileSync(archivePath)).digest('hex');
if (evidence.artifact.sha256 !== sha256) {
  throw new Error(`candidate artifact SHA-256 ${sha256} does not match evidence`);
}
console.log(`candidate evidence passed for ${expectedCommit} and ${basename(archivePath)}`);
