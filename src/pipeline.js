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
import { extract } from './extract.js';
import { groupSpans, tagsToSpans, operatorFromParts } from './group.js';
import { tag } from './model.js';
import { check, parseNumber } from './pvalue.js';

const ALPHA = 0.05;

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
  return extract(windowText).map((e) => ({
    test_type: e.test_type,
    statistic: parseNumber(e.statistic),
    df1: parseNumber(e.df1),
    df2: parseNumber(e.df2),
    p_operator: e.p_operator,
    p_value: parseNumber(e.p_value),
    source: 'pattern',
    line,
  }));
}

async function findWithModel(windowText, line, model) {
  if (model == null) return [];
  const text = modelInputText(windowText);
  const tags = await tag(text, model);
  const spans = tagsToSpans(tags.slice(0, text.length));

  const out = [];
  for (const [parts] of groupSpans(text, spans)) {
    const statistic = parseNumber(parts.STAT);
    if (statistic == null) continue;
    out.push({
      test_type: (parts.TEST || '').trim().toLowerCase() || 't',
      statistic,
      df1: parseNumber(parts.DF1),
      df2: parseNumber(parts.DF2),
      p_operator: operatorFromParts(parts),
      p_value: parseNumber(parts.PVAL),
      source: 'model',
      line,
    });
  }
  return out;
}

function roundTo3(value) {
  return Number(value.toFixed(3));
}

function checkOne(found) {
  const outcome = check({
    test_type: found.test_type,
    statistic: found.statistic,
    df1: found.df1,
    df2: found.df2,
    p_operator: found.p_operator,
    p_value: found.p_value,
  }, { alpha: ALPHA });
  return {
    ...found,
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
      found.push(f);
      byPattern += 1;
    }
    // Windows are read one at a time, on purpose: the dedup set below must
    // see the pattern's hits before the model's, in document order, or a
    // result could be credited to the wrong source.
    for (const f of await findWithModel(w.text, w.line, model)) {
      const key = f.statistic != null ? roundTo3(f.statistic) : null;
      if (key === null || seen.has(key)) continue;
      seen.add(key);
      found.push(f);
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
