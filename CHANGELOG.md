# Changelog

## 0.2.1

- Kit from mother commit 9606a4f, with the parity case `nbsp-operators` (no-break spaces
  around operators).
- A value the model marks that the PDF split with spaces, such as `p <. 05`, is read as one
  number (`.05`); it came out with no p-value and an undecidable verdict. The rule is
  `split_number_rule` in `kit/parity/cases.json`. Kit from mother commit d366bec.
- `checkPdf` places a result on the first matching page at or after the page of the
  result before it. A short quote such as `ts = 3.1` also occurs on earlier pages, and
  the first match anywhere put a page-10 result on page 5.
- The demo shows a character the PDF's font did not map as �, explains it under the
  table, and gives each result that is not consistent a `why:` line from its `reason`.
  The verdict cell shows the reason on hover. Downloads are unchanged.
- The results tables are easier to read: one line per result, with a light dashed line
  between columns. A click on a row, or Enter, opens its quote, its sentence and the
  reason for its verdict on one line; `expand all` and `collapse all` sit above each
  table. A table wider than the screen scrolls inside its own box. The page is 120
  characters wide, not 96.
- The footer credits statcheck to Michèle B. Nuijten, the mother of statcheck, and her
  colleagues in one line, and
  links the author's website, https://rasoulnorouzi.github.io, for software updates.
- The demo has a day and night switch. It follows the system theme until the reader
  clicks, then keeps the choice in this browser.

## 0.2.0

- The kit ships the version 4 model `gate-none` (gru-crf, no noise, seed 0) from mother
  commit 1dfd184. It trained on the version 2 bronze windows plus 1165 passages labelled
  by three rater agents with human coders as a fourth vote. Holdout F1: model 0.921,
  hybrid 0.923 (was 0.904 and 0.908). On 169 human-coded papers the hybrid finds 0.763 of
  the results with a test name (was 0.723); that score was read before the model was
  chosen, so it is not a clean held-out score.
- `kit/spec/charmap.json` has 180 characters (one control character added). The model and
  the spec share it.

Earlier changes, also in 0.2.0:

- `line` is now the 0-based line of the statistic value, for results and fragments, not the first line of the unit. The rule is `line_rule` in `kit/parity/cases.json`.
- Spec version 2. `kit/spec/prefilter.json` now has `"unit": "passage"`:
  `units(text, kit)` merges overlapping and touching windows into one
  passage, and `checkText` reads each passage once. `prefilter` still
  returns windows.
- The dedup rule changed. A find is a duplicate when the character interval
  of its statistic overlaps the interval of a find already emitted, not when
  its rounded value repeats. Two results with the same value at different
  places are both kept. Every result carries `statistic_span`. The rule is
  `dedup_rule` in `kit/parity/cases.json`.
- A find with no test name is a fragment. `checkText` and `checkPdf` return
  it in `fragments`, with no `verdict`, `computed_p`, `reason` or `missing`,
  and never check it. `toMarkdown` and the demo page list fragments after the
  results, under a line that says a fragment has no test name and cannot be
  checked. `toJSON` carries them. `toCSV` does not.

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
- The demo page waits for `[ run ]` instead of starting on drop, and draws a
  progress bar while it works. `test/e2e.test.js` drives the page in Chromium:
  it found that choosing files through the button never worked, because
  clearing the input emptied the live `FileList` the handler was holding.
- Three modes, in the page and in `checkText`/`checkPdf`: `hybrid` (the default),
  `pattern` (statcheck's regular expressions alone) and `model` (the model
  alone). Each is explained on hover and under the choices; JSON, CSV and
  Markdown record the mode. The page credits statcheck and its authors.
