import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// Use the ESM build because Vite spawns module workers; the library's fallback
// path (`import(coreURL)` after `importScripts` fails) only works with ESM core.
const FFMPEG_CORE_BASE = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';

// ---------- i18n ----------

const STRINGS = {
  'zh-Hant': {
    subtitle: 'WebM · GIF · APNG · 瀏覽器內互轉',
    drop_title: '拖曳 .webm / .gif / .apng / .png 到這裡',
    drop_hint: '或點擊選擇',
    label_fps: 'FPS',
    label_width: '寬度 (px)',
    label_loop: '無限循環播放',
    opt_auto: '依來源',
    opt_original: '原寬',
    quality_legend: '輸出品質',
    quality_high: '高品質（palette）',
    quality_normal: '一般',
    default_outputs_label: 'GIF 輸出',
    default_outputs_hint: '套用到所有尚未轉換的 GIF；個別檔案仍可在右邊調整',
    remove_tooltip: '從佇列移除',
    start_button: '開始轉換',
    results_heading: '佇列',
    footer: '大檔案建議在桌機使用，首次載入 ffmpeg-core 約 30 MB。',
    status_queued: '等待中',
    status_writing: '寫入檔案',
    status_converting: '轉換中',
    status_done: '完成',
    status_failed: '失敗',
    load_progress: '載入 ffmpeg 中… (~30 MB)',
    load_failed: '載入失敗',
    download: '下載',
    size_warning: '> 5 MB，部分平台（X、Discord 等）可能無法上傳或會自動轉檔',
    duplicate: '重複',
    duplicate_hint: '同名同大小的檔案已在清單中，仍會照轉',
    drop_overlay: '放開以加入轉換清單',
  },
  en: {
    subtitle: 'WebM · GIF · APNG · in-browser conversion',
    drop_title: 'Drop .webm / .gif / .apng / .png here',
    drop_hint: 'or click to select',
    label_fps: 'FPS',
    label_width: 'Width (px)',
    label_loop: 'Loop infinitely',
    opt_auto: 'Auto',
    opt_original: 'Original',
    quality_legend: 'Output quality',
    quality_high: 'High (palette)',
    quality_normal: 'Normal',
    default_outputs_label: 'GIF outputs',
    default_outputs_hint: 'Applies to all pending GIFs; individual cards can still override',
    remove_tooltip: 'Remove from queue',
    start_button: 'Convert',
    results_heading: 'Queue',
    footer: 'Use desktop for large files; first load downloads ~30 MB ffmpeg-core.',
    status_queued: 'Queued',
    status_writing: 'Writing',
    status_converting: 'Converting',
    status_done: 'Done',
    status_failed: 'Failed',
    load_progress: 'Loading ffmpeg… (~30 MB)',
    load_failed: 'Load failed',
    download: 'Download',
    size_warning: 'Over 5 MB — some platforms (X, Discord, etc.) may reject or transcode',
    duplicate: 'Duplicate',
    duplicate_hint: 'A file with the same name and size is already queued; this one will still be converted',
    drop_overlay: 'Drop to add files',
  },
};

const LS_KEY = 'codecraft.lang';
const SUPPORTED_LANGS = ['zh-Hant', 'en'];

function detectInitialLang() {
  const saved = localStorage.getItem(LS_KEY);
  if (saved && SUPPORTED_LANGS.includes(saved)) return saved;
  const nav = (navigator.language || 'en').toLowerCase();
  return nav.startsWith('zh') ? 'zh-Hant' : 'en';
}

let currentLang = detectInitialLang();
function t(key) {
  return STRINGS[currentLang]?.[key] ?? STRINGS.en[key] ?? key;
}

function applyLang() {
  document.documentElement.lang = currentLang;
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of document.querySelectorAll('[data-i18n-title]')) {
    el.title = t(el.dataset.i18nTitle);
  }
  for (const btn of document.querySelectorAll('.lang-switch [data-lang]')) {
    btn.classList.toggle('active', btn.dataset.lang === currentLang);
  }
  for (const item of queue) {
    for (const target of item.selected) renderOutputStatus(item, target);
  }
  if (els.loadStatus.dataset.key) {
    els.loadStatus.textContent = renderLoadStatus(els.loadStatus.dataset.key, els.loadStatus.dataset.extra);
  }
}

