import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// Use the ESM build because Vite spawns module workers; the library's fallback
// path (`import(coreURL)` after `importScripts` fails) only works with ESM core.
const FFMPEG_CORE_BASE = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';

// ---------- conversion catalog ----------

const TARGET_LABEL = { gif: 'GIF', webm: 'WebM', apng: 'APNG' };
const SOURCE_LABEL = { gif: 'GIF', webm: 'WebM', apng: 'APNG' };
const TARGET_MIME = { gif: 'image/gif', webm: 'video/webm', apng: 'image/apng' };

const PILLS = [
  { id: 'webm-to-gif',  source: 'webm', target: 'gif',  showLoop: true  },
  { id: 'webm-to-apng', source: 'webm', target: 'apng', showLoop: true  },
  { id: 'gif-to-webm',  source: 'gif',  target: 'webm', showLoop: false },
  { id: 'gif-to-apng',  source: 'gif',  target: 'apng', showLoop: true  },
  { id: 'apng-to-gif',  source: 'apng', target: 'gif',  showLoop: true  },
  { id: 'apng-to-webm', source: 'apng', target: 'webm', showLoop: false },
];
const PILL_BY_ID = Object.fromEntries(PILLS.map((p) => [p.id, p]));
const PILLS_BY_SOURCE = PILLS.reduce((acc, p) => {
  (acc[p.source] ||= []).push(p);
  return acc;
}, {});

function pillLabel(p) { return `${SOURCE_LABEL[p.source]} → ${TARGET_LABEL[p.target]}`; }

// ---------- i18n ----------

const STRINGS = {
  'zh-Hant': {
    subtitle: '瀏覽器內 codec 工作台 · WebM / GIF / APNG 互轉',
    drop_title_webm: '拖曳 .webm 到這裡',
    drop_title_gif: '拖曳 .gif 到這裡',
    drop_title_apng: '拖曳 .apng 或 .png 到這裡',
    drop_hint: '或點擊選擇',
    label_fps: 'FPS',
    label_width: '寬度 (px)',
    label_loop: '無限循環播放',
    label_loop_hint: '寫入 GIF Netscape Loop Extension 或 APNG num_plays 欄位。',
    label_quality: '輸出品質',
    opt_auto: '依來源',
    opt_original: '原寬',
    q_to_gif_high: '精細取色（兩段 palette）',
    q_to_gif_normal: '快速取色',
    q_to_gif_high_hint: '先 palettegen 取得最佳色盤，再 paletteuse 套用。顏色明顯較準；檔案可能因抖動變大、編碼較慢。',
    q_to_gif_normal_hint: '使用 ffmpeg 預設單段 palette。顏色可能斷層，但檔案較小、編碼較快。',
    q_to_webm_high: '畫質優先（VP8 CRF 10）',
    q_to_webm_normal: '檔案優先（VP8 CRF 24）',
    q_to_webm_high_hint: 'libvpx VP8 CRF 10。畫面接近無損，檔案較大、編碼較慢。',
    q_to_webm_normal_hint: 'libvpx VP8 CRF 24。畫質可接受，檔案較小、編碼較快。',
    q_to_apng_high: '最小檔案（較慢）',
    q_to_apng_normal: '快速編碼',
    q_to_apng_high_hint: 'APNG 為 lossless 格式。-pred mixed + compression_level 9，輸出最小但編碼較慢。',
    q_to_apng_normal_hint: 'APNG 為 lossless 格式。預設 PNG 壓縮等級，編碼較快、檔案略大。',
    summary_fps: 'FPS {v}',
    summary_fps_auto: 'FPS 依來源',
    summary_width: '寬 {v}',
    summary_width_original: '原寬',
    summary_loop_on: '循環',
    summary_loop_off: '單次',
    remove_tooltip: '從佇列移除',
    edit_tooltip: '編輯設定',
    edit_context_label: '編輯：',
    edit_overwrite: '覆蓋本卡並重新轉換',
    edit_duplicate: '建立新卡加入佇列',
    edit_cancel: '取消',
    start_button: '開始轉換',
    results_heading: '佇列',
    results_empty: '佇列是空的。把檔案拖到左邊開始。',
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
    drop_overlay: '放開以加入佇列',
    toast_wrong_source: '這是 {detected} 檔。請切到「{suggestions}」。',
    toast_switched_to: '已切到「{name}」',
    toast_unsupported_format: '不支援這個格式：{filename}',
    footer_privacy: '純本機 ffmpeg.wasm · 高隱私',
  },
  en: {
    subtitle: 'In-browser codec workbench · WebM / GIF / APNG conversions',
    drop_title_webm: 'Drop .webm here',
    drop_title_gif: 'Drop .gif here',
    drop_title_apng: 'Drop .apng or .png here',
    drop_hint: 'or click to select',
    label_fps: 'FPS',
    label_width: 'Width (px)',
    label_loop: 'Loop infinitely',
    label_loop_hint: 'Writes the loop flag into the output (GIF Netscape Loop Extension / APNG num_plays).',
    label_quality: 'Output quality',
    opt_auto: 'Auto',
    opt_original: 'Original',
    q_to_gif_high: 'Accurate colors (two-pass palette)',
    q_to_gif_normal: 'Fast palette',
    q_to_gif_high_hint: 'Two-pass: palettegen builds an optimal palette, paletteuse applies it. Better colors; file may grow due to dithering and encoding is slower.',
    q_to_gif_normal_hint: 'Single-pass ffmpeg built-in palette. Colors may band; smaller file and faster encoding.',
    q_to_webm_high: 'Quality first (VP8 CRF 10)',
    q_to_webm_normal: 'Size first (VP8 CRF 24)',
    q_to_webm_high_hint: 'libvpx VP8 CRF 10. Near-lossless picture, larger file, slower encoding.',
    q_to_webm_normal_hint: 'libvpx VP8 CRF 24. Acceptable quality, smaller file, faster encoding.',
    q_to_apng_high: 'Smallest file (slower)',
    q_to_apng_normal: 'Fast encode',
    q_to_apng_high_hint: 'APNG is lossless. -pred mixed + compression_level 9 produces the smallest output but encodes slower.',
    q_to_apng_normal_hint: 'APNG is lossless. Default PNG compression level: faster encoding, slightly larger file.',
    summary_fps: 'FPS {v}',
    summary_fps_auto: 'FPS auto',
    summary_width: 'W {v}',
    summary_width_original: 'Original',
    summary_loop_on: 'Loop',
    summary_loop_off: 'Once',
    remove_tooltip: 'Remove from queue',
    edit_tooltip: 'Edit settings',
    edit_context_label: 'Editing:',
    edit_overwrite: 'Overwrite this card & re-encode',
    edit_duplicate: 'Add as a new card',
    edit_cancel: 'Cancel',
    start_button: 'Convert',
    results_heading: 'Queue',
    results_empty: 'Queue is empty. Drop a file on the left to start.',
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
    toast_wrong_source: 'That looks like a {detected} file. Switch to: {suggestions}.',
    toast_switched_to: 'Switched to {name}',
    toast_unsupported_format: 'Unsupported file format: {filename}',
    footer_privacy: 'Pure-local ffmpeg.wasm · privacy-first',
  },
};

