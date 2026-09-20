// The demo page's pure logic: file filtering to at most ten, verdict
// tallies, section headings, summary rows and the three download file
// names. `demo/support.js` has no DOM dependency, unlike `demo/app.js`
// (which reads `document` the moment it is imported), so this is a plain
// Node test, not a browser one.

import { describe, it, expect } from 'vitest';
import {
  MAX_FILES,
  DOWNLOAD_NAMES,
  isPdfFile,
  selectFiles,
  verdictCounts,
  formatVerdictCounts,
  sectionHeading,
  buildSummaryRow,
} from '../demo/support.js';

function fakeFile(name, type = 'application/pdf') {
  return { name, type };
}

describe('demo/support', () => {
  describe('isPdfFile', () => {
    it('accepts the PDF MIME type', () => {
      expect(isPdfFile(fakeFile('paper', 'application/pdf'))).toBe(true);
    });

    it('accepts a .pdf name when the type is blank', () => {
      expect(isPdfFile(fakeFile('paper.pdf', ''))).toBe(true);
    });

    it('rejects a name and type that are neither', () => {
      expect(isPdfFile(fakeFile('notes.txt', 'text/plain'))).toBe(false);
    });
  });

  describe('selectFiles', () => {
    it('keeps every file when there are ten or fewer PDFs and nothing else', () => {
      const files = Array.from({ length: 10 }, (_, i) => fakeFile(`paper-${i}.pdf`));
      const { accepted, rejected, overflow } = selectFiles(files);
      expect(accepted.length).toBe(10);
      expect(rejected).toEqual([]);
      expect(overflow).toBe(0);
    });

    it('keeps only the first ten PDFs and reports the rest as overflow, not by name', () => {
      const files = Array.from({ length: 13 }, (_, i) => fakeFile(`paper-${i}.pdf`));
      const { accepted, rejected, overflow } = selectFiles(files, MAX_FILES);
      expect(accepted.length).toBe(10);
      expect(accepted.map((f) => f.name)).toEqual(files.slice(0, 10).map((f) => f.name));
      expect(rejected).toEqual([]);
      expect(overflow).toBe(3);
    });

    it('rejects a non-PDF by name and does not count it toward the ten-file cap', () => {
      const files = [
        fakeFile('paper-1.pdf'),
        fakeFile('notes.txt', 'text/plain'),
        fakeFile('paper-2.pdf'),
        fakeFile('image.png', 'image/png'),
      ];
      const { accepted, rejected, overflow } = selectFiles(files);
      expect(accepted.map((f) => f.name)).toEqual(['paper-1.pdf', 'paper-2.pdf']);
      expect(rejected.map((f) => f.name)).toEqual(['notes.txt', 'image.png']);
      expect(overflow).toBe(0);
    });

    it('applies the cap to PDFs only, after non-PDFs are set aside', () => {
      const files = [
        ...Array.from({ length: 11 }, (_, i) => fakeFile(`paper-${i}.pdf`)),
        fakeFile('readme.md', 'text/markdown'),
      ];
      const { accepted, rejected, overflow } = selectFiles(files, MAX_FILES);
      expect(accepted.length).toBe(10);
      expect(rejected.map((f) => f.name)).toEqual(['readme.md']);
      expect(overflow).toBe(1);
    });

    it('respects a smaller cap passed explicitly', () => {
      const files = Array.from({ length: 5 }, (_, i) => fakeFile(`paper-${i}.pdf`));
      const { accepted, overflow } = selectFiles(files, 2);
      expect(accepted.length).toBe(2);
      expect(overflow).toBe(3);
    });
  });

  describe('verdictCounts / formatVerdictCounts', () => {
    it('tallies each verdict and falls back to "unknown" when one is missing', () => {
      const results = [
        { verdict: 'consistent' },
        { verdict: 'consistent' },
        { verdict: 'inconsistent' },
        {},
      ];
      expect(verdictCounts(results)).toEqual({ consistent: 2, inconsistent: 1, unknown: 1 });
    });

    it('prints counts sorted by verdict name, regardless of the order results were found', () => {
      const inOneOrder = [{ verdict: 'undecidable' }, { verdict: 'consistent' }, { verdict: 'consistent' }];
      const inAnotherOrder = [{ verdict: 'consistent' }, { verdict: 'consistent' }, { verdict: 'undecidable' }];
      const expected = 'consistent: 2, undecidable: 1';
      expect(formatVerdictCounts(inOneOrder)).toBe(expected);
      expect(formatVerdictCounts(inAnotherOrder)).toBe(expected);
    });

    it('prints "none" for an empty result list', () => {
      expect(formatVerdictCounts([])).toBe('none');
    });
  });

  describe('sectionHeading', () => {
    it('uses the title and the file name when the title came from metadata', () => {
      expect(sectionHeading('paper.pdf', 'A Real Title', 'metadata'))
        .toBe('A Real Title — paper.pdf');
    });

    it('notes when the title came from the largest text on page 1', () => {
      expect(sectionHeading('paper.pdf', 'A Real Title', 'largest-font'))
        .toBe('A Real Title (from the largest text on page 1) — paper.pdf');
    });

    it('falls back to a placeholder when no title was found', () => {
      expect(sectionHeading('paper.pdf', null, null))
        .toBe('(no title found) — paper.pdf');
    });
  });

  describe('buildSummaryRow', () => {
    it('summarises a file that was read', () => {
      const row = buildSummaryRow('paper.pdf', {
        title: 'A Real Title',
        pages: 12,
        results: [{ verdict: 'consistent' }, { verdict: 'inconsistent' }],
      });
      expect(row).toEqual({
        fileName: 'paper.pdf',
        title: 'A Real Title',
        pages: 12,
        resultCount: 2,
        verdicts: 'consistent: 1, inconsistent: 1',
        error: null,
      });
    });

    it('marks a file PDF.js could not read, carrying the error message', () => {
      const row = buildSummaryRow('broken.pdf', { error: 'Invalid PDF structure' });
      expect(row.title).toBe('could not read');
      expect(row.error).toBe('Invalid PDF structure');
      expect(row.pages).toBeNull();
      expect(row.resultCount).toBeNull();
    });
  });

  describe('DOWNLOAD_NAMES', () => {
    it('names the three downloads after the tool, one extension each', () => {
      expect(DOWNLOAD_NAMES).toEqual({
        json: 'statcheck-ml-report.json',
        csv: 'statcheck-ml-report.csv',
        md: 'statcheck-ml-report.md',
      });
    });
  });
});
