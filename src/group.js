// Turn a tag sequence into the results it describes.
//
// This is the JavaScript port of `statcheck_ml.labels.tags_to_spans` and of
// `statcheck_ml.evalutil.group_spans` / `build_result`. Two stages: first the
// BIOES tags collapse into (start, end, entity) spans, then the spans
// collapse into one result per test statistic, the boundary being a TEST tag
// or a second STAT tag with no TEST between them, exactly as the annotators
// drew it.
//
// `pipeline.js` reuses `tagsToSpans` and `groupSpans` from this file rather
// than redrawing the same boundary rule a second time; only the numeric
// parser differs between the two callers, because they parse two different
// things. This file parses gold-shaped text with `asNumber` (thousands
// commas, a stray control character at either end). `pipeline.js` parses
// what a live extraction produced, with `parseNumber` from `pvalue.js`.

const OUTSIDE = 'O';

/**
 * Read spans back out of a BIOES tag sequence.
 *
 * The decoding is forgiving. A model can emit an I tag with no B before it,
 * and dropping such a span would hide a near miss during evaluation, so a
 * stray continuation opens a span instead.
 *
 * @param {string[]} tags
 * @returns {Array<[number, number, string]>} (start, end, entity) triples.
 */
export function tagsToSpans(tags) {
  const spans = [];
  let start = null;
  let entity = null;
  const sequence = [...tags, OUTSIDE];

  for (let i = 0; i < sequence.length; i += 1) {
    const tag = sequence[i];
    let prefix;
    let ent;
    if (tag === OUTSIDE) {
      prefix = OUTSIDE;
      ent = null;
    } else {
      const cut = tag.indexOf('-');
      prefix = tag.slice(0, cut);
      ent = tag.slice(cut + 1);
    }

    if (prefix === 'B' || prefix === 'S' || ((prefix === 'I' || prefix === 'E') && entity !== ent)) {
      if (start !== null) spans.push([start, i, entity]);
      start = i;
      entity = ent;
      if (prefix === 'S') {
        spans.push([start, i + 1, entity]);
        start = null;
        entity = null;
      }
    } else if (prefix === 'E' && entity === ent) {
      spans.push([start, i + 1, entity]);
      start = null;
      entity = null;
    } else if (prefix === OUTSIDE) {
      if (start !== null) spans.push([start, i, entity]);
      start = null;
      entity = null;
    }
  }

  return spans.filter((s) => s[1] > s[0]);
}

/**
 * Turn a flat span list into (parts, spans) pairs, one per result.
 *
 * `parts` maps an entity name to the text it covers; a repeated entity in one
 * group keeps its first occurrence, matching a Python dict's `setdefault`.
 * `spans` lists every (start, end) pair the group consumed, in the order the
 * spans were seen, for a caller that wants the group's full extent.
 *
 * @param {string} text
 * @param {Array<[number, number, string]>} spans
 * @returns {Array<[Object<string,string>, Array<[number, number]>]>}
 */
export function groupSpans(text, spans) {
  const ordered = [...spans].sort((a, b) => {
    if (a[0] !== b[0]) return a[0] - b[0];
    if (a[1] !== b[1]) return a[1] - b[1];
    return a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0;
  });

  const results = [];
  let current = null;
  let currentSpans = [];

  for (const [start, end, label] of ordered) {
    const startsNewResult = label === 'TEST'
      || (label === 'STAT' && current !== null && Object.hasOwn(current, 'STAT'));
    if (startsNewResult) {
      if (current !== null) results.push([current, currentSpans]);
      current = {};
      currentSpans = [];
    }
    if (current === null) {
      current = {};
      currentSpans = [];
    }
    if (!Object.hasOwn(current, label)) current[label] = text.slice(start, end);
    currentSpans.push([start, end]);
  }
  if (current !== null) results.push([current, currentSpans]);
  return results;
}

/** `POP_EQ`, `POP_LT` and `POP_GT` read back to the operator they name. */
const ENTITY_OPERATOR = { POP_EQ: '=', POP_LT: '<', POP_GT: '>' };

/**
 * The operator a group of parts names, or null when it names none.
 *
 * The first `POP_*` key in insertion order wins, matching the reference's
 * `next(... for k in parts if k.startswith("POP_"))`. Two operator tags in
 * one group is a labelling error the model should not produce, but the rule
 * still needs to pick one deterministically when it does.
 *
 * @param {Object<string,string>} parts
 * @returns {?string}
 */
