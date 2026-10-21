import { createContext, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import './Expandable.css'

// True for a view while it is shown full screen (the map then zooms on scroll).
export const ExpandedContext = createContext(false)

// Wraps a view (the trip timeline, the map) with a button that lets it take
// over the whole window, and back. Done in CSS rather than with the browser's
// Fullscreen API, which iPhone Safari only allows for video.
//
// While open it is rendered into <body>: a sticky ancestor (the map column)
// forms its own stacking context, and nothing inside one can rise above the
// rest of the page however high its z-index. The view remounts on the move.
export default function Expandable({ label, children }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    const scroll = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = scroll
    }
  }, [open])

  const view = (
    <div className={`expandable${open ? ' expanded' : ''}`}>
      {open && <div className="expandable-title">{label}</div>}
      <button
        type="button"
        className="expandable-toggle"
        onClick={() => setOpen(o => !o)}
        aria-label={open ? `Close full screen ${label}` : `Show ${label} full screen`}
        title={open ? 'Close (Esc)' : 'Full screen'}
      >
        {open ? (
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
        ) : (
          <svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
        )}
      </button>
      <div className="expandable-body">
        <ExpandedContext.Provider value={open}>{children}</ExpandedContext.Provider>
      </div>
    </div>
  )

  return open ? createPortal(view, document.body) : view
}
