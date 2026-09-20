// The demo page, driven in a real browser.
//
// Every other test here runs the library in Node. This one runs the page the
// way a reader does: it serves the repository, opens the page in Chromium,
// puts two PDFs in the file input, presses `[ run ]`, and reads what appears.
// The model, the WASM runtime and PDF.js all run inside that browser, so a
// fault in the import map, the worker path or the `wasmPaths` setting fails
// here and nowhere else.
//
// Playwright and its Chromium are development dependencies. The test skips
// itself when they are not installed, so `npm test` still runs on a machine
// that has not downloaded a browser.
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURES = join(ROOT, 'test', 'fixtures');

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.wasm': 'application/wasm', '.pdf': 'application/pdf',
  '.md': 'text/markdown', '.onnx': 'application/octet-stream',
};

let chromium = null;
try {
  ({ chromium } = await import('playwright'));
} catch {
  chromium = null;
}

function serve(root) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = normalize(join(root, path));
    if (!file.startsWith(root)) {            // no path escapes the served tree
      res.writeHead(403).end();
      return;
    }
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
      createReadStream(file).pipe(res);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const haveBrowser = chromium !== null
  && existsSync(join(FIXTURES, 'sample_paper_damaged.pdf'));

describe.skipIf(!haveBrowser)('the demo page in a browser', () => {
  let server; let port; let browser; let page; const errors = [];

  beforeAll(async () => {
    ({ server, port } = await serve(ROOT));
    // `channel: 'chromium'` runs the full browser build. The default is the
    // headless shell, a separate download this machine could not reach.
    browser = await chromium.launch({ channel: 'chromium' });
    page = await browser.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`http://127.0.0.1:${port}/demo/`);
    // The kit is verified file by file and the model is a 1.9 MB graph.
    await page.waitForFunction(
      () => document.getElementById('kit-status').textContent.endsWith('ready'),
      { timeout: 120_000 },
    );
  }, 180_000);

  afterAll(async () => {
    if (browser) await browser.close();
    if (server) await new Promise((done) => server.close(done));
  });

  it('loads the kit and the model without a console error', () => {
    expect(errors).toEqual([]);
  });

  it('queues the chosen files and waits for the run button', async () => {
    await page.setInputFiles('#file-input', [
      join(FIXTURES, 'sample_paper.pdf'),
      join(FIXTURES, 'sample_paper_damaged.pdf'),
    ]);
    await page.waitForSelector('#queue:not([hidden])');
    expect(await page.locator('#queue-list div').count()).toBe(2);
    expect(await page.locator('#run-button').textContent()).toContain('run 2 files');
    // Nothing has been checked yet: the tables stay hidden until `[ run ]`.
    expect(await page.locator('#summary-table').isHidden()).toBe(true);
  });

  it('checks both files when the run button is pressed', async () => {
    await page.click('#run-button');
    await page.waitForFunction(
      () => document.getElementById('status-log').textContent.includes('done:'),
      { timeout: 180_000 },
    );
    expect(await page.locator('#progress-bar').textContent()).toMatch(/^\[#+\]$/);
    expect(await page.locator('#progress-text').textContent()).toContain('100%');

    const summaryRows = page.locator('#summary-table tbody tr');
    expect(await summaryRows.count()).toBe(2);
    expect(await summaryRows.first().textContent()).toContain('sample_paper.pdf');

    // The damaged sample holds five results, the same five the Python port
    // finds (`test/pdf.test.js` asserts the triples).
    const damaged = page.locator('section', { hasText: 'sample_paper_damaged.pdf' });
    expect(await damaged.locator('tbody tr.result-row').count()).toBe(5);
  }, 200_000);

  it('shows the page and the sentence for each result', async () => {
    const detail = page.locator('#reports tbody tr.detail-row').first();
    const text = await detail.textContent();
    expect(text).toMatch(/[tFr]\(/);            // the quote itself
    expect(text.length).toBeGreaterThan(20);    // and its context
    const firstPage = await page.locator('#reports tbody tr.result-row td').first().textContent();
    expect(Number(firstPage)).toBeGreaterThan(0);
  });

  it('offers the three downloads', async () => {
    for (const [id, name] of [['#download-json', '.json'], ['#download-csv', '.csv'],
      ['#download-md', '.md']]) {
      expect(await page.locator(id).getAttribute('href')).toMatch(/^blob:/);
      expect(await page.locator(id).getAttribute('download')).toContain(name);
    }
    const csv = await page.evaluate(async () => {
      const href = document.getElementById('download-csv').getAttribute('href');
      return (await fetch(href)).text();
    });
    expect(csv.split('\r\n')[0]).toContain('page,line,source');
    expect(csv).toContain('sample_paper_damaged.pdf');
  });

  it('reports no console error over the whole run', () => {
    expect(errors).toEqual([]);
  });
});
