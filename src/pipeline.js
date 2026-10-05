// The whole pipeline: text goes in, checked results come out.
//
// This is the JavaScript port of `statcheck_ml.pipeline.Pipeline.run_text`,
// with every stage this package now has, in the order that is the design:
// normalise, repair, prefilter, then per unit the pattern first and the
// model after it, then the p-value check. Every stage's rules live in the
// shared kit; this file only calls them in order.
//
// The pattern goes first in each unit because its precision is near 1.000,
// so an existing statcheck user sees no regression; the model adds only what
// the pattern did not already find in that unit.

import { createNormalizer } from './normalize.js';
import { repair } from './repair.js';
import { prefilter, units as prefilterUnits } from './prefilter.js';
import { extractWithSpans } from './extract.js';
import {
  groupSpans, tagsToSpans, operatorFromParts, spanOf,
} from './group.js';
import { tag } from './model.js';
import { check, parseNumber } from './pvalue.js';
import { pdfToText } from './pdf.js';

const ALPHA = 0.05;
const CONTEXT_MAX = 300;

/**
 * Fold characters that mean the same thing, and keep everything else.
 *
 * Port of `statcheck_ml.data.normalise`: only the several space characters a
 * typesetter uses collapse to one, matching Unicode's "space separator"
 * category. A control character is kept exactly as it is, because it is
 * often a damaged operator and the model must learn to read it. This is a
 * narrower pass than `normalize()`: it runs on one window, right before the
 * model reads it, and does not reflow lines or rename operators.
 */
function modelInputText(text) {
  return text.replace(/\p{Zs}/gu, ' ');
}

function findWithPattern(windowText, line) {
  return extractWithSpans(windowText).map((e) => ({
    test_type: e.test_type,
    statistic: parseNumber(e.statistic),
    statisticText: e.statistic,
    df1: parseNumber(e.df1),
    df2: parseNumber(e.df2),
    p_operator: e.p_operator,
    p_value: parseNumber(e.p_value),
    reportedPText: e.p_value,
    source: 'pattern',
    line,
    spanStart: e.start,
    spanEnd: e.end,
    statSpan: [e.statStart, e.statEnd],
  }));
}

async function findWithModel(windowText, line, model) {
  if (model == null) return [];
  const text = modelInputText(windowText);
  const tags = await tag(text, model);
  const spans = tagsToSpans(tags.slice(0, text.length));

  const out = [];
  for (const [parts, groupedSpans, firstSpans] of groupSpans(text, spans)) {
    const statistic = parseNumber(parts.STAT);
    if (statistic == null) continue;
    const [spanStart, spanEnd] = spanOf(groupedSpans);
    out.push({
      test_type: (parts.TEST || '').trim().toLowerCase() || null,
      statistic,
      statisticText: parts.STAT,
      df1: parseNumber(parts.DF1),
      df2: parseNumber(parts.DF2),
      p_operator: operatorFromParts(parts),
      p_value: parseNumber(parts.PVAL),
      reportedPText: parts.PVAL,
      source: 'model',
      line,
      spanStart,
      spanEnd,
      statSpan: firstSpans.STAT,
    });
  }
  return out;
}

function roundTo3(value) {
  return Number(value.toFixed(3));
}

/**
 * Whether character `i` of `text` ends a sentence: a `.`, `?` or `!`
 * followed by a space or the end of the text, or a line break on its own,
 * matching how the results in this corpus are actually typeset.
 */
function isSentenceBoundary(text, i) {
  const ch = text[i];
  if (ch === '\n') return true;
  if (ch === '.' || ch === '?' || ch === '!') {
    const next = text[i + 1];
    return next === undefined || next === ' ' || next === '\n';
  }
  return false;
}

/**
 * Cut `context` down to `maxLen` characters, keeping `[quoteStart, quoteEnd)`
 * inside it and roughly centered. What one side cannot give up because the
 * quote sits close to it is handed to the other side, so the result is
 * still `maxLen` characters whenever `context` has enough room for that.
 */