function setLoadStatus(key, extra) {
  if (!key) {
    els.loadStatus.textContent = '';
    delete els.loadStatus.dataset.key;
    delete els.loadStatus.dataset.extra;
    return;
  }
  els.loadStatus.dataset.key = key;
  if (extra) els.loadStatus.dataset.extra = extra;
  else delete els.loadStatus.dataset.extra;
  els.loadStatus.textContent = renderLoadStatus(key, extra);
}

function renderLoadStatus(key, extra) {
  const base = t(key);
  return extra ? `${base}: ${extra}` : base;
}

// ---------- ffmpeg ----------

const ffmpeg = new FFmpeg();
let ffmpegLoaded = false;
let currentOutput = null;  // { item, target } — routes progress events
let running = false;

const els = {
  dropZone: document.getElementById('drop-zone'),
  fileInput: document.getElementById('file-input'),
  fps: document.getElementById('fps'),
  width: document.getElementById('width'),
  loop: document.getElementById('loop'),
  qualityHigh: document.getElementById('quality-high'),
  startBtn: document.getElementById('start-btn'),
  results: document.getElementById('results'),
  loadStatus: document.getElementById('load-status'),
};

const queue = [];

ffmpeg.on('progress', ({ progress }) => {
  if (!currentOutput) return;
  const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
  setStatus(currentOutput.item, currentOutput.target, 'converting', pct);
});

async function ensureLoaded() {
  if (ffmpegLoaded) return;
  setLoadStatus('load_progress');
  await ffmpeg.load({
    coreURL: await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  ffmpegLoaded = true;
  setLoadStatus(null);
}

// ---------- format detection ----------

// Source → available output targets. Add new entries here to support more
// format pairs; processOne() switches on the (source, target) pair.
const SOURCE_TARGETS = {
  webm: ['gif'],
  gif: ['webm', 'apng'],
  apng: ['gif'],
};

const TARGET_LABEL = { gif: 'GIF', webm: 'WebM', apng: 'APNG' };
const TARGET_MIME = { gif: 'image/gif', webm: 'video/webm', apng: 'image/apng' };

// ---------- default GIF targets (applies to new uploads + pending items) ----------

const LS_DEFAULT_GIF = 'codecraft.default_gif_targets';
let defaultGifTargets = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_DEFAULT_GIF) || '');
    if (Array.isArray(saved) && saved.length > 0) {
      return saved.filter((t) => SOURCE_TARGETS.gif.includes(t));
    }
  } catch {}
  return [SOURCE_TARGETS.gif[0]];
})();

// .png needs byte-level sniffing — APNG and static PNG share the extension.
async function detectSource(file) {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.webm')) return 'webm';
  if (lower.endsWith('.gif')) return 'gif';
  if (lower.endsWith('.apng')) return 'apng';
  if (lower.endsWith('.png')) return (await isAPNG(file)) ? 'apng' : null;
  return null;
}

// APNG has an `acTL` chunk that must appear before the first `IDAT`. Scan
// the first 64 KB; stop early at IDAT.
async function isAPNG(file) {
  const slice = file.slice(0, Math.min(file.size, 65536));
  const b = new Uint8Array(await slice.arrayBuffer());
  for (let i = 8; i + 4 <= b.length; i++) {
    if (b[i] === 0x61 && b[i+1] === 0x63 && b[i+2] === 0x54 && b[i+3] === 0x4C) return true;
    if (b[i] === 0x49 && b[i+1] === 0x44 && b[i+2] === 0x41 && b[i+3] === 0x54) return false;
  }
  return false;
}

// Probe source media to get intrinsic dimensions for a row hint. Images use
// <img>.naturalWidth, video uses <video>.videoWidth after `loadedmetadata`.
function probeDimensions(file, source) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const cleanup = () => URL.revokeObjectURL(url);
    if (source === 'webm') {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => {
        const r = { w: v.videoWidth, h: v.videoHeight };
        cleanup();
        resolve(r);
      };
      v.onerror = () => { cleanup(); resolve(null); };
      v.src = url;
    } else {
      const img = new Image();
      img.onload = () => {
        const r = { w: img.naturalWidth, h: img.naturalHeight };
        cleanup();
        resolve(r);
      };
      img.onerror = () => { cleanup(); resolve(null); };
      img.src = url;
    }
  });
}

