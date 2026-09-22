# Browser tutorial

The browser and npm port of statcheck-ml: a page with no server, an npm
package for Node, and a static bundle for any web host. Every Node command
below ran against this repository at commit `e81e29f`, and the output shown
is pasted from that run. A block that only runs in a browser is marked as
such and was not executed here.

The other two ports have their own tutorials: Python at
[`statcheck-ml/docs/TUTORIAL_PYTHON.md`](https://github.com/rasoulnorouzi/ml-statcheck/blob/main/statcheck-ml/docs/TUTORIAL_PYTHON.md),
R at
[`docs/TUTORIAL.md`](https://github.com/rasoulnorouzi/rasoulnorouzi-statcheck-ml-r/blob/main/docs/TUTORIAL.md).
All three read the same spec files and the same model. The
[mother repository](https://github.com/rasoulnorouzi/ml-statcheck) and its
[`results/REPORT.md`](https://github.com/rasoulnorouzi/ml-statcheck/blob/main/statcheck-ml/results/REPORT.md)
hold the numbers this tutorial quotes.

## 1. What it does and does not do

`statcheck` does two jobs: it **finds** a reported test result with a
regular expression, and it **checks** it by recomputing the p-value from
the test statistic. The regex is the weak link. It cannot read a result
whose operator (`=`, `<`, `>`) a PDF conversion destroyed, which happens
whenever a publisher sets that operator in a symbol font with no ToUnicode
map. This project replaces only the finding step, with a small
character-level model that ships as ONNX and runs in `onnxruntime-web`.

Machine learning finds results. It never judges them. The p-value check in
`src/pvalue.js` is closed-form mathematics: an incomplete beta and an
incomplete gamma function, written out by hand in `src/special.js` because
a browser has no SciPy. A model's tags decide where a result sits in the
text and what its parts are. They never decide whether a paper's p-value is
right.

Every label the model trained on is bronze. Three rater agents (Claude
haiku, sonnet, and opus) annotated the training and holdout windows, a
scripted consensus rule combined their readings, and an adjudicator agent
settled what the rule could not. No person checked a label by hand, and
there is no human gold set. Read every number below against that fact.

From `results/REPORT.md`, Abstract and section 6, on a 200-document holdout
this project never trained on:

| System | P | R | F1 [CI] |
|---|---|---|---|
| statcheck_raw | 0.983 | 0.183 | 0.308 [0.222, 0.385] |
| statcheck_repaired | 0.993 | 0.467 | 0.636 [0.567, 0.698] |
| cascade_gru-crf-s0 | 0.949 | 0.870 | 0.908 [0.875, 0.937] |

`statcheck_repaired` is the R package's own patterns after its own
operator-repair pass, the strongest form of the regex baseline. The
cascade is what `checkText`/`checkPdf` actually run: the repaired pattern
first, then only what the model finds beyond it. It gains 0.272 F1 over
`statcheck_repaired`, significant at p = 0.000 by a paired bootstrap over
holdout documents (`results/REPORT.md` section 7). Most of that gain sits
in the damaged subset, where `statcheck_repaired` reaches F1 0.723 and the
cascade reaches 0.922 (section 6).

## 2. Three ways to use it

### The page

[`https://rasoulnorouzi.github.io/rasoulnorouzi-statcheck-ml-web/`](https://rasoulnorouzi.github.io/rasoulnorouzi-statcheck-ml-web/)
is `demo/index.html`, deployed by `.github/workflows/pages.yml` on every
push to `main`. Open it, drop a PDF on the dashed box (or click the box and
pick a file), and read the table that appears: one row per found result,
with columns for the line, whether the pattern or the model found it, the
test type, the statistic, the degrees of freedom, the operator, the
reported and computed p-values, and the verdict, colored green for
consistent and red for inconsistent or a decision error. A "download JSON"
link appears once a file has been checked, holding the same results plus
the per-stage counts (`stages` in the API below).

The status line above the box names the kit version, the model, and the
mother commit the kit was built from, and tracks the load: `loading
kit…`, then `… loading model…`, then `… ready`. Everything after that
— reading the PDF, tagging it, checking the p-values — runs in
`onnxruntime-web`'s WASM backend inside the tab. No file, and no result,
leaves the machine; there is no server in this port to send it to.

### The npm package

    npm install statcheck-ml

works once the package is published. Until then, install straight from the
repository:

    npm install github:rasoulnorouzi/rasoulnorouzi-statcheck-ml-web

Both forms install `src/` and `kit/` (see `package.json`'s `files` field);
nothing else in the repository ships. Section 3 below runs the installed
shape, just against a checkout instead of `node_modules`.

### A static copy on any web server

`demo/`, `kit/`, and `src/` are the whole runtime — no bundler, no build
step. Copy those three directories to any static host, keeping their
relative position (`demo/../kit` and `demo/../src` must still resolve), and
serve the result. Two things in `demo/index.html` and `demo/app.js` are not
optional:

- An import map, because `src/model.js` imports the bare specifier
  `onnxruntime-web`, which only Node's resolver understands on its own:

  ```html
  <script type="importmap">
  { "imports": { "onnxruntime-web": "./vendor/ort.wasm.min.mjs" } }
  </script>
  ```

- `ort.env.wasm.wasmPaths` set to an absolute URL of the directory holding
  the WASM binary and its loader, resolved relative to the page itself so
  it still works however deep the host serves it from:

  ```js
  const VENDOR_BASE = new URL('./vendor/', import.meta.url).href;
  ort.env.wasm.wasmPaths = VENDOR_BASE;
  ```

`demo/vendor/` already carries both vendored runtimes (`onnxruntime-web`'s
WASM build and `pdfjs-dist`'s browser build; see `demo/vendor/VERSIONS.md`
for exactly what was copied from which package version and why), so a copy
of the repository root needs no `node_modules` at all. Section 9 below
shows the page's own script in full.

## 3. First run in Node

```js
import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { loadKit, loadModel, checkPdf } from './src/index.js';

const kit = await loadKit('./kit');
const model = await loadModel(kit);

const data = readFileSync('test/fixtures/sample_paper_damaged.pdf');
const {
  results, stages, pages, title, titleSource, fileName,
} = await checkPdf(data, kit, model, { pdfjs });
```

Run from the package root, `results` came back as:

```json
[
  {
    "test_type": "t", "statistic": 2.45, "df1": 23, "df2": null,
    "p_operator": "=", "p_value": 0.022, "source": "pattern", "line": 2,
    "quote": "t(23) = 2.45, p = .022", "offset": 94,
    "context": "Reaction times differed between the groups, t(23) = 2.45, p = .022.",
    "verdict": "consistent", "computed_p": 0.022315728160948536,
    "reason": "", "missing": [], "page": 1
  },
  {
    "test_type": "f", "statistic": 5.1, "df1": 2, "df2": 30,
    "p_operator": "=", "p_value": 0.012, "source": "pattern", "line": 2,
    "quote": "F(2, 30) = 5.10, p = .012", "offset": 157,
    "context": "The effect of condition was reliable, F(2, 30) = 5.10, p = .012.",
    "verdict": "consistent", "computed_p": 0.012400181003238699,
    "reason": "", "missing": [], "page": 1
  },
  {
    "test_type": "f", "statistic": 9.2, "df1": 1, "df2": 118,
    "p_operator": "=", "p_value": 0.003, "source": "pattern", "line": 2,
    "quote": "F(1, 118) = 9.20, p = .003", "offset": 223,
    "context": "Accuracy differed between conditions, F(1, 118) = 9.20, p = .003.",
    "verdict": "consistent", "computed_p": 0.002976614217849726,
    "reason": "", "missing": [], "page": 1
  },
  {
    "test_type": "t", "statistic": 1.8, "df1": 46, "df2": null,
    "p_operator": "=", "p_value": 0.04, "source": "pattern", "line": 4,
    "quote": "t(46) = 1.80, p = .04", "offset": 285,
    "context": "Recall was lower under pressure, t(46) = 1.80, p = .04.",
    "verdict": "decision_error", "computed_p": 0.07842066481562257,
    "reason": "the reported and computed p-values disagree about significance",
    "missing": [], "page": 1
  },
  {
    "test_type": "t", "statistic": 4.15, "df1": 19, "df2": null,
    "p_operator": "=", "p_value": 0.001, "source": "pattern", "line": 6,
    "quote": "t(19) = 4.15, p = .001", "offset": 350,
    "context": "Effort was higher in the noticing group, t(19) = 4.15, p = .001.",
    "verdict": "consistent", "computed_p": 0.0005439714186639246,
    "reason": "", "missing": [], "page": 1
  }
]
```

with `pages` equal to `1`, `title` equal to `"A paper whose operators the
conversion destroyed"` (`titleSource: "largest-font"`; this fixture carries
no metadata Title, so the title comes from the bold, 12pt heading above the
damaged lines — see section 5's `pdfToText` entry), `fileName` equal to
`null` (this call passed no `pdfOptions.fileName`), and `stages`:

```json
{
  "normalize": { "lines_before": 12, "lines_after": 12, "operators_renamed": {} },
  "repair": { "replacements": 10 },
  "prefilter": { "lines": 12, "windows_kept": 5 },
  "find": { "by_pattern": 5, "by_model": 0 },
  "check": { "consistent": 4, "decision_error": 1 },
  "not_found": {}
}
```

All five results came from the pattern branch (`by_model: 0`); this
particular fixture is readable by regex once `repair` has restored its ten
damaged operator characters, so the model finds nothing beyond it here.
Section 4 shows a case where the two branches disagree.

Every result carries the same fifteen fields, whether the pattern or the
model found it:

| Field | Type | Meaning |
|---|---|---|
| `test_type` | string | `t`, `f`, `r`, `z`, `chi2`, or `q` |
| `statistic` | number | the test statistic |
| `df1` | number \| null | first degrees of freedom |
| `df2` | number \| null | second degrees of freedom (`f` only) |
| `p_operator` | string \| null | `=`, `<`, or `>`, as reported |
| `p_value` | number \| null | the p-value as reported |
| `source` | string | `"pattern"` or `"model"` |
| `line` | number | the prefilter's candidate line index |
| `quote` | string | the exact source text of the result |
| `offset` | number | the quote's position in the scanned text |
| `context` | string | the sentence around the quote, up to 300 characters |
| `verdict` | string | one of the four strings in section 6 |
| `computed_p` | number \| null | the p-value `computeP` recomputed |
| `reason` | string | empty when consistent, else a sentence |
| `missing` | string[] | which required parts were absent |

`checkPdf` adds a `page` to each result too (the 1-based page it sits on, or
`null` when it cannot be placed), and three fields of its own: `pages`, the
PDF's page count; `title` and `titleSource`, the paper's title and where it
came from (`pdfToText`'s entry in section 5 covers both); and `fileName`,
carried through from `pdfOptions.fileName` unchanged. `stages` is
diagnostic, not a result: how many lines and windows each stage kept, how
many results each of the pattern and the model contributed, and a count of
every verdict and every missing part.

## 4. The stages on one damaged sentence

`checkText` (and so `checkPdf`) runs six stages in order: normalise,
repair, prefilter, then per window the pattern and the model, then check.
Running each by hand on one sentence, with a control character standing in
for a destroyed `=`:

```js
import {
  loadKit, loadModel, normalize, repair, prefilter, extract, tag, check, parseNumber,
} from './src/index.js';

const kit = await loadKit('./kit');
const model = await loadModel(kit);
const sentence = 'F(1, 40)  6.20, p = .016';
```

**`normalize(sentence, kit)`** returns the sentence unchanged:
`"F(1, 40)  6.20, p = .016"`. `` (STX) is not renamed, because
it is already one of `kit/spec/normalize.json`'s eight
`canonical_operator_slots` — the alphabet the model was trained to read a
destroyed operator in. Normalise only renames a character that is
*neither* already in that alphabet *nor* in the character map
(`kit/spec/charmap.json`) *nor* a protected math symbol; this character
already is.

**`repair(normalized, kit)`** returns
`{ text: "F(1, 40) = 6.20, p = .016", replacements: 1 }`. `kit/spec/repair.json`
sets `min_testable_results: 3`, and one sentence supplies only one
candidate, so the arithmetic-driven `repair_validated` inference (try every
operator, keep the mapping whose recomputed p-values agree most often) does
not run. The stage falls back to its simple rule instead: a suspect
character sitting right after a `)` and before a digit is an `=`, the one
reading that position admits no other way.

**`prefilter(repaired, kit)`** returns one window:

```json
[{ "start": 0, "end": 25, "line": 0, "text": "F(1, 40) = 6.20, p = .016" }]
```

`kit/spec/prefilter.json` requires a line of at least 20 characters with a
digit in it and a non-letter density of at least 0.2 before it becomes a
candidate; this 25-character line clears the digit and length checks and
its density (11 of 25 characters are not letters) clears 0.2 too.

**`extract(window.text)`** — the regex baseline, hardcoded in
`src/extract.js` rather than read from a spec (it has none yet; it is a
faithful, line-for-line port of `statcheck`'s own patterns and is meant to
keep statcheck's faults, not fix them) — returns:

```json
[{ "test_type": "f", "statistic": "6.20", "df1": "1", "df2": "40", "p_operator": "=", "p_value": ".016" }]
```

**`tag(window.text, model)`** returns one BIOES tag per character:

```json
["S-TEST","O","O","O","O","B-DF2","E-DF2","O","O","S-POP_EQ","O",
 "B-STAT","I-STAT","I-STAT","E-STAT","O","O","O","O","O","O",
 "B-PVAL","I-PVAL","I-PVAL","E-PVAL"]
```

The model tags `"40"` as `DF2` and tags nothing as `DF1` at all — it misses
the `"1"` right after `F(`. `checkText` never notices, because the pattern
already found `df1` correctly here and the model is only asked to add what
the pattern did not find; this is that design rule paying for itself. The
miss itself is plausible: `results/REPORT.md` section 1 says the model
trains on windows of at least 250 characters with real prose on both
sides, and this hand-built window is 25.

**`check(result, { alpha: 0.05 })`**, on the pattern's parsed result:

```json
{
  "verdict": "inconsistent",
  "computed_p": 0.01702995545478932,
  "reported_p": 0.016,
  "reason": "the reported and computed p-values disagree",
  "missing": []
}
```

`F(1, 40) = 6.20` implies p = .01703, three thousandths above the reported
`.016`. Section 6 below explains the exact rule; here it is enough to say
that this call passed no `statisticText`, so the statistic's own rounding
is read off the number itself, `6.2`, one printed decimal, and the
interval that opens, `[.0166, .0175]`, still does not reach down to
`.016`. Restoring the operator is not the same as making the paper's
arithmetic check out.

`loadKit` is what makes every rule above shared rather than restated: it
reads `kit/manifest.json`, then reads and sha256-hashes every file the
manifest lists — the five `spec/*.json` files, the model's four files, the
parity cases, and the kit's own README — throwing if a hash disagrees. That
is one read of every listed file. The model's own bytes (`tagger.onnx`,
`weights.json`) are hashed at this point too but not kept; `loadModel`
reads them again, only when a prediction is actually needed.

## 5. The API

Every export from `src/index.js`, with one executed example. `kit` and
`model` below are the same `loadKit('./kit')` / `loadModel(kit)` as
section 3.

**`loadKit(baseUrlOrPath)`** → `Promise<{spec, manifest, modelDir, base}>`.
A directory path in Node, a base URL in a browser.

```js
const kit = await loadKit('./kit');
```
```json
{
  "manifest": {
    "kit_version": "2.0.0", "model_default": "gru-crf", "models": ["gru-crf"],
    "mother_commit": "b71a9f92304cb99144279a852b7c815471be0168", "mother_dirty": false,
    "port_name": "statcheck-ml-web"
  },
  "modelDir": "model/gru-crf", "base": "./kit"
}
```

**`normalize(text, kit)`** → `string`. On text with nothing to fix, it is
the identity:

```js
normalize('F (1, 40)  =  6.20, p = .016', kit)
// -> "F (1, 40)  =  6.20, p = .016"  (unchanged)
```

**`createNormalizer(spec, charmap)`** → `{ reflow, canonicalise, normalize }`,
the pieces `normalize` composes. `canonicalise` is where a genuinely
unknown character gets renamed, into the first free canonical slot:

```js
const n = createNormalizer(kit.spec.normalize, kit.spec.charmap);
n.canonicalise('F(1, 40) ≡ 6.20, p ≡ .016')
// -> { text: "F(1, 40)  6.20, p  .016", mapping: Map { '≡' → '' } }
```

`≡` (U+2261) is in neither `kit/spec/charmap.json` nor a protected symbol,
so both its occurrences move to the first open slot, ``.

**`extract(text, kit?)`** → array of raw string matches, offsets not kept
once returned. `kit` is accepted for a uniform `(text, kit)` shape across
stages but unused; this stage has no spec yet.

```js
extract('t(23) = 2.45, p = .022')
// -> [{ test_type: "t", statistic: "2.45", df1: "23", df2: null, p_operator: "=", p_value: ".022" }]
```

**`extractWithSpans(text, kit?)`** → `extract`'s array, each entry carrying
the `start`/`end` character span its match covers. `extract` is this
function with the span dropped again; `checkText` calls this one instead,
so a result's `quote` and `offset` come from the one regex pass `extract`
already runs, not a second one:

```js
extractWithSpans('t(23) = 2.45, p = .022')
// -> [{ test_type: "t", statistic: "2.45", df1: "23", df2: null, p_operator: "=",
//       p_value: ".022", start: 0, end: 22 }]
```

**`CONSISTENT, INCONSISTENT, DECISION_ERROR, UNDECIDABLE`** — the four
verdict strings `check` returns, exported so a caller never has to spell
one out by hand:

```json
{ "CONSISTENT": "consistent", "INCONSISTENT": "inconsistent",
  "DECISION_ERROR": "decision_error", "UNDECIDABLE": "undecidable" }
```

**`check(result, options?)`** → `{verdict, computed_p, reported_p, reason, missing}`.
`options` is `{alpha = 0.05, pEqualAlphaSig = true, reportedPText = null}`.
Section 6 covers this in full; one example:

```js
check({ test_type: 't', statistic: 2.45, df1: 23, df2: null, p_operator: '=', p_value: 0.022 },
      { alpha: 0.05 })
// -> { verdict: "consistent", computed_p: 0.022315728160948536, reported_p: 0.022, reason: "", missing: [] }
```

**`computeP(testType, statistic, df1 = null, df2 = null, oneTailed = false)`** →
`number | null`. What `check` calls internally; useful on its own to get
just the number.

```js
computeP('t', 2.45, 23)   // -> 0.022315728160948536
computeP('f', 9.2, 1, 118) // -> 0.002976614217849726
```

**`parseNumber(text)`** → `number | null`. Text such as a paper prints it
— a leading comparator stripped, a missing leading zero restored, the
Unicode minus and en dash accepted — to a plain number:

```js
['.03', '<.001', '−.5', '', null].map(parseNumber)
// -> [0.03, 0.001, -0.5, null, null]
```

**`tSf(x, df)`, `fSf(x, df1, df2)`, `chi2Sf(x, df)`, `normSf(x)`** — the
four survival functions `computeP` is built from, each `P(distribution >
x)`:

```js
tSf(2.45, 23)     // -> 0.011157864080474268
fSf(9.2, 1, 118)  // -> 0.002976614217849726
chi2Sf(9.49, 4)   // -> 0.049953131223294894
normSf(1.96)      // -> 0.024997895148220393
```

**`logGamma(x)`, `regIncBeta(x, a, b)`, `regIncGammaUpper(a, x)`, `erfc(x)`**
— the special functions the four survival functions above reduce to, this
package's own reimplementation of what SciPy calls Cephes for:

```js
logGamma(5)             // -> 3.178053830347944   (ln(4!) = 3.1780538303479458)
regIncBeta(0.5, 2, 2)   // -> 0.4999999999999998
regIncGammaUpper(2, 3)  // -> 0.1991482734714558
erfc(1)                 // -> 0.15729920705028455
```

**`loadModel(kit, config = kit.manifest.model_default)`** →
`Promise<{session, charmap, decoder}>`. This kit ships one config,
`gru-crf`, so the default and the explicit call return the same thing:

```js
const model = await loadModel(kit);              // config defaults to "gru-crf"
const same = await loadModel(kit, 'gru-crf');     // same, spelled out
```

Both give a `decoder.tags.length` of `37` and `decoder.has_crf: true`. A
config the kit does not ship throws, reading the file that is not there:

```js
await loadModel(kit, 'does-not-exist');
// -> ENOENT: no such file or directory, open '…\kit\model\does-not-exist\tagger.onnx'
```

**`tag(text, model)`** → `Promise<string[]>`, one BIOES tag per character,
Viterbi-decoded when the model has a CRF head (this one does):

```js
await tag('F(1, 40) = 6.20, p = .016', model)
// -> ["S-TEST","O","O","O","O","B-DF2","E-DF2","O","O","S-POP_EQ","O",
//     "B-STAT","I-STAT","I-STAT","E-STAT","O","O","O","O","O","O",
//     "B-PVAL","I-PVAL","I-PVAL","E-PVAL"]
```

**`prefilter(text, kit)`** → array of `{start, end, line, text}` windows.
A window is built around one candidate line and grows to include its
neighbours as context, whether or not the neighbours are candidates
themselves:

```js
prefilter(
  'This paragraph names no statistic and stays out of every window.\n' +
  'F(1, 40) = 6.20, p = .016\n' +
  'The discussion section follows and is also prose only.', kit)
// -> [{ start: 0, end: 145, line: 1,
//       text: "This paragraph names no statistic…\nF(1, 40) = 6.20, p = .016\nThe discussion…" }]
```

Only the middle line clears the digit/length/density checks, but the
window it opens carries both neighbours as context because
`kit/spec/prefilter.json`'s `context_lines` is 2 and this document is only
three lines long.

**`repair(text, kit)`** → `{text, replacements}`:

```js
repair('F(1, 40)  6.20, p = .016', kit)
// -> { text: "F(1, 40) = 6.20, p = .016", replacements: 1 }
```

**`group(text, tags)`** → array of results with a `span`, the pure
tag-sequence-to-result step `checkText` runs after `tag`:

```js
const tags = await tag('F(1, 40) = 6.20, p = .016', model);
group('F(1, 40) = 6.20, p = .016', tags)
// -> [{ test_type: "f", statistic: 6.2, df1: null, df2: 40,
//       p_operator: "=", p_value: 0.016, span: [0, 25] }]
```

`df1` is `null` here for the same reason as section 4: this model tagged
no `DF1` span on this short, context-free line.

**`checkText(text, kit, model, { mode })`** → `Promise<{results, stages}>`, the
whole pipeline over already-extracted text. `mode` is `hybrid` (the default),
`pattern` or `model`; the next block shows the default:

```js
await checkText('The effect was reliable, t(23) = 2.45, p = .022.', kit, model)
```
```json
{
  "results": [{
    "test_type": "t", "statistic": 2.45, "df1": 23, "df2": null,
    "p_operator": "=", "p_value": 0.022, "source": "pattern", "line": 0,
    "quote": "t(23) = 2.45, p = .022", "offset": 25,
    "context": "The effect was reliable, t(23) = 2.45, p = .022.",
    "verdict": "consistent", "computed_p": 0.022315728160948536,
    "reason": "", "missing": []
  }],
  "stages": {
    "normalize": { "lines_before": 1, "lines_after": 1, "operators_renamed": {} },
    "repair": { "replacements": 0 },
    "prefilter": { "lines": 1, "windows_kept": 1 },
    "find": { "by_pattern": 1, "by_model": 0 },
    "check": { "consistent": 1 }, "not_found": {}
  }
}
```

**`checkPdf(data, kit, model, pdfOptions)`** →
`Promise<{results, stages, pages, title, titleSource, fileName}>`. Section 3
above is this call in full; `pdfOptions` is `{pdfjs, onProgress?, fileName?}`,
`pdfjs`/`onProgress` forwarded to `pdfToText` and `fileName` carried through
unchanged, defaulting to `null`. Each result also carries a `page`, the
1-based page it sits on, or `null` when it cannot be placed — matched on the
digits and `.` a result's `quote` shares with a page's raw text, because
those survive an operator repair and a PDF engine's own line breaks when
the rest of the text does not.

**`pdfToText(data, {pdfjs, onProgress?})`** →
`Promise<{text, pages, pageTexts, title, titleSource}>`, the PDF reading
stage on its own, unnormalised:

```js
const {
  text, pages, pageTexts, title, titleSource,
} = await pdfToText(readFileSync('test/fixtures/sample_paper.pdf'), { pdfjs });
// -> pages: 2, text.length: 1979, pageTexts.length: 2
// -> title: "Attention and recall under time pressure", titleSource: "largest-font"
// (this fixture's PyMuPDF writer never sets a metadata Title, so the title
// comes from the largest text on page 1 — the bold, 14pt heading)
// text.slice(0, 200):
// "Attention and recall under time pressure\n\nA. Example, B. Sample, and C. Fictional\n\n
//  Department of Nothing in Particular\n\nAbstract\n\nWe tested whether time pressure changes
//  recall. Ninety-six people took"
```

**`toJSON(docReports, kit, options?)`**, **`toCSV(docReports, kit)`**,
**`toMarkdown(docReports, kit)`** → `string`. `docReports` is an array of
`{fileName, title, titleSource, pages, results, stages}` — what `checkPdf`
returns, plus the file name — one entry per PDF, so several documents make
one report. `kit` is `{version, model, mother_commit}`, printed into the
JSON header and the Markdown trailer; `options` for `toJSON` is
`{pretty = true}`.

```js
const kitInfo = {
  version: kit.manifest.kit_version, model: kit.manifest.model_default,
  mother_commit: kit.manifest.mother_commit,
};
// docs: one { fileName, title, titleSource, pages, results, stages } per
// checkPdf call, both sample fixtures — the same shape as section 3's result.
```

`toCSV(docs, kitInfo)`, first three lines (one header, one row per result):

```csv
file,title,page,line,source,test_type,statistic,df1,df2,p_operator,reported_p,computed_p,verdict,quote,context
sample_paper.pdf,Attention and recall under time pressure,1,28,pattern,t,2.45,23,,=,0.022,0.022315728160948536,consistent,"t(23) = 2.45, p = .022","Reaction times differed between the groups, t(23) = 2.45, p = .022."
sample_paper.pdf,Attention and recall under time pressure,1,28,pattern,f,5.1,2,30,=,0.012,0.012400181003238699,consistent,"F(2, 30) = 5.10, p = .012","The effect of condition on recall was reliable, F(2, 30) = 5.10, p = .012."
```

The `quote` and `context` columns hold a comma, so RFC 4180 quoting wraps
them; line endings are CRLF, matched to the format's own spec rather than
the platform this ran on.

`toMarkdown(docs, kitInfo)`, first lines (heading, summary, table start):

```markdown
## Attention and recall under time pressure

File: sample_paper.pdf. Pages: 2. Verdicts: consistent: 6, decision_error: 1, undecidable: 2.

| page | line | test | statistic | p reported | p computed | verdict | source |
|---|---|---|---|---|---|---|---|
| 1 | 28 | t | 2.45 | 0.022 | 0.022315728160948536 | consistent | pattern |
```

The table stays narrow — the quote and its context are not columns in it —
because a numbered list under the table carries those instead, one entry
per result, so the table is still readable at a normal terminal width.

`toJSON(docs, kitInfo)` gives `{tool: "statcheck-ml", kit, generated_at,
documents}`, `documents` holding every `docReport` unchanged; only
`generated_at` differs between two runs over the same input.

**Modes.** The same two sentences, the second with its operators damaged to the
control character U+0003, through each mode. `stages.find` counts which finder
found what, and `source` names it on every result:

```js
for (const mode of ['hybrid', 'pattern', 'model']) {
  const { results, stages } = await checkText(text, kit, model, { mode });
  console.log(mode, stages.find, results.map((r) => `${r.source}:${r.statistic}:${r.verdict}`));
}
```
```
hybrid   {"by_pattern":2,"by_model":0} pattern:2.45:consistent  pattern:1.8:decision_error
pattern  {"by_pattern":2,"by_model":0} pattern:2.45:consistent  pattern:1.8:decision_error
model    {"by_pattern":0,"by_model":2} model:2.45:consistent  model:1.8:decision_error
```

Here the repair stage restores the damaged operator before any finder runs, so
the patterns read both results and the model has nothing to add. On damage the
repair cannot undo, the patterns miss results and the model finds them; that is
where `hybrid` beats `pattern` on the holdout, F1 0.908 against 0.636.

## 6. Reading a verdict

`check` returns one of four strings. Each, with one executed call
(`reportedPText` is the p-value exactly as the paper prints it, `statisticText`
is the test statistic exactly as the paper prints it, `.022` and `2.45` and
so on, and both are what let the rounding rule below match the paper's own):

**`consistent`** — the reported and computed p-values agree, once both
roundings are allowed for:

```js
check({ test_type: 't', statistic: 2.45, df1: 23, df2: null, p_operator: '=', p_value: 0.022 },
  { reportedPText: '.022', statisticText: '2.45' })
// -> { verdict: "consistent", computed_p: 0.022315728160948536, reported_p: 0.022, reason: "", missing: [] }
```

**`inconsistent`** — they disagree, but agree about significance at
`alpha` (both sides of `.05`, here):

```js
check({ test_type: 'f', statistic: 6.20, df1: 1, df2: 40, p_operator: '=', p_value: 0.016 },
  { reportedPText: '.016', statisticText: '6.20' })
// -> { verdict: "inconsistent", computed_p: 0.01702995545478932, reported_p: 0.016,
//      reason: "the reported and computed p-values disagree", missing: [] }
```

**`decision_error`** — they disagree about significance itself: `t(46) =
1.8` implies p = .0784, which is not significant at .05, while the paper
reported `p = .04`, which is:

```js
check({ test_type: 't', statistic: 1.8, df1: 46, df2: null, p_operator: '=', p_value: 0.04 },
  { reportedPText: '.04', statisticText: '1.80' })
// -> { verdict: "decision_error", computed_p: 0.07842066481562257, reported_p: 0.04,
//      reason: "the reported and computed p-values disagree about significance", missing: [] }
```

**`undecidable`** — a required part is missing, here `df1` for a `t` test:

```json
{ "verdict": "undecidable", "computed_p": null, "reported_p": 0.022,
  "reason": "no degrees of freedom found beside this result", "missing": ["df1"] }
```

**The rounding rule.** `check` follows statcheck's own rule, taken from
`error_test` and `decision_error_test` in statcheck 1.5.0. Both numbers in
a paper are rounded, and the rule allows for both. `roundingInterval`
computes `[lowP, upP]`, the p-values the two ends of the printed statistic
imply: a statistic printed `1.48` stands for anything in `[1.475, 1.485]`,
the end nearer zero gives the larger p and the end further away gives the
smaller one, and a negative statistic swaps which end is which. With a
reported `=`, the result is consistent when the reported p lies in
`[round(lowP, pDec), round(upP, pDec)]`, where `pDec` is the decimals of
the *p-value* as printed; with `<` it is consistent when
`reported >= lowP`; with `>` when `reported <= upP`. `ns` reads as
`p_operator: '>'` against `alpha` itself. A reported p of zero or less is
always an error, whatever the statistic implies — no test gives exactly
zero. `pyRound` is the one place this file must match Python's rounding
rather than JavaScript's own: Python's `round` breaks a tie at the last
digit to the even neighbour, and `Number.prototype.toFixed` breaks it away
from zero instead, so `check` never calls `toFixed` where a verdict is on
the line.

**Counting the decimals.** When `reportedPText` or `statisticText` is not
given, `decimalsOf` falls back to counting Python's own `repr` of the
number — the shortest digit string that reads back to the same double —
because that is what the reference implementation counts, and
JavaScript's default number-to-string does not always agree with it. The
gap shows up at the edges: `String(1e-5)` is `"0.00001"` in JavaScript but
`"1e-05"` in Python, and `pythonFloatText` in `src/pvalue.js` reproduces
the Python spelling rather than the JavaScript one. That spelling has no
decimal point in it, so the fallback counts zero decimals rather than
five:

```js
check({ test_type: 't', statistic: 10, df1: 20, df2: null, p_operator: '=', p_value: 1e-5 })
// -> { verdict: "inconsistent", computed_p: 3.163781758714393e-9, reported_p: 0.00001,
//      reason: "the reported and computed p-values disagree", missing: [] }
```

`t(20) = 10` implies p ≈ 3.16 × 10⁻⁹, three orders of magnitude away from
the reported `1e-5`, and the verdict catches it even with neither text
given: the statistic's own fallback rounding (one decimal, `"10.0"`) still
only opens the interval to about `10 ± 0.05`, nowhere near wide enough,
and zero decimals of tolerance on the p-value side does not save it either.
Always pass the literal text the paper prints, for both the statistic and
the p-value, rather than relying on this fallback — a paper that writes
`10.00` leaves far less room than one that writes `10`, and only the text
says which.

**Agreement with R statcheck.** `results/REPORT.md` section 7 compares
this project's p-value arithmetic with the R package's, on the results the
R package itself reports after repair: all 152 verdicts agree, and none
carry no p-value to compare. Reaching that took the same correction this
port just received: until 2026-09-20 the rule allowed only for the
rounding of the reported p-value, not of the test statistic, and so called
some correctly reported results errors. The rule is now statcheck's own in
all three ports, and the known difference from R statcheck this section
used to describe is closed.

## 7. Choosing a model

`kit/manifest.json` lists one model, `gru-crf` (`kit.manifest.models ===
['gru-crf']`), and it is also `kit.manifest.model_default`. The mother
repository's zoo has three shipped configurations
(`results/REPORT.md` section 8); this kit carries the one selected as best
on dev F1. From `kit/README.md`:

| config | dev F1 | holdout F1 | holdout 95% CI |
|---|---|---|---|
| gru-crf | 0.927 | 0.904 | [0.871, 0.934] |

0.904 is the model alone; section 1's 0.908 is the cascade — the model
plus the repaired pattern in front of it, which is what `checkText` and
`checkPdf` actually run.

`loadModel(kit, config)` takes a second argument for a kit that ships more
than one, defaulting to `kit.manifest.model_default`. Naming this kit's
one config explicitly gives the same model back:

```js
const model = await loadModel(kit);           // "gru-crf", the default
const same = await loadModel(kit, 'gru-crf');  // "gru-crf", named
// same.decoder deep-equals model.decoder
```

There is nothing to choose between yet in this kit. Regenerating it with a
second config (`python pipeline/08_port_kit.py <target_dir> --config
<name> --name statcheck-ml-web`, from the mother repository) is what would
make the second argument matter.

## 8. Batch in Node

A script over a folder of PDFs, one CSV row per result:

```js
// batch.mjs — check every PDF in a folder, write one row per result to a CSV.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { loadKit, loadModel, checkPdf } from './src/index.js'; // 'statcheck-ml' once installed

const [, , pdfDir, outCsv] = process.argv;

const kit = await loadKit('./kit');
const model = await loadModel(kit);

const columns = ['file', 'line', 'source', 'test_type', 'statistic', 'df1', 'df2', 'p_operator', 'p_value', 'computed_p', 'verdict'];
const rows = [columns.join(',')];

for (const name of readdirSync(pdfDir).filter((f) => f.endsWith('.pdf')).sort()) {
  const data = readFileSync(path.join(pdfDir, name));
  const { results } = await checkPdf(data, kit, model, { pdfjs });
  for (const r of results) {
    rows.push([
      name, r.line, r.source, r.test_type, r.statistic, r.df1 ?? '', r.df2 ?? '',
      r.p_operator ?? '', r.p_value ?? '', r.computed_p ?? '', r.verdict,
    ].join(','));
  }
}

writeFileSync(outCsv, rows.join('\n') + '\n');
console.log(`wrote ${rows.length - 1} rows to ${outCsv}`);
```

Run as `node batch.mjs test/fixtures report.csv` from the package root, over
the two fixtures this repository ships:

```
wrote 14 rows to report.csv
```

`report.csv`, header and first seven rows:

```csv
file,line,source,test_type,statistic,df1,df2,p_operator,p_value,computed_p,verdict
sample_paper.pdf,28,pattern,t,2.45,23,,=,0.022,0.022315728160948536,consistent
sample_paper.pdf,28,pattern,f,5.1,2,30,=,0.012,0.012400181003238699,consistent
sample_paper.pdf,28,pattern,chi2,8.69,1,,=,0.003,0.003199606247855303,consistent
sample_paper.pdf,34,model,r,0.42,,,=,0.02,,undecidable
sample_paper.pdf,36,pattern,t,1.8,46,,=,0.04,0.07842066481562257,decision_error
sample_paper.pdf,40,pattern,f,9.2,1,118,=,0.003,0.002976614217849726,consistent
```

The fourth data row, `sample_paper.pdf` line 34, is `source: model` with an
empty `computed_p`: the model found an `r` result the pattern did not, but
without a usable `df1` the check cannot recompute a p-value, so the row is
`undecidable` rather than wrong. The clean and the damaged fixture both
feed the same script; nothing about the CSV step depends on which PDF
engine produced the text.

## 9. In the browser

This section is browser code. It runs in a tab, not under Node, and was
not executed here — the page and file APIs it uses (`document`,
`DataTransfer`, `fetch` against `file://`-relative URLs) have no Node
equivalent this package relies on. It is copied from the real
`demo/index.html` and `demo/app.js`, not invented for this section.

The minimal page needs an import map and an absolute WASM path, both shown
in section 2:

```html
<script type="importmap">
{ "imports": { "onnxruntime-web": "./vendor/ort.wasm.min.mjs" } }
</script>
```

```js
import * as ort from 'onnxruntime-web';
import * as pdfjs from './vendor/pdf.min.mjs';
import { loadKit, loadModel, checkPdf } from '../src/index.js';

const KIT_BASE = new URL('../kit/', import.meta.url).href;
pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;
ort.env.wasm.wasmPaths = new URL('./vendor/', import.meta.url).href;

let kit, model;
async function loadOnce() {
  setStatus('loading kit…');
  kit = await loadKit(KIT_BASE);
  setStatus('… loading model…');
  model = await loadModel(kit);
  setStatus('… ready');
}
```

The page takes up to ten PDFs at once, from a real `[ choose PDFs ]` button
or the drop zone, both wired to the same hidden, `multiple` file input. The
pure parts of this — which files a run accepts, the verdict tally, a
section's heading, the three download file names — live in
`demo/support.js`, so `test/demo.test.js` can exercise them under plain
Node; `demo/app.js` imports them rather than restating the logic:

```js
import {
  MAX_FILES, DOWNLOAD_NAMES, selectFiles, formatVerdictCounts, sectionHeading,
} from './support.js';

chooseButton.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const { files } = fileInput;
  fileInput.value = '';
  runFiles(files);
});
```

The drop handler, unchanged in shape from before, now passes the whole
`FileList` through:

```js
dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropZone.classList.remove('drag-over');
  runFiles(event.dataTransfer.files);
});
```

`runFiles` first splits the file list with `selectFiles(fileList, MAX_FILES)`:
a non-PDF is rejected by name (`rejected <name>: not a PDF`), and a PDF past
the tenth is dropped with one line saying how many were kept and how many
were dropped, never one line per dropped file. It then checks the accepted
files one at a time — not in parallel, so the page stays responsive and the
status log reads in the order the files were given — passing `onProgress` to
`checkPdf` so each file's own status line updates as its pages are read:
`` `[2/5] paper.pdf: reading page 3 of 12 …` ``. A file `checkPdf` cannot
read gets its own status line and a summary-table row that says
`could not read`, with the error's message, and the run continues with the
files after it. When every file is done, one summary line closes the run:
`` `done: 5 files, 12 results, consistent: 9, inconsistent: 3, 4.31s` ``.

Below the log: a summary table, one row per file (file name, title, pages,
result count, verdict tally, or `could not read` for a failed one); then one
section per file with a heading (the title, noting `(from the largest text
on page 1)` when `titleSource` says so, and the file name), a results table
with `page, line, test, statistic, df, op, reported p, computed p, verdict,
source`, and under each result row a second, dimmed row carrying its exact
quote and the sentence around it — kept as a row directly under the result
it explains, not a separate numbered list, so a reader never has to
cross-reference a row number against a list further down the page. Three
links close the page: `[ download JSON ]`, `[ download CSV ]`,
`[ download Markdown ]`, built with `toJSON`/`toCSV`/`toMarkdown` over every
file of the run and named `statcheck-ml-report.json`/`.csv`/`.md`. Starting
a new run revokes the previous run's object URLs before creating new ones.

To verify a deployment by hand, in order:

1. Load the page. The status line above the drop zone moves through
   `loading kit…`, `… loading model…`, to `… ready`, naming the kit
   version, the model, and the mother commit.
2. Click `[ choose PDFs ]`; the native file picker opens and accepts
   several files at once.
3. Pick or drop a mix of PDFs and non-PDFs. Each non-PDF gets its own
   status line naming it as rejected; the PDFs still run.
4. Pick or drop more than ten PDFs. One status line says the run kept the
   first ten and how many were dropped.
5. Drag a PDF over the box without dropping it. The box gets a solid
   border (the `drag-over` class) and loses it again on drag-leave.
6. Drop several PDFs. A status line appears per file, updating as its
   pages are read, then a final line with the file, result and verdict
   counts and the run's duration; then a summary table, one row per file;
   then one results section per file, its verdict column colored green for
   consistent and red for inconsistent or a decision error, and a dimmed
   quote-and-context row under each result.
7. Drop a PDF with no readable result. Its section says "no results found
   in this file." instead of a table.
8. Drop a PDF PDF.js cannot read (a non-PDF renamed to `.pdf`, for
   example). Its summary row reads `could not read` with the error
   message, and the other files' rows are unaffected.
9. Click all three download links and confirm the files download as
   `statcheck-ml-report.json`, `.csv` and `.md`, each covering every file
   of the run.
10. Toggle the OS light/dark setting and confirm the page follows it
    (`prefers-color-scheme` in `demo/index.html`'s stylesheet).

## 10. Limits

**Timing**, from `results/REPORT.md` section 12 / `results/ports.json`,
second of two runs, one machine, the model loaded, one thread:

| | Python (pymupdf) | R (poppler) | Web (pdf.js) |
|---|---|---|---|
| 100 windows through the model | 0.83s | 7.49s | 1.01s |
| `sample_paper_damaged.pdf`, end to end | 0.058s | 0.61s | 0.09s |

R pays for running the model in interpreted matrix code; the browser is
close to the Python reference on the model itself and about 1.5× slower
end to end, which section 12 attributes mostly to the WASM ONNX runtime
over the native one.

**The WASM binary.** `demo/vendor/ort-wasm-simd-threaded.wasm` is 14,239,897
bytes — 13.6 MiB — per `demo/vendor/VERSIONS.md`. `src/model.js` pins
`ort.env.wasm.numThreads = 1`, which keeps this to the single-threaded path
and needs no cross-origin-isolation headers, at the cost of not using
whatever cores a visitor's machine has beyond one.

**pdf.js vs. PyMuPDF recall.** `results/REPORT.md` section 9 measures three
engines — `pymupdf`, `pdfium`, `poppler` — for the gate between the Python
and R ports; it does not include pdf.js. The pdf.js number lives in the kit
itself, `kit/spec/normalize.json`'s `_measured` block, on the same 198
holdout documents and 323 gold results: pdf.js holds 0.907 of the results
after the prefilter, against 0.929 for PyMuPDF. `src/normalize.js`'s own
comment carries the same figures. The 0.022 gap is the cost of this port's
PDF engine, not of anything downstream of it.

**What the prefilter drops.** A line under 20 characters, a line with no
digit in it at all, or a line whose share of non-letter characters is
below 0.2 (`kit/spec/prefilter.json`) never becomes a window, for any
port. Past roughly 55% of the document, a line that looks like a
bibliography entry is blanked out too. The prefilter is tuned for recall,
not precision, but it is still the hard ceiling: `results/REPORT.md`
section 10 and this project's own design rule agree — text it discards is
unrecoverable by any model.

**Damage families the model misses.** From `results/REPORT.md` section 6's
per-family table, on the holdout: `decimal point lost` recall is 0.000 for
the model alone and for the cascade alike (n = 3, interval up to 0.562 —
too few cases to call this settled, but zero is zero). `control character`,
the largest damage family by far (n = 82), is the hardest of the common
ones: 0.744 recall for the model alone, 0.756 for the cascade. Every other
named family reaches at least 0.947 recall for the cascade.

**Bronze labels, again.** No number above, or anywhere else in this
tutorial, is measured against a human-checked label. There is no gold set
for this project yet, only three rater agents, a consensus rule, and an
adjudicator agent, all recorded in `results/REPORT.md` sections 2–4.
