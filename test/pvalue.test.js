// Every `pvalue` case from the kit's parity file, against the JavaScript
// port, plus the properties the parity file cannot state: that each tail
// probability stays inside the unit interval and falls as the statistic
// grows.
//
// The parity file is the acceptance line. A case that fails here is a
// verdict this port would get wrong on a real paper, so the tolerance below
// is never the thing to change.

import {
  describe, it, expect, afterAll,
} from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import {
  CONSISTENT, DECISION_ERROR, INCONSISTENT, UNDECIDABLE,
  check, chi2Sf, computeP, fSf, normSf, parseNumber, tSf,
} from '../src/pvalue.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const kitDir = path.join(here, '..', 'kit');
const parity = JSON.parse(fs.readFileSync(path.join(kitDir, 'parity', 'cases.json'), 'utf8'));
const cases = parity.sections.pvalue;

// The reference recomputes a p-value in double precision through SciPy, and
// this port does it through its own series, so the last digits differ. A
// disagreement that matters to a verdict is many orders of magnitude larger
// than this.
const RELATIVE_TOLERANCE = 1e-9;

let worstRelative = 0;
let worstCase = '';

afterAll(() => {
  console.log(`pvalue: worst relative error over the parity computed_p values ${worstRelative.toExponential(3)} at ${worstCase}`);
});

describe('pvalue parity', () => {
  for (const c of cases) {
    it(c.name, () => {
      const result = {
        test_type: c.test_type,
        statistic: c.statistic,
        df1: c.df1,
        df2: c.df2,
        p_operator: c.p_operator,
        p_value: parseNumber(c.p_text),
      };
      const got = check(result, { reportedPText: c.p_text });

      expect(got.verdict).toBe(c.expected.verdict);

      if (c.expected.computed_p === null) {
        expect(got.computed_p).toBeNull();
        return;
      }
      expect(got.computed_p).not.toBeNull();
      const relative = Math.abs(got.computed_p - c.expected.computed_p)
        / Math.abs(c.expected.computed_p);
      if (relative > worstRelative) {
        worstRelative = relative;
        worstCase = c.name;
      }
      expect(relative).toBeLessThan(RELATIVE_TOLERANCE);
    });
  }

  it('still carries every edge the port was built against', () => {
    // A regenerated parity file that quietly loses one of these rows would
    // leave the hardest branches of this port untested while the suite still
    // passed.
    const edges = [
      'chi2-df1-eq-1', 'chi2-df-eq-1000', 'chi2-df1-eq-0-nan',
      't-df1-eq-1', 't-df-eq-1000', 't-huge-stat-40',
      'f-df1-eq-1', 'f-df2-eq-1', 'f-df2-eq-1000',
      'r-df1-eq-1', 'r-near-one-0999', 'r-equals-one-undecidable',
      't-p-text-zero', 't-p-text-dot-000', 't-p-text-lt-dot001',
      't-decision-error', 't-operator-gt', 't-p-value-none',
    ];
    const present = new Set(cases.map((c) => c.name));
    expect(edges.filter((name) => !present.has(name))).toEqual([]);
  });
});

describe('parseNumber', () => {
  it('reads the p-value text the extractor produces', () => {
    expect(parseNumber('.003')).toBe(0.003);
    expect(parseNumber('<.001')).toBe(0.001);
    expect(parseNumber('0')).toBe(0);
    expect(parseNumber('.000')).toBe(0);
    expect(parseNumber('0.05')).toBe(0.05);
    expect(parseNumber('  = .5 ')).toBe(0.5);
  });

  it('accepts the Unicode minus and the en dash the corpus shows', () => {
    expect(parseNumber('−.05')).toBe(-0.05);
    expect(parseNumber('–1.5')).toBe(-1.5);
  });

  it('returns null where the reference returns None', () => {
    expect(parseNumber(null)).toBeNull();
    expect(parseNumber(undefined)).toBeNull();
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('<')).toBeNull();
    expect(parseNumber('n.s.')).toBeNull();
  });
});

