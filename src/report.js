// Turn one or more checked documents into a file a reader can act on.
//
// `checkPdf` gives one document's results. A reader checking several PDFs at
// once needs them side by side, in a format they can open outside this page
// — a spreadsheet, a document, or a JSON file another tool can read back in.
// This file builds all three from the same input, a `docReport`:
//
//   { fileName, title, titleSource, pages, results, stages }
//
// one per document, exactly what `checkPdf` returns plus the file name a
// caller already knows. Nothing here recomputes a verdict or a p-value;
// this stage only arranges what `checkPdf` already found.

const CSV_COLUMNS = [
  'file', 'title', 'page', 'line', 'source', 'test_type', 'statistic',
  'df1', 'df2', 'p_operator', 'reported_p', 'computed_p', 'verdict',
  'quote', 'context', 'mode',
];

/**
 * Quote one CSV field per RFC 4180: a comma, a quote, or a newline forces
 * the field into quotes, and a quote inside it is doubled.
 */
function csvField(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function csvRow(values) {
  return values.map(csvField).join(',');
}

/**
 * One document's CSV rows: one per result, or one empty-result row when it
 * has none, so a reader can see the file was checked rather than missing
 * from the report by accident.
 */
function csvRowsFor(doc) {
  if (doc.results.length === 0) {
    return [csvRow([doc.fileName, doc.title, '', '', '', '', '', '', '', '', '', '', '', '', '',
      doc.mode])];
  }
  return doc.results.map((r) => csvRow([
    doc.fileName, doc.title, r.page, r.line, r.source, r.test_type, r.statistic,
    r.df1, r.df2, r.p_operator, r.p_value, r.computed_p, r.verdict, r.quote, r.context,
    doc.mode,
  ]));
}

/**
 * `docReports` as one CSV file, one row per result, CRLF line endings.
 *
 * `kit` is accepted for the same `(docReports, kit)` shape as `toMarkdown`
 * and `toJSON`, but a CSV row carries no kit line of its own — that
 * information belongs beside the data it describes, not inside a
 * spreadsheet column.
 *
 * @param {Array<{fileName: ?string, title: ?string, pages: number,
 *   results: Array<object>}>} docReports
 * @param {{version: string, model: string, mother_commit: string}} kit
 * @returns {string}
 */
export function toCSV(docReports, kit) {
  const lines = [csvRow(CSV_COLUMNS), ...docReports.flatMap(csvRowsFor)];
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * `docReports` and `kit` as one JSON document: `documents` holds every
 * `docReport` exactly as given, so a reader that wants the raw shape back
 * gets it without another parse step.
 *
 * @param {Array<object>} docReports
 * @param {{version: string, model: string, mother_commit: string}} kit
 * @param {{pretty?: boolean}} [options]
 * @returns {string}
 */
export function toJSON(docReports, kit, { pretty = true } = {}) {
  const payload = {
    tool: 'statcheck-ml',
    kit: { version: kit.version, model: kit.model, mother_commit: kit.mother_commit },
    generated_at: new Date().toISOString(),
    documents: docReports,
  };
  return JSON.stringify(payload, null, pretty ? 2 : undefined);
}

/** Escape a Markdown table's column separator inside cell text. */
function escapeCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return text.replace(/\|/g, '\\|');
}

function tallyVerdicts(results) {
  const counts = {};
  for (const r of results) counts[r.verdict ?? 'unknown'] = (counts[r.verdict ?? 'unknown'] ?? 0) + 1;
  // Sorted, not insertion order, so the same document always prints the
  // same summary regardless of which verdict its results happened to hit
  // first.
  return Object.keys(counts).sort().map((v) => `${v}: ${counts[v]}`).join(', ') || 'none';
}

function markdownTable(results) {
  const header = '| page | line | test | statistic | p reported | p computed | verdict | source |';
  const rule = '|---|---|---|---|---|---|---|---|';
  const rows = results.map((r) => `| ${escapeCell(r.page ?? '')} | ${escapeCell(r.line)} | `
    + `${escapeCell(r.test_type)} | ${escapeCell(r.statistic)} | ${escapeCell(r.p_value ?? '')} | `
    + `${escapeCell(r.computed_p ?? '')} | ${escapeCell(r.verdict)} | ${escapeCell(r.source)} |`);
  return [header, rule, ...rows].join('\n');
}

function markdownQuoteList(results) {
  return results.map((r, i) => `${i + 1}. \`${r.quote}\` — ${r.context}`).join('\n');
}

function markdownDoc(doc) {
  const heading = doc.title || doc.fileName || 'Untitled document';
  const parts = [
    `## ${escapeCell(heading)}`,
    '',
    `File: ${doc.fileName ?? '(none)'}. Pages: ${doc.pages}. Mode: ${doc.mode ?? 'hybrid'}. `
      + `Verdicts: ${tallyVerdicts(doc.results)}.`,
  ];
  if (doc.results.length > 0) {
    parts.push('', markdownTable(doc.results), '', markdownQuoteList(doc.results));
  } else {
    parts.push('', 'No results found.');
  }
  return parts.join('\n');
}

/**
 * `docReports` as one Markdown report: a heading and a narrow table per
 * document, with the quote and its context moved to a numbered list under
 * the table so the table itself stays readable.
 *
 * @param {Array<object>} docReports
 * @param {{version: string, model: string, mother_commit: string}} kit
 * @returns {string}
 */
export function toMarkdown(docReports, kit) {
  const sections = docReports.map(markdownDoc);
  const trailer = `Generated by statcheck-ml kit ${kit.version}, model ${kit.model}, `
    + `mother commit ${kit.mother_commit}.`;
  return [...sections, '---', trailer].join('\n\n');
}
