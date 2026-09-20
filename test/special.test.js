// The special functions against SciPy, at points chosen to reach every
// branch: both sides of each expansion's switch, an argument at the edge of
// the range, and a degree of freedom large enough to show a cancellation.
//
// Every reference below is SciPy's own number. Each table is a row of the
// output of this command, run from the package root against the mother
// repository's virtual environment. Python's float repr is already a valid
// JavaScript literal, so the output is pasted as it is printed:
//
//   PYTHONIOENCODING=utf-8 ../../.venv/Scripts/python.exe -c "
//   from scipy import special
//   B=[(0.5,0.5,0.5),(0.001,0.5,0.5),(0.999,0.5,0.5),(1e-8,0.5,0.5),
//   (0.02,0.5,500),(0.001,0.5,500),(1e-6,0.5,500),(0.9,0.5,500),(0.25,1,1),
//   (0.3,2.5,3.5),(0.75,5,0.5),(0.002,5,0.5),(0.9974,500,0.5),
//   (0.16666666666666666,15,0.5),(0.99,10,10),(1e-12,2,3),(0.5,100,100),
//   (0.05,50,2),(0.2,2,50),(0.4,0.5,1.5)]
//   for x,a,b in B: print([x,a,b,float(special.betainc(a,b,x))])
//   G=[(0.5,1e-6),(500,600),(0.5,0.5),(0.5,1.5),(0.5,100),(1,1),(1.5,0.1),
//   (2.5,3),(5,250),(5,5.5352),(10,2),(50,50),(100,60),(100,140),(500,525),
//   (1000,1000),(0.5,12.5),(3,15),(0.25,1e-3),(2000,1900)]
//   for a,x in G: print([a,x,float(special.gammaincc(a,x))])
//   for x in [0.5,2.5,5,0.25,500.5,1000]: print([x,float(special.gammaln(x))])
//   for x in [0,0.5,1,2,5,8,10,27]: print([float(x),float(special.erfc(x))])
//   "

import {
  describe, it, expect, afterAll,
} from 'vitest';
import { erfc, logGamma, regIncBeta, regIncGammaUpper } from '../src/special.js';

const RELATIVE_TOLERANCE = 1e-12;

// Below this the comparison turns absolute. SciPy clamps erfc to zero once
// the exponent underflows, at x = 27, while this port lets the value fall
// into the subnormals and returns about 5.2e-319. Both answers are correct
// to every digit a double can hold there, and no caller divides by the
// result, so the two are required only to agree absolutely.
const ABSOLUTE_FLOOR = 1e-300;

/** [x, a, b, I_x(a, b)] */
const BETA_CASES = [
  [0.5, 0.5, 0.5, 0.5000000000000001],
  [0.001, 0.5, 0.5, 0.020135041633377492],
  [0.999, 0.5, 0.5, 0.9798649583666235],
  [1e-08, 0.5, 0.5, 6.366197734286143e-05],
  [0.02, 0.5, 500, 0.9999929977642102],
  [0.001, 0.5, 500, 0.6826895526902824],
  [1e-06, 0.5, 500, 0.025220823043776385],
  [0.9, 0.5, 500, 1.0],
  [0.25, 1, 1, 0.25],
  [0.3, 2.5, 3.5, 0.29675298929566646],
  [0.75, 5, 0.5, 0.0978546142578125],
  [0.002, 5, 0.5, 7.881570949823857e-15],
  [0.9974, 500, 0.5, 0.1067232433953078],
  [0.16666666666666666, 15, 0.5, 3.3450830050127835e-13],
  [0.99, 10, 10, 0.9999999999999991],
  [1e-12, 2, 3, 5.999999999992001e-24],
  [0.5, 100, 100, 0.4999999999999993],
  [0.05, 50, 2, 4.307665335545619e-64],
  [0.2, 2, 50, 0.9998430027538023],
  [0.4, 0.5, 1.5, 0.7477845036444961],
];

/** [a, x, Q(a, x)] */
const GAMMA_CASES = [
  [0.5, 1e-06, 0.9988716212090307],
  [500, 600, 1.2255942330622893e-05],
  [0.5, 0.5, 0.31731050786291115],
  [0.5, 1.5, 0.08326451666355042],
  [0.5, 100, 2.0884875837625688e-45],
  [1, 1, 0.36787944117144245],
  [1.5, 0.1, 0.9775892977616494],
  [2.5, 3, 0.30621891841327875],
  [5, 250, 4.4147360999137545e-101],
  [5, 5.5352, 0.3520595718573703],
  [10, 2, 0.9999535019249828],
  [50, 50, 0.48119168452795674],
  [100, 60, 0.9999985184723673],
  [100, 140, 0.00016105717471255715],
  [500, 525, 0.13247405682147703],
  [1000, 1000, 0.4957947558197845],
  [0.5, 12.5, 5.733031437583875e-07],
  [3, 15, 3.930844818448459e-05],
  [0.25, 0.001, 0.8038483016172734],
  [2000, 1900, 0.9883041796188499],
];

