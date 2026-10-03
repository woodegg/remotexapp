import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('built Console binds the manifest SDK directly under root and proxy prefixes', () => {
  const assets = new URL('../assets/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', assets)));
  const consoleCode = readFileSync(new URL(manifest.console, assets), 'utf8');
  assert(consoleCode.includes(`"./${manifest.sdk}"`));
  assert(!consoleCode.includes('/sdk/index.js'), 'must not consult a cached mutable SDK entry');
  for (const prefix of ['', '/remote/nested']) {
    const moduleURL = new URL(`https://example.test${prefix}/assets/${manifest.console}`);
    assert.equal(new URL('./' + manifest.sdk, moduleURL).pathname,
      `${prefix}/assets/${manifest.sdk}`);
  }
});