// ---------- queue + rendering ----------

function newOutput() {
  return {
    status: 'pending',
    statusKey: 'queued',
    statusPct: null,
    statusExtra: null,
    blobUrl: null,
    row: null,
  };
}

async function addFiles(files) {
  for (const f of files) {
    const source = await detectSource(f);
    if (!source) continue;
    const targets = SOURCE_TARGETS[source];
    // GIF source picks up the user's global default (which can include multiple
    // targets); single-target sources fall back to their only available target.
    const initial = source === 'gif'
      ? defaultGifTargets.filter((t) => targets.includes(t))
      : [targets[0]];
    if (initial.length === 0) initial.push(targets[0]);
    const duplicate = queue.some((it) => it.file.name === f.name && it.file.size === f.size);
    const outputs = {};
    for (const t of initial) outputs[t] = newOutput();
    const item = {
      file: f,
      source,
      targets,
      selected: initial.slice(),
      outputs,
      dims: null,
      duplicate,
      card: null,
      outputsContainer: null,
    };
    queue.push(item);
    renderCard(item);
    probeDimensions(f, source).then((dims) => {
      if (!dims || !item.card) return;
      item.dims = dims;
      item.card.querySelector('.source-dims').textContent = `${dims.w}×${dims.h}`;
    });
  }
  updateStartBtn();
}

function renderCard(item) {
  const card = document.createElement('div');
  card.className = 'source-card';
  const multi = item.targets.length > 1;
  card.innerHTML = `
    <div class="source-header">
      <span class="filename"></span>
      <span class="source-dims"></span>
      ${item.duplicate ? `<span class="dup-badge" data-i18n="duplicate" data-i18n-title="duplicate_hint"></span>` : ''}
      <div class="header-right">
        ${multi ? `<div class="target-chips" role="group"></div>` : ''}
        <button type="button" class="remove-btn" data-i18n-title="remove_tooltip" aria-label="remove">×</button>
      </div>
    </div>
    <div class="outputs"></div>
  `;
  card.querySelector('.filename').textContent = item.file.name;
  const dupEl = card.querySelector('.dup-badge');
  if (dupEl) {
    dupEl.textContent = t('duplicate');
    dupEl.title = t('duplicate_hint');
  }
  const removeBtn = card.querySelector('.remove-btn');
  removeBtn.title = t('remove_tooltip');
  removeBtn.addEventListener('click', () => removeItem(item));

  if (multi) {
    const chipBox = card.querySelector('.target-chips');
    for (const target of item.targets) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.dataset.target = target;
      chip.textContent = TARGET_LABEL[target];
      chip.classList.toggle('active', item.selected.includes(target));
      chip.addEventListener('click', () => toggleTarget(item, target, chip));
      chipBox.appendChild(chip);
    }
  }

  item.card = card;
  item.outputsContainer = card.querySelector('.outputs');
  els.results.appendChild(card);
  for (const target of item.selected) renderOutputRow(item, target);
}

function renderOutputRow(item, target) {
  const row = document.createElement('div');
  row.className = 'output-row';
  row.dataset.target = target;
  row.innerHTML = `
    <span class="target-arrow">→</span>
    <span class="target-label"></span>
    <span class="status"></span>
    <span class="action"></span>
    <div class="progress"><div class="bar"></div></div>
    <div class="preview"></div>
  `;
  row.querySelector('.target-label').textContent = TARGET_LABEL[target];
  item.outputs[target].row = row;
  item.outputsContainer.appendChild(row);
  renderOutputStatus(item, target);
}

function toggleTarget(item, target, chip) {
  if (running) return;
  const has = item.selected.includes(target);
  if (has) {
    if (item.selected.length === 1) return;  // never empty
    removeOutput(item, target);
    chip.classList.remove('active');
  } else {
    addOutput(item, target);
    chip.classList.add('active');
  }
  updateStartBtn();
}

function addOutput(item, target) {
  if (item.selected.includes(target)) return;
  item.selected.push(target);
  item.outputs[target] = newOutput();
  renderOutputRow(item, target);
}

