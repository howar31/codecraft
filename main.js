import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// Use the ESM build because Vite spawns module workers; the library's fallback
// path (`import(coreURL)` after `importScripts` fails) only works with ESM core.
const FFMPEG_CORE_BASE = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';

const ffmpeg = new FFmpeg();
let ffmpegLoaded = false;
let currentItem = null;

const els = {
  dropZone: document.getElementById('drop-zone'),
  fileInput: document.getElementById('file-input'),
  fps: document.getElementById('fps'),
  width: document.getElementById('width'),
  qualityHigh: document.getElementById('quality-high'),
  startBtn: document.getElementById('start-btn'),
  results: document.getElementById('results'),
  loadStatus: document.getElementById('load-status'),
};

const queue = [];

ffmpeg.on('progress', ({ progress }) => {
  if (!currentItem) return;
  const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
  setStatus(currentItem, `轉換中 / Converting ${pct}%`, pct);
});

async function ensureLoaded() {
  if (ffmpegLoaded) return;
  els.loadStatus.textContent = '載入 ffmpeg 中... / Loading ffmpeg (~30MB)...';
  await ffmpeg.load({
    coreURL: await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
  });
  ffmpegLoaded = true;
  els.loadStatus.textContent = '';
}

function addFiles(files) {
  for (const f of files) {
    if (!f.name.toLowerCase().endsWith('.webm')) continue;
    const item = { file: f, status: 'pending' };
    queue.push(item);
    renderRow(item);
  }
  updateStartBtn();
}

function renderRow(item) {
  const row = document.createElement('div');
  row.className = 'result-row';
  row.innerHTML = `
    <span class="name"></span>
    <span class="status">等待中 / Queued</span>
    <span class="action"></span>
    <div class="progress"><div class="bar"></div></div>
    <div class="preview"></div>
  `;
  row.querySelector('.name').textContent = item.file.name;
  els.results.appendChild(row);
  item.row = row;
}

function setStatus(item, text, pct) {
  item.row.querySelector('.status').textContent = text;
  if (pct != null) item.row.querySelector('.bar').style.width = `${pct}%`;
}

function setDownload(item, blob, sizeBytes) {
  const url = URL.createObjectURL(blob);
  const outName = item.file.name.replace(/\.webm$/i, '.gif');
  const sizeMB = sizeBytes / 1024 / 1024;
  const warn = sizeBytes > 5 * 1024 * 1024 ? ' ⚠' : '';
  const action = item.row.querySelector('.action');
  action.innerHTML = '';
  const a = document.createElement('a');
  a.href = url;
  a.download = outName;
  a.textContent = '下載 / Download';
  const size = document.createElement('span');
  size.className = 'size';
  size.textContent = ` ${sizeMB.toFixed(2)} MB${warn}`;
  action.appendChild(a);
  action.appendChild(size);

  const preview = item.row.querySelector('.preview');
  preview.innerHTML = '';
  const img = document.createElement('img');
  img.src = url;
  img.alt = outName;
  preview.appendChild(img);

  setStatus(item, '完成 / Done', 100);
}

async function processOne(item, opts) {
  const inputName = 'input.webm';
  const paletteName = 'palette.png';
  const outputName = 'output.gif';

  currentItem = item;
  setStatus(item, '寫入檔案 / Writing', 0);
  await ffmpeg.writeFile(inputName, await fetchFile(item.file));

  try {
    if (opts.quality === 'high') {
      await ffmpeg.exec([
        '-i', inputName,
        '-vf', `fps=${opts.fps},scale=${opts.width}:-1:flags=lanczos,palettegen=stats_mode=full`,
        paletteName,
      ]);
      await ffmpeg.exec([
        '-i', inputName,
        '-i', paletteName,
        '-lavfi',
        `fps=${opts.fps},scale=${opts.width}:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
        outputName,
      ]);
    } else {
      await ffmpeg.exec([
        '-i', inputName,
        '-vf', `fps=${opts.fps},scale=${opts.width}:-1:flags=lanczos`,
        outputName,
      ]);
    }

    const data = await ffmpeg.readFile(outputName);
    const blob = new Blob([data.buffer], { type: 'image/gif' });
    setDownload(item, blob, data.byteLength);
  } catch (err) {
    setStatus(item, `失敗 / Failed: ${err.message || err}`, 0);
    throw err;
  } finally {
    currentItem = null;
    for (const name of [inputName, paletteName, outputName]) {
      try { await ffmpeg.deleteFile(name); } catch {}
    }
  }
}

function updateStartBtn() {
  const pending = queue.filter((q) => q.status !== 'done' && q.status !== 'processing');
  els.startBtn.disabled = pending.length === 0;
}

async function startAll() {
  els.startBtn.disabled = true;
  try {
    await ensureLoaded();
  } catch (err) {
    els.loadStatus.textContent = `載入失敗 / Load failed: ${err?.message || err}`;
    els.startBtn.disabled = false;
    return;
  }
  const opts = {
    fps: clampInt(els.fps.value, 5, 30, 15),
    width: clampInt(els.width.value, 200, 1920, 800),
    quality: els.qualityHigh.checked ? 'high' : 'normal',
  };
  for (const item of queue) {
    if (item.status === 'done') continue;
    item.status = 'processing';
    try {
      await processOne(item, opts);
      item.status = 'done';
    } catch {
      item.status = 'failed';
    }
  }
  updateStartBtn();
}

function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

els.dropZone.addEventListener('click', () => els.fileInput.click());
els.dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  els.dropZone.classList.add('dragover');
});
els.dropZone.addEventListener('dragleave', () => els.dropZone.classList.remove('dragover'));
els.dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  els.dropZone.classList.remove('dragover');
  addFiles(e.dataTransfer.files);
});
els.fileInput.addEventListener('change', (e) => {
  addFiles(e.target.files);
  e.target.value = '';
});
els.startBtn.addEventListener('click', startAll);
