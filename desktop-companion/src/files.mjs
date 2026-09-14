import { mkdir, readFile, writeFile, rename, lstat, realpath, rm } from 'node:fs/promises';
import { dirname, resolve, relative, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fail, within } from './policy.mjs';
export async function jsonRead(path, fallback) { try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; fail('LOCAL_STATE_INVALID', 500); } }
export async function jsonWrite(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = path + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx', flush: true });
  await rename(temporary, path);
}
export async function safeTree(root, target) {
  const canonical = await realpath(root), full = within(root, target), parts = relative(resolve(root), full).split(sep);
  let current = resolve(root);
  for (const part of parts) {
    current = resolve(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) fail('UNSAFE_LOCAL_PATH'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const parent = await realpath(dirname(full)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (parent && parent !== canonical && !parent.startsWith(canonical + sep)) fail('UNSAFE_LOCAL_PATH');
  return full;
}
export async function removeOwned(root, child) { const target = await safeTree(root, child); await rm(target, { recursive: true, force: true }); }
