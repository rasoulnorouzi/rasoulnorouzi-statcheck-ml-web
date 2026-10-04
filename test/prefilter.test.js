// Every `prefilter` case from the kit's parity file, against the JavaScript
// port.

import {
  describe, it, expect, beforeAll,
} from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { loadKit } from '../src/kit.js';
import { prefilter, units } from '../src/prefilter.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const kitDir = path.join(here, '..', 'kit');
const sections = JSON.parse(
  fs.readFileSync(path.join(kitDir, 'parity', 'cases.json'), 'utf8'),
).sections;
const cases = sections.prefilter;

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

describe('units', () => {
  let kit;
  beforeAll(async () => {
    kit = await loadKit(kitDir);
  });

  it('reads the unit kind from the spec', () => {
    expect(kit.spec.prefilter.unit).toBe('passage');
  });

  for (const c of sections.units) {
    it(c.name, () => {
      const got = units(c.text, kit).map((u) => ({
        start_line: u.startLine,
        end_line: u.endLine,
        char_start: u.start,
        char_end: u.end,
        sha256: crypto.createHash('sha256').update(u.text, 'utf8').digest('hex'),
      }));
      expect(got).toEqual(c.expected);
    });
  }

  it('returns the windows when the spec says window', () => {
    const windowKit = { ...kit, spec: { ...kit.spec, prefilter: { ...kit.spec.prefilter, unit: 'window' } } };
    const c = cases[0];
    expect(units(c.text, windowKit).map((u) => u.line)).toEqual(c.expected.map((w) => w.line));
  });
});
