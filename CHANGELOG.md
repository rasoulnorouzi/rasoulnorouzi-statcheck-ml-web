# Changelog

## 0.1.0

- Package skeleton: `package.json`, `LICENSE`, tests with vitest.
- `loadKit`: reads the port kit and verifies every file against
  `manifest.json` before the package trusts it.
- `normalize`: the JavaScript port of the normalisation stage, ported from
  the mother repository's `js/normalize.js`.
- `extract`: the pattern-based extraction stage, ported from
  `statcheck_ml/extract.py`.
- `special`: the incomplete beta and incomplete gamma functions, the log
  gamma and the complementary error function, written for this package so
  that it keeps no dependency.
- `pvalue`: the t, F, chi-square and normal tail probabilities, `computeP`,
  and the consistency check with the rounding rule of
  `statcheck_ml/pvalue.py`. Every p-value case in the parity file agrees
  with the Python reference to 2e-13 or better.
