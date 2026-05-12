# CLAUDE.md — codecraft

Pure-frontend WebM → GIF converter. See [SPEC.md](SPEC.md) for full architecture.

## Commands

```bash
npm run dev        # http://localhost:5173/codecraft/
npm run build      # → dist/
npm run preview
```

## Architecture pointers

- Entry: `index.html` → `main.js` (single module, ~190 lines).
- ffmpeg.wasm: `@ffmpeg/ffmpeg@0.12` single-threaded, ESM core fetched from unpkg.
- Build: Vite 5, `base: '/codecraft/'`. Deploys to `gh-pages` via GitHub Actions.

## Conventions

- Bilingual UI (Traditional Chinese + English).
- No backend. No upload. Everything client-side.
- `ffmpeg-core` is loaded from `https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm` — the **ESM** build is required because Vite spawns module workers, and the library's fallback path (`import(coreURL)` after `importScripts` fails) only works with ESM.
- Do **NOT** add COOP/COEP headers. Single-threaded does not need SharedArrayBuffer, and the headers block the unpkg fetch (no CORP on response).

## Workflow rules

- One commit per feature; use conventional commit prefixes (`feat:`, `fix:`, `docs:`, ...).
- Never commit automatically — present a summary and wait for explicit approval.
- Code comments in English. AI-facing docs (CLAUDE.md, SPEC.md) in English.
