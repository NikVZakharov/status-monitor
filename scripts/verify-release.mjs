import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';
export const repository = 'NikVZakharov/status-monitor';
export async function verifyRelease(root) {
  const manifest = JSON.parse(await readFile(resolve(root, 'release.json'), 'utf8'));
  const version = (await readFile(resolve(root, 'VERSION'), 'utf8')).trim();
  if (manifest.repository !== repository || manifest.version !== version || manifest.tag !== `v${version}`
      || !/^\d+\.\d+\.\d+$/.test(version) || !/^[a-f0-9]{40}$/.test(manifest.commit)
      || !manifest.files || !Object.keys(manifest.files).length) throw new Error('Invalid release provenance');
  for (const [file, digest] of Object.entries(manifest.files)) {
    const path = resolve(root, file);
    if (!path.startsWith(`${resolve(root)}${sep}`) || !/^[a-f0-9]{64}$/.test(digest)
        || createHash('sha256').update(await readFile(path)).digest('hex') !== digest)
      throw new Error('Release file integrity check failed');
  }
  for (const file of ['src/monitor.mjs', 'src/profile.mjs', 'src/status-state.mjs', 'src/probes.mjs', 'src/probe-transport.mjs', 'src/server.mjs', 'run.sh', 'scripts/install.mjs'])
    if (!Object.hasOwn(manifest.files, file)) throw new Error('Incomplete release');
  return manifest;
}
