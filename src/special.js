// The special functions the tail probabilities are built on.
//
// SciPy calls Cephes for these. A browser has no Cephes, and the package
// carries no dependency, so this file reproduces the two functions every
// tail probability in `pvalue.js` reduces to: the regularised incomplete
// beta, and the regularised upper incomplete gamma.
//
// The algorithms are Numerical Recipes in C, 2nd edition, section 6.1
// (`gammln`), 6.2 (`gammp`, `gser`, `gcf`) and 6.4 (`betai`, `betacf`), with
// two departures. The Lanczos coefficients of section 6.1 are replaced by
// the g=7, n=9 set, because the book's own set holds only 10 digits. And
// the factor in front of each expansion is formed from that same Lanczos
// representation rather than from a difference of logarithms, because the
// difference cancels; `logBeta` and `gammaPrefix` say what that costs.
//
// Every function here is pure.

// Lanczos g=7 with 9 coefficients: the double-precision set from Godfrey's
// Lanczos notes (2001), reproduced widely since. It was fitted for this
// format, and measured against SciPy's `gammaln` on the arguments this
// package uses it holds about 15 significant digits, against the 2e-10 the
// book claims for the g=5, n=6 set it prints.
const LANCZOS_G = 7;
const LANCZOS = [
  0.99999999999980993,
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.13857109526572012,
  9.9843695780195716e-6,
  1.5056327351493116e-7,
];

// The Lentz guard. Numerical Recipes calls it FPMIN and sets it to the
// smallest number the machine can hold without underflow, to keep a
// denominator that lands on zero from producing an infinity on the next
// division. For a double that is about 1e-308, and 1e-300 leaves room for
// the multiplication that follows.
const TINY = 1e-300;

// Both continued fractions below are stopped by a term that no longer moves
// the running product. 1e-15 is a little above the double epsilon, so the
// loop ends on the iteration that reaches the precision the format can hold
// rather than spinning on rounding noise.
const EPS = 1e-15;

// The iteration caps, which are a stop against a fraction that will not
// converge rather than a working limit. Measured over a grid up to a = b =
// 2500, the beta fraction reaches EPS in at most 43 terms. The gamma series
// is the slow one: near the mean of its distribution it needs about 190
// terms at a = 500 and about 270 at a = 2000, which is a chi-square on 4000
// degrees of freedom, so 300 would begin to bind and 1000 does not.
const BETA_ITERATIONS = 300;
const GAMMA_ITERATIONS = 1000;

// Accuracy, measured against SciPy over that grid: the relative error of
// both functions stays below 1e-13 for the degrees of freedom a paper
// reports, and below 5e-13 out to several thousand. It grows with the
// degrees of freedom because the argument of the final exponential grows
// with them, and because the gamma fraction converges slowly where x is
// near a, which leaves about 2e-13 at a = 500. The parity suite accepts
// 1e-9, so this is three orders of margin.

const HALF_LOG_TWO_PI = 0.5 * Math.log(2 * Math.PI);

/** The Lanczos sum for Γ(x), evaluated at z = x - 1 as the fit is written. */
function lanczosSum(x) {
  const z = x - 1;
  let series = LANCZOS[0];
  for (let i = 1; i < LANCZOS.length; i += 1) series += LANCZOS[i] / (z + i);
  return series;
}

/**
 * The natural logarithm of the gamma function.
 *
 * @param {number} x
 * @returns {number} ln |Γ(x)|.
 */
export function logGamma(x) {
  // The Lanczos sum is only fitted for the right half plane. Euler's
  // reflection formula moves a smaller argument there. Every caller in this
  // package passes a positive half-integer, so the branch is reached only by
  // a fractional degree of freedom below one.
  if (x < 0.5) {
    return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - logGamma(1 - x);
  }
  const t = x + LANCZOS_G - 0.5;
  return HALF_LOG_TWO_PI + (x - 0.5) * Math.log(t) - t + Math.log(lanczosSum(x));
}