const LS_LANG = 'codecraft.lang';
const LS_LAST_PILL = 'codecraft.last_pill';
const LS_LAST_PILL_BY_SOURCE = 'codecraft.last_pill_by_source';
const LS_OPTS_PREFIX = 'codecraft.opts.';
const SUPPORTED_LANGS = ['zh-Hant', 'en'];

function detectInitialLang() {
  const saved = localStorage.getItem(LS_LANG);
  if (saved && SUPPORTED_LANGS.includes(saved)) return saved;
  const nav = (navigator.language || 'en').toLowerCase();
  return nav.startsWith('zh') ? 'zh-Hant' : 'en';
}

let currentLang = detectInitialLang();
function t(key, vars) {
  let s = STRINGS[currentLang]?.[key] ?? STRINGS.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  }
  return s;
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
  renderPillBar();
  if (activePillId) updateDropTitle();
  for (const item of queue) renderCardI18n(item);
  if (els.loadStatus.dataset.key) {
    els.loadStatus.textContent = renderLoadStatus(els.loadStatus.dataset.key, els.loadStatus.dataset.extra);
  }
  renderEmptyQueueHint();
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
let currentItem = null;  // routes progress events
let running = false;

const els = {
  pillsRow: document.getElementById('pills-row'),
  dropZone: document.getElementById('drop-zone'),
  dropTitle: document.querySelector('#drop-zone .drop-title'),
  fileInput: document.getElementById('file-input'),
  controls: document.getElementById('active-pill-controls'),
  startBtn: document.getElementById('start-btn'),
  results: document.getElementById('results'),
  loadStatus: document.getElementById('load-status'),
  toastHost: document.getElementById('toast-host'),
  dropOverlay: document.getElementById('drop-overlay'),
  editContext: document.getElementById('edit-context'),
  editContextPill: document.querySelector('#edit-context .edit-context-pill'),
  editContextName: document.querySelector('#edit-context .edit-context-name'),
  editActions: document.getElementById('edit-actions'),
  editOverwriteBtn: document.getElementById('edit-overwrite-btn'),
  editDuplicateBtn: document.getElementById('edit-duplicate-btn'),
  editCancelBtn: document.getElementById('edit-cancel-btn'),
};

