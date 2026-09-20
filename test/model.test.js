// The `model` and `model_logits` cases from the kit's parity file, against
// the JavaScript port of the tagger.
//
// The kit is loaded once (`loadKit` verifies every hash), and the model is
// loaded once too, in a file-level `beforeAll`, rather than once per case:
// an ONNX session is expensive to create and every case reads the same one.

import {
  describe, it, expect, beforeAll,
} from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { loadKit } from '../src/kit.js';
import { loadModel, tag, logits } from '../src/model.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const kitDir = path.join(here, '..', 'kit');
const cases = JSON.parse(fs.readFileSync(path.join(kitDir, 'parity', 'cases.json'), 'utf8'));
const logitTolerance = cases.logit_tolerance;

function argmax(row) {
  let best = -Infinity;
  let bestIndex = 0;
  for (let i = 0; i < row.length; i += 1) {
    if (row[i] > best) { best = row[i]; bestIndex = i; }
  }
  return bestIndex;
}

describe('model', () => {
  let kit;
  let model;

  beforeAll(async () => {
    kit = await loadKit(kitDir);
    model = await loadModel(kit);
  });

  describe('tag', () => {
    for (const c of cases.sections.model) {
      it(c.name, async () => {
        expect(await tag(c.text, model)).toEqual(c.expected);
      });
    }
  });

  describe('logits', () => {
    for (const c of cases.sections.model_logits) {
      it(c.name, async () => {
        const rows = await logits(c.text, model);
        expect(rows.length).toBe(c.expected.length);

        let maxDiff = 0;
        for (let t = 0; t < rows.length; t += 1) {
          expect(rows[t].length).toBe(c.expected[t].length);
          for (let i = 0; i < rows[t].length; i += 1) {
            const diff = Math.abs(rows[t][i] - c.expected[t][i]);
            if (diff > maxDiff) maxDiff = diff;
          }
          // Every argmax must match exactly: a tolerance on the logits is
          // only useful if it never flips the tag the CRF or the argmax
          // would decode.
          expect(argmax(rows[t])).toBe(argmax(c.expected[t]));
        }
        // Printed rather than only asserted, so the largest error a case
        // measured is visible with
        // `npx vitest run --disable-console-intercept`.
        console.log(`model_logits ${c.name}: max abs diff = ${maxDiff}`);
        expect(maxDiff).toBeLessThan(logitTolerance);
      });
    }
  });
});
