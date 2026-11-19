import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import TicketCode from '../TicketCode/TicketCode.jsx'
import './BigReference.css'

// Two screens: the ticket's own code (`show="ticket"`), or the booking
// reference (`show="ref"`) as text, QR code or barcode, always opening on the
// text (Jonas). They hold different things (a ticket number or boarding pass
// is not the booking code), so they stay apart.
const REF_VIEWS = ['text', 'qr', 'barcode']
const VIEW_LABELS = { text: 'Text', qr: 'QR', barcode: 'Barcode' }

// Shows a booking reference (or the ticket's code) as large as the screen allows, at maximum
// contrast in either theme (black on white, or white on black), for holding the phone up at a check-in desk or to a conductor.
// On a phone held upright the reference (text, barcode, PDF417) is turned
// sideways to use the screen's length, while the switch and labels stay
// upright (a page cannot force landscape on iOS).
// Tap anywhere, press Escape or the phone's Back to close. Keeps the screen
// awake while open where the browser supports it (Screen Wake Lock; iOS 16.4+
// in a PWA).
//
// Android: the orientation locked as it is, so turning the phone to read the
// sideways text doesn't make the app re-lay itself out (it flickered); in a
// browser tab that needs full screen. iOS has neither, and keeps the plain view.
export default function BigReference({ item, show = 'ref', onClose: onCloseProp }) {
  const [refView, setRefView] = useState('text')
  const view = show === 'ticket' ? 'ticket' : refView
  const pick = v => e => {
    e.stopPropagation()
    setRefView(v)
  }

  // The latest onClose, without re-running the setup below: running it again
  // would leave full screen and step back through the history mid-view.
  const closeRef = useRef(onCloseProp)
  closeRef.current = onCloseProp
  useEffect(() => {
    const onClose = () => closeRef.current()
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

    // Back closes it: an entry of its own in the history (keeping the
    // router's state, so the router sees the same page when it's gone).
    let closedByBack = false
    history.pushState({ ...history.state, bigref: true }, '')
    const onPop = () => { if (!history.state?.bigref) { closedByBack = true; onClose() } }
    window.addEventListener('popstate', onPop)

    // The orientation locked as it is (Android), so turning the phone to read
    // the sideways text doesn't re-lay the app out. An installed app may lock
    // straight away; a browser tab only in full screen, and Chrome then shows
    // its own "swipe to leave full screen" notice over the bottom for a few
    // seconds, so full screen only when the plain lock is refused. Leaving
    // full screen (Back does that first) closes the reference too.
    const el = document.documentElement
    let wentFull = false
    const onFullscreen = () => { if (wentFull && !document.fullscreenElement) onClose() }
    const type = screen.orientation?.type
    const orientation = type?.startsWith('landscape') ? 'landscape' : 'portrait'
    const lockNow = () => screen.orientation?.lock ? screen.orientation.lock(orientation) : Promise.reject(new Error('no lock'))
    if (type) {
      lockNow().catch(() => {
        if (cancelled || !el.requestFullscreen || document.fullscreenElement) return
        return el.requestFullscreen({ navigationUI: 'hide' }).then(() => {
          if (cancelled) { document.exitFullscreen?.().catch(() => {}); return }
          wentFull = true
          return lockNow()
        })
      }).catch(() => { /* not allowed or not supported: the plain view */ })
      document.addEventListener('fullscreenchange', onFullscreen)
    }

    return () => {
      cancelled = true
      window.removeEventListener('popstate', onPop)
      document.removeEventListener('fullscreenchange', onFullscreen)
      try { screen.orientation?.unlock?.() } catch { /* nothing to unlock */ }
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
      // Closed another way (a tap, Escape): take our history entry away again.
      if (!closedByBack && history.state?.bigref) history.back()
      lock?.release().catch(() => {})
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = scroll
    }
  }, [])

  // Size the text to the reference: up to 24 characters it shrinks to stay on
  // one line (an 18-digit booking number wrapped at the old limit of 14);
  // longer ones stop shrinking and wrap instead.
  const value = item.confirmationRef || ''
  const chars = Math.min(Math.max(value.length, 4), 24)
  const label = `${item.title} · ${view === 'ticket' ? 'Ticket' : 'Booking reference'}`
  const ticketFormat = item.ticketFormat || 'qr'
  const turned = view === 'text' || view === 'barcode' || (view === 'ticket' && (ticketFormat === 'code128' || ticketFormat === 'pdf417'))

  return createPortal(
    <div className="bigref" role="dialog" aria-modal="true" aria-label={label} onClick={() => closeRef.current()}>
      <div className={`bigref-content bigref-${view}`}>
        {show !== 'ticket' && (
          <div className="bigref-switch" role="group" aria-label="Show as">
            {REF_VIEWS.map(v => (
              <button key={v} type="button" aria-pressed={view === v} onClick={pick(v)}>{VIEW_LABELS[v]}</button>
            ))}
          </div>
        )}
        <div className="bigref-label">{label}</div>
        {/* On a phone held upright only this stage turns sideways, and only
            for what needs the screen's length (text, barcode, PDF417); the
            switch and labels stay upright, square codes too. */}
        <div className="bigref-stage">
          <div className={`bigref-payload ${turned ? 'bigref-turned' : ''}`}>
            {view === 'text' && <div className="bigref-value" style={{ '--chars': chars }}>{value}</div>}
            {view === 'ticket' && <TicketCode className="bigref-code" format={ticketFormat} text={item.ticketCode} />}
            {view === 'qr' && <TicketCode className="bigref-code" format="qr" text={value} />}
            {view === 'barcode' && <TicketCode className="bigref-code" format="code128" text={value} />}
            {(view === 'qr' || view === 'barcode') && <div className="bigref-small">{value}</div>}
          </div>
        </div>
        <div className="bigref-hint">Tap anywhere to close</div>
      </div>
    </div>,
    document.body,
  )
}
