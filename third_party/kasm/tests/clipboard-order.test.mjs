import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('native clipboard ordering rejects stale, overlapping, unprivileged and unnegotiated admission', () => {
  const patch = readFileSync(new URL('../patches/0029-server-clipboard-ordering.patch', import.meta.url), 'utf8');
  const file = patch.split('+++ b/common/rfb/NativeClipboardOrder.h\n')[1]?.split('\n--- ')[0];
  assert.ok(file, 'test the exact new header shipped by the patch');
  const header = file.split('\n').filter(line => line.startsWith('+')).map(line => line.slice(1)).join('\n') + '\n';
  const work = mkdtempSync(join(tmpdir(), 'clipboard-order-'));
  try {
    writeFileSync(join(work, 'NativeClipboardOrder.h'), header);
    writeFileSync(join(work, 'test.cpp'), readFileSync(new URL('clipboard-order.cpp', import.meta.url)));
    execFileSync(process.env.KASM_TEST_CXX || 'c++', ['-std=c++11', '-g', '-fsanitize=address,undefined',
      '-fno-omit-frame-pointer', join(work, 'test.cpp'), '-o', join(work, 'test')]);
    execFileSync(join(work, 'test'), [], {env:{...process.env, ASAN_OPTIONS:'detect_leaks=1:halt_on_error=1'}});
  } finally { rmSync(work, {recursive:true, force:true}); }
});
