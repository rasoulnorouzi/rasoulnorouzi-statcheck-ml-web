// `checkPdf` against the Python reference pipeline, on the damaged sample
// paper the mother repository's `examples/make_sample_paper.py` generates.
//
// Fixtures: `test/fixtures/sample_paper.pdf` and
// `test/fixtures/sample_paper_damaged.pdf`, copied from a run of
//
//     PYTHONIOENCODING=utf-8 <venv python> examples/make_sample_paper.py
//
// from `statcheck-ml/`. Both are small and generated, so they are committed
// rather than fetched.
//
// The expected (test_type, statistic, verdict) triples came from the Python
// pipeline, run once against the damaged PDF:
//
//     cd statcheck-ml
//     PYTHONIOENCODING=utf-8 PYTHONPATH=src \
//       <venv python> -m statcheck_ml.cli check \
//       examples/sample_paper_damaged.pdf --json
//
// which printed (trimmed to the fields this test checks):
//
//   1. t    2.45  consistent
//   2. f    5.1   consistent
//   3. f    9.2   consistent
//   4. t    1.8   decision_error
//   5. t    4.15  consistent
//
// All five came from the pattern stage (`"by_pattern": 5, "by_model": 0`),
// none from the model, so this is a check of `pdfToText` and the shared
// `normalize`/`repair`/`prefilter` stages, not of the tagger.
//
// PDF.js and PyMuPDF do not always read a document the same way — the
// mother's `spec/normalize.json` measured PDF.js at 0.907 prefilter recall
// against 0.929 for PyMuPDF on 198 holdout documents — so this test compares
// triples one at a time and reports by name, rather than assuming a match.
// On this fixture, every triple agrees; if a future change to this port or
// to pdfjs-dist makes one disagree, this test fails on that triple by name
// instead of silently accepting a shorter or reordered result list.

import {
  describe, it, expect, beforeAll,
} from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { loadKit } from '../src/kit.js';
import { loadModel } from '../src/model.js';
import { checkPdf } from '../src/pipeline.js';
import { pdfToText } from '../src/pdf.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const kitDir = path.join(here, '..', 'kit');
const fixturesDir = path.join(here, 'fixtures');

// (test_type, statistic, verdict), from the Python run quoted above.
const EXPECTED_TRIPLES = [
  ['t', 2.45, 'consistent'],
  ['f', 5.1, 'consistent'],
  ['f', 9.2, 'consistent'],
  ['t', 1.8, 'decision_error'],
  ['t', 4.15, 'consistent'],
];

describe('pdf', () => {
  let kit;
  let model;
  beforeAll(async () => {
    kit = await loadKit(kitDir);
    model = await loadModel(kit);
  });

  it('pdfToText reads the damaged sample paper as one line per source line', async () => {
    const data = await readFile(path.join(fixturesDir, 'sample_paper_damaged.pdf'));
    const {
      text, pages, pageTexts, title, titleSource,
    } = await pdfToText(data, { pdfjs });
    expect(pages).toBe(1);
    expect(text).toContain('t(23)');
    expect(text).toContain('F(2, 30)');
    // Every result sentence is its own line: the y-grouping rule from the
    // mother's `js/extract.js` must not have joined two of them into one.
    const lines = text.split('\n').filter((l) => l.trim() !== '');
    expect(lines.length).toBeGreaterThanOrEqual(5);

    // `pageTexts` is what `text` is built from: one entry per page, joined
    // with a single newline and one trailing newline, exactly as `text` is.
    expect(pageTexts.length).toBe(pages);
    expect(`${pageTexts.join('\n')}\n`).toBe(text);

    // `make_sample_paper.py` never calls PyMuPDF's `set_metadata`, so this
    // fixture carries no Title, and the title comes from the largest text
    // on page 1 instead: the bold, 12pt heading above the damaged lines.
    expect(titleSource).toBe('largest-font');
    expect(title).toBe('A paper whose operators the conversion destroyed');
  });

  it('checkPdf on the damaged sample paper matches the Python pipeline', async () => {
    const data = await readFile(path.join(fixturesDir, 'sample_paper_damaged.pdf'));
    const { results } = await checkPdf(data, kit, model, { pdfjs });

    const got = results.map((r) => [r.test_type, r.statistic, r.verdict]);

    const matched = [];
    const missing = [];
    for (const want of EXPECTED_TRIPLES) {
      const hit = got.find(
        ([tt, stat, verdict]) => tt === want[0]
          && Math.abs(stat - want[1]) < 1e-9
          && verdict === want[2],
      );
      if (hit) matched.push(want);
      else missing.push(want);
    }
    const extra = got.filter(
      ([tt, stat, verdict]) => !EXPECTED_TRIPLES.some(
        (want) => tt === want[0] && Math.abs(stat - want[1]) < 1e-9 && verdict === want[2],
      ),
    );

    // Reported for a human reading test output, whether or not the
    // assertions below fail: this is the real engine-portability finding
    // the task asked for, not a debugging leftover.
    // eslint-disable-next-line no-console
    console.log('statcheck-ml-web pdf.test.js: Python vs pdfjs triples',
      { matched, missing_from_pdfjs: missing, extra_in_pdfjs: extra });

    expect(missing, `pdfjs did not find: ${JSON.stringify(missing)}`).toEqual([]);
    expect(extra, `pdfjs found extra results: ${JSON.stringify(extra)}`).toEqual([]);
    expect(results.length).toBe(EXPECTED_TRIPLES.length);
  });

  it('checkPdf reads the clean sample paper without throwing', async () => {
    const data = await readFile(path.join(fixturesDir, 'sample_paper.pdf'));
    const { results, pages } = await checkPdf(data, kit, model, { pdfjs });
    expect(pages).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(results)).toBe(true);
  });
});
