'use strict';
const $ = id => document.getElementById(id);
// The startup fragment is consumed once and kept only in this page's memory.
const control = location.hash.slice(1); history.replaceState(null, '', '/');
let settings, capabilities, timer, renderedPairs;
const messages = {
  PAIRING_REQUIRED: 'Open settings again with start.ps1 -OpenSettings. This private page expires when the companion restarts.',
  INVALID_ORIGIN: 'Use an exact HTTPS website origin, such as https://romm.example.com, without a trailing slash or path.',
  EMULATOR_NOT_FOUND: 'The emulator executable could not be found. Choose an existing .exe file on this computer.',
  INVALID_EMULATOR_ARGUMENTS: 'Use one argument per line, including exactly one line containing {rom}.',
  EMULATOR_PROFILE_REQUIRED: 'Add an emulator profile for this game’s system first.',
  LIBRARY_MOVE_NOT_SUPPORTED: 'The existing library cannot be moved here yet. Keep its current folder.',
  DOWNLOADS_ACTIVE: 'Wait for active downloads before changing device settings.',
  DISK_SPACE_REQUIRED: 'There is not enough free space for this download.',
  DOWNLOAD_URL_EXPIRED: 'The provider link expired. Resume from RomM to request a fresh link.',
  DOWNLOAD_INTERRUPTED: 'The download stopped. Resume from RomM to continue.',
  DOWNLOAD_PAUSED: 'Download paused. Resume it from RomM.',
  ARCHIVE_ROM_AMBIGUOUS: 'This archive contains several game files. Automatic game selection is unavailable.',
  ZIP64_UNSUPPORTED: 'This ZIP uses ZIP64, which this companion version does not support.',
  ARCHIVE_FORMAT_UNSUPPORTED: 'This version supports individual ROM files and ordinary ZIP packages.',
};
function note(value, error = false) { $('feedback').textContent = value; $('feedback').className = error ? 'error' : ''; }
function el(tag, text) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; }
async function api(path, body) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store', headers: { Authorization: 'Bearer ' + control, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json(); if (!response.ok) throw new Error(messages[data.error] || 'This action could not finish. Check the selected folder, profile and website.'); return data;
}
function input(label, value, kind = 'input') {
  const wrapper = el('label', label), field = el(kind); field.value = value || ''; wrapper.append(field); return { wrapper, field };
}
function addProfile(value = {}) {
  const card = el('div'); card.className = 'profile'; const grid = el('div'); grid.className = 'profile-grid';
  const fields = { id: input('Profile ID', value.id || 'emulator-' + ($('profiles').children.length + 1)), label: input('Display name', value.label),
    systems: input('System codes, comma separated', value.systems?.join(', ')), executable: input('Emulator .exe path', value.executable), args: input('Arguments, one per line', (value.args || ['{rom}']).join('\n'), 'textarea') };
  fields.systems.field.placeholder = 'gba, gb, gbc'; fields.executable.field.placeholder = 'C:\\Emulators\\mGBA\\mGBA.exe'; fields.args.field.rows = 3;
  for (const field of Object.values(fields)) grid.append(field.wrapper);
  const remove = el('button', 'Remove profile'); remove.type = 'button'; remove.className = 'secondary'; remove.addEventListener('click', () => card.remove());
  card.profileValue = () => ({ id: fields.id.field.value.trim(), label: fields.label.field.value.trim(), systems: fields.systems.field.value.split(',').map(s => s.trim()).filter(Boolean), executable: fields.executable.field.value.trim(), args: fields.args.field.value.split(/\r?\n/).filter(Boolean) });
  card.append(grid, remove); $('profiles').append(card);
}
function renderSettings() {
  $('library-root').value = settings.libraryRoot; $('origins').value = settings.allowedOrigins.join('\n'); $('profiles').replaceChildren();
  for (const profile of settings.profiles) addProfile(profile);
  $('pair-origin').replaceChildren();
  for (const site of settings.allowedOrigins) { const option = el('option', site); option.value = site; $('pair-origin').append(option); }
  $('new-code').disabled = !settings.allowedOrigins.length; $('pair-code').textContent = ''; renderPairings();
}
function renderPairings() {
  const snapshot = JSON.stringify(settings.pairs);
  if (snapshot === renderedPairs) return;
  renderedPairs = snapshot; $('paired').replaceChildren();
  for (const pair of settings.pairs) {
    const row = el('p', 'Paired: ' + pair.origin + ' '), revoke = el('button', 'Revoke'); revoke.className = 'secondary';
    revoke.addEventListener('click', async () => { try { await api('/v1/local/revoke', { id: pair.id }); settings = await api('/v1/local/settings'); renderSettings(); note('Website pairing revoked.'); } catch (error) { note(error.message, true); } });
    row.append(revoke); $('paired').append(row);
  }
}
async function library() {
  const [games, jobs, currentSettings] = await Promise.all([api('/v1/library'), api('/v1/jobs'), api('/v1/local/settings')]);
  // Refresh revocation controls without discarding edits in the device settings form.
  settings.pairs = currentSettings.pairs; renderPairings();
  $('library').replaceChildren(); $('jobs').replaceChildren();
  for (const job of jobs.items.filter(job => job.state !== 'installed')) {
    const row = el('div'); row.className = 'item'; row.append(el('strong', job.title), el('p', job.state === 'downloading' ? 'Downloading directly to this device' : job.state === 'extracting' ? 'Extracting on this device' : messages[job.error] || 'Installation needs attention. Return to RomM to retry.'));
    const progress = el('progress'); progress.max = job.total; progress.value = job.received; row.append(progress); $('jobs').append(row);
  }
  for (const game of games.items) {
    const row = el('div'); row.className = 'item'; row.append(el('strong', game.title), el('p', game.system.toUpperCase() + ' · Installed on this device'));
    const profiles = settings.profiles.filter(profile => profile.systems.includes(game.system)), select = el('select');
    for (const profile of profiles) { const option = el('option', profile.label); option.value = profile.id; select.append(option); }
    const play = el('button', profiles.length ? 'Play' : 'Configure an emulator to play'); play.disabled = !profiles.length;
    play.addEventListener('click', async () => { play.disabled = true; try { await api('/v1/library/' + game.sourceId + '/launch', { profileId: select.value }); note('Emulator launched.'); } catch (error) { note(error.message, true); } finally { play.disabled = false; } });
    row.append(select, play); $('library').append(row);
  }
  if (!games.items.length) $('library').append(el('p', 'Choose a game in your paired RomM website to install it here.'));
  clearTimeout(timer); timer = setTimeout(() => library().catch(() => {}), 3000);
}
$('add-profile').addEventListener('click', () => addProfile());
$('settings').addEventListener('submit', async event => {
  event.preventDefault();
  try { settings = await api('/v1/local/settings', { libraryRoot: $('library-root').value.trim(), allowedOrigins: $('origins').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean), profiles: [...$('profiles').children].map(card => card.profileValue()) }); renderSettings(); await library(); note('Device settings saved.'); }
  catch (error) { note(error.message, true); }
});
$('new-code').addEventListener('click', async () => { try { const data = await api('/v1/local/pairing-code', { origin: $('pair-origin').value }); $('pair-code').textContent = data.code; note('Enter this code in the approved RomM website within five minutes.'); } catch (error) { note(error.message, true); } });
$('refresh').addEventListener('click', () => library().catch(error => note(error.message, true)));
(async () => {
  if (!control) { note(messages.PAIRING_REQUIRED, true); return; }
  try { [settings, capabilities] = await Promise.all([api('/v1/local/settings'), api('/v1/capabilities')]); renderSettings(); $('setup').hidden = false; note('Private settings for this device. Supported system codes: ' + capabilities.systems.join(', ') + '.'); await library(); }
  catch (error) { note(error.message, true); }
})();
