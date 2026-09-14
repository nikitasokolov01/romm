import { open, stat, truncate } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { downloadUrl, fail, CompanionError } from './policy.mjs';

// Control credentials never reach the provider; only Range/If-Range apply to CDN requests.
export async function receiveFile(job, urlValue, destination, { transport = fetch, save = async () => {}, signal } = {}) {
  let url = downloadUrl(urlValue);
  let offset = await stat(destination).then(info => info.size).catch(error => { if (error.code === 'ENOENT') return 0; throw error; });
  if (offset > job.size) fail('PARTIAL_FILE_INVALID');
  if (offset && !job.validator && !job.sha256) { await truncate(destination, 0); offset = 0; }
  if (offset === job.size) return verifyFile(destination, job.sha256);
  const controller = new AbortController();
  let idle = setTimeout(() => controller.abort(), 30000);
  const headers = { 'Accept-Encoding': 'identity' };
  if (offset) { headers.Range = `bytes=${offset}-`; if (job.validator) headers['If-Range'] = job.validator; }
  let file, reader;
  try {
    let response;
    for(let hop=0;hop<4;hop++){
      response = await transport(url, { headers, credentials: 'omit', redirect: 'manual', signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal });
      if(![301,302,303,307,308].includes(response.status))break;
      await response.body?.cancel();
      const location=response.headers.get('location');
      if(!location || hop===3)fail('DOWNLOAD_REDIRECT_BLOCKED',409);
      try{url=downloadUrl(new URL(location,url).href);}catch{fail('DOWNLOAD_REDIRECT_BLOCKED',409);}
    }
    if ([401, 403, 404, 410].includes(response.status)) { await response.body?.cancel(); fail('DOWNLOAD_URL_EXPIRED', 409); }
    if (![200, 206].includes(response.status)) { await response.body?.cancel(); fail('DOWNLOAD_UNAVAILABLE', 502); }
    if (response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity') { await response.body?.cancel(); fail('DOWNLOAD_ENCODING_UNSUPPORTED'); }
    const etag = response.headers.get('etag'), validator = etag && /^"[^"\r\n]{1,500}"$/.test(etag) ? etag : '';
    if (response.status === 206) {
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
      if (!range || Number(range[1]) !== offset || Number(range[2]) !== job.size - 1 || Number(range[3]) !== job.size ||
          (job.validator && validator !== job.validator)) { await response.body?.cancel(); fail('DOWNLOAD_RANGE_MISMATCH'); }
    } else offset = 0; // A server ignoring Range starts a replacement, never an append.
    if (response.headers.has('content-length') && Number(response.headers.get('content-length')) !== job.size - offset) { await response.body?.cancel(); fail('DOWNLOAD_SIZE_MISMATCH'); }
    reader = response.body?.getReader(); if (!reader) fail('DOWNLOAD_EMPTY');
    file = await open(destination, offset ? 'r+' : 'w', 0o600);
    job.validator = validator; job.received = offset; await save();
    let position = offset;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      clearTimeout(idle); idle = setTimeout(() => controller.abort(), 30000);
      if (position + value.length > job.size) fail('DOWNLOAD_SIZE_MISMATCH');
      let written = 0;
      while (written < value.length) {
        const result = await file.write(value, written, value.length - written, position + written);
        if (!result.bytesWritten) fail('DISK_WRITE_FAILED', 500);
        written += result.bytesWritten;
      }
      position += value.length; job.received = position;
    }
    await file.sync();
    if (position !== job.size) fail('DOWNLOAD_INTERRUPTED', 409);
  } catch (error) {
    await reader?.cancel().catch(() => {});
    if (error instanceof CompanionError) throw error;
    fail(signal?.aborted ? 'DOWNLOAD_PAUSED' : 'DOWNLOAD_INTERRUPTED', 409);
  } finally { clearTimeout(idle); await file?.close(); }
  return verifyFile(destination, job.sha256);
}
export async function verifyFile(path, expected) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const actual = hash.digest('hex');
  if (expected && actual !== expected) fail('DOWNLOAD_CHECKSUM_MISMATCH');
  return actual;
}
