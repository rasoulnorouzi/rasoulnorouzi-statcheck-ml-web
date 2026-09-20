// Read a PDF and produce lines, the shape every later stage expects.
//
// PDF.js reports text as positioned pieces, not lines. Where a line ends is
// therefore a decision this file makes, and every port must make the same
// one, or each port reads a different document. `joinItems` below is ported
// from the mother repository's `js/extract.js` (the first PDF.js reader,
// track A): items are joined into one line while their y coordinate does not
// move by more than `NEW_LINE_AT` PDF units, and `item.hasEOL` forces a
// break too.
//
// Unlike that file, this one does not normalise. `checkText` already runs
// `normalize` as its first stage (see `src/pipeline.js`), so `pdfToText`
// only has to match the shape of `statcheck_ml.pipeline.Pipeline.extract_text`
// for the `pymupdf` engine before normalisation:
//
//     text = "".join(page.get_text() for page in doc)
//
// PyMuPDF's `page.get_text()` already ends in a newline, so consecutive
// pages read as separate lines with no blank line between them, and no form
// feed. This file matches that by joining pages with a single `\n`, the same
// choice `js/extract.js` made.
//
// `pdfjs` is passed in rather than imported by a fixed path, because the
// module a caller needs differs: the legacy Node build in a test, the
// browser build with a worker configured in the demo page.

const NEW_LINE_AT = 2;

/**
 * Copy `data` into a plain `Uint8Array` PDF.js will accept.
 *
 * PDF.js refuses a Node `Buffer`, even though `Buffer` is a `Uint8Array`
 * subclass, and it transfers the bytes it is given to its worker, which
 * detaches the caller's own `ArrayBuffer` once reading starts. A copy avoids
 * both: the constructor check sees a plain `Uint8Array`, and the caller's
 * buffer is left usable after this function returns.
 */
function toUint8Array(data) {
  const view = ArrayBuffer.isView(data) ? data : new Uint8Array(data);
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy;
}

/**
 * Join the pieces PDF.js returns for one page into lines.
 *
 * @param {object} textContent The value of `page.getTextContent()`.
 * @returns {string}
 */
export function joinItems(textContent) {
  const parts = [];
  let lastY = null;
  for (const item of textContent.items) {
    if (item.str === undefined) continue;
    const y = item.transform ? Math.round(item.transform[5]) : null;
    if (lastY !== null && y !== null && Math.abs(y - lastY) > NEW_LINE_AT) {
      parts.push('\n');
    }
    parts.push(item.str);
    if (item.hasEOL) parts.push('\n');
    lastY = y;
  }
  return parts.join('');
}

/**
 * Read every page of a PDF and return its text, unnormalised.
 *
 * @param {ArrayBuffer|Uint8Array} data The PDF itself.
 * @param {{pdfjs: object, onProgress?: (page: number, total: number) => void}} options
 *   `pdfjs` is the `pdfjs-dist` module (or its legacy build), already
 *   configured with a worker source when one is needed. `onProgress`, if
 *   given, is called after each page is read.
 * @returns {Promise<{text: string, pages: number}>}
 */
export async function pdfToText(data, { pdfjs, onProgress } = {}) {
  if (!pdfjs) throw new Error('statcheck-ml pdf: pass { pdfjs }, the pdfjs-dist module');
  const bytes = toUint8Array(data);
  const doc = await pdfjs.getDocument({ data: bytes, verbosity: 0 }).promise;

  let raw = '';
  try {
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      raw += joinItems(await page.getTextContent()) + '\n';
      if (typeof page.cleanup === 'function') page.cleanup();
      if (onProgress) onProgress(i, doc.numPages);
    }
  } finally {
    // Releasing the document is optional. A failure here must never discard
    // the text already read.
    try {
      if (typeof doc.destroy === 'function') await doc.destroy();
    } catch { /* nothing to release */ }
  }

  return { text: raw, pages: doc.numPages };
}
