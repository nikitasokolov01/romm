import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { crc32 } from '../src/zip.mjs';
export const bytes = Buffer.from('ROMIO SYNTHETIC TEST DATA. THIS IS NOT A ROM.');
export const digest = value => createHash('sha256').update(value).digest('hex');
export const id = 'a'.repeat(64);
export const input = (changes = {}) => ({ sourceId: id, title: 'Synthetic.gba', system: 'gba', size: bytes.length, sha256: digest(bytes), packaging: 'raw', downloadUrl: 'https://cdn.torbox.app/synthetic?token=temporary-provider-test-token', ...changes });
export async function temporary(t) {
  const directory = await mkdtemp(join(tmpdir(), 'romio-companion-test-'));
  t.after(async () => { if (!resolve(directory).startsWith(resolve(tmpdir()) + '\\romio-companion-test-') && !resolve(directory).startsWith(resolve(tmpdir()) + '/romio-companion-test-')) throw new Error('Unsafe test cleanup'); await rm(directory, { recursive: true, force: true }); });
  return directory;
}
export function zip(files) {
  const locals = [], central = []; let offset = 0;
  for (const item of files) {
    const name = Buffer.from(item.name), data = item.bytes || bytes, method = item.method ?? 0, compressed = method === 8 ? deflateRawSync(data) : data;
    const checksum = item.crc ?? ((crc32(data) ^ 0xffffffff) >>> 0), unpacked = item.unpacked ?? data.length;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(checksum, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(unpacked, 22); local.writeUInt16LE(name.length, 26);
    const header = Buffer.alloc(46); header.writeUInt32LE(0x02014b50); header.writeUInt16LE(0x0314, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(0x800, 8); header.writeUInt16LE(method, 10);
    header.writeUInt32LE(checksum, 16); header.writeUInt32LE(compressed.length, 20); header.writeUInt32LE(unpacked, 24); header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(item.attributes ?? 0, 38); header.writeUInt32LE(offset, 42);
    locals.push(local, name, compressed); central.push(header, name); offset += local.length + name.length + compressed.length;
  }
  const table = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(table.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, table, end]);
}
export async function settled(companion) { await Promise.all([...companion.active.values()].map(active => active.promise)); }
