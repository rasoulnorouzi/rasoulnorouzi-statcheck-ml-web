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
import {
  loadKit, loadModel, checkPdf, toJSON, toCSV, toMarkdown,
} from '../src/index.js';
import {
  MAX_FILES, DOWNLOAD_NAMES, selectFiles, formatVerdictCounts, sectionHeading,
} from './support.js';

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

const chooseButton = document.getElementById('choose-button');
const fileInput = document.getElementById('file-input');
const dropZone = document.getElementById('drop-zone');
const kitStatus = document.getElementById('kit-status');
const statusLog = document.getElementById('status-log');
const summaryTable = document.getElementById('summary-table');
const summaryBody = summaryTable.querySelector('tbody');
const reportsContainer = document.getElementById('reports');
const downloadsEl = document.getElementById('downloads');
const downloadJsonLink = document.getElementById('download-json');
const downloadCsvLink = document.getElementById('download-csv');
const downloadMdLink = document.getElementById('download-md');

let kit = null;
let model = null;
let ready = null; // the in-flight or settled load promise, awaited before a run

function setKitStatus(text) {
  kitStatus.textContent = text;
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
    setKitStatus('loading kit…');
    kit = await loadKit(KIT_BASE);
    setKitStatus(`${kitStatusPrefix()} · loading model…`);
    model = await loadModel(kit);
    setKitStatus(`${kitStatusPrefix()} · ready`);
  })();
  return ready;
}

/** Append one line to the run's status log and return it, so its text can be updated in place. */
function appendStatusLine(text) {
  const p = document.createElement('p');
  p.textContent = text;
  statusLog.appendChild(p);
  return p;
}

function formatNumber(value) {
  return value == null ? '' : String(value);
}

function formatDf(df1, df2) {
  if (df1 == null) return '';
  return df2 == null ? formatNumber(df1) : `${formatNumber(df1)}, ${formatNumber(df2)}`;
}

function td(text, numeric = false) {
  const cell = document.createElement('td');
  cell.textContent = text;
  if (numeric) cell.className = 'num';
  return cell;
}

/**
 * One document's results table: the ten columns the owner asked for, plus a
 * detail row under each result carrying its quote and the sentence around
 * it. The detail row, not a separate numbered list below the table, keeps
 * the trace tied to the row it explains — a reader reads down the page once,
 * the way a terminal transcript reads, instead of jumping between a row
 * number and a list further down.
 */
function buildResultsTable(results) {
  const table = document.createElement('table');
  table.className = 'results-table';

  const thead = document.createElement('thead');
  thead.innerHTML = '<tr>'
    + '<th class="num">page</th><th class="num">line</th><th>test</th>'
    + '<th class="num">statistic</th><th>df</th><th>op</th>'
    + '<th class="num">reported p</th><th class="num">computed p</th>'
    + '<th>verdict</th><th>source</th>'
    + '</tr>';
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const r of results) {
    const row = document.createElement('tr');
    row.append(
      td(formatNumber(r.page), true),
      td(formatNumber(r.line), true),
      td(r.test_type ?? ''),
      td(formatNumber(r.statistic), true),
      td(formatDf(r.df1, r.df2)),
      td(r.p_operator ?? ''),
      td(formatNumber(r.p_value), true),
      td(r.computed_p == null ? '' : r.computed_p.toFixed(6), true),
      td(r.verdict ?? ''),
      td(r.source ?? ''),
    );
    row.children[8].className = `verdict verdict-${r.verdict ?? 'unknown'}`;
    tbody.appendChild(row);

    const detail = document.createElement('tr');
    detail.className = 'detail-row';
    const cell = document.createElement('td');
    cell.colSpan = 10;
    cell.textContent = `\`${r.quote}\` — ${r.context}`;
    detail.appendChild(cell);
    tbody.appendChild(detail);
  }
  table.appendChild(tbody);
  return table;
}

function renderSummary(docReports) {
  summaryBody.textContent = '';
  for (const doc of docReports) {
    const row = document.createElement('tr');
    if (doc.error) {
      row.append(
        td(doc.fileName),
        td('could not read'),
        td('', true),
        td('', true),
        td(doc.error),
      );
    } else {
      row.append(
        td(doc.fileName),
        td(doc.title || '(no title found)'),
        td(formatNumber(doc.pages), true),
        td(formatNumber(doc.results.length), true),
        td(formatVerdictCounts(doc.results)),
      );
    }
    summaryBody.appendChild(row);
  }
  summaryTable.hidden = docReports.length === 0;
}

