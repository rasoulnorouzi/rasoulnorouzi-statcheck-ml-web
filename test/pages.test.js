// `placeOnPages` puts each row on a page by the digits of its quote. A short
// quote can also occur on an earlier page; rows come in document order, so a
// row must not jump back before the page of the row before it.
import { describe, expect, it } from 'vitest';
import { placeOnPages } from '../src/pipeline.js';

describe('placeOnPages', () => {
  const pages = ['ts = 3.1, n = 40', 'nothing here', 'F(1, 20) = 9.12, ts = 3.1'];

  it('keeps a repeated quote on the page after the row before it', () => {
    const rows = [{ quote: 'F(1, 20) = 9.12' }, { quote: 'ts = 3.1' }];
    expect(placeOnPages(rows, pages).map((r) => r.page)).toEqual([3, 3]);
  });

  it('takes the first page when no earlier row moved the cursor', () => {
    expect(placeOnPages([{ quote: 'ts = 3.1' }], pages)[0].page).toBe(1);
  });

  it('falls back to any page, and gives null for a short or unknown quote', () => {
    const rows = [{ quote: 'F(1, 20) = 9.12' }, { quote: 'ts = 3.1, n = 40' }, { quote: 't = 1' }, { quote: 'p = .777' }];
    expect(placeOnPages(rows, pages).map((r) => r.page)).toEqual([3, 1, null, null]);
  });
});
