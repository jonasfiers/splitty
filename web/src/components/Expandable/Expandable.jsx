import { createContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
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
//
// `extra` is shown below the view only while it is full screen, and only when
// the view leaves at least EXTRA_MIN px free (the trip map under a timeline on
// a tall or square screen). Otherwise the view takes the whole window.
//
// The view's own height is measured without the stretch: the element marked
// `data-expand-scroller` is sized to the window, so its children's heights are
// added up instead. That keeps the result the same whether the extra is shown
// or not, so it cannot flip back and forth.
//
// A grip between the two moves the split. The choice is kept per `splitKey`
// in this browser as a fraction of the height, so it carries over between
// screens and rotations; a double tap on the grip goes back to the default.
const EXTRA_MIN = 200 // free room needed before the extra is shown at all
const GRIP = 20 // height of the grip between view and extra
const DRAG_MIN = 120 // neither side can be dragged smaller than this

function loadSplit(key) {
  if (!key) return null
  try {
    const v = parseFloat(localStorage.getItem(`expandable-split:${key}`))
    return v > 0 && v < 1 ? v : null
  } catch { return null }
}
function saveSplit(key, v) {
  if (!key) return
  try {
    if (v == null) localStorage.removeItem(`expandable-split:${key}`)
    else localStorage.setItem(`expandable-split:${key}`, String(v))
  } catch { /* private window: the split just is not remembered */ }
}

function naturalHeight(view) {
  const scroller = view.querySelector('[data-expand-scroller]')
  if (!scroller) return view.offsetHeight
  let content = 0
  for (const child of scroller.children) content += child.offsetHeight
  return view.offsetHeight - scroller.clientHeight + content
}

export default function Expandable({ label, children, extra = null, splitKey = null }) {
  const [open, setOpen] = useState(false)
  const [room, setRoom] = useState(false)
  const [bodyH, setBodyH] = useState(0)
  const [split, setSplit] = useState(() => loadSplit(splitKey))
  const bodyRef = useRef(null)
  const drag = useRef(null)

  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!open || !extra || !body) { setRoom(false); return }
    const measure = () => {
      const view = body.firstElementChild
      if (!view) return
      setBodyH(body.clientHeight)
      setRoom(body.clientHeight - naturalHeight(view) - GRIP >= EXTRA_MIN)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(body)
    const view = body.firstElementChild
    if (view) {
      ro.observe(view)
      const scroller = view.querySelector('[data-expand-scroller]')
      if (scroller) for (const child of scroller.children) ro.observe(child)
    }
    return () => ro.disconnect()
  }, [open, !!extra])

  useEffect(() => {
    if (!open) return
    // A pop-up (sheet) over the view takes Escape first; full screen closes on the next one.
    const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.sheet-overlay')) setOpen(false) }
    const scroll = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = scroll
    }
  }, [open])

  const showExtra = open && !!extra && room
  const clampView = px => Math.round(Math.min(Math.max(px, DRAG_MIN), bodyH - GRIP - DRAG_MIN))
  const viewH = showExtra && split != null && bodyH > 0 ? clampView(split * bodyH) : null

  const setViewH = px => setSplit(clampView(px) / bodyH)
  const onGripDown = e => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { top: bodyRef.current.getBoundingClientRect().top }
  }
  const onGripMove = e => {
    if (!drag.current) return
    setViewH(e.clientY - drag.current.top - GRIP / 2)
  }
  const onGripUp = () => {
    if (!drag.current) return
    drag.current = null
    setSplit(s => { saveSplit(splitKey, s); return s })
  }
  const resetSplit = () => { setSplit(null); saveSplit(splitKey, null) }
  const onGripKey = e => {
    const step = { ArrowUp: -24, ArrowDown: 24 }[e.key]
    if (!step) return
    e.preventDefault()
    const now = viewH ?? bodyRef.current.firstElementChild.offsetHeight
    const next = clampView(now + step) / bodyH
    setSplit(next)
    saveSplit(splitKey, next)
  }

  const view = (
    <div className={`expandable${open ? ' expanded' : ''}${showExtra ? ' with-extra' : ''}${viewH != null ? ' sized' : ''}`}>
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
      <div className="expandable-body" ref={bodyRef} style={viewH != null ? { '--view-h': `${viewH}px` } : undefined}>
        <ExpandedContext.Provider value={open}>
          {children}
          {showExtra && (
            <div
              className="expandable-grip"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize: drag, or use the arrow keys; double tap to reset"
              title="Drag to resize · double-click to reset"
              tabIndex={0}
              onPointerDown={onGripDown}
              onPointerMove={onGripMove}
              onPointerUp={onGripUp}
              onPointerCancel={onGripUp}
              onDoubleClick={resetSplit}
              onKeyDown={onGripKey}
            >
              <span />
            </div>
          )}
          {showExtra && <div className="expandable-extra">{extra}</div>}
        </ExpandedContext.Provider>
      </div>
    </div>
  )

  return open ? createPortal(view, document.body) : view
}
