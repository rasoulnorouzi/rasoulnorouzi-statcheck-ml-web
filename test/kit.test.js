// Checks that loadKit reads the shared kit and that it refuses a tampered one.

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { loadKit } from '../src/kit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const kitDir = path.join(here, '..', 'kit');

describe('loadKit', () => {
  it('loads the spec and the manifest, and verifies every hash', async () => {
    const kit = await loadKit(kitDir);
    expect(kit.manifest.model_default).toBe('gru-crf');
    expect(kit.modelDir).toBe('model/gru-crf');
    expect(kit.base).toBe(kitDir);
    expect(kit.spec.normalize.target_line_width).toBeTypeOf('number');
    expect(kit.spec.charmap.chars).toBeTypeOf('object');
    expect(kit.spec.prefilter).toBeTypeOf('object');
    expect(kit.spec.repair).toBeTypeOf('object');
    expect(kit.spec.font_table).toBeTypeOf('object');
  });

  it('names the file when its hash no longer matches the manifest', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'statcheck-ml-kit-'));
    fs.cpSync(kitDir, tmpDir, { recursive: true });
    const target = path.join(tmpDir, 'spec', 'normalize.json');
    const original = fs.readFileSync(target, 'utf8');
    // One character changed, well inside the file, not at either end.
    fs.writeFileSync(target, original.replace('"version": 1', '"version": 2'));

    await expect(loadKit(tmpDir)).rejects.toThrow('spec/normalize.json');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
