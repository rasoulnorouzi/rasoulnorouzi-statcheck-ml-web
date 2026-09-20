// `toJSON`, `toCSV` and `toMarkdown` against `docReport`s built from
// `checkPdf` on the two committed fixtures.

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
import { normalize } from '../src/normalize.js';
import { repair } from '../src/repair.js';
import { toJSON, toCSV, toMarkdown } from '../src/report.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const kitDir = path.join(here, '..', 'kit');
const fixturesDir = path.join(here, 'fixtures');

// A minimal splitter for the RFC 4180 shape `toCSV` writes: a quoted field
// may hold a comma or an escaped quote, so a plain `split(',')` cannot read
// it back.
function splitCsvLine(line) {
  const fields = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      let field = '';
      i += 1;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { field += '"'; i += 2; continue; }
        if (line[i] === '"') { i += 1; break; }
        field += line[i];
        i += 1;
      }
      fields.push(field);
      i += 1; // the comma or end of line after the closing quote
    } else {
      const next = line.indexOf(',', i);
      if (next === -1) { fields.push(line.slice(i)); i = line.length + 1; break; }
      fields.push(line.slice(i, next));
      i = next + 1;
    }
  }
  return fields;
}

async function buildDocReport(fileName, kit, model) {
  const data = await readFile(path.join(fixturesDir, fileName));
  const out = await checkPdf(data, kit, model, { pdfjs, fileName });
  return {
    fileName: out.fileName,
    title: out.title,
    titleSource: out.titleSource,
    pages: out.pages,
    results: out.results,
    stages: out.stages,
  };
}

describe('report', () => {
  let kit;
  let model;
  let docClean;
  let docDamaged;
  let kitInfo;

  beforeAll(async () => {
    kit = await loadKit(kitDir);
    model = await loadModel(kit);
    docClean = await buildDocReport('sample_paper.pdf', kit, model);
    docDamaged = await buildDocReport('sample_paper_damaged.pdf', kit, model);
    kitInfo = {
      version: kit.manifest.kit_version,
      model: kit.manifest.model_default,
      mother_commit: kit.manifest.mother_commit,
    };
  });

  it('every result of the damaged sample carries a traceable quote, context, page and offset', async () => {
    const data = await readFile(path.join(fixturesDir, 'sample_paper_damaged.pdf'));
    const { text } = await pdfToText(data, { pdfjs });
    const normalized = normalize(text, kit);
    const { text: fixed } = repair(normalized, kit);

    expect(docDamaged.results.length).toBeGreaterThan(0);
    for (const r of docDamaged.results) {
      expect(typeof r.quote).toBe('string');
      expect(r.quote.length).toBeGreaterThan(0);
      expect(fixed).toContain(r.quote);
      expect(r.context).toContain(r.quote);
      expect(r.page).toBe(1);
      expect(fixed.slice(r.offset, r.offset + r.quote.length)).toBe(r.quote);
    }
  });

  it('titles come from the largest text on page 1, both fixtures having no metadata Title', () => {
    // Confirmed against a real read of both fixtures with pdfjs-dist:
    // `doc.getMetadata()` reports no `Title` key at all for either (PyMuPDF's
    // `make_sample_paper.py` never calls `set_metadata`), so both fall back
    // to the largest-font heading on page 1.
    expect(docClean.titleSource).toBe('largest-font');
    expect(docClean.title).toBe('Attention and recall under time pressure');
    expect(docDamaged.titleSource).toBe('largest-font');
    expect(docDamaged.title).toBe('A paper whose operators the conversion destroyed');
  });

  describe('toCSV', () => {
    it('parses back with the header, one row per result, and a comma inside a quote surviving the round trip', () => {
      const csv = toCSV([docClean, docDamaged], kitInfo);
      const lines = csv.split('\r\n').filter((l) => l !== '');
      const header = splitCsvLine(lines[0]);
      expect(header).toEqual([
        'file', 'title', 'page', 'line', 'source', 'test_type', 'statistic',
        'df1', 'df2', 'p_operator', 'reported_p', 'computed_p', 'verdict',
        'quote', 'context',
      ]);

      const expectedRows = docClean.results.length + docDamaged.results.length;
      expect(lines.length - 1).toBe(expectedRows);

      // The chi2 result's quote holds a comma ("χ2(1, N = 223) = 8.69, p = .003").
      const chi2Row = lines.slice(1).map(splitCsvLine).find((f) => f[5] === 'chi2');
      expect(chi2Row).toBeDefined();
      expect(chi2Row[13]).toContain(',');
      expect(chi2Row[13]).toBe('χ2(1, N = 223) = 8.69, p = .003');
    });

    it('gives a document with no results one row, empty in the result columns', () => {
      const empty = {
        fileName: 'empty.pdf', title: null, titleSource: null, pages: 1, results: [], stages: {},
      };
      const csv = toCSV([empty], kitInfo);
      const lines = csv.split('\r\n').filter((l) => l !== '');
      expect(lines.length).toBe(2);
      const row = splitCsvLine(lines[1]);
      expect(row[0]).toBe('empty.pdf');
      expect(row.slice(2)).toEqual(['', '', '', '', '', '', '', '', '', '', '', '', '']);
    });
  });

  describe('toMarkdown', () => {
    it('gives one heading per document, a row per result, and every quote in the list', () => {
      const md = toMarkdown([docClean, docDamaged], kitInfo);
      const headings = md.match(/^## .+$/gm) ?? [];
      expect(headings.length).toBe(2);
      expect(headings[0]).toContain('Attention and recall under time pressure');
      expect(headings[1]).toContain('A paper whose operators the conversion destroyed');

      for (const r of [...docClean.results, ...docDamaged.results]) {
        expect(md).toContain(r.quote);
      }
      expect(md).toContain(kitInfo.version);
      expect(md).toContain(kitInfo.model);
      expect(md).toContain(kitInfo.mother_commit);
    });
  });

  describe('toJSON', () => {
    it('round-trips through JSON.parse and holds both documents', () => {
      const json = toJSON([docClean, docDamaged], kitInfo);
      const parsed = JSON.parse(json);
      expect(parsed.tool).toBe('statcheck-ml');
      expect(parsed.kit).toEqual(kitInfo);
      expect(parsed.documents.length).toBe(2);
      expect(parsed.documents[0].fileName).toBe('sample_paper.pdf');
      expect(parsed.documents[1].fileName).toBe('sample_paper_damaged.pdf');
      expect(parsed.documents[0].results.length).toBe(docClean.results.length);
      expect(new Date(parsed.generated_at).toString()).not.toBe('Invalid Date');
    });
  });
});
