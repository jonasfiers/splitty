import { useRef } from 'react'

// The grip at the top of a bottom sheet. Drag it down to close the sheet: past
// CLOSE_AT px, or a quick flick, the sheet slides away; otherwise it snaps back.
//
const CLOSE_AT = 80
const FLICK_PX = 30
const FLICK_MS = 250
const SLIDE_MS = 200

export default function SheetHandle({ onClose }) {
  const drag = useRef(null)

  const onDown = e => {
    const sheet = e.currentTarget.closest('.sheet')
    if (!sheet) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    sheet.style.transition = 'none'
    drag.current = { sheet, y: e.clientY, t: e.timeStamp, dy: 0 }
  }
  const onMove = e => {
    const d = drag.current
    if (!d) return
    d.dy = Math.max(0, e.clientY - d.y)
    d.sheet.style.transform = d.dy ? `translateY(${d.dy}px)` : ''
  }
  const onUp = e => {
    const d = drag.current
    if (!d) return
    drag.current = null
    const { sheet, dy } = d
    const flick = dy > FLICK_PX && e.timeStamp - d.t < FLICK_MS
    sheet.style.transition = `transform ${SLIDE_MS}ms ease-out`
    if (e.type === 'pointerup' && (dy > CLOSE_AT || flick)) {
      sheet.style.transform = 'translateY(100%)'
      setTimeout(onClose, SLIDE_MS)
    } else {
      sheet.style.transform = ''
    }
  }

  return (
    <div
      className="sheet-handle"
      aria-hidden="true"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    />
  )
}