const queue = [];
let activePillId = null;
let emptyHintEl = null;

ffmpeg.on('progress', ({ progress }) => {
  if (!currentItem) return;
  const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
  setStatus(currentItem, 'converting', pct);
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

// ---------- source detection ----------

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

function probeDimensions(file, source) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const cleanup = () => URL.revokeObjectURL(url);
    if (source === 'webm') {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = () => { const r = { w: v.videoWidth, h: v.videoHeight }; cleanup(); resolve(r); };
      v.onerror = () => { cleanup(); resolve(null); };
      v.src = url;
    } else {
      const img = new Image();
      img.onload = () => { const r = { w: img.naturalWidth, h: img.naturalHeight }; cleanup(); resolve(r); };
      img.onerror = () => { cleanup(); resolve(null); };
      img.src = url;
    }
  });
}

// ---------- per-pill settings ----------

const DEFAULT_OPTS = { fps: '', width: '', loop: true, quality: 'high' };

function loadOpts(pillId) {
  try {
    const raw = localStorage.getItem(LS_OPTS_PREFIX + pillId);
    if (!raw) return { ...DEFAULT_OPTS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_OPTS, ...parsed };
  } catch {
    return { ...DEFAULT_OPTS };
  }
}

function saveOpts(pillId, opts) {
  localStorage.setItem(LS_OPTS_PREFIX + pillId, JSON.stringify(opts));
}

// Read the active sidebar's current opts (used when a new file is dropped).
function snapshotControls() {
  return activeOptsRead();
}

// ---------- pill bar + active pill ----------

function renderPillBar() {
  els.pillsRow.innerHTML = '';
  for (const p of PILLS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pill';
    btn.dataset.pillId = p.id;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(p.id === activePillId));
    btn.classList.toggle('active', p.id === activePillId);
    btn.textContent = pillLabel(p);
    btn.addEventListener('click', () => navigateToPill(p.id));
    els.pillsRow.appendChild(btn);
  }
}

function navigateToPill(pillId) {
  if (!PILL_BY_ID[pillId]) return;
  if (location.hash !== `#/${pillId}`) {
    location.hash = `#/${pillId}`;
  } else {
    setActivePill(pillId);
  }
}

function setActivePill(pillId) {
  const pill = PILL_BY_ID[pillId];
  if (!pill) return;
  if (editingItem) exitEditMode();
  activePillId = pill.id;
  localStorage.setItem(LS_LAST_PILL, pill.id);
  const bySource = readLastPillBySource();
  bySource[pill.source] = pill.id;
  localStorage.setItem(LS_LAST_PILL_BY_SOURCE, JSON.stringify(bySource));
  for (const btn of els.pillsRow.querySelectorAll('.pill')) {
    const active = btn.dataset.pillId === pill.id;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  }
  renderControlsPanel(pill);
  updateDropTitle();
  updateStartBtn();
}

function readLastPillBySource() {
  try { return JSON.parse(localStorage.getItem(LS_LAST_PILL_BY_SOURCE) || '{}') || {}; }
  catch { return {}; }
}

function pickPillForSource(source) {
  const bySource = readLastPillBySource();
  if (bySource[source] && PILL_BY_ID[bySource[source]]) return bySource[source];
  return PILLS_BY_SOURCE[source]?.[0]?.id || null;
}

function suggestionSep() {
  return currentLang === 'zh-Hant' ? '、' : ', ';
}

const FPS_CHOICES = [10, 12, 15, 20, 24, 30, 50];
const WIDTH_CHOICES = [240, 320, 480, 640, 800, 1080, 1280, 1920];

