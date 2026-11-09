import { useRef } from 'react'

// Dragging a bottom sheet down closes it: past CLOSE_AT px, or a quick flick,
// the sheet slides away; otherwise it snaps back. The whole top of the sheet
// (grip and title, full width) is the place to grab, as on iOS and Android;
// the grip itself only shows that it can be done.
//
// Touch and pen only: with a mouse (a desktop dialog) the title stays
// selectable text.
const CLOSE_AT = 80
const FLICK_PX = 30
const FLICK_MS = 250
const SLIDE_MS = 200
// Pulling up: the sheet can't grow, so it only gives a little, resisted
// (a fifth of the finger's travel, at most LIFT_MAX px), and springs back.
const LIFT_RATE = 0.2
const LIFT_MAX = 24

export function useSheetDrag(onClose) {
  const drag = useRef(null)

  const onPointerDown = e => {
    if (e.pointerType === 'mouse') return
    const sheet = e.currentTarget.closest('.sheet')
    if (!sheet) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    sheet.style.transition = 'none'
    drag.current = { sheet, y: e.clientY, t: e.timeStamp, dy: 0 }
  }
  const onPointerMove = e => {
    const d = drag.current
    if (!d) return
    const raw = e.clientY - d.y
    d.dy = Math.max(0, raw)
    const lift = raw < 0 ? Math.min(LIFT_MAX, -raw * LIFT_RATE) : 0
    d.sheet.style.transform = d.dy ? `translateY(${d.dy}px)` : lift ? `translateY(${-lift}px)` : ''
  }
  const onPointerUp = e => {
    const d = drag.current
    if (!d) return
    drag.current = null
    const { sheet, dy } = d
    const flick = dy > FLICK_PX && e.timeStamp - d.t < FLICK_MS
    // Back from a pull-up with a little spring; down or away as before.
    sheet.style.transition = dy ? `transform ${SLIDE_MS}ms ease-out` : `transform 260ms cubic-bezier(.3, 1.4, .5, 1)`
    if (e.type === 'pointerup' && (dy > CLOSE_AT || flick)) {
      sheet.style.transform = 'translateY(100%)'
      setTimeout(onClose, SLIDE_MS)
    } else {
      sheet.style.transform = ''
    }
  }

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp }
}

// The grip bar: just the visual cue.
export default function SheetHandle() {
  return <div className="sheet-handle" aria-hidden="true" />
}
