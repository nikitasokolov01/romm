import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { once } from 'node:events';
import { get } from 'node:http';
import { Companion } from '../src/service.mjs';
import { createCompanionServer } from '../src/server.mjs';
import { temporary, input } from './fixture.mjs';

test('MOCK pairing is explicitly approved, single-use, origin-bound, revocable and never stores the raw token', async t => {
  const directory = await temporary(t), companion = await new Companion({ directory }).init();
  try {
    assert.throws(() => companion.createCode({ origin: 'https://unapproved.example' }), { code: 'ORIGIN_NOT_APPROVED' });
    await companion.configure({ libraryRoot: companion.config.libraryRoot, allowedOrigins: ['https://romm.example'], profiles: [] });
    const code = companion.createCode({ origin: 'https://romm.example' });
    await assert.rejects(companion.pair('https://evil.example', { code: code.code }), { code: 'PAIRING_CODE_INVALID' });
    const paired = await companion.pair('https://romm.example', { code: code.code });
    assert.equal(companion.authorize('https://romm.example', paired.token), true);
    assert.equal(companion.authorize('https://evil.example', paired.token), false);
    await assert.rejects(companion.pair('https://romm.example', { code: code.code }), { code: 'PAIRING_CODE_INVALID' });
    assert.equal((await readFile(join(directory, 'config.json'), 'utf8')).includes(paired.token), false);
    await companion.revoke(companion.config.pairs[0].id);
    assert.equal(companion.authorize('https://romm.example', paired.token), false);
    const limited = companion.createCode({ origin: 'https://romm.example' });
    for (let attempt = 0; attempt < 10; attempt++) await assert.rejects(companion.pair('https://romm.example', { code: 'wrong' }));
    await assert.rejects(companion.pair('https://romm.example', { code: limited.code }), { code: 'PAIRING_CODE_INVALID' });
  } finally { await companion.close(); }
});
test('MOCK loopback API rejects unapproved Origin, rebinding Host, missing bearer and remote settings mutations', async t => {
  const directory = await temporary(t), companion = await new Companion({ directory, transport: async () => assert.fail('No download expected') }).init();
  await companion.configure({ libraryRoot: companion.config.libraryRoot, allowedOrigins: ['https://romm.example'], profiles: [] });
  const { code } = companion.createCode({ origin: 'https://romm.example' }), paired = await companion.pair('https://romm.example', { code });
  const server = createCompanionServer(companion); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const local = `http://127.0.0.1:${server.address().port}`;
  const request = (path, options = {}) => fetch(local + path, options);
  try {
    const page = await request('/'); assert.equal(page.status, 200); assert.ok(page.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
    assert.equal((await request('/v1/capabilities', { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await request('/v1/capabilities', { headers: { Origin: 'null' } })).status, 403);
    const rebound = await new Promise((resolve, reject) => {
      get(local + '/v1/capabilities', { headers: { Origin: 'https://romm.example', Host: 'rebind.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
    });
    assert.equal(rebound, 403);
    assert.equal((await request('/v1/library', { headers: { Origin: 'https://romm.example' } })).status, 401);
    const preflight = await request('/v1/pair', { method: 'OPTIONS', headers: { Origin: 'https://romm.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type', 'Access-Control-Request-Private-Network': 'true' } });
    assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://romm.example');
    assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');
    const status = await request('/v1/status', { headers: { Origin: 'https://romm.example', Authorization: 'Bearer ' + paired.token } });
    assert.equal(status.status, 200); assert.equal((await status.json()).paired, true);
    const settings = await request('/v1/local/settings', { headers: { Origin: 'https://romm.example', Authorization: 'Bearer ' + paired.token } });
    assert.equal(settings.status, 403);
    assert.equal((await request('/v1/local/settings', { headers: { Authorization: 'Bearer ' + companion.controlToken } })).status, 200, 'Same-origin local GET may omit Origin with the control capability');
    const denied = await request('/v1/local/settings', { method: 'POST', headers: { Origin: 'https://romm.example', Authorization: 'Bearer ' + paired.token, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(denied.status, 403);
    const arbitrary = await request('/v1/install', { method: 'POST', headers: { Origin: 'https://romm.example', Authorization: 'Bearer ' + paired.token, 'Content-Type': 'application/json' }, body: JSON.stringify(input({ executable: 'C:\\Windows\\System32\\cmd.exe', args: ['/c', 'bad'] })) });
    assert.equal(arbitrary.status, 400); assert.deepEqual(await arbitrary.json(), { error: 'UNSUPPORTED_FIELD' });
  } finally { const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed; await companion.close(); }
});
test('MOCK install rejects unsafe CDN URLs, unwanted archive formats, unsafe raw files and oversized input before a request', async t => {
  const directory = await temporary(t); let requested = 0;
  const companion = await new Companion({ directory, transport: async () => { requested++; assert.fail('No download expected'); } }).init();
  try {
    for (const downloadUrl of ['http://cdn.torbox.app/game', 'https://api.torbox.app/game', 'https://cdn.torbox.app.evil.test/game', 'https://127.0.0.1/private', 'file:///C:/private', 'https://user:pass@cdn.torbox.app/game', 'https://cdn.torbox.app:444/game']) {
      await assert.rejects(companion.install(input({ downloadUrl })), { code: 'INVALID_DOWNLOAD_URL' });
    }
    await assert.rejects(companion.install(input({ packaging: '7z' })), { code: 'ARCHIVE_FORMAT_UNSUPPORTED' });
    await assert.rejects(companion.install(input({ title: 'game.exe' })), { code: 'ROM_EXTENSION_REQUIRED' });
    await assert.rejects(companion.install(input({ title: 'disc.cue', system: 'psx' })), { code: 'RAW_MULTI_FILE_UNSUPPORTED' });
    await assert.rejects(companion.install(input({ size: 64 * 1024 ** 3 + 1 })), { code: 'DOWNLOAD_SIZE_LIMIT' });
    await assert.rejects(companion.install(input({ launch: true })), { code: 'EMULATOR_PROFILE_REQUIRED' });
    assert.equal(requested, 0); assert.equal(Object.keys(companion.state.jobs).length, 0);
  } finally { await companion.close(); }
});
