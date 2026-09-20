# Changelog

## Unreleased

- `demo/`: the page now takes up to ten PDFs at once, from a real
  `[ choose PDFs ]` button or the drop zone, checked one at a time with a
  status line per file (`onProgress` reading its pages) and one summary
  line when the run ends. A summary table lists every file (title, pages,
  result count, verdict tally, or `could not read` with the error's
  message), and each file gets its own results section — title (noting
  `(from the largest text on page 1)` when that is where it came from),
  a results table with `page, line, test, statistic, df, op, reported p,
  computed p, verdict, source`, and a dimmed row under each result carrying
  its exact quote and the sentence around it. Three links —
  `[ download JSON ]`, `[ download CSV ]`, `[ download Markdown ]` — build
  `statcheck-ml-report.json`/`.csv`/`.md` with `toJSON`/`toCSV`/`toMarkdown`
  over every file of the run, revoking the previous run's object URLs
  first. The pure parts of this (file filtering to the ten-file cap,
  verdict tallies, section headings, the download file names) live in
  `demo/support.js`, covered by `test/demo.test.js` under plain Node.

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
- `pdf`: `pdfToText` and `checkPdf`, reading a PDF with `pdfjs-dist`, using
  the same y-coordinate line grouping as the mother repository's
  `js/extract.js` and joining pages the way
  `statcheck_ml.pipeline.Pipeline.extract_text` does. Checked against the
  Python pipeline on a damaged sample paper: every `(test_type, statistic,
  verdict)` triple agreed.
- Fixed `loadKit`: `node:crypto` was imported at module scope, so the whole
  module failed to load in a browser even though the import was only ever
  used on the Node path. Moved next to the other Node-only imports in the
  same file, which are already lazy for this reason.
- `demo/`: a plain page — drop a PDF, get a results table and a JSON
  download — with the WASM builds of `onnxruntime-web` and `pdfjs-dist`
  vendored under `demo/vendor/` for a static host that cannot read
  `node_modules`.
- `.github/workflows/test.yml` (Node 20 and 24) and `pages.yml` (deploys
  the repository root to GitHub Pages on push to `main`).
- Fixed `pvalue`'s rounding rule: it allowed only for the rounding of the
  reported p-value, so it called some correctly reported results errors,
  such as `t(67) = 1.48, p = .143`. statcheck's own rule (`error_test` and
  `decision_error_test` in statcheck 1.5.0) allows for the rounding of the
  test statistic too, and `check` now mirrors it: `roundingInterval`
  brackets the p-value a rounded statistic could have implied, `pyRound`
  matches Python's tie-to-even rounding where `Number.prototype.toFixed`
  does not, `check` gains `statisticText` and `pZeroError` options, and
  `pipeline.js` threads the printed statistic and p-value text through to
  it from both the pattern and the model branch. Verdict agreement with the
  R package is now complete on the mother repository's baseline.
