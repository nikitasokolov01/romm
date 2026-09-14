import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { Companion } from '../src/service.mjs';
import { receiveFile } from '../src/download.mjs';
import { temporary, bytes, input, id, settled, digest, zip } from './fixture.mjs';

test('MOCK official CDN redirects stay direct and carry no control credentials',async t=>{
  const directory=await temporary(t);let calls=0;
  const job={size:bytes.length,sha256:digest(bytes),received:0,validator:''};
  await receiveFile(job,'https://cdn.torbox.app/original',join(directory,'redirect.bin'),{transport:async(url,init)=>{
    calls++;assert.equal(init.credentials,'omit');assert.equal(new Headers(init.headers).has('Authorization'),false);
    if(calls===1)return new Response(null,{status:307,headers:{Location:'https://edge.tb-cdn.io/fresh'}});
    assert.equal(url.href,'https://edge.tb-cdn.io/fresh');return new Response(bytes,{headers:{'Content-Length':String(bytes.length)}});
  }});
  assert.equal(calls,2);assert.deepEqual(await readFile(join(directory,'redirect.bin')),bytes);
});

test('MOCK interrupted direct download resumes with Range and fresh URL, then publishes an atomic persistent library entry', async t => {
  const directory = await temporary(t); let interrupted = false, requests = 0;
  const companion = await new Companion({ directory, transport: async (url, init) => {
    requests++; assert.equal(url.origin, 'https://cdn.torbox.app'); assert.equal(init.redirect, 'manual');
    assert.equal(new Headers(init.headers).has('Authorization'), false); assert.equal(init.credentials, 'omit');
    if (!interrupted) {
      interrupted = true; let count = 0;
      return new Response(new ReadableStream({ pull(controller) { if (!count++) controller.enqueue(bytes.subarray(0, 9)); else controller.error(new Error('fake connection loss')); } }), {
        headers: { ETag: '"stable-v1"', 'Content-Length': String(bytes.length) },
      });
    }
    assert.equal(init.headers.Range, 'bytes=9-'); assert.equal(init.headers['If-Range'], '"stable-v1"');
    assert.ok(url.searchParams.has('fresh'));
    return new Response(bytes.subarray(9), { status: 206, headers: { ETag: '"stable-v1"', 'Content-Length': String(bytes.length - 9), 'Content-Range': `bytes 9-${bytes.length - 1}/${bytes.length}` } });
  } }).init();
  try {
    await companion.install(input()); await settled(companion);
    assert.equal(companion.job(id).state, 'paused'); assert.equal(companion.library().items.length, 0);
    assert.equal((await stat(join(directory, 'library/.partial', id, 'download.part'))).size, 9);
    await companion.resume(id, { downloadUrl: 'https://cdn.torbox.app/new?fresh=provider-test-only' }); await settled(companion);
    assert.equal(companion.job(id).state, 'installed'); assert.equal(requests, 2);
    const installed = companion.library().items[0]; assert.equal(installed.expectedChecksumVerified, true);
    assert.deepEqual(await readFile(join(directory, 'library/games', id, installed.entry)), bytes);
    assert.equal('localPath' in installed, false);
    const state = await readFile(join(directory, 'library.json'), 'utf8');
    assert.equal(state.includes('temporary-provider-test-token'), false); assert.equal(state.includes('provider-test-only'), false); assert.equal(state.includes('https://'), false);
    await companion.close();
    const restarted = await new Companion({ directory, transport: async () => assert.fail('Installed replay must not fetch bytes') }).init();
    try { assert.equal(restarted.library().items.length, 1); await restarted.install(input()); assert.equal(restarted.job(id).state, 'installed'); }
    finally { await restarted.close(); }
  } finally { await companion.close(); }
});
test('MOCK ignored Range restarts from zero; invalid ranges, redirects and changed checksums never install', async t => {
  const directory = await temporary(t), destination = join(directory, 'partial');
  await writeFile(destination, bytes.subarray(0, 8));
  const job = { size: bytes.length, received: 8, validator: '"v1"', sha256: digest(bytes) };
  await receiveFile(job, input().downloadUrl, destination, { transport: async () => new Response(bytes, { headers: { ETag: '"v2"' } }) });
  assert.deepEqual(await readFile(destination), bytes);
  for (const [label, transport, error] of [
    ['range', async () => new Response(bytes, { status: 206, headers: { 'Content-Range': `bytes 1-${bytes.length}/${bytes.length}` } }), 'DOWNLOAD_RANGE_MISMATCH'],
    ['redirect', async () => new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/private' } }), 'DOWNLOAD_REDIRECT_BLOCKED'],
    ['expired', async () => new Response('expired', { status: 403 }), 'DOWNLOAD_URL_EXPIRED'],
    ['oversize', async () => new Response(Buffer.alloc(bytes.length + 1)), 'DOWNLOAD_SIZE_MISMATCH'],
    ['hash', async () => new Response(Buffer.alloc(bytes.length)), 'DOWNLOAD_CHECKSUM_MISMATCH'],
  ]) {
    const companion = await new Companion({ directory: join(directory, label), transport }).init();
    try { await companion.install(input()); await settled(companion); assert.equal(companion.job(id).error, error); assert.equal(companion.library().items.length, 0); }
    finally { await companion.close(); }
  }
});
test('MOCK safe ZIP installs locally and launch uses only a user-configured executable and argument vector', async t => {
  const directory = await temporary(t), archive = zip([{ name: 'synthetic.gba', method: 8 }]); let launched = 0;
  const executable = join(directory, 'emulator.exe'); await writeFile(executable, 'SYNTHETIC PLACEHOLDER, NEVER EXECUTED');
  const companion = await new Companion({ directory: join(directory, 'state'), transport: async () => new Response(archive), launchProcess: (exe, args, options) => {
    launched++; assert.equal(exe, executable); assert.deepEqual(args.slice(0, 1), ['--fullscreen']);
    assert.ok(args[1].endsWith('synthetic.gba')); assert.equal(options.shell, false); assert.equal(options.windowsVerbatimArguments, false);
    const child = new EventEmitter(); child.unref = () => {}; queueMicrotask(() => child.emit('spawn')); return child;
  } }).init();
  try {
    await companion.configure({ libraryRoot: companion.config.libraryRoot, allowedOrigins: ['https://romm.example'], profiles: [{ id: 'test-emulator', label: 'Synthetic emulator', systems: ['gba'], executable, args: ['--fullscreen', '{rom}'] }] });
    await companion.install(input({ title: 'Synthetic.zip', packaging: 'zip', size: archive.length, sha256: digest(archive), launch: true, profileId: 'test-emulator' })); await settled(companion);
    assert.equal(companion.job(id).state, 'installed'); assert.equal(companion.job(id).launched, true); assert.equal(launched, 1);
    assert.deepEqual(await readFile(join(companion.config.libraryRoot, 'games', id, 'synthetic.gba')), bytes);
    await assert.rejects(companion.launch(id, 'website-invented-executable'), { code: 'EMULATOR_PROFILE_REQUIRED' });
    assert.equal(launched, 1);
  } finally { await companion.close(); }
});
test('MOCK completed folder recovers after a crash between final rename and library metadata update', async t => {
  const directory = await temporary(t), companion = await new Companion({ directory, transport: async () => new Response(bytes) }).init();
  await companion.install(input()); await settled(companion); await companion.close();
  const statePath = join(directory, 'library.json'), state = JSON.parse(await readFile(statePath, 'utf8'));
  state.jobs[id].state = 'extracting'; state.library = {}; await writeFile(statePath, JSON.stringify(state));
  const recovered = await new Companion({ directory, transport: async () => assert.fail('Recovery must not redownload') }).init();
  try { assert.equal(recovered.job(id).state, 'installed'); assert.equal(recovered.library().items.length, 1); }
  finally { await recovered.close(); }
});
