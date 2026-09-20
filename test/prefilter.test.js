// Every `prefilter` case from the kit's parity file, against the JavaScript
// port.

import {
  describe, it, expect, beforeAll,
} from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { loadKit } from '../src/kit.js';
import { prefilter } from '../src/prefilter.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const kitDir = path.join(here, '..', 'kit');
const cases = JSON.parse(
  fs.readFileSync(path.join(kitDir, 'parity', 'cases.json'), 'utf8'),
).sections.prefilter;

describe('prefilter', () => {
  let kit;
  beforeAll(async () => {
    kit = await loadKit(kitDir);
  });

  for (const c of cases) {
    it(c.name, () => {
      const windows = prefilter(c.text, kit).map(({ start, end, line }) => ({ start, end, line }));
      expect(windows).toEqual(c.expected);
    });
  }
});
