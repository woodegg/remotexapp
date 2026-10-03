import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateEvidence } from './evidence-lib.mjs';

function defaultEvidenceFiles() {
  const root = 'tests/evidence/v1';
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => name.endsWith('.json'))
    .map((name) => join(root, name));
}

export function checkEvidenceFiles(paths) {
  if (paths.length === 0) throw new Error('no evidence files were selected');
  for (const path of paths) {
    if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`missing evidence file: ${path}`);
    validateEvidence(JSON.parse(readFileSync(path, 'utf8')), path);
  }
  return paths.length;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const paths = process.argv.slice(2);
  const count = checkEvidenceFiles(paths.length === 0 ? defaultEvidenceFiles() : paths);
  console.log(`evidence check passed: ${count} v1 file(s)`);
}
