// The pattern-based extractor. This is the baseline, not the product.
//
// This is the JavaScript port of `statcheck_ml/extract.py`. It reproduces
// what the R package `statcheck` finds: a test statistic reported in APA
// style, with its degrees of freedom and its p-value.
//
// The ported regex keeps its faults. It is the baseline improvement is
// measured against, so it must stay faithful rather than better. If the
// Python version misses a case, this version misses it too.
//
// It is never the fallback for the model. Mixing the two would make the
// comparison meaningless.

// A number, with an optional sign and an optional leading decimal point.
const NUM = String.raw`-?\d*\.?\d+`;

// One pattern for each family of test. Named groups carry the parts out.
// Spacing is permissive, because typesetting varies between publishers.
const PATTERNS = {
  t: new RegExp(
    String.raw`\bt\s*\(\s*(?<df1>${NUM})\s*\)\s*(?<sop>[=<>])\s*(?<stat>${NUM})` +
    String.raw`\s*,\s*p\s*(?<pop>[=<>])\s*(?<p>${NUM})`, 'gi'),
  f: new RegExp(
    String.raw`\bF\s*\(\s*(?<df1>${NUM})\s*,\s*(?<df2>${NUM})\s*\)\s*(?<sop>[=<>])\s*(?<stat>${NUM})` +
    String.raw`\s*,\s*p\s*(?<pop>[=<>])\s*(?<p>${NUM})`, 'gi'),
  r: new RegExp(
    String.raw`\br\s*\(\s*(?<df1>${NUM})\s*\)\s*(?<sop>[=<>])\s*(?<stat>${NUM})` +
    String.raw`\s*,\s*p\s*(?<pop>[=<>])\s*(?<p>${NUM})`, 'gi'),
  z: new RegExp(
    String.raw`\bz\s*(?<sop>[=<>])\s*(?<stat>${NUM})` +
    String.raw`\s*,\s*p\s*(?<pop>[=<>])\s*(?<p>${NUM})`, 'gi'),
  chi2: new RegExp(
    String.raw`\b(?:χ\s*2|χ2|chi2|X2|c2)\s*\(\s*(?<df1>${NUM})` +
    String.raw`(?:\s*,\s*N\s*[=<>]\s*(?<n>[\d,]+))?\s*\)\s*(?<sop>[=<>])\s*(?<stat>${NUM})` +
    String.raw`\s*,\s*p\s*(?<pop>[=<>])\s*(?<p>${NUM})`, 'gi'),
  q: new RegExp(
    String.raw`\bQ(?:w|b)?\s*\(\s*(?<df1>${NUM})\s*\)\s*(?<sop>[=<>])\s*(?<stat>${NUM})` +
    String.raw`\s*,\s*p\s*(?<pop>[=<>])\s*(?<p>${NUM})`, 'gi'),
};

/**
 * Find every result the pattern can read, ordered by position.
 *
 * Whitespace inside a result is not normalised first. That is deliberate:
 * a caller that wants the offsets needs them to point into the text passed
 * in, the same as the Python reference.
 *
 * `kit` is accepted but not read: this stage has no spec of its own yet,
 * unlike `normalize`. It is here so every stage in the pipeline takes the
 * same `(text, kit)` shape.
 *
 * @param {string} text
 * @param {object} [kit] From `loadKit`. Unused by this stage.
 * @returns {Array<{test_type: string, statistic: string, df1: ?string,
 *   df2: ?string, p_operator: string, p_value: string}>}
 */
export function extract(text, kit) {
  const found = [];
  for (const [name, pattern] of Object.entries(PATTERNS)) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const g = m.groups;
      found.push({
        test_type: name,
        statistic: g.stat,
        df1: g.df1 ?? null,
        df2: g.df2 ?? null,
        p_operator: g.pop,
        p_value: g.p,
        start: m.index,
        end: m.index + m[0].length,
      });
    }
  }
  found.sort((a, b) => a.start - b.start || a.end - b.end);

  // A z pattern can also match inside a longer result. Drop any extraction
  // that sits wholly inside another one.
  const kept = found.filter((e) =>
    !found.some((o) => o !== e && o.start <= e.start && e.end <= o.end));

  return kept.map(({ test_type, statistic, df1, df2, p_operator, p_value }) =>
    ({ test_type, statistic, df1, df2, p_operator, p_value }));
}
