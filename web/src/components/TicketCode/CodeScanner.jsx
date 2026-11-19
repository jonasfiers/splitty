import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getDetector, pickCode } from '../../utils/barcode.js'

// Live camera scanner for a ticket's code (2026-11-19): a paper ticket, or a
// code on another screen. The back camera fills the screen; frames go to the
// zxing detector (utils/barcode.js) a few times a second, and the first code
// Splitty can draw again closes it with onResult({ text, format }). A torch
// button where the camera has one. Escape, Back or ✕ close it.
const EVERY_MS = 150

export default function CodeScanner({ onResult, onClose }) {
  const videoRef = useRef(null)
  const [problem, setProblem] = useState('')
  const [torch, setTorch] = useState(null) // null: no torch; false/true: off/on
  const trackRef = useRef(null)
  const done = useRef(false)
  const handlers = useRef({ onResult, onClose })
  handlers.current = { onResult, onClose }

  useEffect(() => {
    let stream = null
    let timer = null
    let cancelled = false
    const close = () => handlers.current.onClose()
    const onKey = e => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)

    // Back closes it, as other full-screen views do.
    let closedByBack = false
    history.pushState({ ...history.state, scanner: true }, '')
    const onPop = () => { if (!history.state?.scanner) { closedByBack = true; close() } }
    window.addEventListener('popstate', onPop)

    const scan = async detector => {
      if (cancelled || done.current) return
      const video = videoRef.current
      try {
        if (video && video.readyState >= 2) {
          const code = pickCode(await detector.detect(video))
          if (code && !cancelled) {
            done.current = true
            navigator.vibrate?.(40)
            handlers.current.onResult(code)
            return
          }
        }
      } catch (err) {
        // A code Splitty can't draw (an EAN on a product, say): say so, keep looking.
        if (err?.message?.startsWith('Found a')) setProblem(err.message)
      }
      timer = setTimeout(() => scan(detector), EVERY_MS)
    }

    ;(async () => {
      try {
        const [detector, s] = await Promise.all([
          getDetector(),
          navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: false,
          }),
        ])
        if (cancelled) { s.getTracks().forEach(t => t.stop()); return }
        stream = s
        const track = s.getVideoTracks()[0]
        trackRef.current = track
        if (track.getCapabilities?.().torch) setTorch(false)
        const video = videoRef.current
        video.srcObject = s
        await video.play().catch(() => {})
        scan(detector)
      } catch (err) {
        if (cancelled) return
        setProblem(err?.name === 'NotAllowedError'
          ? 'Splitty may not use the camera. Allow it in the browser’s site settings, or read the code from a screenshot instead.'
          : err?.name === 'NotFoundError' ? 'No camera found.' : 'Couldn’t start the camera.')
      }
    })()

    return () => {
      cancelled = true
      clearTimeout(timer)
      stream?.getTracks().forEach(t => t.stop())
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('popstate', onPop)
      if (!closedByBack && history.state?.scanner) history.back()
    }
  }, [])

  const toggleTorch = async () => {
    const on = !torch
    try {
      await trackRef.current?.applyConstraints({ advanced: [{ torch: on }] })
      setTorch(on)
    } catch { setTorch(null) }
  }

  return createPortal(
    <div className="scanner" role="dialog" aria-modal="true" aria-label="Scan the ticket's code">
      <video ref={videoRef} className="scanner-video" playsInline muted />
      <div className="scanner-frame" aria-hidden="true" />
      <div className="scanner-top">
        <button type="button" className="scanner-btn" onClick={() => handlers.current.onClose()} aria-label="Close">✕</button>
        {torch !== null && (
          <button type="button" className="scanner-btn" onClick={toggleTorch} aria-pressed={torch} aria-label="Torch">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6c0 2-2 2-2 4v10a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V10c0-2-2-2-2-4V2h12zM6 6h12M12 12v2" /></svg>
          </button>
        )}
      </div>
      <p className="scanner-hint">{problem || 'Hold the code inside the frame'}</p>
    </div>,
    document.body,
  )
}