/**
 * The logarithm of the beta function, ln Γ(a) + ln Γ(b) - ln Γ(a+b).
 *
 * Formed as one expression rather than as three calls to `logGamma`, because
 * those three cancel. A t test on 1000 degrees of freedom asks for
 * ln Γ(500), ln Γ(1/2) and ln Γ(500.5), which are 2605.12, 0.57 and 2608.22.
 * A double holds a number near 2605 to about 5e-13, and the three of them
 * cancel down to -2.53, so the difference arrives with a relative error near
 * 4e-13, which the tail probability then carries.
 *
 * Substituting the Lanczos form of each term makes the cancellation exact
 * instead of numerical. The linear parts cancel to the constant 1/2 - g, and
 * the logarithms collect into ratios that `log1p` evaluates without ever
 * forming a large number:
 *
 *   ln B(a,b) = ln√(2π) + 1/2 - g
 *             + (a-1/2) ln(ta/tc) + (b-1/2) ln(tb/tc) - (1/2) ln tc
 *             + ln S(a) + ln S(b) - ln S(a+b),   t* = * + g - 1/2
 *
 * Below 1/2 the Lanczos sum is not fitted and the reflection formula has to
 * run, so that case falls back to the three separate logarithms. It costs
 * nothing there: the arguments are small and so is what they cancel to.
 */
function logBeta(a, b) {
  if (a < 0.5 || b < 0.5) return logGamma(a) + logGamma(b) - logGamma(a + b);

  const tc = a + b + LANCZOS_G - 0.5;
  return HALF_LOG_TWO_PI + (0.5 - LANCZOS_G)
    + (a - 0.5) * Math.log1p(-b / tc) + (b - 0.5) * Math.log1p(-a / tc)
    - 0.5 * Math.log(tc)
    + Math.log(lanczosSum(a)) + Math.log(lanczosSum(b)) - Math.log(lanczosSum(a + b));
}

/**
 * The continued fraction of Numerical Recipes `betacf`, evaluated by the
 * modified Lentz method.
 *
 * It converges quickly only for x below (a+1)/(a+b+2); `regIncBeta` is what
 * enforces that, by reflecting the other half of the range.
 */
function betaContinuedFraction(x, a, b) {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;

  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= BETA_ITERATIONS; m += 1) {
    const m2 = 2 * m;

    // The even step of the recurrence.
    let num = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + num * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + num / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;

    // The odd step.
    num = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + num * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + num / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const step = d * c;
    h *= step;

    if (Math.abs(step - 1) < EPS) break;
  }
  return h;
}

/**
 * The regularised incomplete beta function I_x(a, b).
 *
 * @param {number} x In [0, 1].
 * @param {number} a Positive.
 * @param {number} b Positive.
 * @returns {number} In [0, 1].
 */
export function regIncBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  // The factor x^a (1-x)^b / B(a, b), which both branches share. It is built
  // in the exponent because the two parts leave the range of a double long
  // before their quotient does: at x = 1/2 with a = 1000 and b = 500 the
  // numerator is 0.5^1500, which is zero, and 1/B(a,b) is an overflow, while
  // the quotient they make is 3.7e-39. `log1p` holds the second term exactly
  // for the x near zero that a large statistic produces.
  const front = Math.exp(a * Math.log(x) + b * Math.log1p(-x) - logBeta(a, b));

  if (x < (a + 1) / (a + b + 2)) return (front * betaContinuedFraction(x, a, b)) / a;
  // I_x(a, b) = 1 - I_(1-x)(b, a). Past the switch point the fraction for
  // the reflected argument is the one that converges.
  return 1 - (front * betaContinuedFraction(1 - x, b, a)) / b;
}

/**
 * The factor exp(-x + a ln x - ln Γ(a)) that both gamma expansions carry.
 *
 * Written the way Numerical Recipes prints it, the three terms cancel for
 * the same reason `logBeta` does: a chi-square of 1050 on 1000 degrees of
 * freedom asks for a·ln x = 3131.70 and ln Γ(500) = 2605.12, against x =
 * 525, and the three cancel to 1.58. Substituting the Lanczos form of
 * ln Γ(a) turns that into
 *
 *   a ln(x/ta) + (ta - x) + (1/2) ln ta - ln√(2π) - ln S(a),   ta = a + g - 1/2
 *
 * whose largest term is the size of the distance from the mean rather than
 * the size of ln Γ(a). Below 1/2 the Lanczos sum is not fitted, so that case
 * keeps the plain form.
 */
