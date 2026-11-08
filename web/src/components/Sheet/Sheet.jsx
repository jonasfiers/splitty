import { useEffect, useId, useRef } from 'react'
import SheetHandle from './SheetHandle.jsx'

// The app's one pop-up. CSS decides its shape: a bottom sheet with a grip on
// narrow screens, a centred dialog from 768px up (index.css, "SHEET / MODAL").
//
// It closes on a tap outside it, on Escape (only the topmost one when sheets
// are stacked), and on narrow screens by dragging the grip down.
//
// `zIndex` lifts it above a full-screen view (Expandable is 1000).
export default function Sheet({ title, onClose, className = '', zIndex, children }) {
  const titleId = useId()
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
      style={zIndex != null ? { zIndex } : undefined}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className={`sheet${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined}>
        <SheetHandle onClose={onClose} />
        {title && <p className="sheet-title" id={titleId}>{title}</p>}
        {children}
      </div>
    </div>
  )
}
