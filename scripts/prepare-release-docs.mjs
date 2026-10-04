import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkDocuments, readableDocumentsUnder, rewriteArchiveLinks } from './public-docs-lib.mjs';

const [rootArg, commit, ...extra] = process.argv.slice(2);
if (!rootArg || !commit || extra.length) {
  throw new Error('usage: prepare-release-docs.mjs STAGED_RELEASE_ROOT FULL_SOURCE_COMMIT');
}
const root = resolve(rootArg);
const paths = readableDocumentsUnder(root);
for (const path of paths.filter((name) => name.endsWith('.md'))) {
  writeFileSync(join(root, path), rewriteArchiveLinks(root, path, commit));
}
const failures = checkDocuments(root, paths);
if (failures.length) throw new Error(`release documentation failed:\n${failures.join('\n')}`);
console.log(`release documentation prepared and checked (${paths.length} readable documents)`);
