// Every `repair` case from the kit's parity file, against the JavaScript
// port. Most cases exercise the arithmetic-validated mapping; a few, with
// too few testable results in the text, exercise its fallback to the simple
// anchor rule (see `src/repair.js`).

import {
  describe, it, expect, beforeAll,
} from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { loadKit } from '../src/kit.js';
import { repair } from '../src/repair.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const kitDir = path.join(here, '..', 'kit');
const cases = JSON.parse(
  fs.readFileSync(path.join(kitDir, 'parity', 'cases.json'), 'utf8'),
).sections.repair;

describe('repair', () => {
  let kit;
  beforeAll(async () => {
    kit = await loadKit(kitDir);
  });

  for (const c of cases) {
    it(c.name, () => {
      expect(repair(c.text, kit)).toEqual(c.expected);
    });
  }
});
