# Codec Craft — SPEC

## Purpose

Pure-frontend workbench for browser-runnable codec libraries (currently `ffmpeg.wasm`). Today's surface is animated-image conversion across WebM / GIF / APNG; the architecture is intended to grow into other client-side codec operations (e.g., video trim/crop, audio mute, container remux, frame extraction). Single-page web app deployed to GitHub Pages. Files never leave the device — everything runs locally in the browser.

Display name **Codec Craft**; slug `codecraft` (the two `c`s at the join are merged). The slug is the package name, repo name, GitHub Pages subpath, and dev-server route — keep it lowercase and unbroken everywhere it functions as an identifier.

**Supported conversions** (six `source → target` pairs)

| ↓ source / → target | GIF | WebM | APNG |
|---|---|---|---|
| **WebM** | ✓ | — | ✓ |
| **GIF** | — | ✓ | ✓ |
| **APNG** (`.png` with `acTL`) | ✓ | ✓ | — |

**Goals**

- Zero server, zero upload, zero tracking; everything client-side.
- Each conversion gets its own focused view (pill) with only the options that conversion actually needs.
- Per-card setting snapshots — files dropped at one set of opts keep those opts even after the user changes the panel for new drops.
- In-place card editing without leaving the page (sidebar transforms into the editor).
- Per-target quality semantics labelled in the user's own terms (palette accuracy / CRF / encoder effort).
- Inline preview + download link on completion.
- Bilingual UI (Traditional Chinese + English) via runtime `data-i18n` substitution; user choice persisted.

## Architecture

```
index.html  →  main.js  →  @ffmpeg/ffmpeg (ESM, module worker)
                              ↓ dynamic import (blob URL)
                           @ffmpeg/core 0.12.6 (ESM build, from unpkg)
```

- **Build:** Vite 7, `base: '/codecraft/'` for GitHub Pages subpath.
- **Worker:** Vite spawns ffmpeg's worker with `type: "module"`. The library tries `importScripts(coreURL)` first (classic-worker path), catches, then falls back to dynamic `import()`. The fallback only works against the ESM core build — hence `FFMPEG_CORE_BASE` points to `https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm`.
- **Core loading:** `coreURL` / `wasmURL` are fetched once, converted to blob URLs via `toBlobURL`, then passed to `ffmpeg.load()`. ~30 MB total, browser-cached after first load.
- **No COOP/COEP:** Single-threaded ffmpeg.wasm does not need `SharedArrayBuffer`. Setting those headers actually breaks the unpkg fetch (no CORP on the response).
- **Single ffmpeg instance:** One shared `FFmpeg` object processes the queue serially; `currentItem` routes progress events to the active card.
- **Concurrent-run guard:** A global `running` flag is set on entry to `startAll()`; reentry returns immediately. New files dropped mid-run are appended to the same batch (the outer `for…of` over the array reads `.length` each step).

## Layout

