import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, readFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { verifyRelease, repository } from '../scripts/verify-release.mjs';
import { treeDigest } from '../scripts/install.mjs';
test('release provenance detects modified and incomplete executable files',async t=>{
 const root=await mkdtemp(join(tmpdir(),'status-release-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const paths=['src/monitor.mjs','src/profile.mjs','src/status-state.mjs','src/probes.mjs','src/probe-transport.mjs','src/server.mjs','run.sh','scripts/install.mjs'];
 const files={};await writeFile(join(root,'VERSION'),'0.1.0\n');
 for(const path of paths){await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),'source\n');files[path]=createHash('sha256').update('source\n').digest('hex');}
 const manifest={repository,version:'0.1.0',tag:'v0.1.0',commit:'a'.repeat(40),files};
 await writeFile(join(root,'release.json'),JSON.stringify(manifest));
 assert.equal((await verifyRelease(root)).tag,'v0.1.0');
 await writeFile(join(root,'src/monitor.mjs'),'tampered\n');await assert.rejects(verifyRelease(root),/integrity/);
 await writeFile(join(root,'src/monitor.mjs'),'source\n');delete manifest.files['src/profile.mjs'];await writeFile(join(root,'release.json'),JSON.stringify(manifest));await assert.rejects(verifyRelease(root),/Incomplete/);
});
test('bundle digest preserves file identity independently of its installation directory',async t=>{
 const root=await mkdtemp(join(tmpdir(),'status-bundle-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'one'));await writeFile(join(root,'one/index.html'),'<html></html>');await cp(join(root,'one'),join(root,'two'),{recursive:true});
 assert.equal(await treeDigest(join(root,'one')),await treeDigest(join(root,'two')));
 await writeFile(join(root,'two/index.html'),'<html>changed</html>');assert.notEqual(await treeDigest(join(root,'one')),await treeDigest(join(root,'two')));
});
