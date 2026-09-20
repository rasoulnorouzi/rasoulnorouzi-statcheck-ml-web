// Every `normalise` case from the kit's parity file, against the JavaScript port.

import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { loadKit } from '../src/kit.js';
import { normalize } from '../src/normalize.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const kitDir = path.join(here, '..', 'kit');
const cases = JSON.parse(
  fs.readFileSync(path.join(kitDir, 'parity', 'cases.json'), 'utf8'),
).sections.normalise;

describe('normalize', () => {
  let kit;
  beforeAll(async () => {
    kit = await loadKit(kitDir);
  });

  for (const c of cases) {
    it(`${c.engine}/${c.name}`, () => {
      expect(normalize(c.text, kit)).toBe(c.expected);
    });
  }
});