function trimToLength(context, quoteStart, quoteEnd, maxLen) {
  if (context.length <= maxLen) return context;
  const budget = Math.max(0, maxLen - (quoteEnd - quoteStart));
  const before = Math.floor(budget / 2);
  const after = budget - before;

  let left = Math.max(0, quoteStart - before);
  let right = Math.min(context.length, quoteEnd + after);
  const shortBefore = before - (quoteStart - left);
  const shortAfter = after - (right - quoteEnd);
  if (shortBefore > 0) right = Math.min(context.length, right + shortBefore);
  if (shortAfter > 0) left = Math.max(0, left - shortAfter);

  return context.slice(left, right);
}

/**
 * The sentence around `[quoteStart, quoteEnd)` in `scannedText`: expanded to
 * the nearest sentence boundary on each side, newlines folded to spaces, and
 * cut to `CONTEXT_MAX` characters without losing the quote.
 */
function sentenceContext(scannedText, quoteStart, quoteEnd) {
  let left = 0;
  for (let i = quoteStart - 1; i >= 0; i -= 1) {
    if (isSentenceBoundary(scannedText, i)) { left = i + 1; break; }
  }
  while (left < quoteStart && /\s/.test(scannedText[left])) left += 1;

  let right = scannedText.length;
  for (let i = quoteEnd; i < scannedText.length; i += 1) {
    if (isSentenceBoundary(scannedText, i)) {
      right = scannedText[i] === '\n' ? i : i + 1;
      break;
    }
  }

  // `\n` -> ' ' keeps every index below unchanged, so the quote's position
  // in `raw` is still `quoteStart - left` after this replace.
  const raw = scannedText.slice(left, right).replace(/\n/g, ' ');
  return trimToLength(raw, quoteStart - left, quoteEnd - left, CONTEXT_MAX);
}

/**
 * Attach `quote`, `offset` and `context` to one found result, reading them
 * off the window it was found in and the document text `checkText` scanned.
 *
 * `offset` is `window.start + spanStart`: the window's own coordinates are
 * not kept once this runs, because the point of these three fields is to
 * place a result in the document, not in the window that happened to find
 * it.
 */
function withSpan(found, window, scannedText) {
  const {
    spanStart, spanEnd, statSpan, ...rest
  } = found;
  const quote = window.text.slice(spanStart, spanEnd).trim();
  const offset = window.start + spanStart;
  const context = sentenceContext(scannedText, offset, offset + quote.length);
  // The dedup rule counts in blanked-document coordinates, not in `offset`'s.
  const statistic_span = [statSpan[0] + window.docStart, statSpan[1] + window.docStart];
  // `line_rule` in kit/parity/cases.json. Counting newlines in the unit text
  // is exact because a blanked reference line keeps its newline.
  const before = window.text.slice(0, statSpan[0]);
  const line = window.startLine + before.split('\n').length - 1;
  return {
    ...rest, line, quote, offset, context, statistic_span,
  };
}

/** A find with no test name: kept, shown, never checked. */
function asFragment(found) {
  const { statisticText, reportedPText, ...rest } = found;
  return rest;
}

function checkOne(found) {
  const { statisticText, reportedPText, ...rest } = found;
  const outcome = check({
    test_type: found.test_type,
    statistic: found.statistic,
    df1: found.df1,
    df2: found.df2,
    p_operator: found.p_operator,
    p_value: found.p_value,
  }, {
    alpha: ALPHA,
    // Both captures are free here: the pattern branch carries them from its
    // regex groups, and the model branch from the span text its tags
    // covered. Threading them lets the rounding rule allow for how the
    // statistic itself was printed, not only the p-value; neither is kept
    // on the returned result, which stays the same shape it always was.
    statisticText,
    reportedPText,
  });
  return {
    ...rest,
    verdict: outcome.verdict,
    computed_p: outcome.computed_p,
    reason: outcome.reason,
    missing: outcome.missing,
  };
}