// Builds the FPS / Width / [Loop] / Quality widget used by both the sidebar
// (active pill controls) and the in-card edit panel. Returns { root, read }
// — read() returns the current opts snapshot. If onChange is supplied, it is
// invoked with read() after every input change.
function buildOptsControls(pill, initialOpts, { onChange, compact = false, namePrefix = 'q' } = {}) {
  const root = document.createElement('div');
  root.className = 'opts-controls' + (compact ? ' compact' : '');

  const fpsLbl = document.createElement('label');
  fpsLbl.className = 'opt-row';
  const fpsSpan = document.createElement('span');
  fpsSpan.className = 'opt-label';
  fpsSpan.dataset.i18n = 'label_fps';
  fpsSpan.textContent = t('label_fps');
  fpsLbl.appendChild(fpsSpan);
  const fpsSel = document.createElement('select');
  fpsSel.className = 'opt-fps';
  fpsSel.appendChild(makeOption('', t('opt_auto')));
  for (const f of FPS_CHOICES) fpsSel.appendChild(makeOption(String(f), String(f)));
  fpsSel.value = initialOpts.fps || '';
  fpsLbl.appendChild(fpsSel);
  root.appendChild(fpsLbl);

  const wLbl = document.createElement('label');
  wLbl.className = 'opt-row';
  const wSpan = document.createElement('span');
  wSpan.className = 'opt-label';
  wSpan.dataset.i18n = 'label_width';
  wSpan.textContent = t('label_width');
  wLbl.appendChild(wSpan);
  const wSel = document.createElement('select');
  wSel.className = 'opt-width';
  wSel.appendChild(makeOption('', t('opt_original')));
  for (const w of WIDTH_CHOICES) wSel.appendChild(makeOption(String(w), String(w)));
  wSel.value = initialOpts.width || '';
  wLbl.appendChild(wSel);
  root.appendChild(wLbl);

  let loopCb = null;
  if (pill.showLoop) {
    const loopLbl = document.createElement('label');
    loopLbl.className = 'opt-row checkbox';
    loopLbl.dataset.i18nTitle = 'label_loop_hint';
    loopLbl.title = t('label_loop_hint');
    const span = document.createElement('span');
    span.className = 'opt-label';
    span.dataset.i18n = 'label_loop';
    span.textContent = t('label_loop');
    loopCb = document.createElement('input');
    loopCb.type = 'checkbox';
    loopCb.className = 'opt-loop';
    loopCb.checked = !!initialOpts.loop;
    loopLbl.appendChild(span);
    loopLbl.appendChild(loopCb);
    root.appendChild(loopLbl);
  }

  const qPrefix = `q_to_${pill.target}`;
  const fs = document.createElement('fieldset');
  fs.className = 'opt-quality';
  const leg = document.createElement('legend');
  leg.dataset.i18n = 'label_quality';
  leg.textContent = t('label_quality');
  fs.appendChild(leg);
  const radios = {};
  for (const level of ['high', 'normal']) {
    const lbl = document.createElement('label');
    lbl.dataset.i18nTitle = `${qPrefix}_${level}_hint`;
    lbl.title = t(`${qPrefix}_${level}_hint`);
    const r = document.createElement('input');
    r.type = 'radio';
    r.name = `${namePrefix}-quality`;
    r.value = level;
    r.checked = initialOpts.quality === level;
    const txt = document.createElement('span');
    txt.dataset.i18n = `${qPrefix}_${level}`;
    txt.textContent = t(`${qPrefix}_${level}`);
    lbl.appendChild(r);
    lbl.appendChild(txt);
    fs.appendChild(lbl);
    radios[level] = r;
  }
  root.appendChild(fs);

  const read = () => ({
    fps: fpsSel.value || '',
    width: wSel.value || '',
    loop: loopCb ? loopCb.checked : (initialOpts.loop ?? true),
    quality: radios.high.checked ? 'high' : 'normal',
  });

  if (onChange) {
    const fire = () => onChange(read());
    fpsSel.addEventListener('change', fire);
    wSel.addEventListener('change', fire);
    loopCb?.addEventListener('change', fire);
    radios.high.addEventListener('change', fire);
    radios.normal.addEventListener('change', fire);
  }

  return { root, read };
}

// The active sidebar's `read()` — used by drop handler to snapshot opts.
let activeOptsRead = () => ({ ...DEFAULT_OPTS });

function renderControlsPanel(pill) {
  const initial = loadOpts(pill.id);
  const { root, read } = buildOptsControls(pill, initial, {
    onChange: (o) => saveOpts(pill.id, o),
    namePrefix: 'sidebar',
  });
  activeOptsRead = read;
  els.controls.replaceChildren(root);
}

function makeOption(value, text) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = text;
  return o;
}

function updateDropTitle() {
  if (!activePillId) return;
  const pill = PILL_BY_ID[activePillId];
  const key = `drop_title_${pill.source}`;
  els.dropTitle.dataset.i18n = key;
  els.dropTitle.textContent = t(key);
}

// ---------- toast ----------

