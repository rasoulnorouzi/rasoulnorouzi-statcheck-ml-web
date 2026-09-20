// Repair damaged operators, and let the arithmetic choose the mapping.
//
// This is the JavaScript port of `statcheck_ml.repair_validated`. A publisher
// sets mathematical symbols in a symbol font with its own private encoding.
// When the file carries no valid ToUnicode map, the extractor writes the raw
// glyph byte, so the operator is simply missing from the text:
//
//   F(1, 214) \x01 50.54, p \x05 .001
//   F (6, 30) ¼ 2.66, p ¼ .04
//
// No pattern can read these, because the character it needs is absent.
//
// The mapping is inferred by trying every plausible operator for each suspect
// character and keeping the mapping whose recomputed p-values agree with the
// reported ones most often, using the p-value core this package already has.
// The mapping is fixed inside one document, because one font produces the
// whole file, so a character means the same thing everywhere in it.
//
// When too few results can be tested this way, the stage falls back to a
// simpler rule (`statcheck_ml.repair`): a suspect character between the
// degrees of freedom and a number is an equals sign, the one position that
// admits no other reading. That fixes the character everywhere else in the
// document too, including after "p", where the reading would otherwise be
// ambiguous. This is the only check in the project no language model took
// part in.
//
// The rules live in `kit/spec/repair.json`, so that this port and the Python
// and R ports read one definition instead of three copies.

import { computeP } from './pvalue.js';

function numSimple(text) {
  if (text == null) return null;
  let s = String(text).trim();
  if (s.startsWith('.')) s = `0${s}`;
  else if (s.startsWith('-.')) s = `-0${s.slice(1)}`;
  const val = Number(s);
  return Number.isFinite(val) ? val : null;
}

/** A character that is special inside a `[...]` class, escaped for one. */
function escapeForClass(ch) {
  if (ch === '\\') return '\\\\';
  if (ch === ']' || ch === '^' || ch === '-') return `\\${ch}`;
  return ch;
}

/** Build the character class of a possible damaged operator, from the spec. */
function suspectClass(spec) {
  const parts = [];
  for (const [low, high] of spec.suspect_characters.control_range) {
    parts.push(`\\x${low.toString(16).padStart(2, '0')}-\\x${high.toString(16).padStart(2, '0')}`);
  }
  for (const ch of spec.suspect_characters.literal) parts.push(escapeForClass(ch));
  return `[${parts.join('')}]`;
}

/** A complete result whose two operators may both be damaged, with the `g`
 * flag so a caller can both `matchAll` it and `replace` every occurrence. */
function buildResultPattern(spec) {
  const src = spec.result_pattern.replaceAll('SUSPECT', suspectClass(spec));
  return new RegExp(src, 'gi');
}

function* productOf(items, repeat) {
  if (repeat === 0) { yield []; return; }
  const indices = new Array(repeat).fill(0);
  for (;;) {
    yield indices.map((i) => items[i]);
    let pos = repeat - 1;
    while (pos >= 0) {
      indices[pos] += 1;
      if (indices[pos] < items.length) break;
      indices[pos] = 0;
      pos -= 1;
    }
    if (pos < 0) return;
  }
}

function candidates(text, resultRe) {
  const out = [];
  for (const m of text.matchAll(resultRe)) {
    const [, test, df1, df2, statOp, stat, pOp, pVal] = m;
    out.push({
      test: test.toLowerCase(),
      df1: numSimple(df1),
      df2: numSimple(df2),
      stat_op: statOp,
      stat: numSimple(stat),
      p_op: pOp,
      p: numSimple(pVal),
    });
  }
  return out;
}

const CHI2_ALIASES = { c2: 'chi2', v2: 'chi2', x2: 'chi2', 'χ2': 'chi2' };

/** How many digits `value` carries after the point, once trailing zeros from
 * fixed-point formatting are dropped. Mirrors `repair_validated._decimals`,
 * which measures the float itself rather than the text it came from. */
