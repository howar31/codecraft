# Codec Craft — SPEC

## Purpose

Pure-frontend WebM → GIF converter. Single-page web app deployed to GitHub Pages. Files never leave the device — everything runs locally in the browser via ffmpeg.wasm.

Display name **Codec Craft**; slug `codecraft` (the two `c`s at the join are merged). The slug is the package name, repo name, GitHub Pages subpath, and dev-server route — keep it lowercase and unbroken everywhere it functions as an identifier.

**Goals**

- Convert one or more `.webm` videos to `.gif` entirely client-side.
- Zero server, zero upload, zero tracking.
- Two quality modes (palette-optimized vs direct).
- Inline preview + download link on completion.
- Bilingual UI (Traditional Chinese + English).

## Architecture

```
index.html  →  main.js  →  @ffmpeg/ffmpeg (ESM, module worker)
                              ↓ dynamic import (blob URL)
                           @ffmpeg/core 0.12.6 (ESM build, from unpkg)
```

- **Build:** Vite 5.4, `base: '/codecraft/'` for GitHub Pages subpath.
- **Worker:** Vite spawns ffmpeg's worker with `type: "module"`. The library tries `importScripts(coreURL)` first (classic-worker path), catches, then falls back to dynamic `import()`. The fallback only works against the ESM core build — hence `FFMPEG_CORE_BASE` points to `https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm`.
- **Core loading:** `coreURL` / `wasmURL` are fetched once, converted to blob URLs via `toBlobURL`, then passed to `ffmpeg.load()`. ~30MB total, browser-cached after first load.
- **No COOP/COEP:** Single-threaded ffmpeg.wasm does not need `SharedArrayBuffer`. Setting those headers actually breaks the unpkg fetch (no CORP on the response).
- **Single ffmpeg instance:** One shared `FFmpeg` object processes the queue serially; `currentItem` routes progress events to the active row.

## Layout

```
.
├── index.html                       UI shell: bilingual labels, drop zone, controls, results container
├── main.js                          App logic: queue, ffmpeg lifecycle, exec pipeline, render (~200 lines)
├── style.css                        Dark theme, 720px main column, grid-based result rows
├── vite.config.js                   base: '/codecraft/' + optimizeDeps.exclude for ffmpeg packages
├── package.json                     deps: @ffmpeg/ffmpeg, @ffmpeg/util · devDep: vite
├── package-lock.json
├── LICENSE                          MIT
├── README.md                        Human-facing project page
├── CLAUDE.md                        Agent-facing index (commands, conventions, pointers)
├── SPEC.md                          This file
├── .gitignore
├── .github/
│   ├── workflows/
│   │   └── deploy.yml               Build + push dist/ to gh-pages branch (peaceiris/actions-gh-pages@v4)
│   └── dependabot.yml               Weekly npm + monthly github-actions updates
├── dist/                            Build output (gitignored)
└── node_modules/                    (gitignored)
```

## Conversion pipeline

User-configurable inputs: `fps ∈ [5,30]` (default 15), `width ∈ [200,1920]` (default 800), `quality ∈ {high, normal}` (default `high`).

**Normal mode** — single pass:

```
ffmpeg -i input.webm \
  -vf "fps={fps},scale={width}:-1:flags=lanczos" \
  output.gif
```

**High mode** — two passes (palettegen + paletteuse):

```
# pass 1: build palette
ffmpeg -i input.webm \
  -vf "fps={fps},scale={width}:-1:flags=lanczos,palettegen=stats_mode=full" \
  palette.png

# pass 2: apply palette
ffmpeg -i input.webm -i palette.png \
  -lavfi "fps={fps},scale={width}:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" \
  output.gif
```

Each item runs sequentially. On completion the GIF blob URL is rendered inline as `<img>` plus a download link. Output `> 5 MB` triggers a `⚠` marker next to the size text.

## UI behavior

- Drop zone accepts `.webm` via drag-drop or click-to-pick (`<input type="file" multiple>`); non-webm files are filtered out in `addFiles()`.
- Each file becomes a `.result-row` grid: `name | status | action`, with a thin progress bar (`grid-column: 1 / -1`) and a full-width preview slot below (hidden via `:empty` until populated).
- Progress comes from `ffmpeg.on('progress', ...)` and is routed to the currently-processing item via the `currentItem` ref.
- `load-status` text shows the one-time ffmpeg load progress; clears once loaded. Load errors are caught in `startAll()` and surfaced to the same element.

## Conventions

- Code comments: English.
- AI-facing docs (`CLAUDE.md`, `SPEC.md`): English.
- README is human-facing and bilingual.
- Commits: Conventional Commits (`feat:`, `fix:`, `docs:`, `ci:`, `chore:`, ...). One commit per feature.
- Do not add COOP/COEP headers (see Architecture).
- Do not switch the core URL away from `/dist/esm` (see Key Decisions).

## Verification

- **Manual:** `npm run dev`, drop a `.webm`, run both quality modes, inspect inline preview + downloaded file.
- **E2E (ad hoc):** `/tmp/codecraft-e2e.js` (Puppeteer, Node 18 via nvm) uploads a real `.webm`, polls until the download href appears, dumps GIF to `/tmp/codecraft-out-{high,normal}.gif`, verifies with `file`.
- No unit tests yet — the surface area is one stateful module; integration via the E2E script is the pragmatic gate.

## Deploy

`main` push → GitHub Actions (`.github/workflows/deploy.yml`) runs `npm install && npm run build` → `peaceiris/actions-gh-pages@v4` pushes `dist/` to the `gh-pages` branch. The workflow declares `permissions: contents: write` because the default `GITHUB_TOKEN` is read-only and cannot push branches otherwise.

GitHub Pages serves from `gh-pages` / root with HTTPS enforced. Base path `/codecraft/` matches the repo name; the canonical URL is `https://lab.howar31.com/codecraft/` (user's custom Pages domain).

Local commands:

```bash
npm install
npm run dev        # http://localhost:5173/codecraft/
npm run build      # → dist/
npm run preview
```

## Known limitations / Non-goals

- **Memory cap:** ffmpeg.wasm has a ~2 GB browser-side ceiling. Large/long inputs will OOM the worker.
- **First-load weight:** ~30 MB ffmpeg-core download from unpkg on first visit; subsequent loads served from the HTTP cache.
- **Serial batch:** single ffmpeg instance means queued conversions run strictly one at a time.
- **No editing:** no trim, crop, or filters beyond `fps` / `scale`.
- **No multi-threaded ffmpeg.wasm:** intentional — would require `SharedArrayBuffer` and therefore COOP/COEP, which complicates GH Pages and conflicts with the unpkg fetch.
- **No formats other than WebM input / GIF output.**

## Key decisions

- **ESM core build over UMD.** Vite spawns ffmpeg's worker with `type: "module"`. The library's fallback (`importScripts` → dynamic `import()`) only succeeds if the URL it imports actually exports a default. The UMD build does not; the ESM build does. Verified by reading `@ffmpeg/ffmpeg/dist/esm/worker.js`.
- **Drop COOP/COEP.** Single-threaded mode doesn't need them. They additionally break the unpkg fetch because unpkg's response lacks Cross-Origin-Resource-Policy.
- **unpkg over self-hosted core.** Saves repo size and lets the browser HTTP cache amortise the 30 MB cost across visits.
- **`peaceiris/actions-gh-pages` over `actions/deploy-pages`.** Simpler config; uses the classic `gh-pages` branch model rather than the new Pages artifact pipeline.