/**
 * Which finders read a window. `hybrid` is the cascade the report measures:
 * statcheck's patterns first, then the model adds only what they missed.
 * `pattern` is statcheck's own method, and `model` the model alone; both are
 * there so a reader can see what each finder contributes.
 */
export const MODES = {
  hybrid: { pattern: true, model: true },
  pattern: { pattern: true, model: false },
  model: { pattern: false, model: true },
};

/**
 * Read a document and check every statistical result in it.
 *
 * @param {string} text
 * @param {object} kit From `loadKit`.
 * @param {?{session, charmap, decoder}} [model] From `loadModel`. Omitted, a
 *   window is read by the pattern alone.
 * @param {{mode?: 'hybrid'|'pattern'|'model'}} [options]
 * @returns {Promise<{results: Array<object>, fragments: Array<object>,
 *   stages: object}>} `fragments` holds the finds with no test name: a result
 *   without `verdict`, `computed_p`, `reason` and `missing`.
 */
export async function checkText(text, kit, model, { mode = 'hybrid' } = {}) {
  const finders = MODES[mode];
  if (!finders) throw new Error(`statcheck-ml: unknown mode ${mode}; use hybrid, pattern or model`);
  const stages = { mode };

  const normalizer = createNormalizer(kit.spec.normalize, kit.spec.charmap);
  const { text: normalized, info: normalizeInfo } = normalizer.normalize(text);
  stages.normalize = normalizeInfo;

  const { text: fixed, replacements } = repair(normalized, kit);
  stages.repair = { replacements };

  const windows = prefilter(fixed, kit);
  const units = prefilterUnits(fixed, kit);
  stages.prefilter = {
    lines: fixed.split('\n').length,
    windows_kept: windows.length,
    units_kept: units.length,
    characters_read: units.reduce((sum, u) => sum + u.text.length, 0),
  };

  // The dedup rule is `dedup_rule` in kit/parity/cases.json: a find is a
  // duplicate when its statistic interval overlaps one already emitted.
  const found = [];
  const taken = [];
  const seenValues = new Set();
  let byPattern = 0;
  let byModel = 0;
  let fallback = 0;

  // A find without an interval falls back to its value rounded to three
  // decimals. The pattern and the model always give an interval, so the
  // fallback stays for parity with the reference, not for use.
  const valueKey = (f) => (f.statistic != null ? roundTo3(f.statistic) : null);

  function isDuplicate(f) {
    if (f.statistic_span != null) {
      const [s, e] = f.statistic_span;
      return taken.some(([ts, te]) => s < te && ts < e);
    }
    return seenValues.has(valueKey(f));
  }

  function remember(f) {
    if (f.statistic_span != null) {
      taken.push(f.statistic_span);
    } else {
      fallback += 1;
      seenValues.add(valueKey(f));
    }
  }

  for (const u of units) {
    // Pattern first, then the model, in each unit, in document order: the
    // first find at a place stays, and the order sets the credited source.
    const hits = finders.pattern ? findWithPattern(u.text, u.line) : [];
    for (const raw of hits) {
      const f = withSpan(raw, u, fixed);
      if (isDuplicate(f)) continue;
      remember(f);
      found.push(f);
      byPattern += 1;
    }
    for (const raw of await findWithModel(u.text, u.line, finders.model ? model : null)) {
      const f = withSpan(raw, u, fixed);
      if (isDuplicate(f)) continue;
      remember(f);
      found.push(f);
      byModel += 1;
    }
  }

  const named = found.filter((f) => f.test_type);
  const fragments = found.filter((f) => !f.test_type).map(asFragment);
  stages.find = {
    by_pattern: byPattern,
    by_model: byModel,
    value_key_fallback: fallback,
    fragments: fragments.length,
  };

  const checked = named.map(checkOne);
  const verdicts = {};
  const notFound = {};
  for (const f of checked) {
    const v = f.verdict ?? 'unknown';
    verdicts[v] = (verdicts[v] ?? 0) + 1;
    for (const part of f.missing) notFound[part] = (notFound[part] ?? 0) + 1;
  }
  stages.check = verdicts;
  stages.not_found = notFound;

  return { results: checked, fragments, stages };
}

