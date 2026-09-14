import { join } from 'node:path';
import { homedir } from 'node:os';
import { once } from 'node:events';
import { unlink } from 'node:fs/promises';
import { Companion } from './service.mjs';
import { createCompanionServer } from './server.mjs';
import { jsonWrite } from './files.mjs';

async function main() {
  if (Number(process.versions.node.split('.')[0]) !== 22) throw new Error('NODE_22_REQUIRED');
  const directory = process.env.ROMIO_COMPANION_HOME || join(process.env.LOCALAPPDATA || join(homedir(), '.local', 'share'), 'RomioCompanion');
  const companion = await new Companion({ directory }).init(), server = createCompanionServer(companion);
  server.listen(43821, '127.0.0.1'); await once(server, 'listening');
  await jsonWrite(join(directory, 'control.json'), { pid: process.pid, url: `http://127.0.0.1:43821/#${companion.controlToken}` });
  console.log('Romio companion is listening on 127.0.0.1:43821. Open local settings with start.ps1 -OpenSettings.');
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    server.close(); server.closeAllConnections(); await companion.close();
    await unlink(join(directory, 'control.json')).catch(() => {});
  };
  const requestStop = () => { void stop().catch(() => { console.error('COMPANION_STOP_FAILED'); process.exitCode = 1; }); };
  process.on('SIGINT', requestStop); process.on('SIGTERM', requestStop); server.on('shutdown', requestStop);
}
main().catch(() => { console.error('COMPANION_START_FAILED'); process.exitCode = 1; });
