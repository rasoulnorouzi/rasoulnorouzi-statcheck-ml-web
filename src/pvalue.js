// Recompute a p-value from a test statistic, and compare it with the
// reported one.
//
// This is the JavaScript port of `statcheck_ml/pvalue.py`, and it is
// deterministic mathematics. No model output ever reaches a verdict here. A
// confident wrong verdict is worse than no tool at all, so every branch of
// the reference is written out in the same order, and the verdict strings are
// the reference's own strings.
//
// SciPy's survival functions are reproduced through `special.js`:
//   t     2 * 0.5 * I_(df/(df+t²))(df/2, 1/2)
//   F     I_(df2/(df2+df1·F))(df2/2, df1/2)
//   chi²  Q(df/2, x/2)
//   z     erfc(|z| / √2) / 2, doubled
// Each identity is the one Cephes uses, so the two ports agree to the last
// few digits rather than to the tolerance of an approximation.
//
// A field this port reads may arrive as `null` from JSON or as `undefined`
// from a caller that left it out. Both mean the reference's `None`, so every
// test for an absent field is written `== null`, which is true for exactly
// those two values.

import { erfc, regIncBeta, regIncGammaUpper } from './special.js';

// statcheck reports two kinds of problem.
export const CONSISTENT = 'consistent';
export const INCONSISTENT = 'inconsistent';      // reported and computed p disagree
export const DECISION_ERROR = 'decision_error';  // they disagree about significance
export const UNDECIDABLE = 'undecidable';        // not enough information to judge

/** What each kind of test needs before a p-value can be recomputed. */
const REQUIRED_PARTS = {
  t: ['df1'], r: ['df1'], chi2: ['df1'], q: ['df1'],
  f: ['df1', 'df2'], z: [],
};

/** How to name each missing part to a reader. */
const PART_NAMES = {
  statistic: 'no test statistic',
  df1: 'no degrees of freedom',
  df2: 'no second degrees of freedom',
  p_value: 'no p-value',
  p_operator: 'no operator before the p-value',
};

/**
 * The survival function of Student's t distribution.
 *
 * @param {number} x
 * @param {number} df Degrees of freedom, positive.
 * @returns {number} P(T > x).
 */
export function tSf(x, df) {
  // The half tail. The incomplete beta gives the two-sided area, so the
  // factor of one half turns it into one side, and a negative x takes the
  // complement rather than a second evaluation.
  const tail = regIncBeta(df / (df + x * x), df / 2, 0.5) / 2;
  return x >= 0 ? tail : 1 - tail;
}

/**
 * The survival function of the F distribution.
 *
 * @param {number} x
 * @param {number} df1 Numerator degrees of freedom, positive.
 * @param {number} df2 Denominator degrees of freedom, positive.
 * @returns {number} P(F > x).
 */
export function fSf(x, df1, df2) {
  // Below the support SciPy reports 1 rather than failing, and a misread
  // paper does reach this function with a negative F.
  if (x <= 0) return 1;
  return regIncBeta(df2 / (df2 + df1 * x), df2 / 2, df1 / 2);
}

/**
 * The survival function of the chi-square distribution.
 *
 * @param {number} x
 * @param {number} df Degrees of freedom, positive.
 * @returns {number} P(X > x).
 */
export function chi2Sf(x, df) {
  return regIncGammaUpper(df / 2, x / 2);
}

/**
 * The survival function of the standard normal distribution.
 *
 * @param {number} x
 * @returns {number} P(Z > x).
 */
export function normSf(x) {
  return erfc(x / Math.SQRT2) / 2;
}

/**
 * Text such as ".03" or "<.001" to a number, or null.
 *
 * Mirrors `parse_number` in the mother repository's `tests/parity_lib.py`:
 * strip a leading comparison operator, restore a missing leading zero,
 * accept the Unicode minus and the en dash statcheck's corpus shows.
 *
 * The reference calls Python's `float`, which also reads "inf" and "nan".
 * This port rejects both, because a p-value is a finite number and no
 * extractor in the package can produce that text.
 *
 * @param {string|number|null|undefined} text
 * @returns {?number}
 */
export function parseNumber(text) {
  if (text == null || text === '') return null;
  let s = String(text).trim().replace(/−/g, '-').replace(/–/g, '-');
  s = s.replace(/^[<>=]+/, '').trim();
  if (s === '') return null;
  if (s.startsWith('.')) s = `0${s}`;
  else if (s.startsWith('-.')) s = `-0${s.slice(1)}`;
  const value = Number(s);
  return Number.isFinite(value) ? value : null;
}

