import { isAbsolute, resolve, relative, sep } from 'node:path';
export class CompanionError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export const fail = (code, status) => { throw new CompanionError(code, status); };
export const maxDownloadBytes = 64 * 1024 ** 3;
export const maxExtractedBytes = 16 * 1024 ** 3;
export const formats = {
  nes: ['nes'], snes: ['sfc', 'smc'], gb: ['gb'], gbc: ['gbc'], gba: ['gba'], n64: ['z64', 'n64', 'v64'], nds: ['nds'],
  genesis: ['md', 'gen'], sms: ['sms'], gamegear: ['gg'], atari2600: ['a26'], chip8: ['ch8'],
  psx: ['chd', 'cue', 'bin', 'iso', 'pbp', 'm3u'], ps2: ['iso', 'chd', 'bin', 'cue'], psp: ['iso', 'cso', 'pbp'],
  gamecube: ['iso', 'gcm', 'rvz'], wii: ['iso', 'wbfs', 'rvz'], dreamcast: ['chd', 'cdi'],
  saturn: ['chd', 'cue', 'bin', 'm3u'], sega32x: ['32x'], neogeopocket: ['ngp', 'ngc'], wonderswan: ['ws', 'wsc'],
};
const domains = ['torbox.app', 'tb-cdn.cx', 'tb-cdn.io', 'tb-cdn.pw', 'tb-cdn.sh', 'tb-cdn.st', 'tb-cdn.to', 'tb-cdn.earth'];
export function downloadUrl(value) {
  if (typeof value !== 'string' || value.length > 16384) fail('INVALID_DOWNLOAD_URL');
  let url; try { url = new URL(value); } catch { fail('INVALID_DOWNLOAD_URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443') ||
      url.hostname === 'api.torbox.app' || !domains.some(domain => url.hostname.endsWith('.' + domain))) fail('INVALID_DOWNLOAD_URL');
  return url;
}
export function origin(value) {
  let url; try { url = new URL(value); } catch { fail('INVALID_ORIGIN'); }
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password || url.hash || url.search || url.pathname !== '/') fail('INVALID_ORIGIN');
  return url.origin;
}
export function object(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_REQUEST'); return value; }
export function onlyKeys(value, keys) { object(value); if (Object.keys(value).some(key => !keys.includes(key))) fail('UNSUPPORTED_FIELD'); }
export function label(value, limit = 240) { if (typeof value !== 'string' || !value.trim() || value.length > limit || /[\x00-\x1f\x7f]/.test(value)) fail('INVALID_REQUEST'); return value; }
export function sourceId(value) { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail('INVALID_SOURCE_ID'); return value; }
export function safeEntry(name) {
  if (typeof name !== 'string' || name.length > 1024 || /[\\:\x00-\x1f\x7f]/.test(name) || name.startsWith('/')) fail('UNSAFE_ARCHIVE_PATH');
  const parts = name.replace(/\/$/, '').split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[ .]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) fail('UNSAFE_ARCHIVE_PATH');
  return name;
}
export function within(root, value) {
  const absolute = resolve(root, value), diff = relative(resolve(root), absolute);
  if (!diff || diff === '..' || diff.startsWith('..' + sep) || isAbsolute(diff)) fail('UNSAFE_LOCAL_PATH');
  return absolute;
}
export function installInput(raw) {
  onlyKeys(raw, ['sourceId', 'title', 'system', 'size', 'sha256', 'packaging', 'downloadUrl', 'launch', 'profileId']);
  const id = sourceId(raw.sourceId), system = label(raw.system, 60);
  if (!Object.hasOwn(formats, system)) fail('SYSTEM_NOT_SUPPORTED');
  if (!Number.isSafeInteger(raw.size) || raw.size < 1 || raw.size > maxDownloadBytes) fail('DOWNLOAD_SIZE_LIMIT');
  if (!['raw', 'zip'].includes(raw.packaging)) fail('ARCHIVE_FORMAT_UNSUPPORTED');
  if (raw.sha256 !== undefined && raw.sha256 !== '' && (typeof raw.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(raw.sha256))) fail('INVALID_CHECKSUM');
  if (raw.launch !== undefined && typeof raw.launch !== 'boolean') fail('INVALID_REQUEST');
  if (raw.profileId !== undefined && (typeof raw.profileId !== 'string' || !/^[a-z0-9-]{1,60}$/.test(raw.profileId))) fail('INVALID_PROFILE');
  const title = label(raw.title);
  const extension = title.split('.').pop().toLowerCase();
  if (raw.packaging === 'raw' && !formats[system].includes(extension)) fail('ROM_EXTENSION_REQUIRED');
  if (raw.packaging === 'raw' && ['cue', 'm3u'].includes(extension)) fail('RAW_MULTI_FILE_UNSUPPORTED');
  return { sourceId: id, title, system, size: raw.size, sha256: raw.sha256?.toLowerCase() || '', packaging: raw.packaging,
    extension: raw.packaging === 'raw' ? extension : 'zip', launch: raw.launch === true, ...(raw.profileId ? { profileId: raw.profileId } : {}) };
}