function removeOutput(item, target) {
  const out = item.outputs[target];
  if (out?.blobUrl) URL.revokeObjectURL(out.blobUrl);
  out?.row?.remove();
  delete item.outputs[target];
  item.selected = item.selected.filter((tg) => tg !== target);
}

function isItemRemovable(item) {
  return !Object.values(item.outputs).some((o) => o.status === 'processing');
}

function removeItem(item) {
  if (!isItemRemovable(item)) return;
  for (const out of Object.values(item.outputs)) {
    if (out.blobUrl) URL.revokeObjectURL(out.blobUrl);
  }
  const i = queue.indexOf(item);
  if (i >= 0) queue.splice(i, 1);
  item.card?.remove();
  updateStartBtn();
}

// Propagate the global default to all queued GIF items that haven't been
// touched yet (no output is processing or done). Done items keep their
// produced blobs; pending items get re-synced to match the new default.
function setDefaultGifTargets(targets) {
  defaultGifTargets = targets.slice();
  localStorage.setItem(LS_DEFAULT_GIF, JSON.stringify(defaultGifTargets));
  for (const btn of document.querySelectorAll('[data-default-target]')) {
    btn.classList.toggle('active', targets.includes(btn.dataset.defaultTarget));
  }
  for (const item of queue) {
    if (item.source !== 'gif') continue;
    if (Object.values(item.outputs).some((o) => o.status === 'done' || o.status === 'processing')) continue;
    syncItemSelected(item, targets);
  }
  updateStartBtn();
}

function syncItemSelected(item, newTargets) {
  if (newTargets.length === 0) return;
  const toRemove = item.selected.filter((tg) => !newTargets.includes(tg));
  const toAdd = newTargets.filter((tg) => !item.selected.includes(tg));
  for (const tg of toRemove) removeOutput(item, tg);
  for (const tg of toAdd) addOutput(item, tg);
  if (item.card) {
    for (const chip of item.card.querySelectorAll('.target-chips .chip')) {
      chip.classList.toggle('active', item.selected.includes(chip.dataset.target));
    }
  }
}

function setStatus(item, target, key, pct, extra) {
  const out = item.outputs[target];
  if (!out) return;
  out.statusKey = key;
  if (pct !== undefined) out.statusPct = pct;
  out.statusExtra = extra ?? null;
  renderOutputStatus(item, target);
  // Re-evaluate the remove button — going into 'processing' disables it,
  // leaving 'processing' re-enables it.
  const btn = item.card?.querySelector('.remove-btn');
  if (btn) btn.disabled = !isItemRemovable(item);
}

function renderOutputStatus(item, target) {
  const out = item.outputs[target];
  if (!out || !out.row) return;
  let text = t(`status_${out.statusKey}`);
  if (out.statusKey === 'converting' && out.statusPct != null) {
    text += ` ${out.statusPct}%`;
  } else if (out.statusKey === 'failed' && out.statusExtra) {
    text += `: ${out.statusExtra}`;
  }
  out.row.querySelector('.status').textContent = text;
  if (out.statusPct != null) {
    out.row.querySelector('.bar').style.width = `${out.statusPct}%`;
  }
}

function setDownload(item, target, blob, sizeBytes, loop) {
  const out = item.outputs[target];
  if (!out || !out.row) return;
  if (out.blobUrl) URL.revokeObjectURL(out.blobUrl);
  const url = URL.createObjectURL(blob);
  out.blobUrl = url;
  const outName = item.file.name.replace(/\.(webm|gif|apng|png)$/i, `.${target}`);
  const sizeMB = sizeBytes / 1024 / 1024;
  const action = out.row.querySelector('.action');
  action.innerHTML = '';
  const a = document.createElement('a');
  a.href = url;
  a.download = outName;
  a.textContent = t('download');
  a.dataset.i18nDownload = '1';
  const size = document.createElement('span');
  size.className = 'size';
  size.textContent = ` ${sizeMB.toFixed(2)} MB`;
  action.appendChild(a);
  action.appendChild(size);
  if (sizeBytes > 5 * 1024 * 1024) {
    const w = document.createElement('span');
    w.className = 'size-warn';
    w.textContent = '⚠';
    w.dataset.i18nTitle = 'size_warning';
    w.title = t('size_warning');
    size.appendChild(w);
  }

  const preview = out.row.querySelector('.preview');
  preview.innerHTML = '';
  if (target === 'webm') {
    const v = document.createElement('video');
    v.src = url;
    v.controls = true;
    v.loop = loop !== false;
    v.muted = true;
    v.autoplay = true;
    v.playsInline = true;
    preview.appendChild(v);
  } else {
    const img = document.createElement('img');
    img.src = url;
    img.alt = outName;
    preview.appendChild(img);
  }

  setStatus(item, target, 'done', 100);
}

