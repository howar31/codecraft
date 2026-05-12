# SPEC — codecraft

Pure-frontend WebM → GIF converter. Single-page web app deployed to GitHub Pages.

## Goals

- Convert one or more `.webm` videos to `.gif` entirely client-side.
- Zero server, zero upload, zero tracking.
- Two quality modes (palette-optimized vs direct).
- Inline preview + download link on completion.

## Non-goals

- No video editing (trim, crop, filters beyond fps/scale).
- No multi-threaded ffmpeg.wasm (avoids COOP/COEP requirement on GH Pages).
- No formats other than WebM input / GIF output.

## Architecture

```
index.html  →  main.js  →  @ffmpeg/ffmpeg (ESM, module worker)
                              ↓ dynamic import (blob URL)
                           @ffmpeg/core 0.12.6 (ESM build, from unpkg)
```

- **Build:** Vite 5.4, `base: '/codecraft/'` for GitHub Pages subpath.
- **Worker:** Vite spawns ffmpeg's worker with `type: "module"`. The library tries `importScripts` first, falls back to dynamic `import()`. The fallback only works with the ESM core build — hence `FFMPEG_CORE_BASE` points to `https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm`.
- **Core loading:** `coreURL` / `wasmURL` are fetched once, converted to blob URLs via `toBlobURL`, then passed to `ffmpeg.load()`. ~30MB total, browser-cached after first load.
- **No COOP/COEP:** Single-threaded ffmpeg.wasm does not need SharedArrayBuffer. Setting those headers actually breaks the unpkg fetch (no CORP on the response).

## File map

| Path | Purpose |
|---|---|
| `index.html` | UI shell, bilingual labels, drop zone, controls, results container |
| `main.js` | App logic: queue, ffmpeg lifecycle, exec pipeline, render |
| `style.css` | Dark theme, 720px main column, grid-based result rows |
| `vite.config.js` | `base: '/codecraft/'` + `optimizeDeps.exclude` for ffmpeg packages |
| `.github/workflows/deploy.yml` | Build → push `dist/` to `gh-pages` via peaceiris/actions-gh-pages@v4 |
| `package.json` | deps: `@ffmpeg/ffmpeg`, `@ffmpeg/util`; devDep: `vite` |

## Conversion pipeline

User configures: `fps ∈ [5,30]` (default 15), `width ∈ [200,1920]` (default 800), `quality ∈ {high, normal}` (default high).

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

Each item runs sequentially (one ffmpeg instance shared across the queue). After completion, the GIF blob URL is rendered inline as `<img>` plus a download link. Size > 5MB triggers a ⚠ marker.

## UI behavior

- Drop zone accepts `.webm` via drag-drop or click-to-pick (`<input type="file" multiple>`).
- Each file becomes a `.result-row` grid: `name | status | action`, with a thin progress bar (`row-gap`) and a full-width preview slot below.
- Progress comes from `ffmpeg.on('progress', ...)` and maps to the currently-processing item only.
- `load-status` text shows the one-time ffmpeg load progress; clears once loaded.

## Verification

- **Manual:** load `npm run dev`, drop a `.webm`, run both quality modes, inspect inline preview + downloaded file.
- **E2E (ad hoc):** `/tmp/codecraft-e2e.js` runs Puppeteer headless, uploads a real `.webm`, polls until download href appears, dumps GIF to `/tmp/codecraft-out-{high,normal}.gif`, verifies with `file`.
- No unit tests yet — the surface area is one stateful module; integration via the E2E script is the pragmatic gate.

## Known constraints

- `ffmpeg.wasm` memory cap (~2GB browser-side). Large/long inputs will OOM the worker.
- First load downloads ~30MB from unpkg. Subsequent loads served from HTTP cache.
- Single-instance ffmpeg means batch conversion is strictly serial.

## Deployment

`main` push → GitHub Actions runs `npm install && npm run build` → `peaceiris/actions-gh-pages@v4` pushes `dist/` to `gh-pages` branch. GitHub Pages serves from `gh-pages` / root. Base path `/codecraft/` matches the repo name.
