// Select the passages of text that could hold a statistical result.
//
// This is the JavaScript port of `statcheck_ml.prefilter.Prefilter`. Only
// about 1 line in 700 holds a result, and running the model over all of them
// wastes almost all of the work; in a browser it is not possible at all.
//
// The filter is tuned for recall alone. Text it discards can never be
// recovered by the model, so the filter, and not the model, sets the recall
// ceiling of the whole system. It therefore answers "could this hold a
// result", never "does this look like a result".
//
// The rules live in `kit/spec/prefilter.json`, so that this port and the
// Python and R ports read one definition instead of three copies.

const LETTER_RE = /\p{L}/gu;

function density(line) {
  if (!line) return 0;
  const letters = (line.match(LETTER_RE) || []).length;
  return 1 - letters / line.length;
}

// Both exports below run this one pass over the lines.
function scan(text, kit) {
  const spec = kit.spec.prefilter;
  // `prefilter.json` does not carry its own cap; the one normalisation
  // already applies to survive a PDF engine's line breaks is the reference.
  const maxReferenceLine = spec.max_reference_line ?? kit.spec.normalize.max_reference_line;
  const minDensity = spec.min_non_letter_density;
  const minLength = spec.min_line_length;
  const contextLines = spec.context_lines;
  const targetCharacters = spec.target_window_characters ?? 0;
  const maxContextLines = spec.max_context_lines ?? 8;

  const digitRe = new RegExp(spec.require_digit_pattern);
  const refHeadRe = new RegExp(spec.reference_heading_pattern, 'i');
  const refLineRes = spec.reference_line_patterns.map((p) => new RegExp(p));

  function isReference(line) {
    if (line.length > maxReferenceLine) return false;
    return refLineRes.some((re) => re.test(line));
  }

  function stripReferences(lines) {
    let cut = lines.length;
    const scanFrom = Math.floor(lines.length * 0.55);
    for (let i = scanFrom; i < lines.length; i += 1) {
      if (refHeadRe.test(lines[i])) { cut = i; break; }
    }
    const out = lines.slice(0, cut).map((ln) => (isReference(ln) ? '' : ln));
    for (let i = cut; i < lines.length; i += 1) out.push('');
    return out;
  }

  function keepsLine(line) {
    if (line.length < minLength) return false;
    if (!digitRe.test(line)) return false;
    return density(line) >= minDensity;
  }

  /**
   * How many lines of context this window needs, growing past `contextLines`
   * until the window holds `targetCharacters`, and never past
   * `maxContextLines`.
   */
  function spanFor(lines, i) {
    let n = contextLines;
    let lo = Math.max(0, i - n);
    let hi = Math.min(lines.length, i + n + 1);
    if (!targetCharacters) return [lo, hi];
    while (n < maxContextLines) {
      let total = 0;
      for (let k = lo; k < hi; k += 1) total += lines[k].length + 1;
      if (total >= targetCharacters) break;
      n += 1;
      const newLo = Math.max(0, i - n);
      const newHi = Math.min(lines.length, i + n + 1);
      if (newLo === lo && newHi === hi) break; // the document has no more text
      lo = newLo;
      hi = newHi;
    }
    return [lo, hi];
  }

  const rawLines = text.split('\n');
  const lines = stripReferences(rawLines);

  // Character offsets into `text`, one past the end of each line, built from
  // the original lines: blanking a reference line changes what a window
  // reads, never where a line sits in the document.
  const offsets = [0];
  for (const ln of rawLines) offsets.push(offsets[offsets.length - 1] + ln.length + 1);

  // A blanked line keeps its newline but loses its characters, so these
  // offsets differ from `offsets` after the first reference line.
  const blankedOffsets = [0];
  for (const ln of lines) blankedOffsets.push(blankedOffsets[blankedOffsets.length - 1] + ln.length + 1);

  const windows = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!keepsLine(lines[i])) continue;
    const [lo, hi] = spanFor(lines, i);
    windows.push({
      start: offsets[lo],
      end: offsets[hi - 1] + rawLines[hi - 1].length,
      line: i,
      text: lines.slice(lo, hi).join('\n'),
      startLine: lo,
      endLine: hi - 1,
      docStart: blankedOffsets[lo],
    });
  }
  return {
    spec, lines, rawLines, offsets, blankedOffsets, windows,
  };
}

/**
 * Select the text a document offers to the pattern and the model.
 *
 * A window carries the lines around a candidate line, because a result can
 * be split by a line break: on the clean corpus 18.4% of results are
 * separated from their p-value by at least one line break. The window grows
 * past the fixed line count until it holds about as much text as the window
 * the model was trained on, because a fixed line count is not a fixed amount
 * of context once a different PDF engine breaks lines at a different width.
 *
 * @param {string} text
 * @param {{spec: {prefilter: object, normalize: object}}} kit From `loadKit`.
 * @returns {Array<{start: number, end: number, line: number, text: string,
 *   startLine: number, endLine: number, docStart: number}>}
 *   `start` and `end` are character offsets into `text`. `line` is the index
 *   of the candidate line that made the filter keep this window. `docStart`
 *   is the offset of the window's first character over the lines after
 *   reference blanking, which is the coordinate the dedup rule counts in.
 */
export function prefilter(text, kit) {
  return scan(text, kit).windows;
}

/**
 * What the model reads, as the spec's `unit` says. With `"passage"`,
 * windows that overlap or touch merge into one run of lines, so every
 * character is read once. Any other value returns the windows unchanged.
 * Port of `Prefilter.units`.
 */
export function units(text, kit) {
  const {
    spec, lines, rawLines, offsets, blankedOffsets, windows,
  } = scan(text, kit);
  if ((spec.unit ?? 'window') !== 'passage') return windows;

  // Array.prototype.sort is stable, as the reference's sorted() is.
  const ordered = [...windows].sort((a, b) => a.startLine - b.startLine);
  const runs = [];
  for (const w of ordered) {
    const last = runs[runs.length - 1];
    if (last && w.startLine <= last[1] + 1) last[1] = Math.max(last[1], w.endLine);
    else runs.push([w.startLine, w.endLine]);
  }
  return runs.map(([lo, hi]) => ({
    start: offsets[lo],
    end: offsets[hi] + rawLines[hi].length,
    line: lo,
    text: lines.slice(lo, hi + 1).join('\n'),
    startLine: lo,
    endLine: hi,
    docStart: blankedOffsets[lo],
  }));
}
