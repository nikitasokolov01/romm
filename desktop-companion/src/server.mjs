import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CompanionError, fail, onlyKeys } from './policy.mjs';

const web = new URL('../web/', import.meta.url);
async function body(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') fail('JSON_REQUIRED', 415);
  let length = 0; const chunks = [];
  for await (const chunk of req) { length += chunk.length; if (length > 32768) fail('REQUEST_TOO_LARGE', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('INVALID_JSON'); }
}
export function createCompanionServer(companion) {
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    try {
      const port = server.address()?.port, localOrigin = `http://127.0.0.1:${port}`;
      const authorization = req.headers.authorization, token = typeof authorization === 'string' && authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
      // Same-origin GETs do not normally carry Origin. Only the local control capability permits that omission.
      const site = !req.headers.origin && req.method === 'GET' && token === companion.controlToken ? localOrigin : req.headers.origin;
      if (req.headers.host !== `127.0.0.1:${port}` || !['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) fail('LOOPBACK_ONLY', 403);
      const path = new URL(req.url, localOrigin);
      if (path.search || path.hash) fail('QUERY_NOT_ALLOWED');
      if (req.method === 'GET' && ['/', '/app.js', '/style.css'].includes(path.pathname)) {
        if (site && site !== localOrigin) fail('ORIGIN_NOT_APPROVED', 403);
        res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
        const filename = path.pathname === '/' ? 'index.html' : path.pathname.slice(1);
        const content = await readFile(fileURLToPath(new URL(filename, web)));
        res.writeHead(200, { 'Content-Type': filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html' }); res.end(content); return;
      }
      if (site !== localOrigin && !companion.config.allowedOrigins.includes(site)) fail('ORIGIN_NOT_APPROVED', 403);
      res.setHeader('Access-Control-Allow-Origin', site); res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        const requested = String(req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
        if (!['GET', 'POST'].includes(req.headers['access-control-request-method']) || requested.some(value => !['authorization', 'content-type'].includes(value))) fail('PREFLIGHT_REJECTED', 403);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST'); res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Allow-Private-Network', 'true'); res.writeHead(204); res.end(); return;
      }
      if (req.method === 'GET' && path.pathname === '/v1/capabilities') { send(200, companion.capabilities()); return; }
      if (req.method === 'POST' && path.pathname === '/v1/pair' && site !== localOrigin) { send(200, await companion.pair(site, await body(req))); return; }
      const local = site === localOrigin && token === companion.controlToken;
      if (!local && !companion.authorize(site, token)) fail('PAIRING_REQUIRED', 401);
      if (path.pathname.startsWith('/v1/local/')) {
        if (!local) fail('LOCAL_SETTINGS_ONLY', 403);
        if (path.pathname === '/v1/local/settings') {
          if (req.method === 'GET') { send(200, companion.settings()); return; }
          if (req.method === 'POST') { send(200, await companion.configure(await body(req))); return; }
        }
        if (req.method === 'POST' && path.pathname === '/v1/local/pairing-code') { send(200, companion.createCode(await body(req))); return; }
        if (req.method === 'POST' && path.pathname === '/v1/local/revoke') { const input = await body(req); onlyKeys(input, ['id']); send(200, await companion.revoke(input.id)); return; }
        if (req.method === 'POST' && path.pathname === '/v1/local/stop') { onlyKeys(await body(req), []); send(202, { stopping: true }); server.emit('shutdown'); return; }
      }
      if (req.method === 'GET' && path.pathname === '/v1/status') { send(200, { paired: true, deviceId: companion.config.deviceId, profiles: companion.profiles(), capabilities: companion.capabilities() }); return; }
      if (req.method === 'GET' && path.pathname === '/v1/library') { send(200, companion.library()); return; }
      if (req.method === 'GET' && path.pathname === '/v1/jobs') { send(200, { items: Object.keys(companion.state.jobs).map(id => companion.job(id)) }); return; }
      if (req.method === 'POST' && path.pathname === '/v1/install') { send(202, await companion.install(await body(req))); return; }
      let match = /^\/v1\/jobs\/([a-f0-9]{64})$/.exec(path.pathname);
      if (req.method === 'GET' && match) { send(200, companion.job(match[1])); return; }
      match = /^\/v1\/jobs\/([a-f0-9]{64})\/resume$/.exec(path.pathname);
      if (req.method === 'POST' && match) { send(202, await companion.resume(match[1], await body(req))); return; }
      match = /^\/v1\/library\/([a-f0-9]{64})\/launch$/.exec(path.pathname);
      if (req.method === 'POST' && match) {
        const input = await body(req); onlyKeys(input, ['profileId']); send(200, await companion.launch(match[1], input.profileId)); return;
      }
      fail('NOT_FOUND', 404);
    } catch (error) { if (!res.headersSent) send(error instanceof CompanionError ? error.status : 500, { error: error instanceof CompanionError ? error.code : 'LOCAL_REQUEST_FAILED' }); else res.destroy(); }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.maxHeadersCount = 40; return server;
}
