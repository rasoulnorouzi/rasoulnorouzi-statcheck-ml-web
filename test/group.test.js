// Every `group` case from the kit's parity file, against the JavaScript
// port. Each case supplies its own tag sequence, so this suite needs no
// model and no kit.

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { group } from '../src/group.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const kitDir = path.join(here, '..', 'kit');
const cases = JSON.parse(
  fs.readFileSync(path.join(kitDir, 'parity', 'cases.json'), 'utf8'),
).sections.group;

describe('group', () => {
  for (const c of cases) {
    it(c.name, () => {
      expect(group(c.text, c.tags)).toEqual(c.expected);
    });
  }
});
