// Loads the port kit and checks it against its own manifest.
//
// The kit is exported by the mother repository (see kit/README.md) and holds
// the shared spec, the trained model, and the parity cases every port is
// measured against. A port never edits a kit file, so loading it here is the
// only place that needs to know where the files are and what they should
// hash to.

const TEXT_SUFFIXES = ['.json', '.jsonl', '.csv', '.txt', '.md'];

const SPEC_FILES = {
  prefilter: 'spec/prefilter.json',
  normalize: 'spec/normalize.json',
  repair: 'spec/repair.json',
  charmap: 'spec/charmap.json',
  font_table: 'spec/font_table.json',
};

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

function isTextPath(relPath) {
  return TEXT_SUFFIXES.some((suffix) => relPath.endsWith(suffix));
}

/**
 * Fold CRLF to LF the way the manifest was built, so a checkout on Windows
 * hashes the same as one on Linux. A binary file is hashed exactly as read.
 */
function bytesForHashing(bytes, relPath) {
  if (!isTextPath(relPath)) return bytes;
  return encoder.encode(decoder.decode(bytes).replace(/\r\n/g, '\n'));
}

async function sha256Hex(bytes, inNode) {
  // `node:crypto` is imported here, not at module scope, for the same reason
  // `makeReader` imports `node:fs/promises` and `node:path` lazily below: a
  // browser cannot resolve a `node:` specifier at all, even one this branch
  // never runs, because module resolution happens before any code executes.
  if (inNode) {
    const { createHash } = await import('node:crypto');
    return createHash('sha256').update(bytes).digest('hex');
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Build a function that reads one kit file as raw bytes: from disk in Node,
 * or by fetching relative to a base URL in a browser.
 */
async function makeReader(base, inNode) {
  if (inNode) {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    return async (relPath) => new Uint8Array(await readFile(join(base, ...relPath.split('/'))));
  }
  const baseUrl = base.endsWith('/') ? base : `${base}/`;
  return async (relPath) => {
    const res = await fetch(new URL(relPath, baseUrl));
    if (!res.ok) throw new Error(`statcheck-ml kit: cannot fetch ${relPath} (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  };
}

/**
 * Load and verify the port kit.
 *
 * Every file the manifest lists is read once, whatever its size, and its
 * hash is checked before the kit is trusted. The model files (`tagger.onnx`,
 * `weights.json`) are hashed the same way but are not kept: they are read
 * again, by the model stage, only when a prediction is needed.
 *
 * @param {string} baseUrlOrPath A directory path in Node, or a base URL a
 *   browser can fetch relative to.
 * @returns {Promise<{spec: object, manifest: object, modelDir: string, base: string}>}
 */
export async function loadKit(baseUrlOrPath) {
  const inNode = typeof window === 'undefined';
  const read = await makeReader(baseUrlOrPath, inNode);

  const manifestBytes = await read('manifest.json');
  const manifest = JSON.parse(decoder.decode(manifestBytes));

  const specKeyByPath = new Map(
    Object.entries(SPEC_FILES).map(([key, relPath]) => [relPath, key]));
  const spec = {};

  for (const [relPath, expected] of Object.entries(manifest.files)) {
    const bytes = await read(relPath);
    const actual = await sha256Hex(bytesForHashing(bytes, relPath), inNode);
    if (actual !== expected) {
      throw new Error(`statcheck-ml kit: hash mismatch for ${relPath}`);
    }
    const specKey = specKeyByPath.get(relPath);
    if (specKey) spec[specKey] = JSON.parse(decoder.decode(bytes));
  }

  for (const key of Object.keys(SPEC_FILES)) {
    if (!(key in spec)) throw new Error(`statcheck-ml kit: manifest is missing ${SPEC_FILES[key]}`);
  }

  return {
    spec,
    manifest,
    modelDir: `model/${manifest.model_default}`,
    base: baseUrlOrPath,
  };
}
