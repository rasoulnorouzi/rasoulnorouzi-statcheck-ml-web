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
 * Whether `title` reads like a file name rather than a paper's own title:
 * a publisher's PDF workflow sometimes copies the source file name into the
 * Title metadata field verbatim (Word's own default is even more direct,
 * `Microsoft Word - <filename>`), and neither is what a reader means by
 * "the title".
 */
function looksLikeFileName(title) {
  const lower = title.toLowerCase();
  return ['.doc', '.docx', '.pdf', '.tex'].some((ext) => lower.endsWith(ext))
    || title.startsWith('Microsoft Word - ');
}

/**
 * The metadata Title, or `null` when it is not trustworthy on its own.
 *
 * Metadata alone is not enough for two reasons this one check covers: a
 * publisher's conversion pipeline leaves the field empty far more often
 * than not, and when it is set, it sometimes holds the source file name
 * instead of the paper's title (`looksLikeFileName` above). A title under
 * four characters is treated as the same kind of noise as an empty one.
 */
function acceptMetadataTitle(raw) {
  if (!raw) return null;
  const title = String(raw).trim();
  if (title.length < 4) return null;
  if (looksLikeFileName(title)) return null;
  return title;
}

/**
 * Group a page's text items by rounded font height and return the items of
 * the tallest group, in the order PDF.js reported them (its reading order).
 */
function tallestItems(items) {
  const groups = new Map();
  for (const item of items) {
    if (!item.str || !item.str.trim() || !item.transform) continue;
    const height = Math.round(Math.abs(item.transform[3]));
    if (!groups.has(height)) groups.set(height, []);
    groups.get(height).push(item);
  }
  if (groups.size === 0) return [];
  const tallest = Math.max(...groups.keys());
  return groups.get(tallest);
}

/**
 * The paper's title read off the largest text on page 1, or `null` when
 * that text does not look like a title (a running head is a few characters,
 * a full page of same-size prose is hundreds).
 */
function largestFontTitle(page1Items) {
  const text = tallestItems(page1Items).map((item) => item.str).join('')
    .replace(/\s+/g, ' ').trim();
  return text.length >= 8 && text.length <= 300 ? text : null;
}

/**
 * Read every page of a PDF and return its text, unnormalised.
 *
 * @param {ArrayBuffer|Uint8Array} data The PDF itself.
 * @param {{pdfjs: object, onProgress?: (page: number, total: number) => void}} options
 *   `pdfjs` is the `pdfjs-dist` module (or its legacy build), already
 *   configured with a worker source when one is needed. `onProgress`, if
 *   given, is called after each page is read.
 * @returns {Promise<{text: string, pages: number, pageTexts: string[],
 *   title: ?string, titleSource: ?('metadata'|'largest-font')}>}
 */
export async function pdfToText(data, { pdfjs, onProgress } = {}) {
  if (!pdfjs) throw new Error('statcheck-ml pdf: pass { pdfjs }, the pdfjs-dist module');
  const bytes = toUint8Array(data);
  const doc = await pdfjs.getDocument({ data: bytes, verbosity: 0 }).promise;

  const pageTexts = [];
  let page1Items = null;
  try {
    for (let i = 1; i <= doc.numPages; i += 1) {
      const page = await doc.getPage(i);
      const textContent = await page.getTextContent();
      if (i === 1) page1Items = textContent.items;
      pageTexts.push(joinItems(textContent));
      if (typeof page.cleanup === 'function') page.cleanup();
      if (onProgress) onProgress(i, doc.numPages);
    }

    let title = null;
    let titleSource = null;
    const metadata = await doc.getMetadata().catch(() => null);
    const fromMetadata = acceptMetadataTitle(metadata?.info?.Title);
    if (fromMetadata) {
      title = fromMetadata;
      titleSource = 'metadata';
    } else if (page1Items) {
      const fromFont = largestFontTitle(page1Items);
      if (fromFont) {
        title = fromFont;
        titleSource = 'largest-font';
      }
    }

    return { text: `${pageTexts.join('\n')}\n`, pages: doc.numPages, pageTexts, title, titleSource };
  } finally {
    // Releasing the document is optional. A failure here must never discard
    // the text already read.
    try {
      if (typeof doc.destroy === 'function') await doc.destroy();
    } catch { /* nothing to release */ }
  }
}