```
.
├── index.html                       UI shell: pills bar, two-column layout, edit-context + edit-actions slots, drop overlay, toast host; <head> declares favicon (svg+png), apple-touch-icon, manifest, theme-color
├── main.js                          App logic (single module); registers the service worker after window load
├── style.css                        Dark theme, viewport-fit responsive layout
├── vite.config.js                   base: '/codecraft/' + optimizeDeps.exclude for ffmpeg packages
├── package.json                     deps: @ffmpeg/ffmpeg, @ffmpeg/util · devDep: vite
├── package-lock.json
├── LICENSE                          MIT
├── README.md                        Human-facing project page (bilingual)
├── CLAUDE.md                        Agent-facing index (commands, conventions, pointers)
├── SPEC.md                          This file
├── .gitignore
├── public/                          Static assets copied verbatim by Vite to dist/ at the base URL root
│   ├── favicon.svg                  Mosaic icon, rounded-corner version (favicon source of truth)
│   ├── icon-maskable.svg            Full-bleed mosaic for Android adaptive (maskable) icons
│   ├── favicon-32.png               Legacy PNG favicon fallback
│   ├── apple-touch-icon.png         180×180 iOS home-screen icon
│   ├── icon-192.png                 PWA manifest "any" purpose
│   ├── icon-512.png                 PWA manifest "any" purpose
│   ├── icon-maskable-512.png        PWA manifest "maskable" purpose
│   ├── manifest.webmanifest         PWA manifest
│   └── sw.js                        Service worker (app shell SWR + ffmpeg-core cache-first)
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

**`PILLS`** — the primary catalog of available conversions:

```js
[
  { id: 'webm-to-gif',  source: 'webm', target: 'gif',  showLoop: true  },
  { id: 'webm-to-apng', source: 'webm', target: 'apng', showLoop: true  },
  { id: 'gif-to-webm',  source: 'gif',  target: 'webm', showLoop: false },
  { id: 'gif-to-apng',  source: 'gif',  target: 'apng', showLoop: true  },
  { id: 'apng-to-gif',  source: 'apng', target: 'gif',  showLoop: true  },
  { id: 'apng-to-webm', source: 'apng', target: 'webm', showLoop: false },
]
```

`showLoop` is `false` for `*-to-webm` pills because WebM's container has no portable "loop forever" metadata; the Loop checkbox is hidden in those views. Adding a new pair = append to `PILLS` and add a `${source}->${target}` branch in `processOne`. Adding a non-conversion tool (trim, crop, mute) is expected to grow a parallel registry rather than be forced into the `source→target` shape.

**Queue items** — one per dropped file, single-target:

```js
item = {
  file,                                          // browser File
  source,                                        // 'webm' | 'gif' | 'apng'
  target,                                        // 'webm' | 'gif' | 'apng'
  pillId,                                        // PILLS[i].id at drop time
  opts: { fps, width, loop, quality },           // SNAPSHOT — frozen at drop, independent of sidebar
  dims,                                          // { w, h } once probed
  duplicate,                                     // true if same (name, size) already queued
  status,                                        // 'pending' | 'processing' | 'done' | 'failed'
  statusKey, statusPct, statusExtra,             // for i18n re-rendering of status text
  blobUrl,                                       // output Blob URL (cleaned up on remove/re-encode)
  card,                                          // .source-card DOM node
  nodes,                                         // { badge, filename, dims, dup, summary, status, progress, bar, action, preview, editBtn, removeBtn }
}
```

Each card renders one target only. The old per-card multi-target chip mechanism is gone (the equivalent now is to convert twice from two different pills, or use ✎ Duplicate after edit).

**Per-pill option persistence:**

| Key | Shape | Purpose |
|---|---|---|
| `codecraft.lang` | `'zh-Hant' \| 'en'` | UI language |
| `codecraft.last_pill` | pill id | Used when the URL has no `#/<pill>` hash on load |
| `codecraft.last_pill_by_source` | `{ [source]: pillId }` | Auto-switch destination for wrong-source drops |
| `codecraft.opts.<pill-id>` | `{ fps, width, loop, quality }` | Each pill remembers its own sidebar settings |

Sidebar changes are persisted on every input event via the `onChange` callback passed to `buildOptsControls`. Edit-mode changes are NOT persisted to localStorage — they apply only to the card being edited (via Overwrite / Duplicate).

## Format detection

- Extension match handles `.webm`, `.gif`, `.apng` directly.
- `.png` requires byte-level disambiguation: the file is sliced to the first 64 KB and scanned for the `acTL` chunk type (bytes `0x61 0x63 0x54 0x4C`). The scan stops early when it hits `IDAT`, since APNG requires `acTL` to precede `IDAT`. Hits without `acTL` resolve to "static PNG" and are silently skipped.
- Source dimensions are probed async via `<img>` (for image sources) or `<video preload="metadata">` (for WebM); shown next to the filename when ready. Probe failures degrade silently to no badge.

## Conversion pipelines

User-configurable inputs (per pill, persisted independently):

| Option | Values | Default |
|---|---|---|
| FPS | `Auto`, 10, 12, 15, 20, 24, 30, 50 | Auto (no `fps=` filter) |
| Width | `Original`, 240, 320, 480, 640, 800, 1080, 1280, 1920 | Original |
| Loop | checkbox (visible only when `pill.showLoop`) | on |
| Quality | High / Normal, with target-specific labels | High |

`buildFilters({ fps, width }, forVP8)` produces an array of filter expressions:

- `fps=N` if a numeric FPS is chosen.
- `scale=W:-1:flags=lanczos` (or `:-2:` for VP8) if a numeric width is chosen.
- For VP8 with "Original" width, a `scale=iw:-2:flags=lanczos` is still emitted because VP8 requires even dimensions.