/**
 * Return the p-value implied by a test statistic, or null if it cannot be
 * found.
 *
 * The p-value is two-tailed by default, which is what statcheck assumes.
 *
 * @param {string} testType One of t, f, r, z, chi2, q.
 * @param {?number} statistic
 * @param {?number} [df1]
 * @param {?number} [df2]
 * @param {boolean} [oneTailed]
 * @returns {?number}
 */
export function computeP(testType, statistic, df1 = null, df2 = null, oneTailed = false) {
  const kind = String(testType ?? '').trim().toLowerCase();
  if (statistic == null) return null;
  // SciPy returns nan, not an error, for a non-positive degree of freedom,
  // and nan would then pass through the comparison as a number.
  if ((df1 != null && df1 <= 0) || (df2 != null && df2 <= 0)) return null;

  let p;
  if (kind === 't') {
    if (df1 == null) return null;
    p = 2 * tSf(Math.abs(statistic), df1);
  } else if (kind === 'f') {
    if (df1 == null || df2 == null) return null;
    // An F test is one-tailed by construction. The `oneTailed` flag refers
    // to the hypothesis, not to this distribution, so it is not applied
    // here, and the reference returns before the halving for the same
    // reason.
    return fSf(statistic, df1, df2);
  } else if (kind === 'r') {
    if (df1 == null) return null;
    const r = Number(statistic);
    if (Math.abs(r) >= 1) return null;
    // Convert the correlation to a t statistic on df1 degrees of freedom.
    const tValue = r * Math.sqrt(df1 / (1 - r * r));
    p = 2 * tSf(Math.abs(tValue), df1);
  } else if (kind === 'z') {
    p = 2 * normSf(Math.abs(statistic));
  } else if (kind === 'chi2' || kind === 'q') {
    if (df1 == null) return null;
    return chi2Sf(statistic, df1);
  } else {
    return null;
  }

  if (oneTailed) p /= 2;
  return Number.isNaN(p) ? null : p;   // nan never leaves this function
}

/**
 * Name every part the check needs and the result does not carry.
 *
 * More than one published result in five carries no p-value at all, measured
 * over 323 results of this corpus. Nothing can recover a number the author
 * did not print, so the tool says which part is absent instead of returning
 * a bare "undecidable".
 */
function missingParts(result) {
  const absent = [];
  if (result.statistic == null) absent.push('statistic');
  const kind = String(result.test_type ?? '').trim().toLowerCase();
  // An unknown test name falls back to asking for df1, exactly as the
  // reference's dictionary default does. The lookup asks for an own
  // property, because a plain object also answers to "constructor" and
  // "toString", and the reference's dictionary does not.
  const required = Object.hasOwn(REQUIRED_PARTS, kind) ? REQUIRED_PARTS[kind] : ['df1'];
  for (const part of required) {
    if (result[part] == null) absent.push(part);
  }
  if (result.p_value == null) absent.push('p_value');
  else if (!['=', '<', '>'].includes(result.p_operator)) absent.push('p_operator');
  return absent;
}

/**
 * Write the missing parts as a sentence a reader can act on.
 *
 * The sentence reports an observation, not a cause. Whether the author
 * omitted the part, the font destroyed it, or the extraction missed it is a
 * separate question, and the quote beside the result is what answers it.
 */