let lastToastMsg = null;
let lastToastAt = 0;
function showToast(message, { variant = 'info', timeoutMs = 3500 } = {}) {
  const now = Date.now();
  if (message === lastToastMsg && now - lastToastAt < 1000) return;
  lastToastMsg = message;
  lastToastAt = now;
  const node = document.createElement('div');
  node.className = `toast toast-${variant}`;
  node.textContent = message;
  node.addEventListener('click', () => dismissToast(node));
  els.toastHost.appendChild(node);
  // Force reflow so the enter transition kicks in
  void node.offsetWidth;
  node.classList.add('show');
  const dismissTimer = setTimeout(() => dismissToast(node), timeoutMs);
  node._timer = dismissTimer;
}

function dismissToast(node) {
  if (node._timer) clearTimeout(node._timer);
  node.classList.remove('show');
  setTimeout(() => node.remove(), 220);
}

// ---------- queue + rendering ----------

function makeItem(file, source, pillId, opts) {
  const pill = PILL_BY_ID[pillId];
  const duplicate = queue.some((it) => it.file.name === file.name && it.file.size === file.size);
  return {
    file,
    source,
    target: pill.target,
    pillId,
    opts,
    dims: null,
    duplicate,
    status: 'pending',
    statusKey: 'queued',
    statusPct: null,
    statusExtra: null,
    blobUrl: null,
    card: null,
    nodes: null,        // { badge, filename, dims, summary, status, action, progress, preview, edit, remove, bar }
  };
}

async function addFiles(files) {
  if (!activePillId) return;
  if (editingItem) return;  // ignore drops while in edit mode

  // Detect all sources first so we can decide whether to auto-switch.
  const detected = await Promise.all(files.map(async (f) => {
    let src = null;
    try { src = await detectSource(f); } catch {}
    return { file: f, src };
  }));

  // Unsupported formats — toast each, then drop them from the working set.
  for (const d of detected) {
    if (!d.src) showToast(t('toast_unsupported_format', { filename: d.file.name }), { variant: 'error' });
  }
  const supported = detected.filter((d) => d.src !== null);
  if (supported.length === 0) return;

  // Auto-switch only if the entire supported batch shares a single source
  // that differs from the active pill. Mixed batches fall back to per-file warn.
  const uniqueSources = [...new Set(supported.map((d) => d.src))];
  let pill = PILL_BY_ID[activePillId];

  if (uniqueSources.length === 1 && uniqueSources[0] !== pill.source) {
    const targetPillId = pickPillForSource(uniqueSources[0]);
    if (targetPillId) {
      if (location.hash !== `#/${targetPillId}`) location.hash = `#/${targetPillId}`;
      setActivePill(targetPillId);
      pill = PILL_BY_ID[targetPillId];
      showToast(t('toast_switched_to', { name: pillLabel(pill) }), { variant: 'info' });
    }
  }

  for (const d of supported) {
    if (d.src !== pill.source) {
      const suggestions = (PILLS_BY_SOURCE[d.src] || []).map(pillLabel).join(suggestionSep());
      showToast(t('toast_wrong_source', { detected: SOURCE_LABEL[d.src], suggestions }), { variant: 'error' });
      continue;
    }
    const opts = snapshotControls();
    const item = makeItem(d.file, d.src, pill.id, opts);
    queue.push(item);
    renderCard(item);
    probeDimensions(d.file, d.src).then((dims) => {
      if (!dims || !item.nodes) return;
      item.dims = dims;
      item.nodes.dims.textContent = `${dims.w}×${dims.h}`;
    });
  }
  renderEmptyQueueHint();
  updateStartBtn();
}

