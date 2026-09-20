# Vendored runtime files

The demo page has no build step, so it cannot resolve a bare package name
like `onnxruntime-web` or fetch a package's files from `node_modules` (GitHub
Pages serves the repository as static files only). The files below are
copied out of `node_modules` instead, and the demo imports them directly.

## onnxruntime-web 1.30.0

- `ort.wasm.min.mjs` — the `wasm`-only build (no WebGL, no WebGPU), since
  `src/model.js` requests only `executionProviders: ['wasm']`. Mapped to the
  bare specifier `onnxruntime-web` by the import map in `demo/index.html`,
  so `src/model.js`'s own `import * as ort from 'onnxruntime-web'` resolves
  to this file too, and both places share the one loaded module.
- `ort-wasm-simd-threaded.mjs` — the WASM loader this file's companion. It
  is the single-threaded/multi-threaded unified build; `ort.env.wasm.numThreads
  = 1` (set in `src/model.js`) keeps it on one thread, which needs no
  `SharedArrayBuffer` and so no cross-origin-isolation headers, which a
  plain GitHub Pages deployment does not send.
- `ort-wasm-simd-threaded.wasm` — the WebAssembly binary itself.

Copy command, from the package root:

    node -e "const fs=require('fs');
      for (const f of ['ort.wasm.min.mjs','ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm'])
        fs.copyFileSync('node_modules/onnxruntime-web/dist/'+f, 'demo/vendor/'+f);"

## pdfjs-dist 5.4.624

- `pdf.min.mjs` — the browser build (not `legacy/`, which is for older
  browsers without native support for current JavaScript; a page built for
  GitHub Pages in 2026 does not need it).
- `pdf.worker.min.mjs` — its worker, set as `GlobalWorkerOptions.workerSrc`
  in `demo/app.js`. Without it PDF.js falls back to a slower "fake worker"
  running on the main thread.

Copy command, from the package root:

    node -e "const fs=require('fs');
      for (const f of ['pdf.min.mjs','pdf.worker.min.mjs'])
        fs.copyFileSync('node_modules/pdfjs-dist/build/'+f, 'demo/vendor/'+f);"

## Why 5.4.624 and not the latest pdfjs-dist

`pdfjs-dist` 5.7 and 6.x declare `"engines": {"node": ">=22.13.0 || >=24"}`.
`.github/workflows/test.yml` runs the test matrix on Node 20 as well as 24,
so `pdfToText` is exercised on both in CI. 5.4.624 is the newest release
whose engines field includes Node 20 (`>=20.16.0 || >=22.3.0`), so it is the
version this package depends on and the version vendored here, to keep the
demo and the test suite reading the same PDF.js.
