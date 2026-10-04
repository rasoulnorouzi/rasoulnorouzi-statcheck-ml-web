// The fragment path of `checkText`. No parity case produces a fragment, so
// the model is replaced by a stub that tags a bare statistic and its p-value
// with no test name. The cases that must agree with Python are in
// pipeline.test.js; this file checks the shape of the second list.

import {
  describe, it, expect, beforeAll, vi,
} from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

vi.mock('../src/model.js', () => ({
  tag: async (text) => {
    const tags = new Array(text.length).fill('O');
    const mark = (needle, name) => {
      const start = text.indexOf(needle);
      if (start < 0) return;
      for (let i = 0; i < needle.length; i += 1) {
        if (i === 0) tags[start + i] = `B-${name}`;
        else if (i === needle.length - 1) tags[start + i] = `E-${name}`;
        else tags[start + i] = `I-${name}`;
      }
    };
    mark('2.31', 'STAT');
    mark('.02', 'PVAL');
    return tags;
  },
}));

const { loadKit } = await import('../src/kit.js');
const { checkText } = await import('../src/pipeline.js');
const { toMarkdown, toCSV, FRAGMENT_NOTE } = await import('../src/report.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const kitDir = path.join(here, '..', 'kit');
const text = [
  'The participants in the second study were recruited from the university pool.',
  'The difference was 2.31, p = .02.',
  'The participants in the second study were recruited from the university pool.',
].join('\n');

describe('fragments', () => {
  let kit;
  beforeAll(async () => {
    kit = await loadKit(kitDir);
  });

  it('puts a find with no test name in a separate list, with no verdict', async () => {
    const { results, fragments, stages } = await checkText(text, kit, {});
    expect(results).toEqual([]);
    expect(fragments.length).toBe(1);
    const [f] = fragments;
    expect(f.statistic).toBe(2.31);
    expect(f.p_value).toBe(0.02);
    expect(f.test_type).toBeNull();
    expect(f.source).toBe('model');
    expect(f.statistic_span[1] - f.statistic_span[0]).toBe(4);
    for (const key of ['verdict', 'computed_p', 'reason', 'missing']) {
      expect(key in f).toBe(false);
    }
    expect(stages.find.fragments).toBe(1);
    expect(stages.check).toEqual({});
  });

  it('lists fragments in Markdown after the results, under the note', async () => {
    const { results, fragments } = await checkText(text, kit, {});
    const doc = {
      fileName: 'a.pdf', title: 'A', pages: 1, results, fragments, mode: 'hybrid',
    };
    const md = toMarkdown([doc], { version: '1', model: 'm', mother_commit: 'c' });
    expect(md).toContain(FRAGMENT_NOTE);
    expect(md.indexOf('No results found.')).toBeLessThan(md.indexOf(FRAGMENT_NOTE));
    expect(md).toContain('2.31');
  });

  it('keeps fragments out of the CSV', async () => {
    const { results, fragments } = await checkText(text, kit, {});
    const csv = toCSV([{
      fileName: 'a.pdf', title: 'A', pages: 1, results, fragments, mode: 'hybrid',
    }], {});
    expect(csv.trim().split('\r\n').length).toBe(2);
  });
});
