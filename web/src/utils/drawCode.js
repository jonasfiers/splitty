import { qrcode, azteccode, pdf417, datamatrix, code128, drawingSVG } from 'bwip-js/browser'

// Draws a code as SVG markup (bwip-js; only its encoders for the formats in
// utils/barcode.js end up in this chunk). Loaded on demand by
// components/TicketCode. Dark on a transparent background: the caller puts it
// on white, with room around it, since scanners need a light quiet zone even
// in the dark theme. Throws when the text can't be encoded in that format.
const ENCODERS = { qr: qrcode, aztec: azteccode, pdf417, datamatrix, code128 }

export function drawCode(format, text) {
  const encode = ENCODERS[format]
  if (!encode) throw new Error(`Unknown code format ${format}`)
  // bwip-js takes one byte per character: text beyond Latin-1 (a name in
  // Chinese) goes in as its UTF-8 bytes, which is what scanners expect.
  const bytes = /[^\u0000-\u00ff]/.test(text) ? unescape(encodeURIComponent(text)) : text
  const opts = { bcid: format === 'qr' ? 'qrcode' : format, text: bytes, scale: 4 }
  if (format === 'qr') opts.eclevel = 'M'
  if (format === 'code128') opts.height = 12
  if (format === 'pdf417') opts.columns = 6
  const svg = encode(opts, drawingSVG())
  // A barcode can be stretched to any width or height and still scan.
  return format === 'code128' ? svg.replace('<svg ', '<svg preserveAspectRatio="none" ') : svg
}
