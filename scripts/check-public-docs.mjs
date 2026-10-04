import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { checkDocuments, isReadableDocument, readableDocumentsUnder } from './public-docs-lib.mjs';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--root')) {
  throw new Error('usage: check-public-docs.mjs [--root EXTRACTED_RELEASE_ROOT]');
}
const root = resolve(args.length ? args[1] : '.');
const files = args.length ? readableDocumentsUnder(root) :
  [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8' }).split('\0').filter(isReadableDocument))];
const failures = checkDocuments(root, files);
if (failures.length) {
  console.error(`public documentation check failed (${failures.length}):\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`public documentation check passed (${files.length} readable documents)`);