export function operatorFromParts(parts) {
  for (const key of Object.keys(parts)) {
    if (key.startsWith('POP_')) return ENTITY_OPERATOR[key];
  }
  return null;
}

// A character that stands for a damaged minus sign or a damaged decimal
// point, left over at either end of a number after a PDF conversion.
const CONTROL_RE = /[\x00-\x1f]/g;
const MINUS_CHARS = new Set(['-', '−', '–']); // hyphen, minus sign, en dash
const THOUSANDS_RE = /(?<=\d),(?=\d{3}(?:\D|$))/g;

function roundTo4(value) {
  // No parity case needs a genuine tie at the fourth decimal, so a plain
  // fixed-point round is enough; Python's banker's rounding is not mirrored.
  return Number(value.toFixed(4));
}

function parseClean(s) {
  let isNegative = false;
  let rest = s;
  if (MINUS_CHARS.has(rest.slice(0, 1))) {
    isNegative = true;
    rest = rest.slice(1).trim();
  }
  rest = rest.replace(THOUSANDS_RE, '');
  if (rest === '') return null;
  const val = Number(rest);
  if (!Number.isFinite(val)) return null;
  return isNegative ? -val : val;
}

/**
 * Text to a number, the way `statcheck_ml.align.as_number` reads a gold or
 * model-tagged span: a thousands comma is dropped, a leading hyphen, minus
 * sign or en dash is a negative sign, and a stray control character at
 * either end (a damaged minus or decimal point) is stripped once and the
 * parse retried, returning the positive magnitude because the sign such a
 * character carried cannot be recovered.
 *
 * This is a different, stricter parser than `parseNumber` in `pvalue.js`: it
 * never strips a leading `<`, `>` or `=`, because a span this function reads
 * never carries one.
 *
 * @param {?string} text
 * @returns {?number}
 */
export function asNumber(text) {
  if (text == null || text === '') return null;
  const s = String(text).trim();
  if (s === '') return null;

  const val = parseClean(s);
  if (val !== null) return roundTo4(val);

  const trimmed = (s.slice(0, 1).replace(CONTROL_RE, '') + s.slice(1, -1) + s.slice(-1).replace(CONTROL_RE, '')).trim();
  if (trimmed !== '' && trimmed !== s) {
    const val2 = parseClean(trimmed);
    if (val2 !== null) return roundTo4(Math.abs(val2));
  }
  return null;
}

/**
 * The `[start, end]` a group of spans covers: the earliest start and the
 * latest end among them, matching a Python `(min(starts), max(ends))`.
 *
 * `group` below uses this, and so does `pipeline.js`'s model branch, which
 * needs the same span to compute a result's `offset` — one place draws the
 * boundary, so the two callers cannot drift apart.
 *
 * @param {Array<[number, number]>} spans
 * @returns {[number, number]}
 */
export function spanOf(spans) {
  const starts = spans.map(([start]) => start);
  const ends = spans.map(([, end]) => end);
  return [Math.min(...starts), Math.max(...ends)];
}

function buildResult(parts) {
  const stat = asNumber(parts.STAT);
  if (stat == null) return null;
  return {
    test_type: (parts.TEST || '').trim().toLowerCase() || 't',
    statistic: stat,
    df1: asNumber(parts.DF1),
    df2: asNumber(parts.DF2),
    p_operator: operatorFromParts(parts),
    p_value: asNumber(parts.PVAL),
  };
}

/**
 * Group a tag sequence into results, with the character span each one covers.
 *
 * @param {string} text The text the tags were produced over.
 * @param {string[]} tags One BIOES tag per character of `text`.
 * @returns {Array<{test_type: string, statistic: number, df1: ?number,
 *   df2: ?number, p_operator: ?string, p_value: ?number,
 *   span: [number, number]}>}
 */
export function group(text, tags) {
  const out = [];
  for (const [parts, spans] of groupSpans(text, tagsToSpans(tags))) {
    const res = buildResult(parts);
    if (res === null) continue;
    out.push({ ...res, span: spanOf(spans) });
  }
  return out;
}
