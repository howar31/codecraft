# Codec Craft — SPEC

## Purpose

Pure-frontend bidirectional animated-image converter. Single-page web app deployed to GitHub Pages. Files never leave the device — everything runs locally in the browser via ffmpeg.wasm.

Display name **Codec Craft**; slug `codecraft` (the two `c`s at the join are merged). The slug is the package name, repo name, GitHub Pages subpath, and dev-server route — keep it lowercase and unbroken everywhere it functions as an identifier.

**Supported conversions**

| Source | Target(s) |
|---|---|
| `.webm` | GIF |
| `.gif` | WebM, APNG (multi-select per source) |
| `.apng` / `.png` (with `acTL`) | GIF |

**Goals**

- Zero server, zero upload, zero tracking; everything client-side.
- One source file can fan out to multiple targets in a single batch.
- Two output-quality modes (palette-optimized vs direct for GIF; CRF presets for WebM; encoder-effort presets for APNG).
- Inline preview + download link on completion.
- Bilingual UI (Traditional Chinese + English) via runtime `data-i18n` substitution; user choice persisted.

## Architecture

```
index.html  →  main.js  →  @ffmpeg/ffmpeg (ESM, module worker)
                              ↓ dynamic import (blob URL)
                           @ffmpeg/core 0.12.6 (ESM build, from unpkg)
```

- **Build:** Vite 5.4, `base: '/codecraft/'` for GitHub Pages subpath.
- **Worker:** Vite spawns ffmpeg's worker with `type: "module"`. The library tries `importScripts(coreURL)` first (classic-worker path), catches, then falls back to dynamic `import()`. The fallback only works against the ESM core build — hence `FFMPEG_CORE_BASE` points to `https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm`.
- **Core loading:** `coreURL` / `wasmURL` are fetched once, converted to blob URLs via `toBlobURL`, then passed to `ffmpeg.load()`. ~30 MB total, browser-cached after first load.
- **No COOP/COEP:** Single-threaded ffmpeg.wasm does not need `SharedArrayBuffer`. Setting those headers actually breaks the unpkg fetch (no CORP on the response).
- **Single ffmpeg instance:** One shared `FFmpeg` object processes the queue serially; `currentOutput = { item, target }` routes progress events to the correct sub-row.
- **Concurrent-run guard:** A global `running` flag is set on entry to `startAll()`; reentry returns immediately. New files dropped mid-run are appended to the same batch (the outer `for…of` over the array reads `.length` each step), so the user never needs to click Convert twice.

## Layout

```
.
├── index.html                       UI shell: header, two-column layout, drop overlay
├── main.js                          App logic (single module, ~740 lines)
├── style.css                        Dark theme, two-column responsive grid
├── vite.config.js                   base: '/codecraft/' + optimizeDeps.exclude for ffmpeg packages
├── package.json                     deps: @ffmpeg/ffmpeg, @ffmpeg/util · devDep: vite
├── package-lock.json
├── LICENSE                          MIT
├── README.md                        Human-facing project page (bilingual)
├── CLAUDE.md                        Agent-facing index (commands, conventions, pointers)
├── SPEC.md                          This file
├── .gitignore
├── docs/
│   └── hero.gif                     README hero animation, captured via Puppeteer
├── .github/
│   ├── workflows/
│   │   └── deploy.yml               Build + push dist/ to gh-pages (peaceiris/actions-gh-pages@v4)
│   └── dependabot.yml               Weekly npm + monthly github-actions updates
├── dist/                            Build output (gitignored)
└── node_modules/                    (gitignored)
```

## Data model

A `queue` of `item` objects, one per uploaded source file:

```
item = {
  file,                        // browser File
  source,                      // 'webm' | 'gif' | 'apng'
  targets,                     // SOURCE_TARGETS[source]; choices the user may pick from
  selected,                    // ordered array of currently-enabled targets (≥ 1)
  outputs: {                   // map keyed by target name
    [target]: {
      status,                  // 'pending' | 'processing' | 'done' | 'failed'
      statusKey, statusPct, statusExtra,   // for i18n re-rendering
      blobUrl,                 // active object URL for cleanup
      row,                     // .output-row DOM node
    }
  },
  dims,                        // { w, h } once probe completes (async, post-add)
  duplicate,                   // true if a same-name-and-size item already in queue
  card,                        // .source-card DOM node
  outputsContainer,            // .outputs DOM node (parent of all output-rows)
}
```

`SOURCE_TARGETS = { webm: ['gif'], gif: ['webm', 'apng'], apng: ['gif'] }` — adding a new source/target pair only requires touching this map plus the relevant branch in `processOne`.

## Format detection

- Extension match handles `.webm`, `.gif`, `.apng` directly.
- `.png` requires byte-level disambiguation: the file is sliced to the first 64 KB and scanned for the `acTL` chunk type (bytes `0x61 0x63 0x54 0x4C`). The scan stops early when it hits `IDAT`, since APNG requires `acTL` to precede `IDAT`. Hits without `acTL` resolve to "static PNG" and are silently skipped.
- Source dimensions are probed async via `<img>` (for image sources) or `<video preload="metadata">` (for WebM); shown next to the filename when ready. Probe failures degrade silently to no badge.