function decimalsOfValue(value) {
  const s = value.toFixed(10).replace(/0+$/, '');
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

function agrees(row, pOperator) {
  const test = CHI2_ALIASES[row.test] ?? row.test;
  const computed = computeP(test, row.stat, row.df1, row.df2);
  if (computed == null || row.p == null) return null;
  if (pOperator === '=') {
    return Math.abs(computed - row.p) <= Math.max(0.5 * 10 ** -decimalsOfValue(row.p), 1e-6);
  }
  if (pOperator === '<') return computed < row.p;
  return computed > row.p;
}

function scoreMapping(rows, mapping) {
  let agree = 0;
  let testable = 0;
  for (const row of rows) {
    const sop = mapping[row.stat_op] ?? row.stat_op;
    if (sop !== '=') continue; // a test statistic is always reported with "="
    const pop = mapping[row.p_op] ?? row.p_op;
    const verdict = agrees(row, pop);
    if (verdict === null) continue;
    testable += 1;
    if (verdict) agree += 1;
  }
  return [agree, testable];
}

/** Choose the operator mapping the arithmetic supports best, or `{}` when too
 * few results can be tested (the caller then falls back to the simple rule). */
function inferValidated(text, spec, resultRe) {
  const rows = candidates(text, resultRe);
  const operators = spec.operators;
  const operatorSet = new Set(operators);
  const suspectSet = new Set();
  for (const r of rows) { suspectSet.add(r.stat_op); suspectSet.add(r.p_op); }
  const suspects = [...suspectSet].filter((c) => !operatorSet.has(c)).sort();

  if (rows.length === 0 || suspects.length === 0 || suspects.length > spec.max_suspects) return {};

  let best = null;
  let bestRate = -1;
  let bestTestable = 0;
  for (const combo of productOf(operators, suspects.length)) {
    const mapping = {};
    suspects.forEach((s, i) => { mapping[s] = combo[i]; });
    const [agree, testable] = scoreMapping(rows, mapping);
    if (testable < spec.min_testable_results) continue;
    const rate = agree / testable;
    if (rate > bestRate || (rate === bestRate && testable > bestTestable)) {
      best = mapping;
      bestRate = rate;
      bestTestable = testable;
    }
  }
  return best ?? {};
}

// ---------------------------------------------------- the simple fallback --
//
// Port of `statcheck_ml.repair` (not `repair_validated`). Its own module,
// because `repair_validated` falls back to it, not the other way round, and
// it reads no spec: its patterns are fixed in the Python reference too.

const CONTROL = '\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f';
const ANCHOR_STAT_RE = new RegExp(`\\)\\s*([${CONTROL}¼\\\\!bNp])\\s*-?\\d*\\.?\\d`, 'g');
const ANCHOR_P_RE = new RegExp(`\\bp\\s*([${CONTROL}¼\\\\!bN])\\s*(-?\\d*\\.?\\d+)`, 'g');
const P_THRESHOLDS = new Set([0.05, 0.01, 0.001, 0.0001, 0.1]);

function inferSimpleMap(text) {
  const mapping = {};
  for (const m of text.matchAll(ANCHOR_STAT_RE)) {
    const ch = m[1];
    if (!Object.hasOwn(mapping, ch)) mapping[ch] = '=';
  }

  const afterP = new Map();
  for (const m of text.matchAll(ANCHOR_P_RE)) {
    const ch = m[1];
    if (Object.hasOwn(mapping, ch)) continue;
    const value = Number(m[2]);
    if (!Number.isFinite(value)) continue;
    if (!afterP.has(ch)) afterP.set(ch, []);
    afterP.get(ch).push(value);
  }
  for (const [ch, values] of afterP) {
    // A p-value written with a less-than sign is nearly always a round
    // threshold: .05, .01, .001. An equals sign carries an arbitrary value.
    const shareRound = values.filter((v) => P_THRESHOLDS.has(v)).length / Math.max(values.length, 1);
    mapping[ch] = shareRound >= 0.8 ? '<' : '=';
  }
  return mapping;
}

function repairSimple(text) {
  const mapping = inferSimpleMap(text);
  if (Object.keys(mapping).length === 0) return { text, replacements: 0 };

  let replacements = 0;
  const fix = (whole, ch) => {
    if (!Object.hasOwn(mapping, ch)) return whole;
    replacements += 1;
    return whole.replace(ch, mapping[ch]); // only the one captured character
  };
  let out = text.replace(ANCHOR_STAT_RE, fix);
  out = out.replace(ANCHOR_P_RE, fix);
  return { text: out, replacements };
}

// --------------------------------------------------------------- the stage --

/**
 * Repair the operators a PDF conversion destroyed.
 *
 * @param {string} text
 * @param {{spec: {repair: object}}} kit From `loadKit`.
 * @returns {{text: string, replacements: number}}
 */
export function repair(text, kit) {
  const spec = kit.spec.repair;
  const resultRe = buildResultPattern(spec);
  const mapping = inferValidated(text, spec, resultRe);

  if (Object.keys(mapping).length === 0) return repairSimple(text);

  const fixed = text.replace(resultRe, (whole) => {
    let out = whole;
    for (const [ch, op] of Object.entries(mapping)) out = out.replaceAll(ch, op);
    return out;
  });
  // Every occurrence of a repaired character anywhere in the document, not
  // only inside a matched result, matching the reference's own count.
  const replacements = Object.keys(mapping)
    .reduce((sum, ch) => sum + (text.split(ch).length - 1), 0);
  return { text: fixed, replacements };
}
