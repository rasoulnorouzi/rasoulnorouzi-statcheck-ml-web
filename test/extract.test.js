// Every `extract` case from the kit's parity file, against the JavaScript port.

import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { loadKit } from '../src/kit.js';
import { extract } from '../src/extract.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const kitDir = path.join(here, '..', 'kit');
const cases = JSON.parse(
  fs.readFileSync(path.join(kitDir, 'parity', 'cases.json'), 'utf8'),
).sections.extract;

describe('extract', () => {
  let kit;
  beforeAll(async () => {
    kit = await loadKit(kitDir);
  });

  for (const c of cases) {
    it(c.name, () => {
      expect(extract(c.text, kit)).toEqual(c.expected);
    });
  }
});
