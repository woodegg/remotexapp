import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkDocuments, disclosureFindings, rewriteArchiveLinks } from '../../scripts/public-docs-lib.mjs';

test('public guides allow generic examples but reject operational disclosures without echoing content', () => {
  assert.deepEqual(disclosureFindings('http://127.0.0.1:1991\n/home/appuser\nprimary-desktop\nREL-014\n'), []);
  for (const source of ['sandbox99', 'grok-bot', 'WAOS', 'release-tray/plan', '/home/sandbox',
    '/mnt/CloudDrive', 'lightview-0123456789ab', 'TASK-20260829-018']) {
    const findings = disclosureFindings(`example\n${source}`);
    assert.ok(findings.length > 0, source);
    assert.equal(findings[0].line, 2);
    assert.equal(JSON.stringify(findings).includes(source), false);
  }
});

test('archive preserves packaged links and pins omitted source guides to the exact commit', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'remotexapp-docs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs/included.md'), '# Included\n');
  writeFileSync(join(root, 'README.md'), '[Local](docs/included.md)\n[Source](docs/omitted.md#contract)\n[Web](https://example.com)\n');
  const commit = 'a'.repeat(40);
  const source = rewriteArchiveLinks(root, 'README.md', commit);
  assert.ok(source.includes('[Local](docs/included.md)'));
  assert.ok(source.includes(`https://github.com/woodegg/remotexapp/blob/${commit}/docs/omitted.md#contract`));
  assert.ok(source.includes('[Web](https://example.com)'));
  writeFileSync(join(root, 'README.md'), source);
  assert.deepEqual(checkDocuments(root, ['README.md', 'docs/included.md']), []);
});

test('missing guides and escaping local links fail the documentation gate', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'remotexapp-docs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'README.md'), '[Missing](missing.md)\n[Escape](../outside.md)\n');
  assert.equal(checkDocuments(root, ['README.md']).length, 2);
  assert.throws(() => rewriteArchiveLinks(root, 'README.md', 'a'.repeat(40)), /out-of-tree/);
  assert.throws(() => rewriteArchiveLinks(root, 'README.md', 'main'), /full source commit/);
});
