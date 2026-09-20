# Changelog

## 0.1.0

- Package skeleton: `package.json`, `LICENSE`, tests with vitest.
- `loadKit`: reads the port kit and verifies every file against
  `manifest.json` before the package trusts it.
- `normalize`: the JavaScript port of the normalisation stage, ported from
  the mother repository's `js/normalize.js`.
- `extract`: the pattern-based extraction stage, ported from
  `statcheck_ml/extract.py`.
