// The demo page's logic. No framework, no build step: this file is loaded
// as an ES module directly by `index.html`.
//
// Two runtimes need a worker or a WASM binary that a browser can only get
// from a same-origin file, so both are vendored under `./vendor/` (see
// `vendor/VERSIONS.md`) rather than fetched from a CDN or from
// `node_modules`, which GitHub Pages does not serve.
//
// `src/model.js` imports `onnxruntime-web` by its bare package name. A
// browser cannot resolve a bare name on its own, so `index.html` carries an
// import map that sends that name to `./vendor/ort.wasm.min.mjs`. Importing
// it here too, under the same mapped name, reaches the same cached module
// instance — there is only one `onnxruntime-web` in the page — so setting
// `env.wasm.wasmPaths` here takes effect for the session `loadModel` creates
// later.
import * as ort from 'onnxruntime-web';
import * as pdfjs from './vendor/pdf.min.mjs';
import { loadKit, loadModel, checkPdf } from '../src/index.js';

// `loadKit`/`loadModel` build a fetch URL with `new URL(relPath, base)`,
// and the URL constructor requires an absolute `base` — a relative string
// such as `'../kit'` throws `TypeError: Invalid URL` in every browser. This
// file resolves the kit path relative to *itself* first, with
// `import.meta.url`, so the result is always absolute, whatever depth the
// page is served from (a local static server at `/demo/`, or GitHub Pages
// at `/statcheck-ml-web/demo/`).
const KIT_BASE = new URL('../kit/', import.meta.url).href;
const VENDOR_BASE = new URL('./vendor/', import.meta.url).href;

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
ort.env.wasm.wasmPaths = VENDOR_BASE;

const fileInput = document.getElementById('file-input');
const dropZone = document.getElementById('drop-zone');
const statusLine = document.getElementById('status-line');
const resultsTable = document.getElementById('results-table');
const resultsBody = resultsTable.querySelector('tbody');
const emptyNote = document.getElementById('empty-note');
const downloadLink = document.getElementById('download-json');

let kit = null;
let model = null;
let ready = null; // the in-flight or settled load promise, awaited before a check

function setStatus(text) {
  statusLine.textContent = text;
}

/** `manifest.mother_commit` is a full hash; a reader needs only enough of it to look up. */
function shortCommit(hash) {
  return typeof hash === 'string' ? hash.slice(0, 7) : 'unknown';
}

function kitStatusPrefix() {
  if (!kit) return '';
  const m = kit.manifest;
  return `kit ${m.kit_version} · model ${m.model_default} · mother ${shortCommit(m.mother_commit)}`;
}

async function loadOnce() {
  if (ready) return ready;
  ready = (async () => {
    setStatus('loading kit…');
    kit = await loadKit(KIT_BASE);
    setStatus(`${kitStatusPrefix()} · loading model…`);
    model = await loadModel(kit);
    setStatus(`${kitStatusPrefix()} · ready`);
  })();
  return ready;
}

function formatNumber(value) {
  return value == null ? '' : String(value);
}

function formatDf(df1, df2) {
  if (df1 == null) return '';
  return df2 == null ? formatNumber(df1) : `${formatNumber(df1)}, ${formatNumber(df2)}`;
}

function clearTable() {
  resultsBody.textContent = '';
}

function renderResults(results) {
  clearTable();
  emptyNote.hidden = results.length !== 0;
  resultsTable.hidden = results.length === 0;

  for (const r of results) {
    const row = document.createElement('tr');
    const cells = [
      formatNumber(r.line),
      r.source ?? '',
      r.test_type ?? '',
      formatNumber(r.statistic),
      formatDf(r.df1, r.df2),
      r.p_operator ?? '',
      formatNumber(r.p_value),
      r.computed_p == null ? '' : r.computed_p.toFixed(6),
      r.verdict ?? '',
    ];
    const numeric = new Set([0, 3, 6, 7]);      // line, statistic, reported p, computed p
    cells.forEach((value, i) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      if (numeric.has(i)) cell.className = 'num';
      row.appendChild(cell);
    });
    const verdictCell = row.lastElementChild;
    verdictCell.className = `verdict verdict-${r.verdict ?? 'unknown'}`;
    resultsBody.appendChild(row);
  }
}

function setDownload(report) {
  if (downloadLink.href) URL.revokeObjectURL(downloadLink.href);
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  downloadLink.href = URL.createObjectURL(blob);
  downloadLink.hidden = false;
}

async function handleFile(file) {
  if (!file) return;
  try {
    await loadOnce();
  } catch (err) {
    setStatus(`could not load the kit or the model: ${err.message}`);
    return;
  }

  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf) {
    setStatus(`${kitStatusPrefix()} · ${file.name} is not a PDF`);
    return;
  }

  setStatus(`${kitStatusPrefix()} · checking ${file.name}…`);
  const startedAt = performance.now();
  try {
    const data = await file.arrayBuffer();
    const { results, stages, pages } = await checkPdf(data, kit, model, { pdfjs });

    const seconds = ((performance.now() - startedAt) / 1000).toFixed(2);
    renderResults(results);
    setDownload({
      source: file.name, pages, results, stages,
    });
    setStatus(`${kitStatusPrefix()} · ${results.length} result${results.length === 1 ? '' : 's'} in ${seconds}s`);
  } catch (err) {
    setStatus(`${kitStatusPrefix()} · could not read ${file.name}: ${err.message}`);
  }
}

fileInput.addEventListener('change', () => {
  handleFile(fileInput.files[0]);
});

dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropZone.classList.remove('drag-over');
  const [file] = event.dataTransfer.files;
  handleFile(file);
});

setStatus('loading kit…');
loadOnce().catch((err) => setStatus(`could not load the kit or the model: ${err.message}`));
