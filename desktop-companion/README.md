# Romio desktop companion

A standalone Node 22 helper for Windows. RomM can ask this device to download a selected file directly from TorBox, install it in a persistent local library, and open an emulator the user configured locally. The RomM and Romio servers do not receive the file bytes.

This is a custom companion for the RomM fork, not a stock RomM feature. It has no runtime npm dependencies. It does not install emulators, change the firewall, register a Windows service or add startup entries. Keep it running while using remote Play or downloading.

## Start and configure

Install Node.js 22 separately if it is not already present. From this folder:

```powershell
.\start.ps1 -OpenSettings
```

The script launches Node in a hidden window, then opens an interactive browser only when `-OpenSettings` is supplied. It does not change PowerShell execution policy. If local policy prevents running the script, use your normal permitted script workflow; no policy bypass is included.

The helper listens only on `http://127.0.0.1:43821`. Its local settings link contains a random per-start control capability in the fragment. The page immediately removes the fragment from browser history and keeps the capability only in memory. A bare localhost URL cannot change settings. To reopen the private page, run the same command again. Do not share the private settings link or files in `%LOCALAPPDATA%\RomioCompanion`.

1. Choose the local library folder before the first download. Moving an existing library is not supported yet.
2. Approve the exact HTTPS origin of your RomM website, for example `https://romm.example.com`, without a path or trailing slash.
3. Add an emulator profile using an existing local `.exe`, its supported system codes, and fixed arguments. Put `{rom}` on its own argument line. A RetroArch profile can use `-L`, an absolute user-selected core path, and `{rom}` on separate lines. No executable, core or argument is downloaded or accepted from RomM.
4. Create a pairing code for the approved origin. Enter it in RomM's device settings within five minutes. It is single-use, bound to that origin and limited to ten attempts.
5. Choose a game in RomM. The browser requests a fresh direct provider URL, and the companion downloads it to this computer. Installed games can launch without downloading again.

Use `stop.ps1` to stop gracefully. An interrupted transfer can be resumed from RomM after restarting. `%LOCALAPPDATA%\RomioCompanion` contains local configuration, hashed pairing tokens, job/library metadata, private startup control information, and fixed-status logs. The default library is inside that folder. Set `ROMIO_COMPANION_HOME` only when starting `node src/main.mjs` directly to use a different development state folder.

The approved RomM browser may store its paired-device token in its own origin's local storage. The token permits downloading into this library and launching configured profiles; it cannot configure executable paths or approve other websites. Revoke a pairing in the private local settings page. Changing the approved origin list also removes pairings for origins no longer approved.