function describeMissing(parts) {
  if (parts.length === 0) return '';
  const names = parts.map((part) => (Object.hasOwn(PART_NAMES, part) ? PART_NAMES[part] : part));
  if (names.length === 1) return `${names[0]} found beside this result`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} found beside this result`;
}

/**
 * Python's `repr` of a float, which is what the reference's `_decimals`
 * counts when the caller passes no text.
 *
 * `String(1e-5)` is "0.00001" in JavaScript and "1e-05" in Python, so the
 * two languages disagree about how many decimals were reported, and the
 * tolerance would differ by five orders of magnitude on that path. Both
 * languages print the shortest digits that read back to the same double;
 * only the choice between positional and exponent notation differs, and
 * Python makes it at an exponent below -4 or at 16 and above.
 */
function pythonFloatText(value) {
  if (Number.isNaN(value)) return 'nan';
  if (value === Infinity) return 'inf';
  if (value === -Infinity) return '-inf';

  const sign = value < 0 || Object.is(value, -0) ? '-' : '';
  const magnitude = Math.abs(value);
  if (magnitude === 0) return `${sign}0.0`;

  const [mantissa, power] = magnitude.toExponential().split('e');
  const exponent = Number(power);
  const digits = mantissa.replace('.', '');

  if (exponent < -4 || exponent >= 16) {
    const head = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    const tail = String(Math.abs(exponent)).padStart(2, '0');
    return `${sign}${head}e${exponent < 0 ? '-' : '+'}${tail}`;
  }
  if (exponent >= 0) {
    const whole = digits.padEnd(exponent + 1, '0').slice(0, exponent + 1);
    return `${sign}${whole}.${digits.slice(exponent + 1) || '0'}`;
  }
  return `${sign}0.${'0'.repeat(-exponent - 1)}${digits}`;
}

/** Count the digits after the first decimal point in a number written as text. */
function decimals(reported) {
  const text = typeof reported === 'string' ? reported : pythonFloatText(reported);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

/** Say whether a p-value counts as significant at `alpha`. */
function isSignificant(p, alpha, pEqualAlphaSig) {
  return pEqualAlphaSig ? p <= alpha : p < alpha;
}

/**
 * Compare a reported p-value with the value implied by the statistic.
 *
 * `reportedPText` is the p-value exactly as written, for example ".03". It
 * is used to learn how many decimals were reported, so the comparison allows
 * for the rounding the author applied. A reported .03 stands for any value
 * that rounds to .03 at the same number of decimals, which is a tolerance of
 * half of the last reported place. Text such as "<.001" carries its three
 * decimals through the leading operator, and a bare "0" reports none, which
 * leaves the tolerance at one half.
 *
 * @param {{test_type: string, statistic: ?number, df1: ?number, df2: ?number,
 *   p_operator: ?string, p_value: ?number, one_tailed: ?boolean}} result
 * @param {{alpha: ?number, pEqualAlphaSig: ?boolean,
 *   reportedPText: ?string}} [options]
 * @returns {{verdict: string, computed_p: ?number, reported_p: ?number,
 *   reason: string, missing: string[]}}
 */
export function check(result, options = {}) {
  const { alpha = 0.05, pEqualAlphaSig = true, reportedPText = null } = options;
  const computed = computeP(
    result.test_type, result.statistic, result.df1 ?? null, result.df2 ?? null,
    result.one_tailed ?? false,
  );
  const absent = missingParts(result);

  if (computed == null) {
    // Name the part that is absent. When every part is present the fault is
    // the value itself, such as a correlation at or beyond 1.
    const reason = absent.length > 0 ? describeMissing(absent)
      : 'the statistic and its degrees of freedom give no p-value';
    return {
      verdict: UNDECIDABLE,
      computed_p: null,
      reported_p: result.p_value ?? null,
      reason,
      missing: absent,
    };
  }
  if (result.p_value == null || !['=', '<', '>'].includes(result.p_operator)) {
    return {
      verdict: UNDECIDABLE,
      computed_p: computed,
      reported_p: result.p_value ?? null,
      reason: describeMissing(absent) || 'there is no reported p-value to compare against',
      missing: absent,
    };
  }

  const reported = Number(result.p_value);
  const operator = result.p_operator;

  let agrees;
  if (operator === '=') {
    const places = decimals(reportedPText != null ? reportedPText : result.p_value);
    const tolerance = places > 0 ? 0.5 * (10 ** -places) : 0.5;
    agrees = Math.abs(computed - reported) <= tolerance;
  } else if (operator === '<') {
    agrees = computed < reported;
  } else {
    agrees = computed > reported;
  }

  if (agrees) {
    return {
      verdict: CONSISTENT, computed_p: computed, reported_p: reported, reason: '', missing: [],
    };
  }

  // The values disagree. A disagreement that also flips the conclusion is
  // reported separately, because it changes what the paper claims.
  let reportedSignificant;
  if (operator === '=') reportedSignificant = isSignificant(reported, alpha, pEqualAlphaSig);
  else if (operator === '<') reportedSignificant = reported <= alpha;
  else reportedSignificant = false;
  const computedSignificant = isSignificant(computed, alpha, pEqualAlphaSig);

  if (reportedSignificant !== computedSignificant) {
    return {
      verdict: DECISION_ERROR,
      computed_p: computed,
      reported_p: reported,
      reason: 'the reported and computed p-values disagree about significance',
      missing: [],
    };
  }
  return {
    verdict: INCONSISTENT,
    computed_p: computed,
    reported_p: reported,
    reason: 'the reported and computed p-values disagree',
    missing: [],
  };
}
