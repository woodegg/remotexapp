import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const experiments = JSON.parse(readFileSync(join(root, 'tests/performance/experiments.json'), 'utf8'));
const experimentRecord = readFileSync(join(root, 'docs/performance-experiments.md'), 'utf8');
const handover = readFileSync(join(root, 'docs/production-handover.md'), 'utf8');
const failures = [];

function requireFile(path, label) {
  try {
    if (!statSync(path).isFile()) failures.push(`${label} is not a file: ${path}`);
  } catch {
    failures.push(`${label} is missing: ${path}`);
  }
}

for (const experiment of experiments) {
  const directory = join(root, 'tests/performance', experiment.directory);
  const readme = join(directory, 'README.md');
  const results = join(directory, experiment.results);
  requireFile(readme, `${experiment.id} README`);
  requireFile(results, `${experiment.id} results`);

  try {
    const payload = JSON.parse(readFileSync(results, 'utf8'));
    if (payload.experiment !== experiment.id) {
      failures.push(`${experiment.id} result experiment=${JSON.stringify(payload.experiment)}`);
    }
    if (payload.outcome !== experiment.outcome) {
      failures.push(`${experiment.id} result outcome=${JSON.stringify(payload.outcome)}, expected ${experiment.outcome}`);
    }
    if (!payload.status) failures.push(`${experiment.id} result has no status text`);
  } catch (error) {
    failures.push(`${experiment.id} results are invalid JSON: ${error.message}`);
  }

  const registerLine = experimentRecord.split('\n').find(line => line.startsWith(`| ${experiment.id} |`));
  const expectedLabel = experiment.outcome === 'accepted' ? '**Accepted:' : '**Rejected:';
  if (!registerLine || !registerLine.includes(expectedLabel)) {
    failures.push(`${experiment.id} experiment-register outcome is missing or inconsistent`);
  }
  if (!experimentRecord.includes(`## ${experiment.id}:`)) {
    failures.push(`${experiment.id} detailed experiment section is missing`);
  }
  if (!handover.includes(`| ${experiment.id} `)) {
    failures.push(`${experiment.id} production-handover row is missing`);
  }
}

if (failures.length) {
  console.error(`performance documentation check failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`performance documentation check passed (${experiments.length} completed experiments)`);
