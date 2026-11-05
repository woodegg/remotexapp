import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const source=process.env.KASM_SERVER_SOURCE;
test('applied server stages rich clipboard before mutation and bounds allocations', {skip:!source},()=>{
  const input=readFileSync(join(source,'common/rfb/SMsgReader.cxx'),'utf8');
  const start=input.indexOf('void SMsgReader::readBinaryClipboard()'),end=input.indexOf('void SMsgReader::readExtendedClipboard',start);
  assert(start>=0&&end>start);
  const work=mkdtempSync(join(tmpdir(),'native-clipboard-'));
  try {
    const harness=readFileSync(new URL('native-clipboard.cpp',import.meta.url),'utf8');
    writeFileSync(join(work,'test.cpp'),harness.replace('// INSERT_APPLIED_READER',input.slice(start,end)));
    execFileSync(process.env.KASM_TEST_CXX||'c++',['-std=c++11','-g','-fsanitize=address,undefined','-fno-omit-frame-pointer','-I'+join(source,'common'),join(work,'test.cpp'),'-o',join(work,'test')]);
    execFileSync(join(work,'test'),[],{env:{...process.env,ASAN_OPTIONS:'detect_leaks=1:halt_on_error=1'}});
  } finally {rmSync(work,{recursive:true,force:true});}
});