/** [x, ln Γ(x)] */
const LOG_GAMMA_CASES = [
  [0.5, 0.5723649429247],
  [2.5, 0.2846828704729192],
  [5, 3.1780538303479458],
  [0.25, 1.2880225246980774],
  [500.5, 2608.2229044109863],
  [1000, 5905.220423209181],
];

/** [x, erfc(x)] */
const ERFC_CASES = [
  [0.0, 1.0],
  [0.5, 0.4795001221869535],
  [1.0, 0.15729920705028516],
  [2.0, 0.004677734981047266],
  [5.0, 1.5374597944280347e-12],
  [8.0, 1.1224297172982928e-29],
  [10.0, 2.0884875837625446e-45],
  [27.0, 0.0],
];

let worstRelative = 0;
let worstPoint = '';

/**
 * The distance from SciPy, measured the way the value's size allows.
 *
 * `ln Γ(1) = 0` is exact in both languages, and an exact zero has no
 * relative error to measure, so it falls to the absolute branch as well.
 */
function deviation(got, reference, point) {
  const scale = Math.abs(reference);
  if (scale > ABSOLUTE_FLOOR) {
    const relative = Math.abs(got - reference) / scale;
    if (relative > worstRelative) {
      worstRelative = relative;
      worstPoint = point;
    }
    return { value: relative, limit: RELATIVE_TOLERANCE };
  }
  return { value: Math.abs(got - reference), limit: ABSOLUTE_FLOOR };
}

afterAll(() => {
  console.log(`special: worst relative error against SciPy ${worstRelative.toExponential(3)} at ${worstPoint}`);
});

describe('regIncBeta', () => {
  for (const [x, a, b, expected] of BETA_CASES) {
    it(`I_${x}(${a}, ${b})`, () => {
      const { value, limit } = deviation(regIncBeta(x, a, b), expected, `regIncBeta(${x}, ${a}, ${b})`);
      expect(value).toBeLessThan(limit);
    });
  }

  it('saturates rather than passing the unit interval', () => {
    expect(regIncBeta(0, 2, 3)).toBe(0);
    expect(regIncBeta(1, 2, 3)).toBe(1);
    expect(regIncBeta(-0.5, 2, 3)).toBe(0);
    expect(regIncBeta(1.5, 2, 3)).toBe(1);
  });
});

describe('regIncGammaUpper', () => {
  for (const [a, x, expected] of GAMMA_CASES) {
    it(`Q(${a}, ${x})`, () => {
      const { value, limit } = deviation(regIncGammaUpper(a, x), expected, `regIncGammaUpper(${a}, ${x})`);
      expect(value).toBeLessThan(limit);
    });
  }

  it('reports the whole mass below the support', () => {
    expect(regIncGammaUpper(3, 0)).toBe(1);
    expect(regIncGammaUpper(3, -5)).toBe(1);
  });
});

describe('logGamma', () => {
  for (const [x, expected] of LOG_GAMMA_CASES) {
    it(`ln Γ(${x})`, () => {
      const { value, limit } = deviation(logGamma(x), expected, `logGamma(${x})`);
      expect(value).toBeLessThan(limit);
    });
  }

  it('cancels to zero at the two arguments where the gamma is one', () => {
    // ln Γ(1) and ln Γ(2) are exactly zero. The Lanczos sum arrives there by
    // cancellation rather than landing on it, and leaves about one part in
    // 1e15 behind, where Cephes returns the exact zero because it names the
    // small integers as special cases. Nothing here reads the logarithm
    // without exponentiating it again, so the difference stays at the size
    // of a rounding step.
    expect(Math.abs(logGamma(1))).toBeLessThan(1e-15);
    expect(Math.abs(logGamma(2))).toBeLessThan(1e-15);
  });
});

describe('erfc', () => {
  for (const [x, expected] of ERFC_CASES) {
    it(`erfc(${x})`, () => {
      const { value, limit } = deviation(erfc(x), expected, `erfc(${x})`);
      expect(value).toBeLessThan(limit);
    });
  }

  it('underflows gradually where SciPy clamps to zero', () => {
    // The decision this port takes at the end of the range: keep the
    // subnormal, which holds about five significant digits, until the format
    // itself reaches zero.
    expect(erfc(27)).toBeGreaterThan(0);
    expect(erfc(27)).toBeLessThan(1e-300);
    expect(erfc(28)).toBe(0);
  });

  it('reflects below zero', () => {
    expect(erfc(-1.5)).toBeCloseTo(2 - erfc(1.5), 15);
    expect(erfc(0)).toBe(1);
  });
});