describe('computeP', () => {
  it('refuses a non-positive degree of freedom', () => {
    expect(computeP('t', 2, 0)).toBeNull();
    expect(computeP('t', 2, -5)).toBeNull();
    expect(computeP('f', 2, 3, 0)).toBeNull();
  });

  it('refuses a correlation at or beyond one', () => {
    expect(computeP('r', 1, 15)).toBeNull();
    expect(computeP('r', -1, 15)).toBeNull();
    expect(computeP('r', 1.2, 15)).toBeNull();
    expect(computeP('r', 0.99, 15)).not.toBeNull();
  });

  it('refuses a test it does not know, and one with no statistic', () => {
    expect(computeP('wilcoxon', 2, 10)).toBeNull();
    expect(computeP('t', null, 10)).toBeNull();
    expect(computeP('z', null)).toBeNull();
  });

  it('treats a name an object already answers to as unknown', () => {
    // The reference looks the test name up in a dictionary, which holds
    // nothing but the six names. A JavaScript object answers to more than
    // it was given, and reading an inherited member here would crash the
    // check instead of returning a verdict.
    expect(computeP('constructor', 2, 10)).toBeNull();
    const got = check({
      test_type: 'constructor', statistic: 2, df1: null, df2: null, p_operator: '=', p_value: 0.05,
    });
    expect(got.verdict).toBe(UNDECIDABLE);
    expect(got.missing).toEqual(['df1']);
    expect(got.reason).toBe('no degrees of freedom found beside this result');
  });

  it('halves a one-tailed p-value, except for F', () => {
    const twoTailed = computeP('t', 2.5, 18);
    expect(computeP('t', 2.5, 18, null, true)).toBeCloseTo(twoTailed / 2, 15);
    // An F test is one-tailed by construction, so the flag never reaches it.
    const f = computeP('f', 4.11, 2, 30);
    expect(computeP('f', 4.11, 2, 30, true)).toBe(f);
  });

  it('reads the test name whatever case and spacing it arrives in', () => {
    expect(computeP(' T ', 2.5, 18)).toBe(computeP('t', 2.5, 18));
    expect(computeP('CHI2', 11.07, 5)).toBe(computeP('chi2', 11.07, 5));
  });
});

describe('check', () => {
  it('names every part it needed and did not get', () => {
    const got = check({
      test_type: 't', statistic: 2, df1: null, df2: null, p_operator: null, p_value: null,
    });
    expect(got.verdict).toBe(UNDECIDABLE);
    expect(got.missing).toEqual(['df1', 'p_value']);
    expect(got.reason).toBe('no degrees of freedom and no p-value found beside this result');
  });

  it('separates a missing operator from a missing p-value', () => {
    const got = check({
      test_type: 't', statistic: 2, df1: 10, df2: null, p_operator: null, p_value: 0.05,
    });
    expect(got.verdict).toBe(UNDECIDABLE);
    expect(got.missing).toEqual(['p_operator']);
    expect(got.reason).toBe('no operator before the p-value found beside this result');
    // The p-value could not be compared, but it could be recomputed, and the
    // reference reports it.
    expect(got.computed_p).toBeGreaterThan(0.07);
  });

  it('blames the value when no part is missing', () => {
    const got = check({
      test_type: 'r', statistic: 1, df1: 15, df2: null, p_operator: '=', p_value: 0.05,
    });
    expect(got.verdict).toBe(UNDECIDABLE);
    expect(got.missing).toEqual([]);
    expect(got.reason).toBe('the statistic and its degrees of freedom give no p-value');
  });

  it('allows the rounding the author applied, and no more', () => {
    // t(20) = 1.5 gives p = .14924. Two decimals round to .15, so .14 is a
    // real disagreement; three decimals round to .149 and agree.
    const result = {
      test_type: 't', statistic: 1.5, df1: 20, df2: null, p_operator: '=', p_value: 0.14,
    };
    expect(check(result, { reportedPText: '.14' }).verdict).toBe(INCONSISTENT);
    expect(check({ ...result, p_value: 0.149 }, { reportedPText: '.149' }).verdict)
      .toBe(CONSISTENT);
    // A bare "0" reports no decimals at all, which leaves half a unit of
    // tolerance and swallows anything below .5.
    expect(check({ ...result, p_value: 0 }, { reportedPText: '0' }).verdict).toBe(CONSISTENT);
  });

  it('counts the decimals of a float the way Python prints it', () => {
    // With no text the reference falls back to `str(p_value)`. Python writes
    // 1e-05, which carries no decimals and so leaves half a unit of
    // tolerance; JavaScript writes 0.00001, which carries five and leaves
    // 5e-06. z = 1 gives p = .317, which sits between the two, so the
    // verdict turns on which string the count is taken from.
    const result = {
      test_type: 'z', statistic: 1, df1: null, df2: null, p_operator: '=', p_value: 1e-5,
    };
    expect(check(result).verdict).toBe(CONSISTENT);
    expect(check(result, { reportedPText: '0.00001' }).verdict).toBe(DECISION_ERROR);
  });

  it('reports a disagreement that flips the conclusion separately', () => {
    const result = {
      test_type: 't', statistic: 1.5, df1: 20, df2: null, p_operator: '=', p_value: 0.01,
    };
    expect(check(result, { reportedPText: '.01' }).verdict).toBe(DECISION_ERROR);
    // Both sides stay non-significant here, so the same size of gap is only
    // an inconsistency.
    expect(check({ ...result, p_value: 0.3 }, { reportedPText: '.3' }).verdict)
      .toBe(INCONSISTENT);
  });

  it('moves the significance line with alpha', () => {
    // t(60) = 1.8 gives p = .0769, and the paper claims p < .05. At alpha
    // .05 the claim is significant and the recomputed value is not, which is
    // the decision error; at alpha .10 both are significant and only the
    // numbers disagree.
    const result = {
      test_type: 't', statistic: 1.8, df1: 60, df2: null, p_operator: '<', p_value: 0.05,
    };
    expect(check(result).verdict).toBe(DECISION_ERROR);
    expect(check(result, { alpha: 0.1 }).verdict).toBe(INCONSISTENT);
  });

  it('lets the tie rule decide a p-value that lands on alpha', () => {
    // The rule only bites at equality, so alpha is set to the recomputed
    // value itself. With a tie counted as significant both sides agree about
    // significance and the disagreement is only numerical.
    const result = {
      test_type: 't', statistic: 1.8, df1: 60, df2: null, p_operator: '<', p_value: 0.05,
    };
    const alpha = computeP('t', 1.8, 60);
    expect(check(result, { alpha, pEqualAlphaSig: true }).verdict).toBe(INCONSISTENT);
    expect(check(result, { alpha, pEqualAlphaSig: false }).verdict).toBe(DECISION_ERROR);
  });
});

