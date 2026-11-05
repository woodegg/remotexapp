import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

test('server anchor uses the configured system PATH and retains readiness PID',()=>{
  const root=mkdtempSync(join(tmpdir(),'remotexapp-anchor-'));
  try{
    symlinkSync('/bin/mkdir',join(root,'mkdir'));
    writeFileSync(join(root,'sleep'),'#!/bin/sh\nprintf "%s\\n" "$*" > "$REMOTEXAPP_RUNTIME/args"\nprintf "%s\\n" "$$" > "$REMOTEXAPP_RUNTIME/observed.pid"\n',{mode:0o755});
    const runtime=join(root,'runtime');
    const result=spawnSync('/bin/sh',[resolve('drivers/common/x11-server.sh')],{env:{...process.env,PATH:root,REMOTEXAPP_RUNTIME:runtime},encoding:'utf8',timeout:3000});
    assert.equal(result.status,0,result.stderr);
    assert.equal(readFileSync(join(runtime,'args'),'utf8'),'infinity\n');
    assert.equal(readFileSync(join(runtime,'server.pid'),'utf8'),readFileSync(join(runtime,'observed.pid'),'utf8'));
  }finally{rmSync(root,{recursive:true,force:true});}
});