Chrome/Edge may prompt for Local Network Access when the HTTPS website contacts localhost. Accepting that browser prompt remains the user's choice. CORS/Private Network Access headers are limited to approved origins; no browser security setting is disabled. Live RomM-origin browser permission behavior has not yet been verified. See [Chrome's Local Network Access documentation](https://developer.chrome.com/blog/local-network-access).

## RomM integration API

All routes use the loopback origin above. The exact browser `Origin` must be approved. Pairing and API calls use JSON; subsequent calls send `Authorization: Bearer <paired device token>`. Tokens must not be put in query strings. Romio's master token is never sent to the companion.

| Route | Request / response |
| --- | --- |
| `GET /v1/capabilities` | Approved-origin, read-only discovery. Returns version, device ID, supported `formats`, `systems`, size limits and `pairingRequired`. |
| `POST /v1/pair` | `{code}` → `{token, deviceId, capabilities}`. |
| `GET /v1/status` | Authenticated `{paired: true, deviceId, profiles: [{id,label,systems}], capabilities}`. No emulator paths or arguments are exposed. |
| `GET /v1/library` | `{items}` containing installed source IDs, titles, system, entry/file names and checksum status. No absolute local paths. |
| `POST /v1/install` | See body below. Returns HTTP 202 with job state. Repeated source IDs are idempotent. |
| `GET /v1/jobs/{sourceId}` | Job `{id,state,received,total,error,...}`. States: `downloading`, `paused`, `extracting`, `installed`, `failed`. |
| `POST /v1/jobs/{sourceId}/resume` | `{downloadUrl}` with a newly resolved URL; resumes paused jobs. |
| `POST /v1/library/{sourceId}/launch` | `{profileId?}` → `{launched: true, profileId}`. Omitted profile selects the first locally configured profile for the system. |

```json
{
  "sourceId": "64 lowercase hexadecimal characters from the Romio candidate ID",
  "title": "Exact filename from the selected source.gba",
  "system": "gba",
  "size": 12345,
  "sha256": "optional expected SHA-256; omit or use an empty string if unknown",
  "packaging": "raw",
  "downloadUrl": "fresh HTTPS URL on an official TorBox CDN",
  "launch": true,
  "profileId": "locally-configured-profile-id"
}
```

The example is a schema illustration, not a valid request. For raw files, `title` must retain a supported file extension; use the basename of the candidate's exact source path. `launch` defaults to false. When true, a matching configured emulator profile is required before the transfer starts. Unknown request fields, including executable paths, arguments and destination paths, are rejected. The selected profile also must match the game's system. `launched` confirms process creation, not successful gameplay.

Install and resume URLs are validated against official TorBox HTTPS CDN domains, used only in memory and never written to state or logs. Requests omit browser/companion credentials and never forward a RomM Authorization header. A URL may contain the TorBox account key under the owner's existing personal-device authorization; the direct URL must still be kept private. At most three redirects are followed, with each destination checked against the same official HTTPS CDN rules. Redirects to private addresses or other hosts are rejected.

## Installation and launch bounds

- Download size: at most 64 GiB, with exact expected-byte verification and optional expected SHA-256 verification. A computed SHA-256 is recorded even when no trusted expected checksum exists; that does not establish ROM provenance.
- Resume uses a strong ETag with `If-Range`, or a trusted expected checksum. Without either, a partial file is restarted rather than appended without identity protection. HTTP 206 ranges must start at the local byte count and match the expected total. HTTP 200 in response to Range starts a clean replacement. Expired links pause until RomM supplies a fresh URL. Two simultaneous downloads are allowed.
- Installs use private partial directories and become visible through a final directory rename only after validation. A completed-folder manifest recovers the narrow restart window before library state is updated. Failed or interrupted files never become playable library entries.
- ZIP support is limited to ordinary ZIP32, stored or deflated entries, at most 2,048 entries, an 8 MiB central directory, 16 GiB declared/extracted total, less than 4 GiB per entry, and bounded compression ratios. Available disk space further restricts extraction. ZIP64, encryption, symlinks, device names, duplicate case-folded paths, path traversal and overlapping entries are rejected. The implementation follows the [ZIP format specification](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT).
- Only expected console file extensions are extracted; executable and script members are ignored. An archive must identify one game entry, or one bounded cue/playlist layout with references confined to extracted files. Ambiguous multi-game ZIPs are rejected. Raw cue/playlist downloads are unsupported because their companion files are missing. 7z/RAR packages and ZIP64 archives are explicitly unsupported in this version.
- Built-in systems: NES, SNES, GB/GBC/GBA, N64, NDS, Genesis, SMS, Game Gear, Atari 2600, CHIP-8, PSX, PS2, PSP, GameCube, Wii, Dreamcast, Saturn, 32X, Neo Geo Pocket and WonderSwan. Supported extensions are exposed through the implementation's system map. Platform classification does not guarantee that a particular emulator can run a file.
- Emulator profiles are edited only through the local control UI. Launch uses a fixed executable and separate argument vector with `shell: false`; the only substituted value is the completed ROM path. It does not download BIOS files, cores or emulators.

## Verification

```powershell
node --test test/*.test.mjs
node --check src/main.mjs
node --check web/app.js
```

**12 mock tests pass.** They cover interruption/resume, ignored and invalid ranges, expired URLs, bounded official CDN redirects and rejected unsafe redirects, checksums, persistent and atomic installation, ZIP expansion/CRC/path/symlink/case checks, cue references, pairing attempts/revocation, strict origins and Host checks, protected local settings, rejected arbitrary launch fields, and configured argument-vector launch.

Download tests use synthetic text bytes and ZIP fixtures. Emulator launch uses an injected mock process launcher; no real emulator or ROM was launched or downloaded. A live Windows user setup, real provider transfer/resume, native emulator launch, and the complete RomM-browser pairing/Play flow remain to be verified. This companion has not been installed as a startup service or modified the user's system configuration during development.

The local settings page was also checked using an isolated workspace fixture with network transfers and process execution disabled. Saving an approved website, generating a pairing code and revoking a displayed pairing were exercised through the browser; actual loopback HTTP requests verified single use, authenticated status, origin restrictions, CORS/Private Network Access headers, hash-only token storage and rejection of a revoked token. Automatic pairing-list refresh was not independently verified in the browser. This does not verify a remote browser's Local Network Access permission prompt.
