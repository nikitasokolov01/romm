import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { extractZip, zipEntries } from '../src/zip.mjs';
import { temporary, zip, bytes } from './fixture.mjs';

test('MOCK ZIP stored and deflate extraction preserves synthetic bytes and ignores executable members', async t => {
  const directory = await temporary(t);
  for (const method of [0, 8]) {
    const file = join(directory, method + '.zip'), destination = join(directory, 'content-' + method);
    await writeFile(file, zip([{ name: 'nested/synthetic.gba', method }, { name: 'not-an-emulator.exe', bytes: Buffer.from('not executed') }]));
    const result = await extractZip(file, destination, 'gba');
    assert.equal(result.entry, 'nested/synthetic.gba'); assert.deepEqual(await readFile(join(destination, result.entry)), bytes);
    assert.deepEqual(await readdir(destination), ['nested']);
  }
});
test('MOCK ZIP rejects traversal, drive paths, ADS, Windows device names, symlinks and case duplicates before extraction', async t => {
  const directory = await temporary(t), file = join(directory, 'invalid.zip');
  for (const name of ['../escape.gba', '/absolute.gba', 'C:/escape.gba', 'folder\\escape.gba', 'game.gba:evil.exe', 'CON.gba', 'folder./game.gba']) {
    await writeFile(file, zip([{ name }])); await assert.rejects(zipEntries(file), { code: 'UNSAFE_ARCHIVE_PATH' });
  }
  await writeFile(file, zip([{ name: 'link.gba', attributes: 0xa1ff0000 }])); await assert.rejects(zipEntries(file), { code: 'ZIP_FEATURE_UNSUPPORTED' });
  await writeFile(file, zip([{ name: 'GAME.gba' }, { name: 'game.gba' }])); await assert.rejects(zipEntries(file), { code: 'ZIP_DUPLICATE_PATH' });
});
test('MOCK ZIP bounds declared expansion and actual output, detects CRC errors and refuses ambiguous ROMs', async t => {
  const directory = await temporary(t), file = join(directory, 'invalid.zip');
  await writeFile(file, zip([{ name: 'game.gba', method: 8, bytes: Buffer.alloc(2 * 1024 ** 2) }]));
  await assert.rejects(zipEntries(file), { code: 'ZIP_EXPANSION_LIMIT' });
  await writeFile(file, zip([{ name: 'game.gba', method: 8, unpacked: 1 }]));
  await assert.rejects(extractZip(file, join(directory, 'expanded'), 'gba'), { code: 'ZIP_EXTRACTION_FAILED' });
  await writeFile(file, zip([{ name: 'game.gba', crc: 1 }]));
  await assert.rejects(extractZip(file, join(directory, 'crc'), 'gba'), { code: 'ZIP_CHECKSUM_MISMATCH' });
  await writeFile(file, zip([{ name: 'one.gba' }, { name: 'two.gba' }]));
  await assert.rejects(extractZip(file, join(directory, 'ambiguous'), 'gba'), { code: 'ARCHIVE_ROM_AMBIGUOUS' });
});
test('MOCK optical ZIP validates cue references before allowing local launch', async t => {
  const directory = await temporary(t), file = join(directory, 'disc.zip');
  await writeFile(file, zip([{ name: 'disc.cue', bytes: Buffer.from('FILE "disc.bin" BINARY\n TRACK 01 MODE1/2352') }, { name: 'disc.bin' }]));
  assert.equal((await extractZip(file, join(directory, 'safe'), 'psx')).entry, 'disc.cue');
  await writeFile(file, zip([{ name: 'disc.cue', bytes: Buffer.from('FILE "../private.bin" BINARY') }, { name: 'disc.bin' }]));
  await assert.rejects(extractZip(file, join(directory, 'unsafe'), 'psx'), { code: 'UNSAFE_ARCHIVE_PATH' });
});
