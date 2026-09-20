// Every `pipeline` case from the kit's parity file, against `checkText`.
//
// A case's expected results carry only the fields listed in the mother
// repository's `tests/parity_lib.py` (`PIPELINE_RESULT_KEYS`); `checkText`
// returns more (`reason`, `missing`), so this suite compares field by field
// rather than with a blanket `toEqual`. A number is compared to 1e-9
// relative, matching the task's tolerance for floating-point drift between
// the two language runtimes; every other field, including a `null`, must
// match exactly.

import {
  describe, it, expect, beforeAll,
} from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { loadKit } from '../src/kit.js';
import { loadModel } from '../src/model.js';
import { checkText } from '../src/pipeline.js';
import { normalize } from '../src/normalize.js';
import { repair } from '../src/repair.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const kitDir = path.join(here, '..', 'kit');
const cases = JSON.parse(
  fs.readFileSync(path.join(kitDir, 'parity', 'cases.json'), 'utf8'),
).sections.pipeline;

function expectField(got, want) {
  if (typeof want === 'number' && typeof got === 'number') {
    const scale = Math.max(Math.abs(want), 1e-12);
    expect(Math.abs(got - want) / scale).toBeLessThan(1e-9);
    return;
  }
  expect(got ?? null).toEqual(want ?? null);
}

describe('pipeline', () => {
  let kit;
  let model;
  beforeAll(async () => {
    kit = await loadKit(kitDir);
    model = await loadModel(kit);
  });

  for (const c of cases) {
    it(c.name, async () => {
      const { results } = await checkText(c.text, kit, model);
      expect(results.length).toBe(c.expected.length);
      for (let i = 0; i < c.expected.length; i += 1) {
        const want = c.expected[i];
        const got = results[i];
        for (const key of Object.keys(want)) expectField(got[key], want[key]);
      }
    });
  }

  it('adds quote, offset and context to every result, without disturbing the parity fields', async () => {
    const c = cases.find((doc) => doc.expected.length > 0);
    const { results } = await checkText(c.text, kit, model);
    expect(results.length).toBe(c.expected.length);

    // `offset` is a position in the text `checkText` actually scanned —
    // after normalise and repair, not the raw case text — so the round
    // trip below reproduces those two stages the same way `checkText` does.
    const normalized = normalize(c.text, kit);
    const { text: fixed } = repair(normalized, kit);

    for (let i = 0; i < c.expected.length; i += 1) {
      const want = c.expected[i];
      const got = results[i];
      for (const key of Object.keys(want)) expectField(got[key], want[key]);

      expect(typeof got.quote).toBe('string');
      expect(got.quote.length).toBeGreaterThan(0);
      expect(typeof got.offset).toBe('number');
      expect(fixed.slice(got.offset, got.offset + got.quote.length)).toBe(got.quote);
      expect(typeof got.context).toBe('string');
      // `quote` keeps an internal line break verbatim (only its ends are
      // trimmed), but `context` collapses every line break to a space, so a
      // quote that crosses a line — this project's own design rule is that
      // one can — is compared to `context` the same way.
      expect(got.context).toContain(got.quote.replace(/\n/g, ' '));
    }
  });
});
