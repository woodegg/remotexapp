import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const source = process.env.KASM_SERVER_SOURCE;
test('applied encoding cache preserves ordering, lengths and allocation ownership', {skip:!source}, () => {
  const work = mkdtempSync(join(tmpdir(), 'kasm-cache-test-'));
  try {
    const binary = join(work, 'cache-test');
    execFileSync('c++', ['-std=c++11', '-g', '-fsanitize=address,undefined',
      '-fno-omit-frame-pointer', '-I' + join(source, 'common'),
      fileURLToPath(new URL('./encoding-cache.cpp', import.meta.url)),
      join(source, 'common/rfb/EncCache.cxx'), '-o', binary]);
    execFileSync(binary, [], {env:{...process.env, ASAN_OPTIONS:'detect_leaks=1:halt_on_error=1'}});
  } finally {
    rmSync(work, {recursive:true, force:true});
  }
});
