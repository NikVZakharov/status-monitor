import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { verifyRelease, repository } from './verify-release.mjs';
const root=resolve(import.meta.dirname,'..');
const version=(await readFile(join(root,'VERSION'),'utf8')).trim();
if(!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('A stable semantic version is required');
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const dist=join(root,'dist');const name=`status-monitor-v${version}`;const stage=join(dist,name);
await rm(stage,{recursive:true,force:true});await mkdir(stage,{recursive:true});
const files=['VERSION','package.json','README.md','run.sh','install.sh','scripts/install.mjs','scripts/verify-release.mjs',...(await readdir(join(root,'src'))).filter(name=>name.endsWith('.mjs')).map(name=>`src/${name}`)];
const hashes={};
for(const file of files) {
 await mkdir(resolve(stage,file,'..'),{recursive:true});await cp(join(root,file),join(stage,file));
 hashes[file]=createHash('sha256').update(await readFile(join(stage,file))).digest('hex');
}
const manifest={repository,version,tag:`v${version}`,commit,files:hashes};
await writeFile(join(stage,'release.json'),`${JSON.stringify(manifest,null,2)}\n`);
await verifyRelease(stage);
const stamp=execFileSync('git',['show','-s','--format=%ct','HEAD'],{cwd:root,encoding:'utf8'}).trim();
execFileSync('python3',[join(root,'scripts/archive.py'),stage,join(dist,`${name}.tar.gz`),stamp]);
const archiveHash=createHash('sha256').update(await readFile(join(dist,`${name}.tar.gz`))).digest('hex');
await writeFile(join(dist,'SHA256SUMS'),`${archiveHash}  ${name}.tar.gz\n`);
await writeFile(join(dist,'release.json'),`${JSON.stringify(manifest,null,2)}\n`);
console.log(JSON.stringify({archive:`dist/${name}.tar.gz`,sha256:archiveHash,...manifest},null,2));