## Conversion pipelines

User-configurable inputs:

| Option | Values | Default |
|---|---|---|
| FPS | `Auto`, 10, 12, 15, 20, 24, 30, 50 | Auto (no `fps=` filter) |
| Width | `Original`, 240, 320, 480, 640, 800, 1080, 1280, 1920 | Original |
| Loop | checkbox | on |
| Quality | High / Normal | High |
| GIF outputs (default) | WebM, APNG (multi-select) | `[webm]` (persisted to `localStorage.codecraft.default_gif_targets`) |

`buildFilters({ fps, width }, forVP8)` produces an array of filter expressions:

- `fps=N` if a numeric FPS is chosen.
- `scale=W:-1:flags=lanczos` (or `:-2:` for VP8) if a numeric width is chosen.
- For VP8 with "Original" width, a no-op-when-even `scale=iw:-2:flags=lanczos` is still emitted because VP8 requires even dimensions.

**WebM → GIF and APNG → GIF**

```
# Normal mode — single pass
ffmpeg -i input.<ext> [-vf "<filters>"] -loop {0|-1} output.gif

# High mode — palettegen + paletteuse
ffmpeg -i input.<ext> -vf "<filters>,palettegen=stats_mode=full" palette.png
ffmpeg -i input.<ext> -i palette.png \
  -lavfi "<filters> [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" \
  -loop {0|-1} output.gif
```

`-loop 0` = infinite (forced by default), `-loop -1` = single playback. The infinite-loop default ensures source GIFs that lack a Netscape loop extension still loop in the output.

**GIF → WebM** (VP8, NOT VP9 — see Key Decisions)

```
ffmpeg -i input.gif -vf "<filters>" \
  -c:v libvpx -quality good -cpu-used 0 \
  -crf {10|24} -b:v 1M \
  -pix_fmt yuv420p \
  output.webm
```

WebM has no muxer-level loop flag; the loop preference only influences the preview `<video loop>` attribute.

**GIF → APNG**

```
ffmpeg -i input.gif [-vf "<filters>"] -plays {0|1} -f apng \
  [-pred mixed -compression_level 9]  # high quality only
  output.apng
```

APNG is lossless; "Quality" controls encoder effort (size vs speed) rather than visual fidelity.

`processOne(item, target, opts)` switches on `${source}->${target}` and dispatches to one of the four branches above. Output blobs are stamped with `TARGET_MIME[target]` and previewed inline: `<img>` for GIF / APNG, `<video controls loop muted autoplay playsInline>` for WebM. Files larger than 5 MB show a `⚠` glyph with i18n tooltip.

## UI behavior

**Layout** — Two-column at `≥ 960 px` (CSS grid `340px / 1fr`); single column below. On wide layouts the left controls pane is `position: sticky` so drop-zone + controls + Convert button stay reachable while the right queue scrolls.

**Drop targets** — Two layered indicators:

- A bordered `#drop-zone` in the left pane, click-to-pick.
- A `document`-level **drag-anywhere overlay** (`#drop-overlay`) shown during any file drag anywhere on the window. A `dragDepth` counter avoids flicker as the cursor crosses descendant boundaries. File detection uses `dataTransfer.types.includes('Files')` so element drags are ignored.

**File-list capture** — `change` and `drop` handlers snapshot `Array.from(fileList)` before doing async work, because both `input.files` (after `input.value = ''`) and `event.dataTransfer.files` (after the synchronous handler exits) can be cleared by the browser, dropping all but the first file otherwise.

**Per-source card (`.source-card`)** — Header shows filename, source dimensions, optional duplicate badge, optional per-card target chips (only when `targets.length > 1`), and an `×` remove button. Body (`.outputs`) holds one `.output-row` per selected target.

**Per-output row (`.output-row`)** — Grid layout: `→ Target | status | action | (progress, full-width) | (preview, full-width)`. Progress is set by `setStatus(item, target, key, pct)`; download link + preview replace the action cell on completion.

**Chips** — Identical visual treatment for two scopes:

- **Global GIF outputs default** in the left controls pane. Toggling propagates immediately to every queued GIF item whose outputs are all still pending, plus persists to `localStorage.codecraft.default_gif_targets` for future uploads.
- **Per-card override** in each multi-target `.source-card`. Toggling adds/removes the corresponding `.output-row` for that one item.
- Both enforce "at least one selected" (the only chip cannot be deselected).

**Duplicate detection** — `(name, size)` match against any existing queue item flags the new card with a `--warn`-coloured badge and i18n tooltip. Items are still queued and processed normally; the badge is informational only.

**Remove** — The `×` button is disabled only while the item has any `processing` output. Pending, done, and failed items can all be removed; the handler revokes blob URLs and splices `queue`.

