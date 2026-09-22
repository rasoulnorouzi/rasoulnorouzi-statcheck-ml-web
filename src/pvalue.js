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
  test_type: 'no test name',
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
  const kind = String(result.test_type ?? '').trim().toLowerCase();
  // Without the test's name no p-value can be computed: the same 7.42 with
  // df 8 is p = .49 as a chi-square and p = .00007 as a t. It is never guessed.
  if (kind === '') absent.push('test_type');
  if (result.statistic == null) absent.push('statistic');
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

/**
 * Count the digits after the first decimal point in a number written as
 * text.
 *
 * @param {string|number} reported
 * @returns {number}
 */
export function decimalsOf(reported) {
  const text = typeof reported === 'string' ? reported : pythonFloatText(reported);
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

/** Say whether a p-value counts as significant at `alpha`. */
function isSignificant(p, alpha, pEqualAlphaSig) {
  return pEqualAlphaSig ? p <= alpha : p < alpha;
}

/**
 * Python's `round(x, ndigits)` for a non-negative `ndigits`: round to that
 * many decimal places, ties to even, judged from the number's exact binary
 * value. `check` rounds `lowP`/`upP` to the p-value's own decimals before
 * comparing them with the reported p, so a bound that lands exactly halfway
 * decides a verdict, and JavaScript's own rounding does not agree with
 * Python there: `Number.prototype.toFixed` breaks a tie away from zero
 * ((2.5).toFixed(0) is "3"), while Python's `round` breaks it to the even
 * neighbour (`round(2.5)` is `2`). Checked against the venv's Python for
 * several bounds in `test/pvalue.test.js`.
 *
 * `toFixed` is specified to round against a number's exact mathematical
 * value rather than against a further approximation of it, so asking for
 * far more digits than `ndigits` reproduces that exact value's own decimal
 * digits out to where they end — a double's binary fraction is always
 * finite — and the tie is read straight off them.
 *
 * @param {number} x
 * @param {number} ndigits
 * @returns {number}
 */
export function pyRound(x, ndigits) {
  if (!Number.isFinite(x) || x === 0) return x;
  const sign = x < 0 ? -1 : 1;
  const magnitude = Math.abs(x);
  const text = magnitude.toFixed(Math.min(100, ndigits + 40));
  const dot = text.indexOf('.');
  const wholePart = text.slice(0, dot);
  const fracPart = text.slice(dot + 1);
  const keptDigits = wholePart + fracPart.slice(0, ndigits);
  const tailDigits = fracPart.slice(ndigits);

  // BigInt carries the possible +1 exactly, and `padStart` below restores
  // any leading zero a plain `BigInt -> String` round trip would drop, so
  // the digit boundary between the whole part and the decimals stays where
  // `ndigits` put it.
  let kept = BigInt(keptDigits === '' ? '0' : keptDigits);
  const firstTailDigit = Number(tailDigits[0] ?? '0');
  const tailIsExactlyHalf = firstTailDigit === 5 && /^0*$/.test(tailDigits.slice(1));
  if (firstTailDigit > 5 || (firstTailDigit === 5 && !tailIsExactlyHalf)) {
    kept += 1n;
  } else if (tailIsExactlyHalf && kept % 2n === 1n) {
    kept += 1n;
  }

  const digits = kept.toString().padStart(keptDigits.length, '0');
  const cut = digits.length - ndigits;
  const roundedWhole = digits.slice(0, cut) || '0';
  const roundedFrac = digits.slice(cut);
  const value = Number(ndigits > 0 ? `${roundedWhole}.${roundedFrac}` : roundedWhole);
  return sign * value;
}

/**
 * The p-values a test statistic could imply, given how it was rounded.
 *
 * A paper writes `t(67) = 1.48`. The true statistic is anywhere in
 * [1.475, 1.485], and each end implies a different p-value. statcheck
 * compares the reported p against that whole interval, and this port must
 * do the same or it calls a correctly reported result an error.
 *
 * @param {{test_type: string, statistic: number, df1: ?number, df2: ?number,
 *   one_tailed: ?boolean}} result
 * @param {?string} [statisticText] The statistic exactly as printed, for
 *   example "1.48". Without it the decimals are read off the number itself,
 *   which is right only when it was parsed from the text it was printed as.
 * @returns {[?number, ?number]} `[lowP, upP]`, or `[null, null]` when no p
 *   can be computed at either end.
 */
export function roundingInterval(result, statisticText) {
  const places = decimalsOf(statisticText != null ? statisticText : result.statistic);
  const half = 0.5 / (10 ** places);
  const statistic = Number(result.statistic);
  // The end nearer zero implies the larger p-value, so a negative statistic
  // swaps which end is which.
  const [near, far] = statistic >= 0
    ? [statistic - half, statistic + half]
    : [statistic + half, statistic - half];
  const upP = computeP(
    result.test_type, near, result.df1 ?? null, result.df2 ?? null, result.one_tailed ?? false,
  );
  const lowP = computeP(
    result.test_type, far, result.df1 ?? null, result.df2 ?? null, result.one_tailed ?? false,
  );
  if (upP == null || lowP == null) return [null, null];
  return [lowP, upP];
}

/**
 * Compare a reported p-value with the value implied by the statistic.
 *
 * The rule is statcheck's own (`error_test` and `decision_error_test` in
 * statcheck 1.5.0), because statcheck is the baseline this project is
 * measured against and its convention is what a reader expects. Both
 * numbers in a paper are rounded, and the comparison allows for both:
 * `reportedPText` gives the decimals of the p-value, `statisticText` the
 * decimals of the statistic. Without them the decimals are read from the
 * numbers themselves, which is right whenever they were parsed from the
 * text they were printed as.
 *
 * An inconsistency is not the same as a wrong conclusion. The verdict is
 * `decision_error` when the reported and the computed p-value fall on
 * opposite sides of `alpha`, and `inconsistent` when they disagree without
 * changing what the paper claims.
 *
 * @param {{test_type: string, statistic: ?number, df1: ?number, df2: ?number,
 *   p_operator: ?string, p_value: ?number, one_tailed: ?boolean}} result
 * @param {{alpha: ?number, pEqualAlphaSig: ?boolean, reportedPText: ?string,
 *   statisticText: ?string, pZeroError: ?boolean}} [options]
 * @returns {{verdict: string, computed_p: ?number, reported_p: ?number,
 *   reason: string, missing: string[]}}
 */
export function check(result, options = {}) {
  const {
    alpha = 0.05, pEqualAlphaSig = true, reportedPText = null,
    statisticText = null, pZeroError = true,
  } = options;
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

  let reported;
  let operator;
  if (result.p_operator === 'ns') {
    // "ns" is a claim about alpha, not a number: the paper says the result
    // was not significant. statcheck reads it as `p > alpha`, and so does
    // this.
    reported = alpha;
    operator = '>';
  } else if (result.p_value == null || !['=', '<', '>'].includes(result.p_operator)) {
    return {
      verdict: UNDECIDABLE,
      computed_p: computed,
      reported_p: result.p_value ?? null,
      reason: describeMissing(absent) || 'there is no reported p-value to compare against',
      missing: absent,
    };
  } else {
    reported = Number(result.p_value);
    operator = result.p_operator;
  }

  let [lowP, upP] = roundingInterval(result, statisticText);
  if (lowP == null) { lowP = computed; upP = computed; }

  let error;
  if (pZeroError && reported <= 0) {
    // No test gives a p-value of exactly zero, so the paper reports a
    // number that cannot be right, however small the computed value is.
    error = true;
  } else if (operator === '=') {
    const pDec = decimalsOf(reportedPText != null ? reportedPText : reported);
    error = reported > pyRound(upP, pDec) || reported < pyRound(lowP, pDec);
  } else if (operator === '<') {
    error = reported < lowP;
  } else {
    error = reported > upP;
  }

  if (!error) {
    return {
      verdict: CONSISTENT, computed_p: computed, reported_p: reported, reason: '', missing: [],
    };
  }

  // statcheck decides significance on the computed value itself, not on the
  // interval: the interval says whether the two numbers can agree, alpha
  // says what the paper concluded.
  const computedSignificant = isSignificant(computed, alpha, pEqualAlphaSig);
  let decisionError;
  if (operator === '=') {
    const reportedSignificant = isSignificant(reported, alpha, pEqualAlphaSig);
    decisionError = reportedSignificant !== computedSignificant;
  } else if (operator === '<') {
    decisionError = reported <= alpha && !computedSignificant;
  } else {
    decisionError = reported >= alpha && computedSignificant;
  }

  if (decisionError) {
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
