import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// pdf.js, loaded only by the file viewer (pages/FileViewerPage.jsx).
//
// The worker is a file from Splitty's own origin (CSP worker-src 'self'); its
// .mjs ships as .js (vite.config.js). Fonts, character maps (Chinese, Japanese,
// Korean text), colour profiles and image decoders are copied to /pdfjs/ at
// build time (vite.config.js, copyPdfjsAssets). The CSP allows no WebAssembly,
// so pdf.js uses the decoders' JavaScript versions; slower, but tickets are small.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const ASSETS = '/pdfjs/'

// The whole file at once, not in ranges: the signed link expires after five
// minutes, and a ticket is at most 10 MB (the upload limit).
export async function loadPdf(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = new Uint8Array(await res.arrayBuffer())
  return pdfjs.getDocument({
    data,
    // The CSP allows no WebAssembly: without this, pdf.js tries it first and
    // every try is a blocked-content report.
    useWasm: false,
    cMapUrl: `${ASSETS}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSETS}standard_fonts/`,
    wasmUrl: `${ASSETS}wasm/`,
    iccUrl: `${ASSETS}iccs/`,
    // No links, forms or scripts: a ticket is only looked at.
    enableXfa: false,
  }).promise
}