function renderReports(docReports) {
  reportsContainer.textContent = '';
  for (const doc of docReports) {
    const section = document.createElement('section');
    section.className = 'doc-section';

    const h2 = document.createElement('h2');
    h2.textContent = sectionHeading(doc.fileName, doc.title, doc.titleSource);
    section.appendChild(h2);

    if (doc.error) {
      const p = document.createElement('p');
      p.textContent = `could not read ${doc.fileName}: ${doc.error}`;
      section.appendChild(p);
      reportsContainer.appendChild(section);
      continue; // eslint-disable-line no-continue
    }

    const meta = document.createElement('p');
    meta.className = 'dim';
    meta.textContent = `pages: ${formatNumber(doc.pages)}. verdicts: ${formatVerdictCounts(doc.results)}.`;
    section.appendChild(meta);

    if (doc.results.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'no results found in this file.';
      section.appendChild(p);
    } else {
      section.appendChild(buildResultsTable(doc.results));
    }
    reportsContainer.appendChild(section);
  }
}

function setDownloadLink(a, content, type, filename) {
  if (a.getAttribute('href')) URL.revokeObjectURL(a.href);
  const blob = new Blob([content], { type });
  a.href = URL.createObjectURL(blob);
  a.download = filename;
}

function renderDownloads(docReports) {
  const kitInfo = {
    version: kit.manifest.kit_version,
    model: kit.manifest.model_default,
    mother_commit: kit.manifest.mother_commit,
  };
  setDownloadLink(downloadJsonLink, toJSON(docReports, kitInfo), 'application/json', DOWNLOAD_NAMES.json);
  setDownloadLink(downloadCsvLink, toCSV(docReports, kitInfo), 'text/csv', DOWNLOAD_NAMES.csv);
  setDownloadLink(downloadMdLink, toMarkdown(docReports, kitInfo), 'text/markdown', DOWNLOAD_NAMES.md);
  downloadsEl.hidden = false;
}

/** Clear everything a previous run left behind, including its object URLs, before a new one starts. */
function resetRun() {
  statusLog.textContent = '';
  summaryBody.textContent = '';
  summaryTable.hidden = true;
  reportsContainer.textContent = '';
  for (const a of [downloadJsonLink, downloadCsvLink, downloadMdLink]) {
    if (a.getAttribute('href')) URL.revokeObjectURL(a.href);
    a.removeAttribute('href');
  }
  downloadsEl.hidden = true;
}

/**
 * Check every accepted file in `fileList`, one at a time so the page stays
 * responsive and the status log reads in a stable order, then render the
 * summary table, the per-file reports, and the three downloads.
 */
async function runFiles(fileList) {
  const { accepted, rejected, overflow } = selectFiles(fileList, MAX_FILES);
  resetRun();

  for (const f of rejected) appendStatusLine(`rejected ${f.name}: not a PDF`);
  if (overflow > 0) {
    appendStatusLine(`too many files: kept the first ${MAX_FILES}, dropped ${overflow} more`);
  }
  if (accepted.length === 0) {
    appendStatusLine('no PDFs to check.');
    return;
  }

  try {
    await loadOnce();
  } catch (err) {
    appendStatusLine(`could not load the kit or the model: ${err.message}`);
    return;
  }

  const startedAt = performance.now();
  const docReports = [];
  const n = accepted.length;
  for (let i = 0; i < n; i += 1) {
    const file = accepted[i];
    const line = appendStatusLine(`[${i + 1}/${n}] ${file.name}: reading…`);
    try {
      // eslint-disable-next-line no-await-in-loop
      const data = await file.arrayBuffer();
      // eslint-disable-next-line no-await-in-loop
      const outcome = await checkPdf(data, kit, model, {
        pdfjs,
        fileName: file.name,
        onProgress: (page, total) => {
          line.textContent = `[${i + 1}/${n}] ${file.name}: reading page ${page} of ${total} …`;
        },
      });
      const count = outcome.results.length;
      line.textContent = `[${i + 1}/${n}] ${file.name}: ${count} result${count === 1 ? '' : 's'}`;
      docReports.push({
        fileName: file.name,
        title: outcome.title,
        titleSource: outcome.titleSource,
        pages: outcome.pages,
        results: outcome.results,
        stages: outcome.stages,
      });
    } catch (err) {
      line.textContent = `[${i + 1}/${n}] ${file.name}: could not read (${err.message})`;
      docReports.push({
        fileName: file.name,
        title: null,
        titleSource: null,
        pages: null,
        results: [],
        stages: {},
        error: err.message,
      });
    }
  }

  const seconds = ((performance.now() - startedAt) / 1000).toFixed(2);
  renderSummary(docReports);
  renderReports(docReports);
  renderDownloads(docReports);

  const totalResults = docReports.reduce((sum, d) => sum + d.results.length, 0);
  const overallVerdicts = formatVerdictCounts(docReports.flatMap((d) => d.results));
  appendStatusLine(
    `done: ${n} file${n === 1 ? '' : 's'}, ${totalResults} result${totalResults === 1 ? '' : 's'}, `
    + `${overallVerdicts}, ${seconds}s`,
  );
}

chooseButton.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  const { files } = fileInput;
  fileInput.value = ''; // lets picking the same file(s) again re-fire 'change'
  runFiles(files);
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
  runFiles(event.dataTransfer.files);
});

setKitStatus('loading kit…');
loadOnce().catch((err) => setKitStatus(`could not load the kit or the model: ${err.message}`));
