import { useEffect, useState } from 'react'
import { isLinear, TICKET_FORMATS } from '../../utils/barcode.js'
import './TicketCode.css'

// A ticket code or booking reference drawn as a QR code, barcode... on a white
// tile with a quiet zone around it, in either theme. The drawing code
// (utils/drawCode.js, bwip-js) loads on first use; the service worker keeps it
// for offline use with the rest of the app. `onError` hears when the text
// can't be encoded in that format.
export default function TicketCode({ format, text, className = '', onError }) {
  const [svg, setSvg] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    setFailed(false)
    if (!text) { setSvg(null); return }
    import('../../utils/drawCode.js')
      .then(({ drawCode }) => { if (live) { setSvg(drawCode(format, text)); onError?.(null) } })
      .catch(err => { if (live) { setSvg(null); setFailed(true); onError?.(err) } })
    return () => { live = false }
  }, [format, text]) // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) return <div className={`ticket-code ticket-code-failed ${className}`}>Can’t draw this text as {TICKET_FORMATS.find(f => f.value === format)?.label ?? 'a code'}</div>
  return (
    <div
      className={`ticket-code ${isLinear(format) ? 'ticket-code-linear' : format === 'pdf417' ? 'ticket-code-wide' : 'ticket-code-square'} ${className}`}
      role="img"
      aria-label={`${format} code`}
      // bwip-js's own SVG: paths only, no text from the user in the markup.
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  )
}