`processOne(item)` switches on `${source}->${target}` and dispatches to one of four ffmpeg recipes. Output blobs are stamped with `TARGET_MIME[target]` and previewed inline: `<img>` for GIF / APNG, `<video controls loop muted autoplay playsInline>` for WebM. Files larger than 5 MB show a `⚠` glyph with i18n tooltip.

**WebM → GIF / APNG → GIF**

```
# Normal mode — single pass
ffmpeg -i input.<ext> [-vf "<filters>"] -loop {0|-1} output.gif

# High mode — palettegen + paletteuse
ffmpeg -i input.<ext> -vf "<filters>,palettegen=stats_mode=full" palette.png
ffmpeg -i input.<ext> -i palette.png \
  -lavfi "<filters> [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" \
  -loop {0|-1} output.gif
```

`-loop 0` = infinite (default), `-loop -1` = single playback. Label: "精細取色（兩段 palette）" / "Accurate colors (two-pass palette)" vs "快速取色" / "Fast palette".

**GIF → WebM and APNG → WebM** (VP8 only — see Key Decisions)

```
ffmpeg -i input.<ext> -vf "<filters>" \
  -c:v libvpx -quality good -cpu-used 0 \
  -crf {10|24} -b:v 1M \
  -pix_fmt yuv420p \
  output.webm
```

`apng-to-webm` shares the exact same recipe with the source demuxer switched. WebM has no muxer-level loop flag; Loop checkbox is therefore hidden in `*-to-webm` pills. Label: "畫質優先（VP8 CRF 10）" / "Quality first (VP8 CRF 10)" vs "檔案優先（VP8 CRF 24）" / "Size first (VP8 CRF 24)".

**GIF → APNG and WebM → APNG**

```
ffmpeg -i input.<ext> [-vf "<filters>"] -plays {0|1} -f apng \
  [-pred mixed -compression_level 9]  # high quality only
  output.apng
```

APNG is lossless; "Quality" controls encoder effort (size vs speed) rather than visual fidelity. Label: "最小檔案（較慢）" / "Smallest file (slower)" vs "快速編碼" / "Fast encode".

## UI behavior

**Pill bar** — Six pill buttons across the top of the page, one per conversion. Click a pill → updates `location.hash` to `#/<pill-id>`, which triggers a `hashchange` listener calling `setActivePill(id)`. The sidebar's opts widget rebuilds from `loadOpts(pillId)`, the drop-zone title swaps to match the source format, and the pill bar's active class moves. Future non-conversion tools (trim, crop, mute, frame export) will appear as additional pills or via a parallel tool registry; no in-UI hint about that is rendered today.

**Shared opts widget** — `buildOptsControls(pill, initialOpts, { onChange, namePrefix, compact })` returns `{ root, read }`. The sidebar mounts it in normal mode with an `onChange` that persists to `codecraft.opts.<pill-id>`; edit mode re-mounts the same widget bound to a single card's `item.opts` with no `onChange` (`read()` is called on Overwrite / Duplicate confirm). One widget definition; new opts fields are added in one place.

**Drop → snapshot opts** — When files are added (`addFiles`):

1. `detectSource(file)` for each file.
2. Unsupported files → error toast (`toast_unsupported_format`).
3. If the entire supported batch shares one source different from the active pill, auto-switch: choose destination via `codecraft.last_pill_by_source[source]` (falling back to `PILLS_BY_SOURCE[source][0].id`), update hash, fire info toast (`toast_switched_to`).
4. Mixed-source batches do NOT auto-switch — non-matching files toast `toast_wrong_source` and are skipped.
5. Matching files: `snapshotControls()` reads the current sidebar widget's `read()` result, the resulting opts dict is stored on the new `item.opts`, the card is rendered, and dimensions are probed asynchronously.

**Card** (`.source-card`) — Compact single-row layout:

```
[pill badge] filename  dims  [duplicate?]                     ✎  ✕
opts summary                                                  status
[progress bar — visible only during writing/converting]
[download link · size · ⚠?]
[preview <img|video>]
```

`opts summary` is `t('summary_fps', { v }) · t('summary_width', { v }) · target-specific quality label [· Loop / Once if pill.showLoop]`, rendered from `item.opts` (the snapshot, not the live sidebar).

