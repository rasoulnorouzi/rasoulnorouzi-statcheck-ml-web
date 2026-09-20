// Pure helpers for the demo page.
//
// `app.js` touches `document` the moment it is imported (it reads elements
// off the page and starts loading the kit), so it cannot be imported under
// plain Node the way a test needs to. The logic in this file has no such
// dependency — file filtering, verdict tallies, a section's heading, the
// three download file names — so it lives here instead, where
// `test/demo.test.js` can import it directly and `app.js` imports it too,
// rather than restating any of it inline.

export const MAX_FILES = 10;

export const DOWNLOAD_NAMES = Object.freeze({
  json: 'statcheck-ml-report.json',
  csv: 'statcheck-ml-report.csv',
  md: 'statcheck-ml-report.md',
});

/**
 * Whether `file` (a `File`, or anything with `.name`/`.type`) is a PDF: by
 * its MIME type first, and by its name's extension when the type is blank,
 * which a drag-and-drop `DataTransfer` sometimes leaves for a file the OS
 * does not recognise.
 */
export function isPdfFile(file) {
  const type = file && file.type ? file.type : '';
  const name = file && file.name ? file.name : '';
  return type === 'application/pdf' || /\.pdf$/i.test(name);
}

/**
 * Split a dropped or chosen file list into what a run accepts and what it
 * does not.
 *
 * A non-PDF is rejected outright, by name, so a reader can see which file
 * and why. A PDF beyond `maxFiles` is dropped too, but only its count is
 * kept as `overflow` — the owner asked the status line to say a run kept
 * the first ten, not to name every file past the tenth.
 *
 * @param {Iterable<{name: string, type: string}>} files
 * @param {number} [maxFiles]
 * @returns {{accepted: Array, rejected: Array, overflow: number}}
 */
export function selectFiles(files, maxFiles = MAX_FILES) {
  const list = Array.from(files);
  const rejected = list.filter((f) => !isPdfFile(f));
  const pdfs = list.filter(isPdfFile);
  const overflow = Math.max(0, pdfs.length - maxFiles);
  const accepted = pdfs.slice(0, maxFiles);
  return { accepted, rejected, overflow };
}

/**
 * One verdict -> count map over a document's results, `'unknown'` standing
 * in for a result whose verdict is missing.
 */
export function verdictCounts(results) {
  const counts = {};
  for (const r of results) {
    const v = (r && r.verdict) ?? 'unknown';
    counts[v] = (counts[v] ?? 0) + 1;
  }
  return counts;
}

/**
 * `verdictCounts`, printed as `"consistent: 3, inconsistent: 1"`. The keys
 * are sorted rather than kept in the order results were found, so the same
 * set of results always reads the same way; `'none'` when there are none.
 */
export function formatVerdictCounts(results) {
  const counts = verdictCounts(results);
  const keys = Object.keys(counts).sort();
  return keys.length ? keys.map((k) => `${k}: ${counts[k]}`).join(', ') : 'none';
}

/**
 * A results section's heading: the title when one was found, the file name
 * otherwise, with a note when the title came from the largest text on page
 * 1 rather than the PDF's own metadata, and the file name always last so a
 * reader can match a section back to the file it came from.
 */
export function sectionHeading(fileName, title, titleSource) {
  const titleText = title || '(no title found)';
  const note = titleSource === 'largest-font' ? ' (from the largest text on page 1)' : '';
  return `${titleText}${note} — ${fileName}`;
}

/**
 * One summary-table row for a file the run attempted: title, pages, result
 * count and verdict tally when it was read, or `'could not read'` and the
 * error's message when it was not.
 *
 * @param {string} fileName
 * @param {{title?: ?string, pages?: ?number, results?: Array, error?: ?string}} outcome
 */
export function buildSummaryRow(fileName, outcome) {
  if (outcome && outcome.error) {
    return {
      fileName,
      title: 'could not read',
      pages: null,
      resultCount: null,
      verdicts: outcome.error,
      error: outcome.error,
    };
  }
  const { title = null, pages = null, results = [] } = outcome || {};
  return {
    fileName,
    title,
    pages,
    resultCount: results.length,
    verdicts: formatVerdictCounts(results),
    error: null,
  };
}

/**
 * A progress bar drawn in characters, because this page is monospace text.
 *
 * `done` counts finished files, `withinFile` is how far the current file has
 * come (0 to 1), so a single long document still moves the bar.
 */
export function progressBar(done, total, withinFile = 0, width = 40) {
  if (total <= 0) return { bar: '', text: '' };
  const fraction = Math.min(1, Math.max(0, (done + withinFile) / total));
  const filled = Math.round(fraction * width);
  return {
    bar: `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}]`,
    text: `${Math.round(fraction * 100)}% (${Math.min(done + 1, total)}/${total})`,
  };
}

/** One line per queued file, for the list shown before a run starts. */
export function queueLines(files) {
  return files.map((f) => `${f.name}  ${Math.round((f.size || 0) / 1024)} kB`);
}
