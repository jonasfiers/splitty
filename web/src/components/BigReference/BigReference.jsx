import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import './BigReference.css'

// Shows a booking reference as large as the screen allows, at maximum
// contrast in either theme (black on white, or white on black), for holding the phone up at a check-in desk or to a conductor.
// On a phone held upright the content is turned sideways, so the reference
// can use the screen's length (a page cannot force landscape on iOS).
// Tap anywhere or press Escape to close. Keeps the screen awake while open
// where the browser supports it (Screen Wake Lock; iOS 16.4+ in a PWA).
export default function BigReference({ value, label, onClose }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    const scroll = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)

    let lock = null
    let cancelled = false
    const requestLock = async () => {
      try {
        const l = await navigator.wakeLock?.request('screen')
        if (cancelled) l?.release()
        else lock = l
      } catch { /* not supported or refused: the view works without it */ }
    }
    // The browser drops the lock when the page is hidden; take it again on return.
    const onVisible = () => { if (document.visibilityState === 'visible') requestLock() }
    requestLock()
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      lock?.release().catch(() => {})
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = scroll
    }
  }, [onClose])

  // Size the text to the reference: short ones fill the width, longer ones
  // (past 14 characters) stop shrinking and wrap instead.
  const chars = Math.min(Math.max(value.length, 4), 14)

  return createPortal(
    <div className="bigref" role="dialog" aria-modal="true" aria-label={label} onClick={onClose}>
      <div className="bigref-content">
        <div className="bigref-label">{label}</div>
        <div className="bigref-value" style={{ '--chars': chars }}>{value}</div>
        <div className="bigref-hint">Tap anywhere to close</div>
      </div>
    </div>,
    document.body,
  )
}
