# Romio edition of RomM

This fork adds a console-only Discover page backed by a Romio addon connection. It is custom work, not an upstream RomM feature. The fork is based on upstream master commit `4912f8d071d872a6585f8bf35bf5c3c259ca18ed`.

Source: https://github.com/nikitasokolov01/romm/tree/romio-remote-library

## Using it

1. Sign in to RomM and open Discover. The original local library remains available at `/library`.
2. In Discover settings, paste the revocable connection link created in Romio Settings. Its form is `https://your-romio-host/romio/addon#TOKEN`. The fragment token is sent in the authenticated configuration request and stored in a private server file. It is never a TorBox API key or Romio administrator token.
3. Search a title or filter by console/category. Choose a game, then a region/revision copy. Cached copies can become ready quickly; uncached copies show acquisition progress. The application remembers stable copy/job IDs, never expiring provider URLs.
4. Choose browser playback on supported cores and formats, or pair the companion to install on this computer and launch an emulator you already installed.

The default categories are All games and Retro. Ratings appear after an administrator syncs matching IGDB metadata. Configure the standard RomM `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET` environment settings, restart, then use the rating sync control in Discover. Only exact title/alias and console matches are accepted; ambiguous matches remain unrated. The sync handles at most 12 visible games per request. Awards require a separate attributed metadata source and are hidden while none exists. Covers currently come from attributed metadata; filenames are used to group source copies until provider metadata is matched.

## Downloads and playback

RomM and Romio exchange JSON metadata. RomM's authenticated content endpoint resolves a new TorBox link and returns an empty HTTP 307; the browser or companion downloads the bytes from the provider. The VPS does not download, extract or store ROM payloads. Only metadata, app configuration and normal RomM assets are persisted there.

The browser player uses RomM's bundled EmulatorJS assets. Per-game ZIP extraction and browser-local save storage happen on the client. Core, BIOS, memory, package layout and provider CORS support still determine whether a particular game can run. Remote saves are not wired into stock RomM cloud-save APIs. Native saves are managed by the selected emulator.

A torrent being cached does not guarantee individual-file access. Live testing found GBA collections exposed by TorBox only as 7 GB and 14 GB generated archives. Romio checks the provider's cached file lists, excludes copies without an exact path/size match, and searches other configured sources. A definitive file-verification failure stops the job so another copy can be chosen. Whole-collection archive downloads and extraction on the VPS are not used as a fallback.

Some TorBox CDN links contain the account key. The personal deployment's owner explicitly enabled those links for their own devices. Treat resolved URLs as sensitive; do not log, share, bookmark or persist them. The Romio addon credential stays on the server. Fresh links are resolved for every launch or resume.

## Native companion

See [desktop-companion/README.md](desktop-companion/README.md). Requires Node.js 22. On Windows run:

```powershell
.\desktop-companion\start.ps1 -OpenSettings
```

Choose a local library folder, explicitly approve the exact RomM HTTPS origin, and configure your installed emulator executable with fixed arguments. Generate a one-use code in these local settings and enter it in RomM. A browser may request local-network permission. The device must remain on during installation. The service binds only to loopback; no public inbound port is required. It does not install emulators or BIOS files.

## Deployment and integration boundaries

Use the upstream production `docker/Dockerfile` target `full-image`, which includes EmulatorJS assets. Keep RomM authentication enabled. The optional `ROMIO_TRUSTED_INTERNAL_ORIGIN=http://romio:3000` exception is only for a private Docker network containing the Romio service. Public addon connections require HTTPS and pass SSRF validation. The private connection file is `/romm/config/romio/connection.json`.

Custom endpoints are under `/api/romio`. The stock local-library schema and APIs remain intact. Remote catalog entries are not fabricated filesystem ROM records and are not added to stock client APIs. iiSU, Cocoon and Android redirect compatibility are unverified and may require additional integration work.

## Verification and provenance

Automated tests exercise real application routers with mock providers, redirect responses, credential redaction, permissions, SSRF checks, metadata matching, launch state and download/extraction safeguards. Isolated browser checks cover catalog search, copy selection, preparation state, themes, responsive layouts and device pairing settings. Live VPS checks authenticate to RomM and retrieve real indexed titles and TorBox cache status without fetching ROM bodies. These are separate from live browser gameplay, actual emulator launch, remote browser local-network permission and provider expiry/resume testing, which are not yet verified end to end.

The live homebrew check on 2026-09-14 also verified cached Rock Paper Scissors selection, empty GET/HEAD 307 responses, and an official provider HEAD response with the expected 40,976-byte size, the deployed RomM origin allowed by CORS, and byte-range support advertised. No ROM body was fetched. Prepared exact copies remain searchable when a collection index changes its torrent hash; their provider bindings are still verified on every launch.

This implementation was developed with OpenAI Codex assistance. Upstream RomM notices and AGPL-3.0 licensing are retained. The corresponding fork source is linked in the Discover settings UI.