function gammaPrefix(a, x) {
  if (a < 0.5) return Math.exp(-x + a * Math.log(x) - logGamma(a));
  const ta = a + LANCZOS_G - 0.5;
  return Math.exp(
    a * Math.log(x / ta) + (ta - x) + 0.5 * Math.log(ta)
    - HALF_LOG_TWO_PI - Math.log(lanczosSum(a)),
  );
}

/**
 * The series of Numerical Recipes `gser`, returning the lower P(a, x).
 *
 * It converges fastest below x = a + 1, which is where `regIncGammaUpper`
 * sends it.
 */
function gammaSeries(a, x) {
  let ap = a;
  let term = 1 / a;
  let sum = term;
  for (let n = 1; n <= GAMMA_ITERATIONS; n += 1) {
    ap += 1;
    term *= x / ap;
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * EPS) break;
  }
  return sum * gammaPrefix(a, x);
}

/**
 * The continued fraction of Numerical Recipes `gcf`, returning the upper
 * Q(a, x) directly, by the modified Lentz method.
 */
function gammaContinuedFraction(a, x) {
  let b = x + 1 - a;
  let c = 1 / TINY;
  let d = 1 / b;
  let h = d;

  for (let i = 1; i <= GAMMA_ITERATIONS; i += 1) {
    const num = -i * (i - a);
    b += 2;
    d = num * d + b;
    if (Math.abs(d) < TINY) d = TINY;
    c = b + num / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const step = d * c;
    h *= step;
    if (Math.abs(step - 1) < EPS) break;
  }

  // The prefactor is formed in the exponent, so a chi-square far into its
  // tail -- 500 on 10 degrees of freedom gives 4e-101 -- keeps its
  // significant digits instead of underflowing on the way.
  return gammaPrefix(a, x) * h;
}

/**
 * The regularised upper incomplete gamma function Q(a, x) = 1 - P(a, x).
 *
 * @param {number} a Positive.
 * @param {number} x Non-negative.
 * @returns {number} In [0, 1].
 */
export function regIncGammaUpper(a, x) {
  // SciPy's survival functions report 1 below the support of a distribution
  // rather than an error, and `pvalue.js` depends on that, because a
  // negative chi-square reaches this function from a misread paper.
  if (x <= 0) return 1;
  if (x < a + 1) return 1 - gammaSeries(a, x);
  return gammaContinuedFraction(a, x);
}

/**
 * The complementary error function.
 *
 * This is Q(1/2, x²), the identity that ends Numerical Recipes section 6.2,
 * so the accuracy is the accuracy of `regIncGammaUpper` and no separate
 * rational approximation has to be trusted. The switch inside that function
 * falls at x² = 1.5, and below it the result is formed as 1 - P, a
 * subtraction that gives up about one digit. Measured against SciPy, that
 * corner is the worst of the ordinary range at 1.3e-14, at x = 1.2; the
 * other end costs more, 4.2e-14 at x = 26, where the exponent itself is
 * -676 and its last bit is worth more than the answer's last digit.
 *
 * Large x underflows gradually rather than being clamped: erfc(27) comes out
 * as a subnormal near 5.2e-319, which carries about five significant digits,
 * and erfc(28) and above reach zero the way the IEEE format demands. Nothing
 * in this package divides by the result, so a subnormal is as safe as a zero
 * and holds more information.
 *
 * @param {number} x
 * @returns {number} In [0, 2].
 */
export function erfc(x) {
  const upper = regIncGammaUpper(0.5, x * x);
  // erfc(-x) = 2 - erfc(x). The squaring loses the sign, so it is restored
  // here rather than inside the gamma function.
  return x >= 0 ? upper : 2 - upper;
}