function renderCard(item) {
  const pill = PILL_BY_ID[item.pillId];
  const card = document.createElement('div');
  card.className = 'source-card';
  card.innerHTML = `
    <div class="source-header">
      <span class="card-pill-badge"></span>
      <span class="filename"></span>
      <span class="source-dims"></span>
      ${item.duplicate ? `<span class="dup-badge"></span>` : ''}
      <div class="header-right">
        <button type="button" class="icon-btn edit-btn" aria-label="edit">✎</button>
        <button type="button" class="icon-btn remove-btn" aria-label="remove">×</button>
      </div>
    </div>
    <div class="card-meta">
      <span class="card-summary"></span>
      <span class="card-status"></span>
    </div>
    <div class="progress"><div class="bar"></div></div>
    <div class="action"></div>
    <div class="preview"></div>
  `;
  const nodes = {
    badge: card.querySelector('.card-pill-badge'),
    filename: card.querySelector('.filename'),
    dims: card.querySelector('.source-dims'),
    dup: card.querySelector('.dup-badge'),
    summary: card.querySelector('.card-summary'),
    status: card.querySelector('.card-status'),
    progress: card.querySelector('.progress'),
    bar: card.querySelector('.bar'),
    action: card.querySelector('.action'),
    preview: card.querySelector('.preview'),
    editBtn: card.querySelector('.edit-btn'),
    removeBtn: card.querySelector('.remove-btn'),
  };
  nodes.badge.textContent = pillLabel(pill);
  nodes.filename.textContent = item.file.name;
  if (nodes.dup) {
    nodes.dup.textContent = t('duplicate');
    nodes.dup.title = t('duplicate_hint');
  }
  nodes.editBtn.title = t('edit_tooltip');
  nodes.removeBtn.title = t('remove_tooltip');
  nodes.editBtn.addEventListener('click', () => enterEditMode(item));
  nodes.removeBtn.addEventListener('click', () => removeItem(item));

  item.card = card;
  item.nodes = nodes;
  els.results.appendChild(card);
  renderCardSummary(item);
  renderCardStatus(item);
  applyCardStateClass(item);
}

function renderCardI18n(item) {
  const pill = PILL_BY_ID[item.pillId];
  if (!item.nodes) return;
  item.nodes.badge.textContent = pillLabel(pill);
  if (item.nodes.dup) {
    item.nodes.dup.textContent = t('duplicate');
    item.nodes.dup.title = t('duplicate_hint');
  }
  item.nodes.editBtn.title = t('edit_tooltip');
  item.nodes.removeBtn.title = t('remove_tooltip');
  renderCardSummary(item);
  renderCardStatus(item);
}

function renderCardSummary(item) {
  const pill = PILL_BY_ID[item.pillId];
  const parts = [];
  parts.push(item.opts.fps ? t('summary_fps', { v: item.opts.fps }) : t('summary_fps_auto'));
  parts.push(item.opts.width ? t('summary_width', { v: item.opts.width }) : t('summary_width_original'));
  parts.push(t(`q_to_${pill.target}_${item.opts.quality}`));
  if (pill.showLoop) parts.push(item.opts.loop ? t('summary_loop_on') : t('summary_loop_off'));
  item.nodes.summary.textContent = parts.join(' · ');
}

function renderCardStatus(item) {
  let text = t(`status_${item.statusKey}`);
  if (item.statusKey === 'converting' && item.statusPct != null) text += ` ${item.statusPct}%`;
  else if (item.statusKey === 'failed' && item.statusExtra) text += `: ${item.statusExtra}`;
  item.nodes.status.textContent = text;
  if (item.statusPct != null) item.nodes.bar.style.width = `${item.statusPct}%`;
  applyCardStateClass(item);
}

function applyCardStateClass(item) {
  if (!item.card) return;
  item.card.classList.toggle('is-processing', item.status === 'processing');
  item.card.classList.toggle('is-done', item.status === 'done');
  item.card.classList.toggle('is-failed', item.status === 'failed');
  // Hide progress bar when not actively progressing
  const showBar = item.statusKey === 'writing' || item.statusKey === 'converting';
  item.nodes.progress.style.display = showBar ? '' : 'none';
}

function setStatus(item, key, pct, extra) {
  item.statusKey = key;
  if (pct !== undefined) item.statusPct = pct;
  item.statusExtra = extra ?? null;
  if (key === 'done') item.status = 'done';
  else if (key === 'failed') item.status = 'failed';
  else if (key === 'writing' || key === 'converting') item.status = 'processing';
  else item.status = 'pending';
  renderCardStatus(item);
  if (item.nodes) {
    item.nodes.removeBtn.disabled = item.status === 'processing';
    item.nodes.editBtn.disabled = item.status === 'processing';
  }
}

function isItemRemovable(item) { return item.status !== 'processing'; }

function removeItem(item) {
  if (!isItemRemovable(item)) return;
  if (item === editingItem) return;  // cannot delete the card being edited
  if (item.blobUrl) URL.revokeObjectURL(item.blobUrl);
  const i = queue.indexOf(item);
  if (i >= 0) queue.splice(i, 1);
  item.card?.remove();
  renderEmptyQueueHint();
  updateStartBtn();
}

