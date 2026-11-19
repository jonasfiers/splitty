// Ticket codes (2026-11-19): the QR, Aztec... codes printed on an item's
// tickets, one per ticket, stored as the text each holds (item.tickets:
// [{ code, format, name }], api/tripService.js ticketsOf) and drawn
// again full screen by BigReference. A booking reference can be shown as a QR
// code or a barcode too, for desks that scan the reference itself.
//
// Drawing (bwip-js) is loaded only when a code is shown: utils/drawCode.js.
// Reading, from a file or the camera (components/TicketCode/CodeScanner), uses
// zxing-cpp as WebAssembly through barcode-detector's ponyfill, in every
// browser, rather than a native BarcodeDetector: Android's own one gave up on a
// photo of a boarding pass that zxing read at once (2026-11-19). The .wasm is
// one of Splitty's own files (CSP: script-src 'wasm-unsafe-eval'), fetched on
// the first read, never from a CDN.

export const TICKET_FORMATS = [
  { value: 'qr', label: 'QR code' },
  { value: 'aztec', label: 'Aztec' },
  { value: 'pdf417', label: 'PDF417' },
  { value: 'datamatrix', label: 'Data Matrix' },
  { value: 'code128', label: 'Barcode (Code 128)' },
]

export const isLinear = format => format === 'code128'

// The most an item keeps (api/routes/trips.js MAX_TICKETS).
export const MAX_TICKETS = 10

// An item's tickets; an offline copy saved before the list may still have the
// single ticketCode of the first version.
export const itemTickets = item => item?.tickets
  ?? (item?.ticketCode ? [{ code: item.ticketCode, format: item.ticketFormat || 'qr', name: '' }] : [])

// BarcodeDetector's names for the formats Splitty can draw again.
const FROM_DETECTOR = { qr_code: 'qr', aztec: 'aztec', pdf417: 'pdf417', data_matrix: 'datamatrix', code_128: 'code128' }

export const canReadCodes = () => typeof WebAssembly === 'object'
export const canScanLive = () => canReadCodes() && !!navigator.mediaDevices?.getUserMedia

let detectorPromise = null
// One detector for all formats Splitty can draw again, loaded once.
export function getDetector() {
  detectorPromise ??= Promise.all([
    import('barcode-detector/ponyfill'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ]).then(([{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }]) => {
    prepareZXingModule({
      overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
      fireImmediately: true,
    })
    return new BarcodeDetector({ formats: Object.keys(FROM_DETECTOR) })
  }).catch(err => { detectorPromise = null; throw err })
  return detectorPromise
}

// The biggest usable code among those found: on a ticket that is the code to
// scan, not a small logo or link. Null when there is none; throws (with a
// message to show) when only codes Splitty can't draw were found.
export function pickCode(found) {
  if (found.length === 0) return null
  const area = c => c.boundingBox.width * c.boundingBox.height
  const usable = found.filter(c => FROM_DETECTOR[c.format] && c.rawValue)
  if (usable.length === 0) throw new Error(`Found a ${found[0].format.replace('_', ' ')} code, which Splitty can’t draw again.`)
  const best = usable.sort((a, b) => area(b) - area(a))[0]
  return { text: best.rawValue, format: FROM_DETECTOR[best.format] }
}

// Every code Splitty can draw again among those found, in reading order (top
// to bottom, then left to right), each text once. Throws (with a message to
// show) when only codes Splitty can't draw were found.
function usableCodes(found) {
  const usable = found.filter(c => FROM_DETECTOR[c.format] && c.rawValue)
  if (found.length > 0 && usable.length === 0) throw new Error(`Found a ${found[0].format.replace('_', ' ')} code, which Splitty can’t draw again.`)
  const box = c => c.boundingBox
  usable.sort((a, b) => (Math.abs(box(a).y - box(b).y) > Math.min(box(a).height, box(b).height) / 2 ? box(a).y - box(b).y : box(a).x - box(b).x))
  const seen = new Set()
  return usable
    .filter(c => !seen.has(c.rawValue) && seen.add(c.rawValue))
    .map(c => ({ text: c.rawValue, format: FROM_DETECTOR[c.format] }))
}

// Finds the codes in a picked file: a screenshot or photo (several tickets on
// one photo give several codes), or a PDF (its first ten pages, drawn large enough
// for small codes). Returns [{ text, format }], or throws an Error whose
// message can be shown as is.
export async function readCodesFromFile(file) {
  if (!canReadCodes()) throw new Error('This browser can’t read codes. Paste the text instead.')
  let detector
  try { detector = await getDetector() } catch { throw new Error('Couldn’t load the code reader. Check the connection and try again.') }
  const found = []

  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const { loadPdfData } = await import('./pdf.js')
    const task = loadPdfData(new Uint8Array(await file.arrayBuffer()))
    try {
      const pdf = await task.promise
      for (let n = 1; n <= Math.min(pdf.numPages, MAX_TICKETS); n++) {
        const page = await pdf.getPage(n)
        const viewport = page.getViewport({ scale: 3 })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport, annotationMode: 0 }).promise
        // Pages one under the other, so reading order runs across them.
        const offset = (n - 1) * 100000
        found.push(...(await detector.detect(canvas)).map(c => ({
          format: c.format,
          rawValue: c.rawValue,
          boundingBox: { x: c.boundingBox.x, y: c.boundingBox.y + offset, width: c.boundingBox.width, height: c.boundingBox.height },
        })))
        canvas.width = canvas.height = 0
      }
    } finally {
      task.destroy()
    }
  } else {
    const bitmap = await createImageBitmap(file)
    try { found.push(...await detector.detect(bitmap)) } finally { bitmap.close?.() }
  }

  const codes = usableCodes(found)
  if (codes.length === 0) throw new Error('No code found. Try a sharper screenshot, or paste the text.')
  return codes
}