const MIN_QUOTE_SIGNATURE = 3;

/**
 * `str` with everything but digits and `.` removed, plus an index mapping
 * each kept character back to its position in `str`.
 *
 * This is what `placeOnPages` below matches a result against a page on, rather
 * than the quote text itself, because the quote and a page's raw text
 * rarely agree character for character: the quote's operator may have been
 * repaired, and whitespace and line breaks differ between a PDF engine's
 * raw output and the normalised, repaired text a result was found in. The
 * digits of a reported statistic survive both.
 */
function digitSignature(str) {
  let sig = '';
  const index = [];
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      sig += ch;
      index.push(i);
    }
  }
  return { sig, index };
}

/**
 * The 1-based page of every row, or `null` for a row that cannot be placed:
 * its quote's digit signature is too short to be specific, or no page's
 * signature contains it.
 *
 * A short quote such as `ts = 3.1` can also occur on an earlier page. The
 * rows come in document order, so each row takes the first matching page at
 * or after the page of the row before it, and only falls back to the first
 * match anywhere when no later page matches.
 */
export function placeOnPages(rows, pageTexts) {
  const pageSigs = pageTexts.map((t) => digitSignature(t).sig);
  let cursor = 0;
  return rows.map((r) => {
    const quoteSig = digitSignature(r.quote).sig;
    if (quoteSig.length < MIN_QUOTE_SIGNATURE) return { ...r, page: null };
    let i = pageSigs.findIndex((sig, k) => k >= cursor && sig.includes(quoteSig));
    if (i < 0) i = pageSigs.findIndex((sig) => sig.includes(quoteSig));
    if (i < 0) return { ...r, page: null };
    cursor = i;
    return { ...r, page: i + 1 };
  });
}

/**
 * Read a PDF and check every statistical result in it.
 *
 * `pdfToText` produces unnormalised text the same way as
 * `statcheck_ml.pipeline.Pipeline.extract_text` does for the `pymupdf`
 * engine, and `checkText` runs the normalise stage that follows it, so this
 * is the two stages composed, plus placing each result on a page and
 * carrying the paper's title along.
 *
 * The document is still scanned in one `checkText` call, so the results and
 * their order are exactly what `checkText` alone would give; this function
 * only adds a `page` to each one afterwards.
 *
 * @param {ArrayBuffer|Uint8Array} data The PDF itself.
 * @param {object} kit From `loadKit`.
 * @param {?{session, charmap, decoder}} [model] From `loadModel`.
 * @param {{pdfjs: object, onProgress?: (page: number, total: number) => void,
 *   fileName?: ?string}} [pdfOptions] Forwarded to `pdfToText`; `pdfjs` is
 *   required. `fileName` is carried through to the returned shape as-is.
 * @returns {Promise<{results: Array<object>, fragments: Array<object>,
 *   stages: object, pages: number,
 *   title: ?string, titleSource: ?('metadata'|'largest-font'),
 *   fileName: ?string}>}
 */
export async function checkPdf(data, kit, model, pdfOptions = {}) {
  const { fileName = null, mode = 'hybrid' } = pdfOptions;
  const {
    text, pages, pageTexts, title, titleSource,
  } = await pdfToText(data, pdfOptions);
  const { results, fragments, stages } = await checkText(text, kit, model, { mode });
  return {
    results: placeOnPages(results, pageTexts), fragments: placeOnPages(fragments, pageTexts), stages, pages, title, titleSource, fileName, mode,
  };
}
