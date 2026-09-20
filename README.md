# statcheck-ml

statcheck-ml is the browser and npm port of statcheck-ml. It reads a
statistical result from text or from a PDF, and checks its p-value against
the test statistic, without sending anything to a server. The demo page is
at https://rasoulnorouzi.github.io/rasoulnorouzi-statcheck-ml-web/. For a full
walkthrough, with every Node example executed against this repository, see
[`docs/TUTORIAL.md`](docs/TUTORIAL.md).

[![test](https://github.com/rasoulnorouzi/rasoulnorouzi-statcheck-ml-web/actions/workflows/test.yml/badge.svg)](https://github.com/rasoulnorouzi/rasoulnorouzi-statcheck-ml-web/actions/workflows/test.yml)
[![pages](https://github.com/rasoulnorouzi/rasoulnorouzi-statcheck-ml-web/actions/workflows/pages.yml/badge.svg)](https://github.com/rasoulnorouzi/rasoulnorouzi-statcheck-ml-web/actions/workflows/pages.yml)

## Install

    npm install statcheck-ml

This works when the package is published. Until then, install it from the
repository:

    npm install github:rasoulnorouzi/rasoulnorouzi-statcheck-ml-web

## Usage

In Node:

    import { loadKit, loadModel, checkText } from 'statcheck-ml';
    const kit = await loadKit('kit');
    const model = await loadModel(kit);
    const { results } = await checkText(documentText, kit, model);

In a browser, with `pdfjs-dist` and an import map for `onnxruntime-web`
(see `demo/index.html` for both):

    import { loadKit, loadModel, checkPdf } from './src/index.js';
    const kit = await loadKit('./kit');
    const model = await loadModel(kit);
    const { results } = await checkPdf(await file.arrayBuffer(), kit, model, { pdfjs });

## Stages

The pipeline has several stages. Each one reads the last stage's output.
This table lists every stage and says which ones this package has now.

| stage | in this package | function |
|---|---|---|
| kit loading and verification | yes | `loadKit` |
| normalise | yes | `normalize` |
| extract (regex baseline) | yes | `extract`, `extractWithSpans` |
| prefilter | yes | `prefilter` |
| repair | yes | `repair` |
| model (GRU-CRF, ONNX) | yes | `loadModel`, `tag` |
| group | yes | `group` |
| p-value check | yes | `computeP`, `check` |
| whole pipeline | yes | `checkText` |
| PDF reading | yes | `pdfToText`, `checkPdf` |
| report formats | yes | `toJSON`, `toCSV`, `toMarkdown` |

## The model

`loadModel(kit)` reads the shipped GRU-CRF model — `tagger.onnx`, its
character map, and its decoder — and creates an `onnxruntime-web`
inference session on the WASM backend, in Node and in a browser alike.
`tag(text, model)` runs it over one window of text and returns one BIOES
tag per character, decoded with the same Viterbi pass as the Python and R
ports when the model carries a CRF head.

`checkText(text, kit, model)` runs the whole pipeline: normalise, repair,
prefilter, then per window the pattern first and the model after it, adding
only what the pattern did not already find, then the p-value check. Pass
`null` in place of `model` to run the pattern alone.

    import { loadKit, loadModel, checkText } from 'statcheck-ml';

    const kit = await loadKit('kit');
    const model = await loadModel(kit);
    const { results } = await checkText(documentText, kit, model);

## PDF reading

`pdfToText(data, { pdfjs })` reads every page of a PDF with `pdfjs-dist` and
groups its positioned text items into lines by their y coordinate, the same
rule the mother repository's `js/extract.js` uses. Pages are joined with a
single newline, matching how `statcheck_ml.pipeline.Pipeline.extract_text`
joins PyMuPDF's pages. The text is not normalised here — `checkText` already
runs that stage — so `checkPdf(data, kit, model, { pdfjs })` is exactly
`pdfToText` followed by `checkText`.

`pdfjs` is passed in rather than imported by a fixed path, because the
build a caller needs differs: `pdfjs-dist/legacy/build/pdf.mjs` in Node,
the browser build with a worker configured in a page (see `demo/app.js`).

`pdfToText` also returns `pageTexts` (one entry per page, what `text` is
built from), and the paper's `title` with a `titleSource` of `"metadata"` or
`"largest-font"` saying where it came from. `checkPdf`'s result carries a
`page` on each result (the 1-based page it sits on, or `null` when it
cannot be placed), plus `title`, `titleSource`, and a `fileName` taken from
`pdfOptions.fileName`. Every result, from `checkText` or `checkPdf` alike,
also carries `quote` (the exact source text), `offset` (its position in the
text the pipeline scanned), and `context` (the sentence around it) — see
`docs/TUTORIAL.md` section 5 for the fields in full.

## Reports

`toJSON(docReports, kit, options?)`, `toCSV(docReports, kit)`, and
`toMarkdown(docReports, kit)` turn one or more checked documents into a file
a reader can act on. A `docReport` is `{fileName, title, titleSource, pages,
results, stages}` — what `checkPdf` returns, plus the file name — one per
PDF, so several documents can go into one report. `kit` is
`{version, model, mother_commit}`, printed into the JSON header and the
Markdown trailer. The CSV has one row per result (RFC 4180 quoting, CRLF
line endings), and the Markdown has one heading and one table per document,
with the quotes and their context in a numbered list under the table.

## Kit

This package ships with a kit: the shared spec, the trained model, and the
parity cases every port is measured against. See `kit/README.md` for what
the kit holds and how to verify it by hand.

## The p-value check

`computeP` recomputes the p-value from the test statistic. `check` compares
that value with the p-value the paper reports, and gives one of four
verdicts: `consistent`, `inconsistent`, `decision_error` or `undecidable`.

The package contains its own incomplete beta and incomplete gamma functions,
in `src/special.js`. It does not use a statistics library. The comparison is
closed-form mathematics, so a model output never changes a verdict.

`check` follows statcheck's own rounding rule (`error_test` in statcheck
1.5.0): it needs the p-value text exactly as the paper writes it, for
example `.03`, and the test statistic's text too, for example `1.48`. The
number of decimals in each tells the check how much its author rounded,
and the comparison allows for both roundings at once, the way statcheck
itself does. See `docs/TUTORIAL.md` section 6 for the rule in full.

## Tests

    npm test

The tests load the kit and check its hashes. Then they run every case from
`kit/parity/cases.json` — normalise, extract, prefilter, repair, model,
group and the whole pipeline — against this package's code. The p-value
cases must agree with the Python reference to 1 part in 1e9. The special
functions must agree with SciPy to 1 part in 1e12. The model's raw logits
must agree with the ONNX reference run to 1e-3 absolute, and every argmax
tag must agree exactly.

To see the largest error each suite measured, let the console through:

    npx vitest run --disable-console-intercept

`test/pdf.test.js` checks `checkPdf` against the Python pipeline on
`test/fixtures/sample_paper_damaged.pdf`, generated by the mother
repository's `examples/make_sample_paper.py`. Its comment holds the exact
command that produced the Python results it compares against.

## Demo page

`demo/index.html` and `demo/app.js` are a plain page with no build step and
no framework: a `[ choose PDFs ]` button and a drop zone take up to ten PDFs
at once, checked one at a time with a status line per file, then a summary
table, a results table and traceable quote per file, and three downloads
(`[ download JSON ]`, `[ download CSV ]`, `[ download Markdown ]`) built with
`toJSON`/`toCSV`/`toMarkdown` over the whole run. It vendors the two runtimes
a static host cannot fetch from `node_modules` — `onnxruntime-web`'s WASM
build and `pdfjs-dist`'s browser build — under `demo/vendor/`; see
`demo/vendor/VERSIONS.md` for what was copied and from which package
version.

Serve the repository root and open `/demo/`:

    npx serve .

GitHub Pages deploys the same repository root on every push to `main` (see
`.github/workflows/pages.yml`), which is why the demo reads `../kit/` and
`../src/index.js` as paths relative to itself rather than as a separate
build output.