**Edit mode** — `editingItem` is the single global flag. Clicking ✎ on a card calls `enterEditMode(item)`:

1. Rebuild the sidebar widget using the card's `pill` context with `item.opts` as initial values. No `onChange` — the panel does not persist anything to localStorage during edit.
2. Reveal `#edit-context` ("編輯: [pill] filename") and `#edit-actions` (Overwrite / Duplicate / Cancel) inside the sidebar; CSS `body.editing` hides `.drop-zone`, `.normal-actions`, `.controls-pane > footer`, and `#drop-overlay`; dims the pills bar, header, page-footer, and non-target cards to opacity 0.3 with `pointer-events: none`.
3. The editing-target card gains an accent outline and its own remove button is disabled.

Confirm flows:

- **Overwrite** — `item.opts = read()`, blob URL revoked, action/preview cleared, status reset to queued, summary re-rendered, edit mode exits.
- **Duplicate** — clones the item with `read()` as new opts, pushes to the queue, edit mode exits.
- **Cancel / ESC** — exits without touching the card.

Switching pills (programmatic) during edit auto-exits via `setActivePill`'s guard. User pill clicks are blocked by CSS `pointer-events: none` on the dimmed pills bar. Drops during edit are blocked at JS level (`addFiles` returns early if `editingItem` is set) and CSS hides the drop overlay.

**Viewport-fit layout** — At `≥ 960 px` the page is locked to viewport height: `body { height: 100vh; overflow: hidden }`; `main` is a flex column with header / pills (flex: none), `.layout` (flex: 1), and `.page-footer` (flex: none). Both panes inside `.layout` use `min-height: 0; overflow-y: auto` so the queue (`.results-pane`) is the only scrollable region when cards exceed the viewport. Below `960 px` the page reverts to natural block flow.

**Drop targets** — Two layered indicators:

- A bordered `#drop-zone` in the left pane, click-to-pick (hidden in edit mode).
- A `document`-level **drag-anywhere overlay** (`#drop-overlay`) shown during any file drag anywhere on the window. A `dragDepth` counter avoids flicker as the cursor crosses descendant boundaries. File detection uses `dataTransfer.types.includes('Files')` so element drags are ignored. Drag handlers return early when `editingItem` is set so the overlay never appears during edit.

**File-list capture** — `change` and `drop` handlers snapshot `Array.from(fileList)` before doing async work, because both `input.files` (after `input.value = ''`) and `event.dataTransfer.files` (after the synchronous handler exits) can be cleared by the browser, dropping all but the first file otherwise.

**Toast** — `showToast(message, { variant: 'info' | 'error', timeoutMs })` appends a node into a fixed top-center container (`#toast-host`, `top: 1rem; left: 50%; translateX(-50%)`). Same message within 1 s is de-duplicated. Auto-dismiss after 3.5 s; click to dismiss. Used for `toast_wrong_source`, `toast_switched_to`, `toast_unsupported_format`. ffmpeg load failures stay in the inline `#load-status` span (not toast).

**Status states & card visuals** — `setStatus(item, key, pct, extra)` updates `item.status` and renders. The card gets `.is-processing` / `.is-done` / `.is-failed` modifiers that adjust its left border accent. The progress bar is hidden unless the status is `writing` or `converting`.

**Duplicate detection** — `(name, size)` match against any existing queue item flags the new card with a `--warn`-coloured badge and i18n tooltip. Items are still queued and processed normally; the badge is informational only.

**Remove** — The `✕` button is disabled if the card is processing OR is the current edit target. Pending, done, and failed (non-edit-target) items can all be removed; the handler revokes blob URLs and splices `queue`.

**Concurrent control** — `running` is `true` for the duration of `startAll()`. While running, the Convert button is disabled. New drops are still accepted and processed in the same batch.

**i18n** — `STRINGS['zh-Hant' | 'en']` keyed by short identifier; initial choice is `localStorage.codecraft.lang` or `navigator.language.startsWith('zh') ? 'zh-Hant' : 'en'`. `applyLang()` walks `[data-i18n]` for `textContent` and `[data-i18n-title]` for `title`; dynamic strings (per-card status / summary, download links, dup badge) are re-rendered from stored state on language switch. The sidebar widget is also re-rendered after a language switch so per-target quality labels follow the chosen language; during edit mode the rebuild preserves the editing context. Toast suggestion separator switches between `、` (zh-Hant) and `, ` (en). Pill labels (`"WebM → GIF"` etc.) are universal across languages and computed from `SOURCE_LABEL[source]` + `TARGET_LABEL[target]`.