function renderEmptyQueueHint() {
  if (queue.length === 0) {
    if (!emptyHintEl) {
      emptyHintEl = document.createElement('p');
      emptyHintEl.className = 'queue-empty muted';
    }
    emptyHintEl.textContent = t('results_empty');
    if (!emptyHintEl.parentNode) els.results.appendChild(emptyHintEl);
  } else if (emptyHintEl?.parentNode) {
    emptyHintEl.remove();
  }
}

// ---------- edit mode (sidebar takes over) ----------

let editingItem = null;

function enterEditMode(item) {
  if (item.status === 'processing') return;
  if (editingItem === item) { exitEditMode(); return; }
  if (editingItem) exitEditMode();

  editingItem = item;
  const pill = PILL_BY_ID[item.pillId];

  // Rebuild sidebar opts widget using the card's pill context + card's opts.
  // No onChange — changes are committed only via Overwrite or Duplicate.
  const { root, read } = buildOptsControls(pill, item.opts, {
    namePrefix: `sidebar-edit-${queue.indexOf(item)}`,
  });
  activeOptsRead = read;
  els.controls.replaceChildren(root);

  // Show edit context label + edit actions, hide normal start-btn area
  els.editContext.hidden = false;
  els.editContextPill.textContent = pillLabel(pill);
  els.editContextName.textContent = item.file.name;
  els.editActions.hidden = false;

  document.body.classList.add('editing');
  item.card.classList.add('editing-target');
  item.nodes.removeBtn.disabled = true;
  item.card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function exitEditMode() {
  if (!editingItem) return;
  const item = editingItem;
  editingItem = null;

  // Restore sidebar to active pill's defaults
  const pill = PILL_BY_ID[activePillId];
  renderControlsPanel(pill);

  els.editContext.hidden = true;
  els.editContextPill.textContent = '';
  els.editContextName.textContent = '';
  els.editActions.hidden = true;

  document.body.classList.remove('editing');
  item.card?.classList.remove('editing-target');
  if (item.nodes) {
    // updateStartBtn re-evaluates remove button enabled state from status
    item.nodes.removeBtn.disabled = item.status === 'processing';
  }
}

function applyEditOverwrite() {
  if (!editingItem) return;
  const item = editingItem;
  item.opts = activeOptsRead();
  if (item.blobUrl) { URL.revokeObjectURL(item.blobUrl); item.blobUrl = null; }
  item.nodes.action.innerHTML = '';
  item.nodes.preview.innerHTML = '';
  item.statusPct = null;
  setStatus(item, 'queued', null);
  renderCardSummary(item);
  exitEditMode();
  updateStartBtn();
}

function applyEditDuplicate() {
  if (!editingItem) return;
  const item = editingItem;
  const newOpts = activeOptsRead();
  const clone = makeItem(item.file, item.source, item.pillId, newOpts);
  queue.push(clone);
  renderCard(clone);
  probeDimensions(item.file, item.source).then((dims) => {
    if (!dims || !clone.nodes) return;
    clone.dims = dims;
    clone.nodes.dims.textContent = `${dims.w}×${dims.h}`;
  });
  exitEditMode();
  renderEmptyQueueHint();
  updateStartBtn();
}

// ---------- conversion ----------

function buildFilters(opts, forVP8) {
  const filters = [];
  if (opts.fps) filters.push(`fps=${opts.fps}`);
  const heightArg = forVP8 ? '-2' : '-1';
  if (opts.width) {
    filters.push(`scale=${opts.width}:${heightArg}:flags=lanczos`);
  } else if (forVP8) {
    filters.push(`scale=iw:-2:flags=lanczos`);
  }
  return filters;
}

async function processOne(item) {
  const inputName = `input.${item.source}`;
  const outputName = `output.${item.target}`;
  const paletteName = 'palette.png';
  const opts = item.opts;

  currentItem = item;
  setStatus(item, 'writing', 0);
  await ffmpeg.writeFile(inputName, await fetchFile(item.file));

  try {
    const pair = `${item.source}->${item.target}`;
    const filters = buildFilters(opts, item.target === 'webm');
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
    } else if (pair === 'gif->webm' || pair === 'apng->webm') {
      // libvpx (VP8). VP9 in single-threaded ffmpeg.wasm 0.12 crashes on first frame.
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
    } else if (pair === 'gif->apng' || pair === 'webm->apng') {
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
    const blob = new Blob([data.buffer], { type: TARGET_MIME[item.target] });
    setDownload(item, blob, data.byteLength);
  } catch (err) {
    setStatus(item, 'failed', 0, err.message || String(err));
    throw err;
  } finally {
    currentItem = null;
    for (const name of [inputName, paletteName, outputName]) {
      try { await ffmpeg.deleteFile(name); } catch {}
    }
  }
}

function setDownload(item, blob, sizeBytes) {
  if (item.blobUrl) URL.revokeObjectURL(item.blobUrl);
  const url = URL.createObjectURL(blob);
  item.blobUrl = url;
  const outName = item.file.name.replace(/\.(webm|gif|apng|png)$/i, `.${item.target}`);
  const sizeMB = sizeBytes / 1024 / 1024;
  const action = item.nodes.action;
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

  const preview = item.nodes.preview;
  preview.innerHTML = '';
  if (item.target === 'webm') {
    const v = document.createElement('video');
    v.src = url;
    v.controls = true;
    v.loop = true;
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

  setStatus(item, 'done', 100);
}

function updateStartBtn() {
  els.startBtn.disabled = running || !queue.some((it) => it.status !== 'done' && it.status !== 'processing');
  for (const item of queue) {
    if (item.nodes) {
      item.nodes.removeBtn.disabled = running && item.status === 'processing';
      item.nodes.editBtn.disabled = item.status === 'processing';
    }
  }
}

async function startAll() {
  if (running) return;
  running = true;
  updateStartBtn();
  try {
    try {
      await ensureLoaded();
    } catch (err) {
      setLoadStatus('load_failed', err?.message || String(err));
      return;
    }
    for (const item of queue) {
      if (item.status === 'done' || item.status === 'processing') continue;
      try { await processOne(item); }
      catch { /* status already set to failed in processOne */ }
    }
  } finally {
    running = false;
    updateStartBtn();
  }
}

// ---------- events ----------

els.dropZone.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  e.target.value = '';
  addFiles(files);
});
els.startBtn.addEventListener('click', startAll);

