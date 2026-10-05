// The demo page's pure logic: file filtering to at most ten, verdict
// tallies, section headings, summary rows and the three download file
// names. `demo/support.js` has no DOM dependency, unlike `demo/app.js`
// (which reads `document` the moment it is imported), so this is a plain
// Node test, not a browser one.

import { describe, it, expect } from 'vitest';
import {
  MAX_FILES, DOWNLOAD_NAMES, isPdfFile, selectFiles, verdictCounts, formatVerdictCounts, sectionHeading, buildSummaryRow, progressBar, queueLines,
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

describe('progressBar', () => {
  it('draws an empty bar at the start and a full one at the end', () => {
    expect(progressBar(0, 4, 0, 8)).toEqual({ bar: '[--------]', text: '0% (1/4)' });
    expect(progressBar(4, 4, 0, 8)).toEqual({ bar: '[########]', text: '100% (4/4)' });
  });

  it('moves while one long file is still being read', () => {
    const { bar, text } = progressBar(0, 1, 0.5, 8);
    expect(bar).toBe('[####----]');
    expect(text).toBe('50% (1/1)');
  });

  it('never runs past the ends', () => {
    expect(progressBar(9, 4, 5, 8).bar).toBe('[########]');
    expect(progressBar(0, 0).bar).toBe('');
  });
});

describe('queueLines', () => {
  it('names each file and its size', () => {
    expect(queueLines([{ name: 'a.pdf', size: 2048 }])).toEqual(['a.pdf  2 kB']);
  });

  it('tolerates a file object with no size', () => {
    expect(queueLines([{ name: 'b.pdf' }])).toEqual(['b.pdf  0 kB']);
  });
});

describe('demo/support, damaged characters and reasons', async () => {
  const { showUnmapped, oneLine, hasUnmapped, whyLine, UNMAPPED_MARK } = await import('../demo/support.js');

  it('shows a control character as the mark and keeps tabs and newlines', () => {
    expect(showUnmapped('ts \u0003 2.5,\tps \u0006 0.02\n')).toBe(`ts ${UNMAPPED_MARK} 2.5,\tps ${UNMAPPED_MARK} 0.02\n`);
    expect(oneLine('t(212) =\n\n12.65, p \u0004 .26 ')).toBe(`t(212) = 12.65, p ${UNMAPPED_MARK} .26`);
    expect(hasUnmapped('t(20) = 2.1')).toBe(false);
    expect(hasUnmapped('t(20) \u0004 2.1')).toBe(true);
  });

  it('gives a reason line for a result that is not consistent', () => {
    expect(whyLine({ verdict: 'consistent', reason: '' })).toBe('');
    expect(whyLine({ verdict: 'undecidable', reason: 'no degrees of freedom found beside this result', missing: ['df1'], quote: 'ts = 2.5' }))
      .toBe('why: no degrees of freedom found beside this result');
  });

  it('names the unmapped character as the likely operator', () => {
    const r = { verdict: 'undecidable', reason: 'no operator before the p-value found beside this result', missing: ['p_operator'], quote: 't(212) \u0004 1.25, p \u0004 .26' };
    expect(whyLine(r)).toContain(`the ${UNMAPPED_MARK} in the quote is likely the lost operator`);
  });
});

describe('demo/support, theme', async () => {
  const { nextTheme } = await import('../demo/support.js');
  it('moves between the two themes', () => {
    expect(nextTheme('dark')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
  });
});
