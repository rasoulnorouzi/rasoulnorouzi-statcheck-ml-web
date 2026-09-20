// Run the exported tagger: encode characters, run the ONNX graph, decode.
//
// This is the JavaScript port of `statcheck_ml.onnx_runtime.OnnxTagger`,
// using `onnxruntime-web` in place of the `onnxruntime` Python package. The
// WASM backend runs the same in Node, under vitest, and in a browser, which
// is the point of the package: one model, three runtimes, no server.
//
// The CRF stays outside the exported graph (see `kit/model/*/decoder.json`).
// Only the emission scores are exported, and `viterbiDecode` below is the
// Viterbi pass every port runs over them, ported from
// `statcheck_ml.crf.viterbi_decode` (equivalently, `CRF.decode`).

import * as ort from 'onnxruntime-web';

// One thread per session run. The Python reference is single-threaded by
// design, so that a multi-run evaluation stays predictable on a CPU a
// training grid may also be using; here it also sidesteps the cross-origin
// isolation a threaded WASM build needs to use `SharedArrayBuffer`, which a
// plain `npm test` run and a plain static host do not provide.
ort.env.wasm.numThreads = 1;

async function readBytes(base, relPath, inNode) {
  if (inNode) {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    return new Uint8Array(await readFile(join(base, ...relPath.split('/'))));
  }
  const baseUrl = base.endsWith('/') ? base : `${base}/`;
  const res = await fetch(new URL(relPath, baseUrl));
  if (!res.ok) throw new Error(`statcheck-ml model: cannot fetch ${relPath} (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Load one model out of the kit: the ONNX graph, its character map, and its
 * decoder (the tag names and, for a CRF model, the transition scores).
 *
 * `loadKit` already reads and hashes every file this function reads, but
 * does not keep the model bytes, so they are read again here, only when a
 * prediction is actually needed.
 *
 * @param {{base: string}} kit From `loadKit`.
 * @param {string} [config] A model directory name under `kit/model/`.
 * @returns {Promise<{session: import('onnxruntime-web').InferenceSession,
 *   charmap: object, decoder: object}>}
 */
export async function loadModel(kit, config = kit.manifest.model_default) {
  const dir = `model/${config}`;
  const inNode = typeof window === 'undefined';
  const [onnxBytes, charmapBytes, decoderBytes] = await Promise.all([
    readBytes(kit.base, `${dir}/tagger.onnx`, inNode),
    readBytes(kit.base, `${dir}/charmap.json`, inNode),
    readBytes(kit.base, `${dir}/decoder.json`, inNode),
  ]);

  const utf8 = new TextDecoder('utf-8');
  const charmap = JSON.parse(utf8.decode(charmapBytes));
  const decoder = JSON.parse(utf8.decode(decoderBytes));
  const session = await ort.InferenceSession.create(onnxBytes, { executionProviders: ['wasm'] });

  return { session, charmap, decoder };
}

/**
 * Text to character ids, one per Unicode character, unknown characters
 * mapped to `charmap.unk_id`.
 *
 * @param {string} text
 * @param {{chars: Object<string, number>, unk_id: number}} charmap
 * @returns {number[]}
 */
export function encode(text, charmap) {
  const unk = charmap.unk_id ?? 1;
  const ids = new Array(text.length);
  for (let i = 0; i < text.length; i += 1) ids[i] = charmap.chars[text[i]] ?? unk;
  return ids;
}

async function runLogits(text, model) {
  const ids = encode(text, model.charmap);
  const data = BigInt64Array.from(ids, (v) => BigInt(v));
  const tensor = new ort.Tensor('int64', data, [1, ids.length]);
  const result = await model.session.run({ ids: tensor });
  const { data: flat, dims } = result.logits; // [1, time, tags]
  const [, time, nTags] = dims;
  const rows = [];
  for (let t = 0; t < time; t += 1) rows.push(flat.subarray(t * nTags, (t + 1) * nTags));
  return rows;
}

function argmax(row) {
  let best = -Infinity;
  let bestIndex = 0;
  for (let i = 0; i < row.length; i += 1) {
    if (row[i] > best) { best = row[i]; bestIndex = i; }
  }
  return bestIndex;
}

/**
 * Raw emission scores for one window, one `Float32Array` row per character.
 *
 * @param {string} text
 * @param {{session, charmap, decoder}} model From `loadModel`.
 * @returns {Promise<Float32Array[]>}
 */
export async function logits(text, model) {
  if (!text) return [];
  return runLogits(text, model);
}

/**
 * The best tag path for the Viterbi decode of a linear-chain CRF over one
 * sequence. Mirrors `statcheck_ml.crf.viterbi_decode` (equivalently,
 * `CRF.decode` in the training-side module).
 *
 * `transitions` already carries the mask, so entry `[i][j]` is the score of
 * tag `j` following tag `i`, or a large negative number when that step is
 * forbidden.
 *
 * @param {Array<ArrayLike<number>>} emissions (time, n_tags).
 * @param {number[][]} transitions (n_tags, n_tags).
 * @param {number[]} start (n_tags,).
 * @param {number[]} end (n_tags,).
 * @returns {number[]} One tag id per row of `emissions`.
 */
export function viterbiDecode(emissions, transitions, start, end) {
  const time = emissions.length;
  if (time === 0) return [];
  const n = start.length;

  let score = new Float64Array(n);
  for (let i = 0; i < n; i += 1) score[i] = start[i] + emissions[0][i];

  if (time === 1) {
    const withEnd = new Float64Array(n);
    for (let i = 0; i < n; i += 1) withEnd[i] = score[i] + end[i];
    return [argmax(withEnd)];
  }

  const history = [];
  for (let t = 1; t < time; t += 1) {
    const bestPrev = new Int32Array(n);
    const bestScore = new Float64Array(n);
    for (let j = 0; j < n; j += 1) {
      let best = -Infinity;
      let bestI = 0;
      for (let i = 0; i < n; i += 1) {
        const v = score[i] + transitions[i][j];
        if (v > best) { best = v; bestI = i; }
      }
      bestPrev[j] = bestI;
      bestScore[j] = best;
    }
    const emissionRow = emissions[t];
    const next = new Float64Array(n);
    for (let j = 0; j < n; j += 1) next[j] = bestScore[j] + emissionRow[j];
    score = next;
    history.push(bestPrev);
  }

  const finalScore = new Float64Array(n);
  for (let i = 0; i < n; i += 1) finalScore[i] = score[i] + end[i];
  let tag = argmax(finalScore);
  const path = [tag];
  for (let t = time - 2; t >= 0; t -= 1) {
    tag = history[t][tag];
    path.push(tag);
  }
  path.reverse();
  return path;
}

/**
 * Tag one window of text: BIOES tags, one per character, decoded with
 * Viterbi when the model has a CRF head, or with plain argmax otherwise.
 *
 * @param {string} text
 * @param {{session, charmap, decoder}} model From `loadModel`.
 * @returns {Promise<string[]>}
 */
export async function tag(text, model) {
  if (!text) return [];
  const rows = await runLogits(text, model);
  const path = model.decoder.has_crf
    ? viterbiDecode(rows, model.decoder.transitions, model.decoder.start, model.decoder.end)
    : rows.map(argmax);
  return path.slice(0, text.length).map((i) => model.decoder.tags[i]);
}