let dragDepth = 0;
function isFileDrag(e) {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  for (let i = 0; i < types.length; i++) if (types[i] === 'Files') return true;
  return false;
}
document.addEventListener('dragenter', (e) => {
  if (!isFileDrag(e) || editingItem) return;
  dragDepth++;
  if (dragDepth === 1) els.dropOverlay.classList.add('active');
});
document.addEventListener('dragleave', (e) => {
  if (!isFileDrag(e) || editingItem) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) els.dropOverlay.classList.remove('active');
});
document.addEventListener('dragover', (e) => {
  if (!isFileDrag(e) || editingItem) return;
  e.preventDefault();
});
document.addEventListener('drop', (e) => {
  if (!isFileDrag(e) || editingItem) return;
  e.preventDefault();
  dragDepth = 0;
  els.dropOverlay.classList.remove('active');
  const files = Array.from(e.dataTransfer.files);
  addFiles(files);
});

els.editOverwriteBtn.addEventListener('click', applyEditOverwrite);
els.editDuplicateBtn.addEventListener('click', applyEditDuplicate);
els.editCancelBtn.addEventListener('click', exitEditMode);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && editingItem) {
    e.preventDefault();
    exitEditMode();
  }
});

for (const btn of document.querySelectorAll('.lang-switch [data-lang]')) {
  btn.addEventListener('click', () => {
    const next = btn.dataset.lang;
    if (next === currentLang || !SUPPORTED_LANGS.includes(next)) return;
    currentLang = next;
    localStorage.setItem(LS_LANG, currentLang);
    applyLang();
    for (const a of document.querySelectorAll('.action a[data-i18n-download]')) {
      a.textContent = t('download');
    }
    // Re-render the sidebar widget so per-pill quality labels follow the lang.
    if (editingItem) {
      const it = editingItem;
      editingItem = null;
      enterEditMode(it);
    } else if (activePillId) {
      renderControlsPanel(PILL_BY_ID[activePillId]);
    }
  });
}

// ---------- routing ----------

function pillIdFromHash() {
  const h = location.hash || '';
  const m = h.match(/^#\/?([a-z-]+)$/);
  if (m && PILL_BY_ID[m[1]]) return m[1];
  return null;
}

function resolveInitialPill() {
  return pillIdFromHash()
    || (PILL_BY_ID[localStorage.getItem(LS_LAST_PILL)] ? localStorage.getItem(LS_LAST_PILL) : null)
    || 'gif-to-webm';
}

window.addEventListener('hashchange', () => {
  const id = pillIdFromHash();
  if (id && id !== activePillId) setActivePill(id);
});

// ---------- boot ----------

renderPillBar();
const initial = resolveInitialPill();
if (location.hash !== `#/${initial}`) location.hash = `#/${initial}`;
setActivePill(initial);
applyLang();
renderEmptyQueueHint();
