import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { setTimeout } from 'node:timers/promises';
import { loadProfile } from '../src/profile.mjs';
import { configuration } from '../src/monitor.mjs';
import { verifyRelease } from './verify-release.mjs';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const command = (name, args) => execFileSync(name, args, {encoding:'utf8', stdio:['ignore','pipe','pipe']});
async function exists(path) { try { await stat(path); return true; } catch(error) { if(error.code==='ENOENT') return false; throw error; } }
async function rejectLinks(path) {
  for (const item of await readdir(path,{withFileTypes:true})) {
    if (item.isSymbolicLink()) throw new Error('Status bundle must not contain symbolic links');
    if (item.isDirectory()) await rejectLinks(join(path,item.name));
  }
}
export async function treeDigest(path) {
  const digest=createHash('sha256');
  async function visit(current, relative='') {
    const entries=(await readdir(current,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'));
    for(const item of entries) {
      const rel=relative?`${relative}/${item.name}`:item.name;
      if(item.isDirectory()) await visit(join(current,item.name),rel);
      else if(item.isFile()) { digest.update(rel);digest.update('\0');digest.update(await readFile(join(current,item.name)));digest.update('\0'); }
      else throw new Error('Unsupported bundle entry');
    }
  }
  await visit(path);return digest.digest('hex');
}
async function main() {
  if (process.getuid?.()!==0) throw new Error('Run the installer as root');
  const [environmentFile,bundleDirectory,profilePath]=process.argv.slice(2);
  if (![environmentFile,bundleDirectory,profilePath].every(path=>path&&isAbsolute(path))) throw new Error('Absolute environment, bundle and project profile paths are required');
  const release=await verifyRelease(sourceRoot);
  const profile=await loadProfile(profilePath);
  const originalEnvironment=await readFile(environmentFile,'utf8');
  const config=configuration(parseEnv(originalEnvironment),profile);
  const service=`${profile.id}-status-monitor`;
  const live=`/opt/promtech/${service}`;
  const envPath=`/etc/promtech/${service}.env`;
  const unitPath=`/etc/systemd/system/${service}.service`;
  if (config.stateDirectory!==`/var/lib/${service}` || config.bundleDirectory!==`${live}/public`) throw new Error('Canonical state and bundle directories are required');
  if (!(await stat(join(bundleDirectory,'index.html'))).isFile()) throw new Error('Standalone status bundle is required');
  await rejectLinks(bundleDirectory);
  const profileBytes=await readFile(profilePath);
  const bundleSha256=await treeDigest(bundleDirectory);
  command('flock',['--version']); command('systemctl',['--version']);
  if (spawnSync('getent',['passwd',`${profile.id}-status`]).status!==0)
    command('useradd',['--system','--home-dir','/nonexistent','--shell','/usr/sbin/nologin',`${profile.id}-status`]);
  await mkdir('/opt/promtech',{recursive:true,mode:0o755});
  await mkdir('/etc/promtech',{recursive:true,mode:0o755});
  await mkdir(config.stateDirectory,{recursive:true,mode:0o700});
  command('chown',[`${profile.id}-status:${profile.id}-status`,config.stateDirectory]);
  await chmod(config.stateDirectory,0o700);
  const staging=await mkdtemp(`${live}.next.`);
  await chmod(staging,0o755);
  const backup=`/var/backups/status-monitor/${service}/${new Date().toISOString().replace(/[:.]/g,'-')}`;
  await mkdir(backup,{recursive:true,mode:0o700});
  const hadLive=await exists(live);
  const hadEnv=await exists(envPath);
  const hadUnit=await exists(unitPath);
  const wasActive=spawnSync('systemctl',['is-active','--quiet',`${service}.service`]).status===0;
  let stopped=false;
  try {
    for(const file of Object.keys(release.files)) {
      const target=join(staging,file);
      await mkdir(dirname(target),{recursive:true,mode:0o755});
      await cp(join(sourceRoot,file),target);
      await chmod(target,file.endsWith('.sh')?0o755:0o644);
    }
    await writeFile(join(staging,'release.json'),`${JSON.stringify(release,null,2)}\n`,{mode:0o644});
    await writeFile(join(staging,'profile.mjs'),profileBytes,{mode:0o644});
    await cp(bundleDirectory,join(staging,'public'),{recursive:true});
    if (await treeDigest(join(staging,'public'))!==bundleSha256) throw new Error('Status bundle changed while staging');
    await verifyRelease(staging);
    await writeFile(join(staging,'installation.json'),`${JSON.stringify({repository:release.repository,tag:release.tag,version:release.version,commit:release.commit,profileSha256:createHash('sha256').update(profileBytes).digest('hex'),bundleSha256,installedAt:new Date().toISOString()},null,2)}\n`,{mode:0o644});
    if(hadEnv) await cp(envPath,join(backup,'environment.env'));
    if(hadUnit) await cp(unitPath,join(backup,'service.unit'));
    const installedEnvironment=originalEnvironment.split('\n').filter(line=>!/^\s*(?:export\s+)?STATUS_PROFILE_PATH\s*=/.test(line)).join('\n').trimEnd()+`\nSTATUS_PROFILE_PATH=${live}/profile.mjs\n`;
    const unit=`[Unit]\nDescription=${profile.id} independent public status monitor\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nUser=${profile.id}-status\nGroup=${profile.id}-status\nEnvironmentFile=${envPath}\nExecStart=${live}/run.sh\nRestart=on-failure\nRestartSec=10\nTimeoutStopSec=15\nStateDirectory=${service}\nStateDirectoryMode=0700\nUMask=0077\nNoNewPrivileges=true\nPrivateTmp=true\nProtectHome=true\nProtectSystem=strict\nReadWritePaths=${config.stateDirectory}\nProtectKernelTunables=true\nProtectKernelModules=true\nProtectControlGroups=true\nRestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX\n\n[Install]\nWantedBy=multi-user.target\n`;
    if(command('systemctl',['show',`${service}.service`,'--property=LoadState','--value']).trim()!=='not-found') command('systemctl',['stop',`${service}.service`]);
    stopped=true;
    if(hadLive) await rename(live,join(backup,'runtime'));
    await rename(staging,live);
    await writeFile(envPath,installedEnvironment,{mode:0o600});await chmod(envPath,0o600);
    await writeFile(unitPath,unit,{mode:0o644});
    command('systemctl',['daemon-reload']);command('systemctl',['enable','--now',`${service}.service`]);
    let ready=false;
    for(let attempt=0;attempt<20;attempt++) {
      try {
        const response=await fetch(`http://127.0.0.1:${config.port}/status.json`,{signal:AbortSignal.timeout(1500)});
        const feed=await response.json();
        if(response.status===200 && Array.isArray(feed.components) && ['current','stale','unobserved','unconfirmed'].includes(feed.observationState)) { ready=true;break; }
      } catch {}
      await setTimeout(500);
    }
    if(!ready || spawnSync('systemctl',['is-active','--quiet',`${service}.service`]).status!==0) throw new Error('Installed monitor did not become ready');
    console.log(JSON.stringify({service,repository:release.repository,tag:release.tag,commit:release.commit,bundleSha256,backup}));
  } catch(error) {
    if(stopped) {
      spawnSync('systemctl',['stop',`${service}.service`]);
      if(await exists(join(backup,'runtime'))) { await rm(live,{recursive:true,force:true});await rename(join(backup,'runtime'),live); }
      else if(!hadLive) await rm(live,{recursive:true,force:true});
      if(hadEnv) await cp(join(backup,'environment.env'),envPath);else await rm(envPath,{force:true});
      if(hadUnit) await cp(join(backup,'service.unit'),unitPath);else await rm(unitPath,{force:true});
      command('systemctl',['daemon-reload']);
      if(wasActive) command('systemctl',['start',`${service}.service`]);
    }
    throw error;
  } finally { await rm(staging,{recursive:true,force:true}); }
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(()=>{console.error('Status monitor installation failed; previous runtime restored when activation had started. Protected values are omitted.');process.exitCode=1;});
