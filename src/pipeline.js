// The whole pipeline: text goes in, checked results come out.
//
// This is the JavaScript port of `statcheck_ml.pipeline.Pipeline.run_text`,
// with every stage this package now has, in the order that is the design:
// normalise, repair, prefilter, then per window the pattern first and the
// model after it, then the p-value check. Every stage's rules live in the
// shared kit; this file only calls them in order.
//
// The pattern goes first in each window because its precision is near 1.000,
// so an existing statcheck user sees no regression; the model adds only what
// the pattern did not already find in that window.

import { createNormalizer } from './normalize.js';
import { repair } from './repair.js';
import { prefilter } from './prefilter.js';
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
  }));
}

async function findWithModel(windowText, line, model) {
  if (model == null) return [];
  const text = modelInputText(windowText);
  const tags = await tag(text, model);
  const spans = tagsToSpans(tags.slice(0, text.length));

  const out = [];
  for (const [parts, groupedSpans] of groupSpans(text, spans)) {
    const statistic = parseNumber(parts.STAT);
    if (statistic == null) continue;
    const [spanStart, spanEnd] = spanOf(groupedSpans);
    out.push({
      test_type: (parts.TEST || '').trim().toLowerCase() || 't',
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
  const { spanStart, spanEnd, ...rest } = found;
  const quote = window.text.slice(spanStart, spanEnd).trim();
  const offset = window.start + spanStart;
  const context = sentenceContext(scannedText, offset, offset + quote.length);
  return {
    ...rest, quote, offset, context,
  };
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
 * Read a document and check every statistical result in it.
 *
 * @param {string} text
 * @param {object} kit From `loadKit`.
 * @param {?{session, charmap, decoder}} [model] From `loadModel`. Omitted, a
 *   window is read by the pattern alone.
 * @returns {Promise<{results: Array<object>, stages: object}>}
 */
export async function checkText(text, kit, model) {
  const stages = {};

  const normalizer = createNormalizer(kit.spec.normalize, kit.spec.charmap);
  const { text: normalized, info: normalizeInfo } = normalizer.normalize(text);
  stages.normalize = normalizeInfo;

  const { text: fixed, replacements } = repair(normalized, kit);
  stages.repair = { replacements };

  const windows = prefilter(fixed, kit);
  stages.prefilter = { lines: fixed.split('\n').length, windows_kept: windows.length };

  const found = [];
  const seen = new Set();
  let byPattern = 0;
  let byModel = 0;

  for (const w of windows) {
    for (const f of findWithPattern(w.text, w.line)) {
      const key = f.statistic != null ? roundTo3(f.statistic) : null;
      if (seen.has(key)) continue;
      seen.add(key);
      // A result found in more than one window (they overlap on purpose)
      // keeps the quote/offset/context of the window that found it first,
      // because `withSpan` only ever runs once per key, right here.
      found.push(withSpan(f, w, fixed));
      byPattern += 1;
    }
    // Windows are read one at a time, on purpose: the dedup set below must
    // see the pattern's hits before the model's, in document order, or a
    // result could be credited to the wrong source.
    for (const f of await findWithModel(w.text, w.line, model)) {
      const key = f.statistic != null ? roundTo3(f.statistic) : null;
      if (key === null || seen.has(key)) continue;
      seen.add(key);
      found.push(withSpan(f, w, fixed));
      byModel += 1;
    }
  }
  stages.find = { by_pattern: byPattern, by_model: byModel };

  const checked = found.map(checkOne);
  const verdicts = {};
  const notFound = {};
  for (const f of checked) {
    const v = f.verdict ?? 'unknown';
    verdicts[v] = (verdicts[v] ?? 0) + 1;
    for (const part of f.missing) notFound[part] = (notFound[part] ?? 0) + 1;
  }
  stages.check = verdicts;
  stages.not_found = notFound;

  return { results: checked, stages };
}

const MIN_QUOTE_SIGNATURE = 3;

/**
 * `str` with everything but digits and `.` removed, plus an index mapping
 * each kept character back to its position in `str`.
 *
 * This is what `pageOf` below matches a result against a page on, rather
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
 * The 1-based page a result's quote sits on, or `null` when it cannot be
 * placed: the quote's digit signature is too short to be specific to one
 * page, or no page's signature contains it at all.
 */
function pageOf(quote, pageTexts) {
  const quoteSig = digitSignature(quote).sig;
  if (quoteSig.length < MIN_QUOTE_SIGNATURE) return null;
  for (let i = 0; i < pageTexts.length; i += 1) {
    if (digitSignature(pageTexts[i]).sig.includes(quoteSig)) return i + 1;
  }
  return null;
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
 * @returns {Promise<{results: Array<object>, stages: object, pages: number,
 *   title: ?string, titleSource: ?('metadata'|'largest-font'),
 *   fileName: ?string}>}
 */
export async function checkPdf(data, kit, model, pdfOptions = {}) {
  const { fileName = null } = pdfOptions;
  const {
    text, pages, pageTexts, title, titleSource,
  } = await pdfToText(data, pdfOptions);
  const { results, stages } = await checkText(text, kit, model);
  const placed = results.map((r) => ({ ...r, page: pageOf(r.quote, pageTexts) }));
  return {
    results: placed, stages, pages, title, titleSource, fileName,
  };
}
