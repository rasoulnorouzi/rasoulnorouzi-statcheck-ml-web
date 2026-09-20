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
- `model`: `loadModel` and `tag`, running the shipped GRU-CRF tagger through
  `onnxruntime-web` on the WASM backend, with a Viterbi decode ported from
  `statcheck_ml/crf.py`. Every `model` and `model_logits` parity case
  agrees with the Python reference: every tag exactly, every logit to 1e-3
  absolute.
- `prefilter`, `repair`, `group`: the window selector, the arithmetic-
  validated operator repair with its simple-rule fallback, and the BIOES
  span reader, ported from `statcheck_ml/prefilter.py`,
  `statcheck_ml/repair_validated.py` and `statcheck_ml/labels.py` +
  `statcheck_ml/evalutil.py`.
- `pipeline`: `checkText`, the whole pipeline in the reference's order —
  normalise, repair, prefilter, then per window the pattern before the
  model, then the p-value check. Every `pipeline` parity case agrees with
  the Python reference.
- Fixed `extract`'s chi-square pattern: JavaScript's `\b` only knows the
  ASCII word characters, so it never matched before a Greek χ with a space
  on either side, unlike Python's Unicode-aware `\b`. No `extract` parity
  case exercised a real χ before this, so it surfaced as a `pipeline` case
  the model had to cover for with a worse guess. Replaced with a Unicode-
  aware lookbehind.
