import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const source=process.env.KASM_SERVER_SOURCE;
test('applied UDP socket is exclusive and loopback-only', {skip:!source || process.env.KASM_TRANSPORT!=='udp'},()=>{
  const work=mkdtempSync(join(tmpdir(),'kasm-udp-socket-'));
  try {
    const binary=join(work,'socket-test');
    execFileSync('c++',['-std=c++11','-I'+join(source,'common/network/webudp'),
      fileURLToPath(new URL('./udp-socket.cpp',import.meta.url)),join(source,'common/network/webudp/WuNetwork.cpp'),'-o',binary]);
    execFileSync(binary);
  }finally{rmSync(work,{recursive:true,force:true});}
});