**Concurrent control** — `running` is `true` for the duration of `startAll()`. While running, the Convert button, all chips (global + per-card), and all remove buttons are disabled. `setStatus` also re-evaluates the remove button so a finished output's card becomes removable mid-batch.

**i18n** — `STRINGS['zh-Hant' | 'en']` keyed by short identifier; initial choice is `localStorage.codecraft.lang` or `navigator.language.startsWith('zh') ? 'zh-Hant' : 'en'`. `applyLang()` walks `[data-i18n]` for `textContent` and `[data-i18n-title]` for the `title` attribute; dynamic strings (per-row status, download links, dup badge) are re-rendered from stored state on language switch.

## Conventions

- Code comments: English.
- AI-facing docs (`CLAUDE.md`, `SPEC.md`): English. README is human-facing and bilingual.
- Commits: Conventional Commits (`feat:`, `fix:`, `docs:`, `ci:`, `chore:`, ...). One commit per feature.
- Do not add COOP/COEP headers (see Architecture).
- Do not switch the core URL away from `/dist/esm` (see Key Decisions).
- For new conversion pairs: extend `SOURCE_TARGETS` and add a branch in `processOne` keyed by `${source}->${target}`.

## Verification

- **Manual:** `npm run dev`, drop a mix of `.webm` / `.gif` / `.apng`, toggle chips, run; inspect inline preview + downloaded files.
- **E2E (ad hoc):** `/tmp/codecraft-gif-e2e.js` and `/tmp/codecraft-e2e.js` (Puppeteer, Node 18 via nvm) exercise the conversion pipelines and dump outputs to `/tmp/codecraft-out-*` / `/tmp/codecraft-gif-*`. Verified with `file`.
- **Hero capture:** `/tmp/codecraft-hero-capture.js` drives the same UI with three synthetic demo files (mandelbrot, testsrc, cellular automaton) to produce `docs/hero.gif`.
- No unit tests yet — the surface area is one stateful module; integration via Puppeteer is the pragmatic gate.

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
- **Serial batch:** single ffmpeg instance means queued conversions run strictly one at a time, and a multi-target item fans out into N serial encodes.
- **No editing:** no trim, crop, or filters beyond `fps` / `scale`.
- **No multi-threaded ffmpeg.wasm:** intentional — would require `SharedArrayBuffer` and therefore COOP/COEP, which complicates GH Pages and conflicts with the unpkg fetch.
- **No format pairs outside the table in Purpose.** WebM↔APNG and PNG-static handling are deliberately omitted.
- **FPS dropdown caps at 50** because GIF spec stores delays in 1/100 s (so 100 fps is the theoretical max, ~50 fps the practical browser ceiling); requesting more would only duplicate frames.
- **Duplicate fingerprint is `(name, size)`** — quick and good enough for "user re-dragged the same file"; not a true byte-level hash.

## Key decisions

- **ESM core build over UMD.** Vite spawns ffmpeg's worker with `type: "module"`. The library's fallback (`importScripts` → dynamic `import()`) only succeeds if the URL it imports actually exports a default. The UMD build does not; the ESM build does. Verified by reading `@ffmpeg/ffmpeg/dist/esm/worker.js`.
- **VP8 (libvpx) over VP9 for GIF → WebM.** `libvpx-vp9` in ffmpeg.wasm 0.12 single-threaded crashes with `RuntimeError: memory access out of bounds` on the first encoded frame regardless of input size (the wasm build is `--disable-pthreads`; VP9's C path is unstable). VP8's older encoder is rock-solid in the same build and still produces small WebM files (~12× compression vs source GIF in practice). Revisit if/when ffmpeg.wasm ships a stable VP9-capable core.
- **Drop COOP/COEP.** Single-threaded mode doesn't need them. They additionally break the unpkg fetch because unpkg's response lacks Cross-Origin-Resource-Policy.
- **unpkg over self-hosted core.** Saves repo size and lets the browser HTTP cache amortise the 30 MB cost across visits.
- **`peaceiris/actions-gh-pages` over `actions/deploy-pages`.** Simpler config; uses the classic `gh-pages` branch model rather than the new Pages artifact pipeline.
- **Two-column sticky layout over a sticky action bar.** Wide screens already have horizontal real estate; using a left pane that's always visible is less obstructive than a stuck-to-top horizontal bar.
- **Window-level drag-anywhere over per-zone drag.** Long queues push the visible drop-zone off-screen; routing every drop through `document` listeners keeps the affordance reachable, with a full-screen overlay as the indicator.
- **Per-card multi-target via chips, not per-row dropdowns.** Selecting multiple outputs for one source is the central new feature; chips naturally extend to "click to add another output" without a multi-step modal. A global "GIF outputs default" propagates to the still-pending items so batch use cases avoid clicking each card.
- **FileList snapshot before async work.** Both `input.files` (when the input value is reset) and `dataTransfer.files` (after the sync handler exits) can be cleared mid-iteration by the browser; copying to an Array before yielding to async preserves the input.
