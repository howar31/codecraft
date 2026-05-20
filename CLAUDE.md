# CLAUDE.md — Codec Craft

Pure-frontend workbench for browser-runnable codec libraries (currently `ffmpeg.wasm`). Today's surface is animated-image conversion across WebM / GIF / APNG; the architecture is intended to grow into other client-side codec operations — e.g., video trim/crop, audio mute or track edit, container remux, frame extraction. Display name **Codec Craft**, slug `codecraft` (merged two `c`s). See [SPEC.md](SPEC.md) for current architecture.

## Scope

In scope: anything a browser-runnable codec library (ffmpeg.wasm today; future candidates include libheif-js, libvips-wasm, mp4box.js, beamcoder, WebCodecs, etc.) can perform entirely on the client.

The product axis is **privacy-first, no upload**, not "image converter". Evaluate new feature requests against (1) can a browser-runnable codec lib do this, and (2) does it stay client-side — not against the current toolset.

Out of scope: anything requiring server compute, network upload, or third-party API calls.

## Commands

```bash
npm run dev        # http://localhost:5173/codecraft/
npm run build      # → dist/
npm run preview
```

## Architecture pointers

- Entry: `index.html` → `main.js` (single module today; split by surface when feature count makes it painful, not preemptively).
- Codec engine: `@ffmpeg/ffmpeg@0.12` single-threaded, ESM core fetched from unpkg. Additional browser-side codec libs are welcome when ffmpeg can't reach a use case.
- UI is **pill-per-conversion**: `PILLS` array enumerates each `source→target` pair as its own view. Top pill-bar selects the active one; the sidebar opts widget (FPS / width / quality / [loop]) is rendered per pill from a shared `buildOptsControls(pill, initialOpts, { onChange, namePrefix })` function — same function powers in-place card editing (edit mode swaps the sidebar to act on a specific card's `opts` instead of pill defaults).
- Conversion graph: 6 `source→target` pairs covering WebM ↔ GIF, GIF ↔ APNG, WebM ↔ APNG. Defined in `PILLS`; the `${source}->${target}` switch in `processOne` dispatches to four ffmpeg recipes (palette to-gif, libvpx VP8 to-webm, apng mux to-apng — shared across pairs that target the same format). `.png` is byte-sniffed for `acTL` to distinguish APNG from static PNG.
- Drop snapshot: each queue card freezes its opts at drop time (`item.opts`), independent of subsequent sidebar changes. Edit-mode (`✎`) re-opens the sidebar widget bound to that card, with Overwrite / Duplicate / Cancel actions.
- Layout: desktop (≥960 px) locks `body` to `100vh` flex column; header + pills + footer stay fixed, only the queue (`.results-pane`) scrolls. Mobile (<960 px) reverts to natural block flow.
- Wrong-source drop: when all dropped files share one source different from the active pill, auto-switch to that source's last-used pill (tracked in `codecraft.last_pill_by_source`); info toast confirms. Mixed-source batches fall back to per-file warn + skip.
- Non-conversion operations (trim, crop, mute, frame export, …) will not fit `PILLS`'s `source→target` shape. Expect a parallel tool registry rather than overloading the converter abstraction.
- PWA: `public/manifest.webmanifest` + `public/sw.js` registered from `main.js` at scope `/codecraft/`. SW strategy — cache-first for the version-pinned `unpkg.com/@ffmpeg/core@0.12.6/*` (~30 MB, never expires), stale-while-revalidate for same-origin app shell. Bump `VERSION` in `sw.js` to invalidate.
- Icons: source is `public/favicon.svg` (Mosaic). PNG variants (favicon-32, apple-touch 180, icon-192/512, icon-maskable-512) rendered via `rsvg-convert` from the SVGs. Maskable variant uses `public/icon-maskable.svg` (full-bleed, no rounded corners).
- Build: Vite 5, `base: '/codecraft/'`. Deploys to `gh-pages` via GitHub Actions.

## Conventions

- i18n via `STRINGS['zh-Hant' | 'en']` + `data-i18n` / `data-i18n-title` attributes. Choice persisted in `localStorage` under `codecraft.lang`. Bilingual UI but rendered one language at a time.
- README.md is bilingual (zh-Hant + en); the audience is mixed.
- `ffmpeg-core` is loaded from `https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm` — the **ESM** build is required because Vite spawns module workers, and the library's fallback path (`import(coreURL)` after `importScripts` fails) only works with ESM.

## Codec gotchas

- GIF→WebM uses **libvpx VP8**, NOT VP9. `libvpx-vp9` in ffmpeg.wasm 0.12 single-threaded crashes with `RuntimeError: memory access out of bounds` on the first encoded frame.
- Do **NOT** add COOP/COEP headers. Single-threaded does not need SharedArrayBuffer, and the headers block the unpkg fetch (no CORP on response).
