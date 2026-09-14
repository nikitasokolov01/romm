import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, stat, lstat, rename, unlink, statfs } from 'node:fs/promises';
import { isAbsolute, join, dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { jsonRead, jsonWrite, safeTree, removeOwned } from './files.mjs';
import { CompanionError, fail, object, onlyKeys, label, origin, sourceId, safeEntry, installInput, downloadUrl, formats, maxDownloadBytes, maxExtractedBytes, within } from './policy.mjs';
import { receiveFile } from './download.mjs';
import { extractZip } from './zip.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export class Companion {
  constructor({ directory, transport = fetch, launchProcess = spawn } = {}) {
    this.directory = resolve(directory); this.transport = transport; this.launchProcess = launchProcess;
    this.controlToken = randomBytes(32).toString('base64url'); this.active = new Map(); this.codes = new Map(); this.saving = Promise.resolve();
  }
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    this.config = await jsonRead(join(this.directory, 'config.json'), { deviceId: randomUUID(), libraryRoot: join(this.directory, 'library'), allowedOrigins: [], profiles: [], pairs: [] });
    this.state = await jsonRead(join(this.directory, 'library.json'), { jobs: {}, library: {} });
    for (const job of Object.values(this.state.jobs)) if (['downloading', 'extracting'].includes(job.state)) {
      const installed = await this.completed(job).catch(() => null);
      if (installed) { this.state.library[job.sourceId] = installed; job.state = 'installed'; job.received = job.size; job.error = null; }
      else { job.state = 'paused'; job.error = 'DOWNLOAD_PAUSED'; }
    }
    await this.saveConfig(); await this.save(); return this;
  }
  saveConfig() { return jsonWrite(join(this.directory, 'config.json'), this.config); }
  save() { this.saving = this.saving.then(() => jsonWrite(join(this.directory, 'library.json'), this.state)); return this.saving; }
  capabilities() { return { version: '0.1.0', deviceId: this.config.deviceId, formats: ['raw', 'zip'], systems: Object.keys(formats), maxDownloadBytes, maxExtractedBytes, pairingRequired: true }; }
  profiles() { return this.config.profiles.map(({ id, label, systems }) => ({ id, label, systems })); }
  settings() { return { libraryRoot: this.config.libraryRoot, allowedOrigins: this.config.allowedOrigins, profiles: this.config.profiles,
    pairs: this.config.pairs.map(({ id, origin, createdAt }) => ({ id, origin, createdAt })) }; }
  async configure(input) {
    onlyKeys(input, ['libraryRoot', 'allowedOrigins', 'profiles']);
    if (this.active.size) fail('DOWNLOADS_ACTIVE', 409);
    const libraryRoot = label(input.libraryRoot, 1024);
    if (!isAbsolute(libraryRoot) || libraryRoot.startsWith('\\\\')) fail('INVALID_LIBRARY_FOLDER');
    if (libraryRoot !== this.config.libraryRoot && (Object.keys(this.state.library).length || Object.keys(this.state.jobs).length)) fail('LIBRARY_MOVE_NOT_SUPPORTED', 409);
    if (!Array.isArray(input.allowedOrigins) || input.allowedOrigins.length > 10) fail('INVALID_ORIGIN');
    const allowedOrigins = [...new Set(input.allowedOrigins.map(origin))];
    if (!Array.isArray(input.profiles) || input.profiles.length > 30) fail('INVALID_PROFILE');
    const profiles = [], ids = new Set();
    for (const raw of input.profiles) {
      onlyKeys(raw, ['id', 'label', 'systems', 'executable', 'args']);
      if (!/^[a-z0-9-]{1,60}$/.test(raw.id) || ids.has(raw.id)) fail('INVALID_PROFILE'); ids.add(raw.id);
      if (!Array.isArray(raw.systems) || !raw.systems.length || raw.systems.some(system => !Object.hasOwn(formats, system))) fail('INVALID_PROFILE');
      const executable = label(raw.executable, 1024);
      if (!isAbsolute(executable) || !/\.exe$/i.test(executable) || executable.startsWith('\\\\')) fail('INVALID_EMULATOR_PATH');
      const info = await lstat(executable).catch(() => null);
      if (!info?.isFile() || info.isSymbolicLink()) fail('EMULATOR_NOT_FOUND');
      if (!Array.isArray(raw.args) || raw.args.length > 30 || raw.args.filter(arg => arg === '{rom}').length !== 1 ||
          raw.args.some(arg => typeof arg !== 'string' || arg.length > 2048 || /[\x00-\x1f]/.test(arg) || (arg.includes('{rom}') && arg !== '{rom}'))) fail('INVALID_EMULATOR_ARGUMENTS');
      profiles.push({ id: raw.id, label: label(raw.label, 100), systems: [...new Set(raw.systems)], executable, args: raw.args });
    }
    await mkdir(libraryRoot, { recursive: true, mode: 0o700 });
    this.config = { ...this.config, libraryRoot: resolve(libraryRoot), allowedOrigins, profiles,
      pairs: this.config.pairs.filter(pair => allowedOrigins.includes(pair.origin)) };
    this.codes.clear(); await this.saveConfig(); return this.settings();
  }
  createCode(input) {
    onlyKeys(input, ['origin']);
    if (!this.config.allowedOrigins.includes(input.origin)) fail('ORIGIN_NOT_APPROVED', 403);
    const code = String(randomBytes(4).readUInt32BE() % 100000000).padStart(8, '0');
    this.codes.clear(); this.codes.set(input.origin, { hash: hash(code), expires: Date.now() + 300000, attempts: 0 });
    return { code, expiresIn: 300 };
  }
  async pair(site, input) {
    onlyKeys(input, ['code']);
    const code = this.codes.get(site);
    if (!code || Date.now() > code.expires || ++code.attempts > 10 || typeof input.code !== 'string' || !equal(hash(input.code), code.hash)) fail('PAIRING_CODE_INVALID', 403);
    this.codes.delete(site);
    const token = randomBytes(32).toString('base64url'), id = randomUUID();
    this.config.pairs = this.config.pairs.filter(pair => pair.origin !== site);
    this.config.pairs.push({ id, origin: site, tokenHash: hash(token), createdAt: new Date().toISOString() });
    await this.saveConfig(); return { token, deviceId: this.config.deviceId, capabilities: this.capabilities() };
  }
  authorize(site, token) { return typeof token === 'string' && this.config.pairs.some(pair => pair.origin === site && equal(pair.tokenHash, hash(token))); }
  async revoke(id) { this.config.pairs = this.config.pairs.filter(pair => pair.id !== id); await this.saveConfig(); return { revoked: true }; }
  library() { return { items: Object.values(this.state.library).map(({ localPath, ...item }) => item) }; }
  job(id) {
    sourceId(id); const job = this.state.jobs[id]; if (!job) fail('JOB_NOT_FOUND', 404);
    const { validator, sha256, ...view } = job; return { ...view, id, total: job.size };
  }
  profile(system, profileId) {
    const profile = this.config.profiles.find(profile => (!profileId || profile.id === profileId) && profile.systems.includes(system));
    if (!profile) fail('EMULATOR_PROFILE_REQUIRED', 409); return profile;
  }
  async completed(job) {
    const root = this.config.libraryRoot;
    if (!await stat(root).catch(() => null)) return null;
    const folder = await safeTree(root, join('games', sourceId(job.sourceId)));
    const manifest = await jsonRead(within(folder, 'install.json'), null);
    if (!manifest) return null;
    if (manifest.sourceId !== job.sourceId || manifest.size !== job.size || manifest.system !== job.system || !/^[a-f0-9]{64}$/.test(manifest.verifiedSha256) ||
      !Array.isArray(manifest.files) || !manifest.files.includes(manifest.entry)) fail('LOCAL_STATE_INVALID');
    for (const file of manifest.files) safeEntry(file);
    const target = await safeTree(root, join('games', job.sourceId, manifest.entry));
    if (!(await stat(target)).isFile()) fail('INSTALLED_FILE_MISSING');
    return { ...manifest, localPath: target };
  }
  async install(input) {
    const metadata = installInput(input), url = downloadUrl(input.downloadUrl).href, id = metadata.sourceId;
    if (metadata.launch) this.profile(metadata.system, metadata.profileId);
    const previous = this.state.jobs[id];
    if (previous) {
      if (['size', 'system', 'packaging', 'sha256'].some(key => previous[key] !== metadata[key])) fail('SOURCE_ID_CONFLICT', 409);
      if (previous.state === 'installed' && metadata.launch) { await this.launch(id, metadata.profileId); previous.launched = true; delete previous.launchError; await this.save(); }
      return this.job(id);
    }
    if (this.active.size >= 2) fail('DOWNLOADS_BUSY', 409);
    const job = { ...metadata, state: 'downloading', received: 0, createdAt: new Date().toISOString(), error: null };
    this.state.jobs[id] = job; await this.save();
    this.enqueue(job, url); return this.job(id);
  }
  async resume(id, input) {
    sourceId(id); onlyKeys(input, ['downloadUrl']); const url = downloadUrl(input.downloadUrl).href;
    const job = this.state.jobs[id]; if (!job) fail('JOB_NOT_FOUND', 404);
    if (this.active.has(id)) return this.job(id);
    if (job.state !== 'paused') fail('JOB_NOT_RESUMABLE', 409);
    if (this.active.size >= 2) fail('DOWNLOADS_BUSY', 409);
    job.state = 'downloading'; job.error = null; await this.save(); this.enqueue(job, url); return this.job(id);
  }
  enqueue(job, url) {
    const controller = new AbortController();
    const promise = this.run(job, url, controller.signal).catch(async error => {
      const code = error instanceof CompanionError ? error.code : 'INSTALL_FAILED';
      job.state = ['DOWNLOAD_INTERRUPTED', 'DOWNLOAD_PAUSED', 'DOWNLOAD_URL_EXPIRED', 'DOWNLOAD_UNAVAILABLE', 'DOWNLOAD_REDIRECT_BLOCKED'].includes(code) ? 'paused' : 'failed';
      job.error = code; await this.save();
    }).finally(() => this.active.delete(job.sourceId));
    this.active.set(job.sourceId, { promise, controller });
  }
  async run(job, url, signal) {
    const root = this.config.libraryRoot, id = job.sourceId;
    await mkdir(root, { recursive: true, mode: 0o700 });
    const recovered = await this.completed(job);
    if (recovered) { this.state.library[id] = recovered; job.state = 'installed'; job.received = job.size; job.error = null; await this.save(); return; }
    await mkdir(within(root, '.partial'), { recursive: true, mode: 0o700 });
    await mkdir(within(root, 'games'), { recursive: true, mode: 0o700 });
    const staging = await safeTree(root, join('.partial', id)); await mkdir(staging, { recursive: true, mode: 0o700 });
    const partial = await safeTree(root, join('.partial', id, 'download.part'));
    const disk = await statfs(root), available = Number(disk.bavail) * Number(disk.bsize);
    if (available < Math.max(0, job.size - job.received) + 64 * 1024 ** 2) fail('DISK_SPACE_REQUIRED', 409);
    const verifiedSha256 = await receiveFile(job, url, partial, { transport: this.transport, save: () => this.save(), signal });
    const content = await safeTree(root, join('.partial', id, 'content'));
    await removeOwned(root, join('.partial', id, 'content'));
    let entry, files;
    if (job.packaging === 'zip') {
      job.state = 'extracting'; await this.save();
      const free = await statfs(root), availableForExtraction = Number(free.bavail) * Number(free.bsize) - 64 * 1024 ** 2;
      if (availableForExtraction <= 0) fail('DISK_SPACE_REQUIRED', 409);
      const extracted = await extractZip(partial, content, job.system, { maxBytes: Math.min(maxExtractedBytes, availableForExtraction) }); entry = extracted.entry; files = extracted.files;
    } else {
      await mkdir(content, { mode: 0o700 }); entry = 'game.' + job.extension; files = [entry];
      await rename(partial, within(content, entry));
    }
    const completed = await safeTree(root, join('games', id));
    if (await stat(completed).then(() => true).catch(error => { if (error.code === 'ENOENT') return false; throw error; })) fail('INSTALL_DESTINATION_EXISTS', 409);
    const installed = { sourceId: id, title: job.title, system: job.system, packaging: job.packaging, size: job.size, verifiedSha256,
      expectedChecksumVerified: Boolean(job.sha256), files, entry, installedAt: new Date().toISOString() };
    // The complete folder and its recovery manifest become visible in one rename.
    await jsonWrite(within(content, 'install.json'), installed); await rename(content, completed);
    this.state.library[id] = { ...installed, localPath: within(completed, entry) }; job.state = 'installed'; job.received = job.size; job.error = null; await this.save();
    await removeOwned(root, join('.partial', id));
    if (job.launch) {
      try { await this.launch(id, job.profileId); job.launched = true; }
      catch (error) { job.launchError = error instanceof CompanionError ? error.code : 'EMULATOR_LAUNCH_FAILED'; }
      await this.save();
    }
  }
  async launch(id, profileId) {
    sourceId(id); const item = this.state.library[id]; if (!item) fail('GAME_NOT_INSTALLED', 404);
    if (profileId !== undefined && (typeof profileId !== 'string' || !/^[a-z0-9-]{1,60}$/.test(profileId))) fail('INVALID_PROFILE');
    const profile = this.profile(item.system, profileId), target = await safeTree(this.config.libraryRoot, join('games', id, item.entry));
    if (!(await stat(target)).isFile()) fail('INSTALLED_FILE_MISSING', 409);
    try {
      const child = this.launchProcess(profile.executable, profile.args.map(arg => arg === '{rom}' ? target : arg), {
        cwd: dirname(profile.executable), shell: false, windowsVerbatimArguments: false, windowsHide: false, detached: true, stdio: 'ignore',
      });
      await once(child, 'spawn'); child.unref();
    } catch { fail('EMULATOR_LAUNCH_FAILED', 500); }
    return { launched: true, profileId: profile.id };
  }
  async close() { for (const active of this.active.values()) active.controller.abort(); await Promise.allSettled([...this.active.values()].map(active => active.promise)); await this.saving; }
}
