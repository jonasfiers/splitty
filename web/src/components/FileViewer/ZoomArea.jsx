import { useEffect, useRef } from 'react'
import './ZoomArea.css'

// The file viewer's document pane (pages/FileViewerPage.jsx): fills the space
// between the header and the bottom bar, scrolls both ways, and zooms on its
// own, so the header and navigation stay where they are. Without it a pinch
// zoomed the browser's whole page, navigation included.
//
//   pinch (two fingers)    zoom around the fingers, 1× to 5×
//   double-tap             fit to width ↔ 2.5× at that spot
//   ctrl + wheel           zoom (a trackpad pinch on a Mac sends this)
//
// Zooming widens the content (width: scale × 100%); the pages inside scale
// with it and redraw sharp once it settles (their ResizeObserver).
const MIN = 1, MAX = 5, DOUBLE_TAP = 2.5

export default function ZoomArea({ children }) {
  const area = useRef(null)
  const content = useRef(null)

  useEffect(() => {
    const el = area.current, inner = content.current
    let scale = 1

    // Zoom to `next` keeping the content point under (fx, fy) (area
    // coordinates) under the point (tx, ty) after the change.
    const zoomAt = (next, fx, fy, tx = fx, ty = fy) => {
      next = Math.min(MAX, Math.max(MIN, next))
      const px = (el.scrollLeft + fx) / scale, py = (el.scrollTop + fy) / scale
      scale = next
      inner.style.width = `${scale * 100}%`
      el.scrollLeft = px * scale - tx
      el.scrollTop = py * scale - ty
    }
    const local = t => { const r = el.getBoundingClientRect(); return [t.clientX - r.left, t.clientY - r.top] }

    // Fill the height left between this pane's top and the bottom bar's top
    // edge (or the window's bottom where there is none), less the gap the
    // pages have between them. Measured from the bar itself: in the installed
    // app innerHeight also counts the strip under Android's gesture bar.
    const fit = () => {
      const nav = document.querySelector('.bottom-nav')
      const bottom = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect().top : window.innerHeight
      el.style.height = `${Math.max(240, bottom - el.getBoundingClientRect().top - 12)}px`
    }
    fit()
    window.addEventListener('resize', fit)

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
          px: (el.scrollLeft + (a[0] + b[0]) / 2) / scale,
          py: (el.scrollTop + (a[1] + b[1]) / 2) / scale,
        }
        lastTap = null
      }
    }
    const onMove = e => {
      if (!pinch || e.touches.length !== 2) return
      e.preventDefault()
      const [a, b] = [...e.touches].map(local)
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2
      scale = Math.min(MAX, Math.max(MIN, pinch.scale * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.dist))
      inner.style.width = `${scale * 100}%`
      el.scrollLeft = pinch.px * scale - mx
      el.scrollTop = pinch.py * scale - my
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
      window.removeEventListener('resize', fit)
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
      el.removeEventListener('wheel', onWheel)
    }
  }, [])

  return (
    <div ref={area} className="zoom-area">
      <div ref={content} className="zoom-content">{children}</div>
    </div>
  )
}