**Page footer** — Single horizontal bar (wraps on narrow) with a privacy tagline ("純本機 ffmpeg.wasm · 高隱私" / "Pure-local ffmpeg.wasm · privacy-first") on the left and inline credit + sponsor links (`Howar31` profile, `GitHub` repo, the sponsor page, `Ko-fi`) on the right. Sponsor page → `donate.howar31.com` (primary; heart mark + i18n label `footer_page` = 贊助 / Sponsor; hover `#B4532C`); Ko-fi → `ko-fi.com/howar31` (hover `#FF5E5B`). CSS classes are `.page-link` / `.kofi-link` (with a shared `.support-link`) and the i18n key is `footer_page` — deliberately no `sponsor` / `donate` words in any DOM-reaching identifier so adblock cosmetic filters don't hide the CTAs. Mark and colour come from the `accept-donations` skill → `references/sponsor-mark.md`; the adblock rule is in the same skill.

## PWA / offline

`public/manifest.webmanifest` declares the app installable with `display: standalone`, `start_url: "./"`, `scope: "./"` (both relative to the manifest URL → `/codecraft/`), `theme_color` / `background_color` = `#0f1117`, and four icons (favicon.svg "any" + 192/512 PNG "any" + 512 PNG "maskable"). `index.html` `<head>` carries `rel=icon` SVG + 32 px PNG fallback, `rel=apple-touch-icon`, `rel=manifest`, and `<meta name="theme-color" content="#0f1117">`.

The maskable variant uses `public/icon-maskable.svg`, which is full-bleed (no rounded corners) with the mosaic scaled to fit the inner ~80 % safe zone so Android's circle/squircle masks don't clip the design.

`public/sw.js` is registered from `main.js`'s boot block (after the rest of the app initializes):

```js
navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
```

Registration is wrapped in `'serviceWorker' in navigator` and `window.addEventListener('load', …)` so it doesn't compete with first-paint work. Errors are logged via `console.warn` but never block the app.

**Caching strategies:**

