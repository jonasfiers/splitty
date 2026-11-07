import { useEffect, useRef } from 'react'
import './ZoomArea.css'

// The file viewer's document pane (pages/FileViewerPage.jsx): fills the screen
// under the viewer's bar (by CSS, ZoomArea.css, so it follows rotating,
// unfolding and resizing by itself), scrolls both ways, and zooms on its own, so the header and navigation stay where they are. Without it a pinch
// zoomed the browser's whole page, navigation included.
//
//   pinch (two fingers)    zoom around the fingers, 1× to 5×
//   double-tap             fit to width ↔ 2.5× at that spot
//   ctrl + wheel           zoom (a trackpad pinch on a Mac sends this)
//
// Zooming widens the content (width: scale × its 1× width); the pages inside scale
// with it and redraw sharp once it settles (their ResizeObserver).
const MIN = 1, MAX = 5, DOUBLE_TAP = 2.5
// The document's width at 1× where the pane is wider (tablet, desktop).
const FIT = 820

export default function ZoomArea({ children }) {
  const area = useRef(null)
  const content = useRef(null)

  useEffect(() => {
    const el = area.current, inner = content.current
    let scale = 1

    // Zoom to `next` keeping the content point under (fx, fy) (area
    // coordinates) under the point (tx, ty) after the change.
    // Content coordinates are relative to the content's own corner: centred
    // at 1×, it starts further right than the pane.
    const setScale = next => {
      scale = Math.min(MAX, Math.max(MIN, next))
      inner.style.width = `calc(min(100%, ${FIT}px) * ${scale})`
    }
    const contentPoint = (fx, fy) => [
      (el.scrollLeft + fx - inner.offsetLeft) / scale,
      (el.scrollTop + fy - inner.offsetTop) / scale,
    ]
    const keep = ([px, py], tx, ty) => {
      el.scrollLeft = px * scale + inner.offsetLeft - tx
      el.scrollTop = py * scale + inner.offsetTop - ty
    }
    const zoomAt = (next, fx, fy) => {
      const p = contentPoint(fx, fy)
      setScale(next)
      keep(p, fx, fy)
    }
    const local = t => { const r = el.getBoundingClientRect(); return [t.clientX - r.left, t.clientY - r.top] }

    // Touch events, not pointer events: once the browser starts scrolling a
    // finger it cancels that pointer, and a pinch would stop halfway.
    let pinch = null
    let lastTap = null
    const onStart = e => {
      if (e.touches.length === 2) {
        const [a, b] = [...e.touches].map(local)
        pinch = {
          dist: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1,
          scale,
          point: contentPoint((a[0] + b[0]) / 2, (a[1] + b[1]) / 2),
        }
        lastTap = null
      }
    }
    const onMove = e => {
      if (!pinch || e.touches.length !== 2) return
      e.preventDefault()
      const [a, b] = [...e.touches].map(local)
      setScale(pinch.scale * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.dist)
      keep(pinch.point, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    }
    const onEnd = e => {
      if (e.touches.length < 2) pinch = null
      // A double-tap: two quick one-finger taps close together.
      if (e.touches.length || e.changedTouches.length !== 1) return
      const [x, y] = local(e.changedTouches[0])
      const now = Date.now()
      if (lastTap && now - lastTap.t < 300 && Math.hypot(x - lastTap.x, y - lastTap.y) < 30) {
        e.preventDefault()
        zoomAt(scale > 1.05 ? 1 : DOUBLE_TAP, x, y)
        lastTap = null
      } else {
        lastTap = { t: now, x, y }
      }
    }
    const onWheel = e => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const [x, y] = local(e)
      zoomAt(scale * Math.exp(-e.deltaY * 0.01), x, y)
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: false })
    el.addEventListener('touchcancel', onEnd, { passive: false })
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
      el.removeEventListener('wheel', onWheel)
    }
  }, [])

  return (
    <div ref={area} className="zoom-area" style={{ '--zoom-fit': `${FIT}px` }}>
      <div ref={content} className="zoom-content">{children}</div>
    </div>
  )
}