/**
 * The 32-bit mulberry generator, seeded so the sweep below is the same
 * sequence on every machine and in every run.
 */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('tail probabilities', () => {
  // The parity file fixes 64 points. These 200 pairs per distribution say
  // that nothing between them leaves the unit interval or turns back upward,
  // which is what a wrong branch in a continued fraction looks like.
  const SWEEP = 200;

  it('t stays in the unit interval and falls as the statistic grows', () => {
    const random = mulberry32(20260920);
    for (let i = 0; i < SWEEP; i += 1) {
      const df = 1 + random() * 500;
      const x = -20 + random() * 40;
      const step = random() * 5 + 1e-6;
      const p = tSf(x, df);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
      expect(tSf(x + step, df)).toBeLessThanOrEqual(p);
    }
  });

  it('chi-square stays in the unit interval and falls as the statistic grows', () => {
    const random = mulberry32(20260921);
    for (let i = 0; i < SWEEP; i += 1) {
      const df = 1 + random() * 500;
      const x = random() * 600;
      const step = random() * 20 + 1e-6;
      const p = chi2Sf(x, df);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
      expect(chi2Sf(x + step, df)).toBeLessThanOrEqual(p);
    }
  });

  it('F stays in the unit interval and falls as the statistic grows', () => {
    const random = mulberry32(20260922);
    for (let i = 0; i < SWEEP; i += 1) {
      const df1 = 1 + random() * 100;
      const df2 = 1 + random() * 500;
      const x = random() * 30;
      const step = random() * 3 + 1e-6;
      const p = fSf(x, df1, df2);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
      expect(fSf(x + step, df1, df2)).toBeLessThanOrEqual(p);
    }
  });

  it('the normal tail is symmetric about zero', () => {
    const random = mulberry32(20260923);
    expect(normSf(0)).toBe(0.5);
    for (let i = 0; i < SWEEP; i += 1) {
      const x = random() * 8;
      expect(normSf(-x) + normSf(x)).toBeCloseTo(1, 15);
      expect(normSf(x + 0.1)).toBeLessThanOrEqual(normSf(x));
    }
  });
});
