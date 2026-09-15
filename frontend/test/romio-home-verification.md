# Categorized Discover verification

Verified September 15, 2026.

- Seven homepage tests pass: six named shelves, system filtering without a catalog request, explicit category and search results, return to shelves, no all-games fallback on errors, and exclusion of unattributed ratings.
- All 15 source-dialog tests pass, including automatic retry after a failed status request or failed restoration, provider stages, and checked time. Polling runs every seven seconds with one status request at a time.
- Full `vue-tsc --noEmit` and ESLint on changed components, API client, tests and preview pass. All 18 locales have the same 64 Romio keys; sorting and placeholder validators pass.

`romio-preview.ts` mounts the real UI with a synthetic API adapter. `romio-home.fixture.json` is a sanitized live catalog snapshot containing game metadata and public cover URLs. Provider jobs remain synthetic; the fixture does not acquire or download ROMs.

The isolated browser displayed all six shelves and loaded all 52 supplied cover images. The top-rated shelf stayed empty with a metadata setup action. “View all” opened a labeled category page; searching “Fire Red” opened one explicit result. Both themes were inspected. Phone (320px), desktop (1440px) and 4K widths had no page overflow. Mouse actions, keyboard movement, simulated gamepad focus and touch modality were checked. No physical controller or emulator playback was tested.

The fixture logged existing router and missing notification-emitter warnings, plus a transient ResizeObserver notification warning during viewport changes. Settled layouts rendered and remained interactive; production console verification remains separate.

Screenshots are in the outer workspace's ignored `research/minerva/` directory: `home-shelves-dark.png`, `home-shelves-light.png` and `home-shelves-mobile-light.png`. Production build and authenticated VPS verification are handled separately.