- **`unpkg.com/@ffmpeg/core@*` (cross-origin, version-pinned URL):** cache-first, indefinite. The URL is locked to `@0.12.6` in `main.js`, so cache hits are provably the same bytes as a network fetch — no risk of staleness. Saves the ~30 MB wasm + glue code download on every subsequent visit and enables offline conversion.
- **Same-origin app shell:** stale-while-revalidate. The install handler pre-caches only a minimal bootstrap (`./`, `./manifest.webmanifest`, `./favicon.svg`); everything else (Vite's hashed JS/CSS bundles, icons) is cached opportunistically the first time it's requested. This avoids the impossibility of pre-listing Vite's hashed asset names at SW source time.

**Cache versioning:** a single `VERSION` constant (`codecraft-v1`) prefixes both cache names (`<VERSION>-shell`, `<VERSION>-core`). The `activate` handler deletes any cache whose key doesn't start with the current `VERSION`. Bumping `VERSION` is the safe nuke-and-rebuild knob for any SW-related issue.

**Icon generation:** the two SVGs (`favicon.svg`, `icon-maskable.svg`) are the source of truth. The five PNG variants (favicon-32, apple-touch 180, icon-192/512, icon-maskable-512) are rendered locally via `rsvg-convert`; they are committed to `public/` and not regenerated as part of `npm run build`.

## Conventions

- Code comments: English.
- AI-facing docs (`CLAUDE.md`, `SPEC.md`): English. README is human-facing and bilingual (zh-Hant + en).
- Commits: Conventional Commits (`feat:`, `fix:`, `docs:`, `ci:`, `chore:`, ...). One commit per feature.
- Do not add COOP/COEP headers (see Architecture).
- Do not switch the core URL away from `/dist/esm` (see Key Decisions).
- For new conversion pairs: extend `PILLS` and add a `${source}->${target}` branch in `processOne`. The two new branches added in the workbench refactor (`webm->apng`, `apng->webm`) reuse the existing APNG-mux and libvpx VP8 recipes.
- For new operations (trim / crop / mute / …): introduce a parallel registry; do not overload `PILLS`'s `source→target` semantics.

## Verification

- **Manual:** `npm run dev`, navigate pills via the top bar or `#/<pill-id>` hash, drop sample files (or click-to-pick), verify queue cards carry per-card opts snapshots and the sidebar's persistence survives reloads.
- **Puppeteer (ad hoc):** `/tmp/codecraft-verify*.js` scripts driven by `headless: 'new'` exercise pill routing, snapshot independence, edit-mode focus mask, cross-pill edit, auto-switch behavior, drop-blocking during edit, and toast positioning. Frame capture for the hero gif uses CDP `Page.captureScreenshot` in a fixed-interval loop, then `ffmpeg` palettegen + paletteuse to produce `docs/hero.gif`.
- **Alpha caveat:** `webm-to-apng` and `apng-to-webm` have not been runtime-tested with transparency-bearing samples. Alpha may be lost through libvpx VP8 in single-threaded ffmpeg.wasm 0.12.
- **PWA smoke test:** in `npm run preview` (or the built deployment), open Chrome DevTools → Application → Manifest (icons + theme-color render correctly), Service Workers (sw.js is activated), then toggle Network → Offline + reload (app shell loads from cache). After one online conversion, `unpkg.com/@ffmpeg/core@*` entries should appear under the Cache Storage section.
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
- **First-load weight:** ~30 MB ffmpeg-core download from unpkg on first conversion; subsequent loads served from the SW cache (after one online visit).
- **First visit requires network:** the service worker can only cache assets it has actually seen. The app shell is cached during the first navigation; ffmpeg-core is cached during the first conversion. Truly first-time-on-this-device usage is online-only.
- **Serial batch:** single ffmpeg instance means queued conversions run strictly one at a time.
- **No editing:** no trim, crop, or filters beyond `fps` / `scale`. The architecture reserves space for such tools as additional non-pill registries.
- **Multi-target output dropped:** the previous "one drop → both WebM and APNG" affordance is gone. Users now convert from two pills, or use ✎ Duplicate to fan out from one card.
- **No multi-threaded ffmpeg.wasm:** intentional — would require `SharedArrayBuffer` and therefore COOP/COEP, which complicates GH Pages and conflicts with the unpkg fetch.
- **Alpha through WebM↔APNG:** unverified. VP8 alpha in single-threaded ffmpeg.wasm 0.12 may not survive round-trips; transparent stickers may flatten to a solid background.
- **FPS dropdown caps at 50** because GIF spec stores delays in 1/100 s (so 100 fps is the theoretical max, ~50 fps the practical browser ceiling); requesting more would only duplicate frames.
- **Duplicate fingerprint is `(name, size)`** — quick and good enough for "user re-dragged the same file"; not a true byte-level hash.

## Key decisions

- **Workbench framing.** The project is positioned as a codec workbench rather than a single-purpose converter. `PILLS` is the conversion-tool registry; future non-conversion tools (trim, crop, mute, frame export) are expected to live in a parallel registry. README, CLAUDE.md, and SPEC.md align on this product axis.
- **One pill per conversion** instead of source-detected multi-target. The earlier design surfaced FPS/Width/Loop/Quality as a single global panel and let a GIF fan out to WebM + APNG via per-card chips. That created two kinds of conflict: (1) Loop is silently meaningless when the output is WebM; (2) the "Quality" radio meant three different things depending on which target the user had selected. Splitting by pill makes each view's options unambiguous and lets the labels be target-specific (palette accuracy / CRF / encoder effort). Multi-target is sacrificed; the ✎ Duplicate flow plus per-pill batching cover the realistic use cases.
- **Snapshot opts at drop instead of late-binding to a global panel.** Each card carries its own `opts` object set at the moment it joined the queue. The sidebar describes "what new drops will use" — changing it doesn't mutate past cards. This matches the mental model of batch encoders (HandBrake, Compressor) and survives multi-batch workflows where the user changes settings between drops.
- **Sidebar takes over as the edit surface.** Rather than building a duplicate edit panel inside each card, ✎ rebinds the existing sidebar widget to the target card's opts and dims everything else. One widget, one CSS path; new opts fields are added in one place (`buildOptsControls`).
- **Auto-switch on wrong-source drop**, gated to single-source batches. Toast UX requires the user to click the right pill manually; an auto-switch is more direct when the user's intent is unambiguous. Mixed batches keep the per-file warn path to avoid surprise.
- **Per-source last-pill memory** (`codecraft.last_pill_by_source`). When auto-switching, prefer the user's last pill for that source over `PILLS_BY_SOURCE[source][0]`. A user who tends to convert GIFs to APNG shouldn't be silently routed to GIF→WebM just because it's first in the array.
- **ESM core build over UMD.** Vite spawns ffmpeg's worker with `type: "module"`. The library's fallback (`importScripts` → dynamic `import()`) only succeeds if the URL it imports actually exports a default. The UMD build does not; the ESM build does. Verified by reading `@ffmpeg/ffmpeg/dist/esm/worker.js`.
- **VP8 (libvpx) over VP9 for `*-to-webm`.** `libvpx-vp9` in ffmpeg.wasm 0.12 single-threaded crashes with `RuntimeError: memory access out of bounds` on the first encoded frame regardless of input size (the wasm build is `--disable-pthreads`; VP9's C path is unstable). VP8's older encoder is rock-solid in the same build and still produces small WebM files (~12× compression vs source GIF in practice). Revisit if/when ffmpeg.wasm ships a stable VP9-capable core.
- **Drop COOP/COEP.** Single-threaded mode doesn't need them. They additionally break the unpkg fetch because unpkg's response lacks Cross-Origin-Resource-Policy.
- **unpkg over self-hosted core.** Saves repo size and lets the browser HTTP cache amortise the 30 MB cost across visits.
- **`peaceiris/actions-gh-pages` over `actions/deploy-pages`.** Simpler config; uses the classic `gh-pages` branch model rather than the new Pages artifact pipeline.
- **Viewport-fit layout with queue-only scroll.** Header, pills, sidebar, and footer all stay visible; only the queue list scrolls. This keeps the active controls reachable regardless of how many cards have accumulated, replacing the older `position: sticky` controls-pane trick. Reverts to natural block flow on narrow screens.
- **Toast at top-center.** The previous bottom-right placement collided with the page-footer area and went unnoticed when the queue was busy. Top-center is in the natural eye-path and doesn't conflict with the top-right lang-switch.
- **Window-level drag-anywhere over per-zone drag.** Long queues used to push the visible drop-zone off-screen; routing every drop through `document` listeners keeps the affordance reachable, with a full-screen overlay as the indicator. Both the overlay and the drag handlers themselves are guarded against the edit-mode state.
- **FileList snapshot before async work.** Both `input.files` (when the input value is reset) and `dataTransfer.files` (after the sync handler exits) can be cleared mid-iteration by the browser; copying to an Array before yielding to async preserves the input.
- **Cache-first for ffmpeg-core, stale-while-revalidate for app shell.** The unpkg URL is version-pinned to `@0.12.6`, so cache-first will never serve stale bytes — a cache hit is provably identical to a fresh network fetch. The app shell uses hashed Vite filenames that change every build, so SWR (with on-the-fly caching on first request) is both correct and avoids the impossibility of pre-listing hash names at SW source time. The combination delivers true offline after one online visit without any build-time SW codegen.
- **No vite-plugin-pwa.** The hand-rolled SW is ~70 lines and avoids a build-time dependency that would otherwise need to enumerate `dist/` assets to produce a precache manifest. The runtime SWR approach is simpler and equally offline-capable after the first visit.
- **Favicon source is SVG; PNG variants generated locally.** Modern browsers all support SVG favicons; PNG variants exist for legacy fallback (favicon-32), iOS (apple-touch-icon 180), and PWA manifest (icon-192/512 "any" + icon-maskable-512 from a separate full-bleed SVG). They are committed to `public/` and not regenerated by the Vite build — bumping the design means re-running `rsvg-convert` and committing the new PNGs.
- **Mosaic favicon design.** Four-by-four grid of `#7c9eff` (accent) tiles with varied opacity (1.0 / 0.7 / 0.6 / 0.4 / 0.3 / 0.2) over the dark surface (`#1a1e27`). Conveys pixel / quantization / codec essence without locking the brand to a specific operation (conversion vs trim vs crop), which matches the workbench framing.
- **`theme_color` = `#0f1117` (page background), not the accent.** A dark theme color keeps the system chrome (status bar, task switcher) integrated with the app's dark UI; using the accent would make the surrounding chrome blue and clash.
