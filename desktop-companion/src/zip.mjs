import { open, mkdir, readFile } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { dirname, posix } from 'node:path';
import { createInflateRaw } from 'node:zlib';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fail, safeEntry, within, formats, maxExtractedBytes } from './policy.mjs';

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export function crc32(bytes, value = 0xffffffff) { for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8); return value >>> 0; }
function nameOf(bytes, flags) {
  if (!(flags & 0x800) && bytes.some(byte => byte > 127)) fail('ZIP_FILENAME_ENCODING_UNSUPPORTED');
  try { return safeEntry(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch (error) { if (error.code) throw error; fail('ZIP_INVALID'); }
}
async function readAt(file, size, offset) {
  const bytes = Buffer.alloc(size), { bytesRead } = await file.read(bytes, 0, size, offset);
  if (bytesRead !== size) fail('ZIP_INVALID');
  return bytes;
}
function rejectZip64(extra) {
  let offset = 0;
  while (offset < extra.length) {
    if (offset + 4 > extra.length) fail('ZIP_INVALID');
    const tag = extra.readUInt16LE(offset), size = extra.readUInt16LE(offset + 2);
    if (tag === 1) fail('ZIP64_UNSUPPORTED');
    offset += size + 4;
    if (offset > extra.length) fail('ZIP_INVALID');
  }
}
export async function zipEntries(path, limits = {}) {
  const file = await open(path, 'r');
  try {
    const { size } = await file.stat();
    if (size < 22) fail('ZIP_INVALID');
    const tailSize = Math.min(size, 65557), tail = await readAt(file, tailSize, size - tailSize);
    let end = -1;
    for (let offset = tail.length - 22; offset >= 0; offset--) {
      if (tail.readUInt32LE(offset) === 0x06054b50 && offset + 22 + tail.readUInt16LE(offset + 20) === tail.length) { end = offset; break; }
    }
    if (end < 0) fail('ZIP_INVALID');
    const count = tail.readUInt16LE(end + 10), centralSize = tail.readUInt32LE(end + 12), centralOffset = tail.readUInt32LE(end + 16);
    if (count === 65535 || centralSize === 0xffffffff || centralOffset === 0xffffffff) fail('ZIP64_UNSUPPORTED');
    if (tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6) || tail.readUInt16LE(end + 8) !== count ||
        !count || count > (limits.maxFiles ?? 2048) || centralSize > 8 * 1024 ** 2 || centralOffset + centralSize !== size - tailSize + end) fail('ZIP_LIMIT_OR_FORMAT');
    const central = await readAt(file, centralSize, centralOffset), entries = [], seen = new Set();
    let cursor = 0, total = 0;
    for (let i = 0; i < count; i++) {
      if (cursor + 46 > central.length || central.readUInt32LE(cursor) !== 0x02014b50) fail('ZIP_INVALID');
      const flags = central.readUInt16LE(cursor + 8), method = central.readUInt16LE(cursor + 10), crc = central.readUInt32LE(cursor + 16);
      const compressed = central.readUInt32LE(cursor + 20), unpacked = central.readUInt32LE(cursor + 24), nameSize = central.readUInt16LE(cursor + 28);
      const extraSize = central.readUInt16LE(cursor + 30), commentSize = central.readUInt16LE(cursor + 32), localOffset = central.readUInt32LE(cursor + 42);
      const mode = central.readUInt32LE(cursor + 38) >>> 16, type = mode & 0xf000;
      if (flags & ~0x080e || ![0, 8].includes(method) || central.readUInt16LE(cursor + 34) || ![0, 0x4000, 0x8000].includes(type)) fail('ZIP_FEATURE_UNSUPPORTED');
      if ([compressed, unpacked, localOffset].includes(0xffffffff)) fail('ZIP64_UNSUPPORTED');
      if (cursor + 46 + nameSize + extraSize + commentSize > central.length) fail('ZIP_INVALID');
      const name = nameOf(central.subarray(cursor + 46, cursor + 46 + nameSize), flags), directory = name.endsWith('/');
      rejectZip64(central.subarray(cursor + 46 + nameSize, cursor + 46 + nameSize + extraSize));
      if ((type === 0x4000) !== directory && type !== 0 || (directory && (compressed || unpacked)) || (method === 0 && compressed !== unpacked)) fail('ZIP_INVALID');
      const normalized = name.replace(/\/$/, '').normalize('NFC').toLowerCase();
      if (seen.has(normalized)) fail('ZIP_DUPLICATE_PATH'); seen.add(normalized);
      total += unpacked;
      if (total > (limits.maxBytes ?? maxExtractedBytes) || unpacked > (limits.maxEntryBytes ?? 4 * 1024 ** 3 - 1) ||
          unpacked > Math.max(1024 ** 2, compressed * (limits.maxRatio ?? 200))) fail('ZIP_EXPANSION_LIMIT');
      const local = await readAt(file, 30, localOffset);
      if (local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(6) !== flags || local.readUInt16LE(8) !== method) fail('ZIP_INVALID');
      const localNameSize = local.readUInt16LE(26), localExtraSize = local.readUInt16LE(28);
      const localName = await readAt(file, localNameSize + localExtraSize, localOffset + 30);
      if (nameOf(localName.subarray(0, localNameSize), flags) !== name) fail('ZIP_PATH_MISMATCH');
      rejectZip64(localName.subarray(localNameSize));
      if (!(flags & 8) && (local.readUInt32LE(14) !== crc || local.readUInt32LE(18) !== compressed || local.readUInt32LE(22) !== unpacked)) fail('ZIP_INVALID');
      const start = localOffset + 30 + localNameSize + localExtraSize;
      if (start + compressed > centralOffset) fail('ZIP_INVALID');
      entries.push({ name, directory, method, crc, compressed, unpacked, start, localOffset });
      cursor += 46 + nameSize + extraSize + commentSize;
    }
    if (cursor !== central.length) fail('ZIP_INVALID');
    const ordered = [...entries].sort((a, b) => a.localOffset - b.localOffset);
    for (let i = 1; i < ordered.length; i++) if (ordered[i].localOffset < ordered[i - 1].start + ordered[i - 1].compressed) fail('ZIP_OVERLAPPING_ENTRIES');
    return entries;
  } finally { await file.close(); }
}
function chooseRom(files) {
  for (const extension of ['m3u', 'cue']) {
    const choices = files.filter(name => name.toLowerCase().endsWith('.' + extension));
    if (choices.length === 1) return choices[0];
    if (choices.length > 1) fail('ARCHIVE_ROM_AMBIGUOUS');
  }
  if (files.length !== 1) fail(files.length ? 'ARCHIVE_ROM_AMBIGUOUS' : 'ARCHIVE_ROM_NOT_FOUND');
  return files[0];
}
async function checkReferences(destination, entry, files) {
  const extension = entry.split('.').pop().toLowerCase();
  if (!['cue', 'm3u'].includes(extension)) return;
  const content = await readFile(within(destination, entry));
  if (content.length > 65536) fail('PLAYLIST_LIMIT');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(content);
  const references = extension === 'm3u' ? text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'))
    : [...text.matchAll(/^\s*FILE\s+(?:"([^"]+)"|(\S+))\s+/gim)].map(match => match[1] || match[2]);
  if (!references.length || references.length > 200) fail('PLAYLIST_INVALID');
  for (const ref of references) {
    safeEntry(ref);
    const path = posix.join(posix.dirname(entry), ref);
    if (!files.includes(path) || path === entry) fail('PLAYLIST_EXTERNAL_REFERENCE');
  }
}
export async function extractZip(path, destination, system, limits = {}) {
  if (!Object.hasOwn(formats, system)) fail('SYSTEM_NOT_SUPPORTED');
  const entries = await zipEntries(path, limits);
  const selected = entries.filter(entry => !entry.directory && formats[system].includes(entry.name.split('.').pop().toLowerCase()));
  const names = selected.map(entry => entry.name), entryPoint = chooseRom(names);
  await mkdir(destination, { mode: 0o700 });
  let actualTotal = 0;
  for (const entry of selected) {
    const target = within(destination, entry.name);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    let length = 0, crc = 0xffffffff;
    const validator = new Transform({ transform(chunk, encoding, callback) {
      length += chunk.length; actualTotal += chunk.length;
      if (length > entry.unpacked || actualTotal > (limits.maxBytes ?? maxExtractedBytes)) return callback(new Error('ZIP_EXPANSION_LIMIT'));
      crc = crc32(chunk, crc); callback(null, chunk);
    } });
    const input = entry.compressed ? createReadStream(path, { start: entry.start, end: entry.start + entry.compressed - 1 }) : (await import('node:stream')).Readable.from([]);
    const streams = [input, ...(entry.method === 8 ? [createInflateRaw()] : []), validator, createWriteStream(target, { flags: 'wx', mode: 0o600 })];
    try { await pipeline(streams); } catch { fail('ZIP_EXTRACTION_FAILED'); }
    if (length !== entry.unpacked || ((crc ^ 0xffffffff) >>> 0) !== entry.crc) fail('ZIP_CHECKSUM_MISMATCH');
  }
  for (const name of names) await checkReferences(destination, name, names);
  return { entry: entryPoint, files: names, bytes: actualTotal };
}