// ---------- conversion ----------

function buildFilters(opts, forVP8) {
  const filters = [];
  if (opts.fps) filters.push(`fps=${opts.fps}`);
  // VP8 in WebM is happiest with even dimensions; mirror what we did for the
  // (now-disabled) VP9 path for safety.
  const heightArg = forVP8 ? '-2' : '-1';
  if (opts.width) {
    filters.push(`scale=${opts.width}:${heightArg}:flags=lanczos`);
  } else if (forVP8) {
    filters.push(`scale=iw:-2:flags=lanczos`);
  }
  return filters;
}

async function processOne(item, target, opts) {
  const inputName = `input.${item.source}`;
  const outputName = `output.${target}`;
  const paletteName = 'palette.png';

  currentOutput = { item, target };
  setStatus(item, target, 'writing', 0);
  await ffmpeg.writeFile(inputName, await fetchFile(item.file));

  try {
    const pair = `${item.source}->${target}`;
    const filters = buildFilters(opts, target === 'webm');
    const filterStr = filters.join(',');

    if (pair === 'webm->gif' || pair === 'apng->gif') {
      const loopArg = opts.loop ? '0' : '-1';
      if (opts.quality === 'high') {
        const pgFilter = [...filters, 'palettegen=stats_mode=full'].join(',');
        await ffmpeg.exec(['-i', inputName, '-vf', pgFilter, paletteName]);
        const puPrefix = filters.length ? `${filterStr} [x]; [x][1:v]` : '[0:v][1:v]';
        await ffmpeg.exec([
          '-i', inputName,
          '-i', paletteName,
          '-lavfi', `${puPrefix} paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
          '-loop', loopArg,
          outputName,
        ]);
      } else {
        const args = ['-i', inputName];
        if (filterStr) args.push('-vf', filterStr);
        args.push('-loop', loopArg, outputName);
        await ffmpeg.exec(args);
      }
    } else if (pair === 'gif->webm') {
      // VP8 in CRF-with-soft-cap mode. ffmpeg.wasm 0.12 single-threaded
      // crashes inside libvpx-vp9, so we use libvpx (VP8) which is stable.
      const crf = opts.quality === 'high' ? '10' : '24';
      await ffmpeg.exec([
        '-i', inputName,
        '-vf', filterStr,
        '-c:v', 'libvpx',
        '-quality', 'good',
        '-cpu-used', '0',
        '-crf', crf,
        '-b:v', '1M',
        '-pix_fmt', 'yuv420p',
        outputName,
      ]);
    } else if (pair === 'gif->apng') {
      const args = ['-i', inputName];
      if (filterStr) args.push('-vf', filterStr);
      args.push('-plays', opts.loop ? '0' : '1', '-f', 'apng');
      if (opts.quality === 'high') args.push('-pred', 'mixed', '-compression_level', '9');
      args.push(outputName);
      await ffmpeg.exec(args);
    } else {
      throw new Error(`unsupported conversion: ${pair}`);
    }

    const data = await ffmpeg.readFile(outputName);
    const blob = new Blob([data.buffer], { type: TARGET_MIME[target] });
    setDownload(item, target, blob, data.byteLength, opts.loop);
  } catch (err) {
    setStatus(item, target, 'failed', 0, err.message || String(err));
    throw err;
  } finally {
    currentOutput = null;
    for (const name of [inputName, paletteName, outputName]) {
      try { await ffmpeg.deleteFile(name); } catch {}
    }
  }
}

function hasPendingWork(item) {
  return item.selected.some((tg) => {
    const s = item.outputs[tg]?.status;
    return s !== 'done' && s !== 'processing';
  });
}

function updateStartBtn() {
  if (running) {
    els.startBtn.disabled = true;
  } else {
    els.startBtn.disabled = !queue.some(hasPendingWork);
  }
  for (const chip of document.querySelectorAll('.target-chips .chip, [data-default-target]')) {
    chip.disabled = running;
  }
  for (const item of queue) {
    const btn = item.card?.querySelector('.remove-btn');
    if (btn) btn.disabled = !isItemRemovable(item);
  }
}

async function startAll() {
  if (running) return;
  running = true;
  els.startBtn.disabled = true;
  for (const chip of document.querySelectorAll('.target-chips .chip')) chip.disabled = true;
  try {
    try {
      await ensureLoaded();
    } catch (err) {
      setLoadStatus('load_failed', err?.message || String(err));
      return;
    }
    const opts = {
      fps: parsePositiveIntOrNull(els.fps.value),
      width: parsePositiveIntOrNull(els.width.value),
      loop: els.loop.checked,
      quality: els.qualityHigh.checked ? 'high' : 'normal',
    };
    // Outer for-of on Array re-reads .length each step, so files added
    // mid-run are picked up automatically. Same for the inner selected loop.
    for (const item of queue) {
      for (const target of item.selected) {
        const out = item.outputs[target];
        if (!out || out.status === 'done' || out.status === 'processing') continue;
        out.status = 'processing';
        try {
          await processOne(item, target, opts);
          out.status = 'done';
        } catch {
          out.status = 'failed';
        }
      }
    }
  } finally {
    running = false;
    updateStartBtn();
  }
}

function parsePositiveIntOrNull(v) {
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) || n <= 0 ? null : n;
}

// ---------- events ----------

els.dropZone.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', (e) => {
  // Snapshot FileList before clearing the input value — addFiles is async and
  // the for-of loop will see an empty FileList once we reset .value, dropping
  // every file after the first.
  const files = Array.from(e.target.files);
  e.target.value = '';
  addFiles(files);
});
els.startBtn.addEventListener('click', startAll);

// Window-level drag-anywhere. A dragenter/leave counter prevents flicker as
// the dragged file crosses descendant boundaries inside the page.
const dropOverlay = document.getElementById('drop-overlay');
let dragDepth = 0;
function isFileDrag(e) {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  for (let i = 0; i < types.length; i++) if (types[i] === 'Files') return true;
  return false;
}
document.addEventListener('dragenter', (e) => {
  if (!isFileDrag(e)) return;
  dragDepth++;
  if (dragDepth === 1) dropOverlay.classList.add('active');
});
document.addEventListener('dragleave', (e) => {
  if (!isFileDrag(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropOverlay.classList.remove('active');
});
document.addEventListener('dragover', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();  // required to allow drop
});
document.addEventListener('drop', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.classList.remove('active');
  // Snapshot before yielding to the async pipeline — DataTransfer is only
  // guaranteed to live for the duration of the synchronous handler.
  const files = Array.from(e.dataTransfer.files);
  addFiles(files);
});

for (const btn of document.querySelectorAll('.lang-switch [data-lang]')) {
  btn.addEventListener('click', () => {
    const next = btn.dataset.lang;
    if (next === currentLang || !SUPPORTED_LANGS.includes(next)) return;
    currentLang = next;
    localStorage.setItem(LS_KEY, currentLang);
    applyLang();
    for (const a of document.querySelectorAll('.action a[data-i18n-download]')) {
      a.textContent = t('download');
    }
  });
}

// Default GIF outputs chip group — drives both new uploads and propagation
// to already-pending GIF items.
for (const btn of document.querySelectorAll('[data-default-target]')) {
  btn.classList.toggle('active', defaultGifTargets.includes(btn.dataset.defaultTarget));
  btn.addEventListener('click', () => {
    if (running) return;
    const target = btn.dataset.defaultTarget;
    const has = defaultGifTargets.includes(target);
    let next;
    if (has) {
      if (defaultGifTargets.length === 1) return;  // never empty
      next = defaultGifTargets.filter((t) => t !== target);
    } else {
      next = [...defaultGifTargets, target];
    }
    setDefaultGifTargets(next);
  });
}

applyLang();
