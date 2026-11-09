import { useEffect, useId, useRef, useState } from 'react'
import SheetHandle, { useSheetDrag } from './SheetHandle.jsx'

// The app's one pop-up. CSS decides its shape: a bottom sheet with a grip on
// narrow screens, a centred dialog from 768px up (index.css, "SHEET / MODAL").
//
// It closes on a tap outside it, on Escape (only the topmost one when sheets
// are stacked), and on narrow screens by dragging its top (grip and title) down.
//
// `zIndex` lifts it above a full-screen view (Expandable is 1000). A sheet
// opened from another one (a picker in a form sheet) always comes out on top
// of it: it takes one layer above the highest sheet already open.
export default function Sheet({ title, onClose, className = '', zIndex, children }) {
  const titleId = useId()
  const drag = useSheetDrag(onClose)
  const [layer] = useState(() => {
    const open = [...document.querySelectorAll('.sheet-overlay')].map(o => Number(getComputedStyle(o).zIndex) || 0)
    return Math.max(zIndex ?? 200, ...open.map(z => z + 1))
  })
  const overlay = useRef(null)
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const onKey = e => {
      if (e.key !== 'Escape') return
      const all = document.querySelectorAll('.sheet-overlay')
      if (all[all.length - 1] === overlay.current) close.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      ref={overlay}
      className="sheet-overlay"
      style={{ zIndex: layer }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className={`sheet${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined}>
        {/* The grip and title stay put; only the body scrolls. */}
        <div className="sheet-head" {...drag}>
          <SheetHandle />
          {title && <p className="sheet-title" id={titleId}>{title}</p>}
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}

// The buttons at the bottom of a sheet, the same in every sheet: the main
// action first and full width, then the ghost ones (Cancel, Close) under it.
// `row` children (a <div className="sheet-actions-row">) sit side by side.
export function SheetActions({ children }) {
  return <div className="sheet-actions">{children}</div>
}

// Sections of a sheet that sit side by side on a wide screen (768px and up),
// with a line between them, the dialog widening to fit; stacked on a phone.
//
// <SheetColumns>
//   <SheetSection>…the calendar…</SheetSection>
//   <SheetSection narrow>…the time…</SheetSection>
// </SheetColumns>
//
// narrow: a fixed, smaller column (260px) beside a flexible one.
export function SheetColumns({ children }) {
  return <div className="sheet-columns">{children}</div>
}
export function SheetSection({ narrow = false, className = '', children }) {
  return <div className={`sheet-section${narrow ? ' sheet-section-narrow' : ''} ${className}`.trim()}>{children}</div>
}
