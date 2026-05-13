# CLAUDE.md — Codec Craft

Pure-frontend bidirectional animated-image converter (WebM ⇄ GIF, GIF ⇄ APNG). Display name **Codec Craft**, slug `codecraft` (merged two `c`s). See [SPEC.md](SPEC.md) for full architecture.

## Commands

```bash
npm run dev        # http://localhost:5173/codecraft/
npm run build      # → dist/
npm run preview
```

## Architecture pointers

- Entry: `index.html` → `main.js` (single module).
- ffmpeg.wasm: `@ffmpeg/ffmpeg@0.12` single-threaded, ESM core fetched from unpkg.
- Layout: two-column at ≥960 px (sticky left controls pane, right queue), single-column below.
- Format graph: `SOURCE_TARGETS = { webm:[gif], gif:[webm,apng], apng:[gif] }`. `.png` is byte-sniffed for `acTL` to distinguish APNG from static PNG.
- Build: Vite 5, `base: '/codecraft/'`. Deploys to `gh-pages` via GitHub Actions.

## Conventions

- i18n via `STRINGS['zh-Hant' | 'en']` + `data-i18n` / `data-i18n-title` attributes. Choice persisted in `localStorage` under `codecraft.lang`. Bilingual UI but rendered one language at a time.
- No backend. No upload. Everything client-side.
- `ffmpeg-core` is loaded from `https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm` — the **ESM** build is required because Vite spawns module workers, and the library's fallback path (`import(coreURL)` after `importScripts` fails) only works with ESM.
- GIF→WebM uses **libvpx VP8**, NOT VP9. `libvpx-vp9` in ffmpeg.wasm 0.12 single-threaded crashes with `RuntimeError: memory access out of bounds` on the first encoded frame.
- Do **NOT** add COOP/COEP headers. Single-threaded does not need SharedArrayBuffer, and the headers block the unpkg fetch (no CORP on response).

## Workflow rules

- One commit per feature; use conventional commit prefixes (`feat:`, `fix:`, `docs:`, ...).
- Never commit automatically — present a summary and wait for explicit approval.
- Code comments in English. AI-facing docs (CLAUDE.md, SPEC.md) in English. README is bilingual / human-facing.
