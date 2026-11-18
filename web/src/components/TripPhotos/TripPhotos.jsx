import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import client from '../../api/client'
import Sheet, { SheetActions } from '../Sheet/Sheet.jsx'
import Field from '../Field/Field.jsx'
import Icon from '../Icon/Icon.jsx'
import { useConfirm } from '../Confirm/ConfirmProvider.jsx'
import { dayOf, timeOf, formatDay } from '../../utils/trip.js'
import './TripPhotos.css'

// Photos of a trip, from Immich albums linked to it (api/tripPhotos.js). The
// server passes every image through with a signed link, so Immich itself is
// never contacted from here.

// { enabled, albums, photos, reload } for a trip; nothing while offline.
export function useTripPhotos(tripId, skip = false) {
  const [data, setData] = useState({ enabled: false, albums: [], photos: [] })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (skip || !tripId) return
    let live = true
    client.get(`/trips/${tripId}/photos`, { timeout: 45000 })
      .then(r => { if (live) setData(r.data) })
      .catch(() => { /* the trip works without its photos */ })
    return () => { live = false }
  }, [tripId, skip, attempt])
  const reload = useCallback(() => setAttempt(n => n + 1), [])
  return { ...data, reload }
}

export const photoSrc = url => `/api${url}`
// Stops the tile's loading glow (TripPhotos.css) once its photo is there.
const doneLoading = e => e.currentTarget.parentElement?.classList.add('loaded')

// The photos of each day: { 'YYYY-MM-DD': [photo] }.
export const photosByDay = photos => {
  const out = {}
  for (const p of photos) if (p.at) (out[dayOf(p.at)] ??= []).push(p)
  return out
}

// A row of thumbnails under a day, as many as fit the width (no scrolling);
// opens the viewer on the tapped one. When not all fit, the last tile says
// "+N" and opens all of the day's photos as a grid instead.
const TILE = 64, GAP = 6
export function DayPhotos({ photos, onOpen }) {
  const [grid, setGrid] = useState(false)
  const [fit, setFit] = useState(8)
  const [row, setRow] = useState(null)
  useEffect(() => {
    if (!row) return
    const measure = () => setFit(Math.max(1, Math.floor((row.clientWidth + GAP) / (TILE + GAP))))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(row)
    return () => ro.disconnect()
  }, [row])
  if (!photos?.length) return null
  const shown = photos.slice(0, fit)
  const more = photos.length - shown.length
  return (
    <>
      <div className="day-photos" ref={setRow} aria-label={`${photos.length} photo${photos.length !== 1 ? 's' : ''}`}>
        {shown.map((p, i) => {
          const isMore = i === shown.length - 1 && more > 0
          return (
            <button
              key={p.id}
              type="button"
              className="day-photo"
              onClick={() => (isMore ? setGrid(true) : onOpen(photos, i))}
              aria-label={isMore ? `All ${photos.length} photos of this day` : `Photo at ${timeOf(p.at)}`}
            >
              <img src={photoSrc(p.thumb)} alt="" loading="lazy" decoding="async" onLoad={doneLoading} onError={doneLoading} />
              {p.video && !isMore && <span className="day-photo-video" aria-hidden="true"><Icon name="play" /></span>}
              {isMore && <span className="day-photo-more">+{more + 1}</span>}
            </button>
          )
        })}
      </div>
      {grid && <PhotoGrid photos={photos} onOpen={onOpen} onClose={() => setGrid(false)} />}
    </>
  )
}

// All of a day's photos, full screen, as a grid; a tap opens the viewer
// (which comes out on top), Escape or × closes.
export function PhotoGrid({ photos, onOpen, onClose }) {
  useEffect(() => {
    const key = e => { if (e.key === 'Escape' && !document.querySelector('.photo-viewer')) onClose() }
    window.addEventListener('keydown', key)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', key); document.body.style.overflow = prev }
  }, [onClose])
  const day = photos[0]?.at ? dayOf(photos[0].at) : ''
  return createPortal(
    <div className="photo-grid" role="dialog" aria-modal="true" aria-label="Photos of the day">
      <div className="photo-grid-head">
        <strong>{day ? formatDay(day, { weekday: 'long', day: 'numeric', month: 'long' }) : 'Photos'}</strong>
        <span>{photos.length} photos</span>
        <button type="button" className="photo-grid-close" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
      </div>
      <div className="photo-grid-tiles">
        {photos.map((p, i) => (
          <button key={p.id} type="button" className="photo-grid-tile" onClick={() => onOpen(photos, i)} aria-label={`Photo at ${timeOf(p.at)}`}>
            <img src={photoSrc(p.thumb)} alt="" loading="lazy" decoding="async" onLoad={doneLoading} onError={doneLoading} />
            {p.video && <span className="day-photo-video" aria-hidden="true"><Icon name="play" /></span>}
          </button>
        ))}
      </div>
    </div>,
    document.body
  )
}

// Zooming a photo in the viewer with two fingers, not the page (the viewer
// has touch-action: none). Zoomed in, one finger pans and a swipe doesn't
// change photo; a double tap zooms in on that spot, or back out. Back to
// normal on every new photo. Videos are left to their own controls.
const MAX_ZOOM = 5
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi)
const NO_ZOOM = { s: 1, x: 0, y: 0 }

function usePinchZoom(at, go) {
  const frameRef = useRef(null)
  const [zoom, setZoomState] = useState(NO_ZOOM)
  const current = useRef(NO_ZOOM)
  const gesture = useRef(null)
  const lastTap = useRef(0)

  // Kept within the frame: no panning the photo out of sight.
  const setZoom = useCallback(z => {
    const r = frameRef.current?.getBoundingClientRect()
    const next = !r || z.s <= 1.01 ? NO_ZOOM : {
      s: z.s,
      x: clamp(z.x, -(z.s - 1) * r.width / 2, (z.s - 1) * r.width / 2),
      y: clamp(z.y, -(z.s - 1) * r.height / 2, (z.s - 1) * r.height / 2),
    }
    current.current = next
    setZoomState(next)
  }, [])
  useEffect(() => { setZoom(NO_ZOOM) }, [at, setZoom])

  // A touch relative to the frame's centre (the zoom's origin).
  const rel = t => {
    const r = frameRef.current.getBoundingClientRect()
    return { x: t.clientX - (r.left + r.width / 2), y: t.clientY - (r.top + r.height / 2) }
  }
  const pinchOf = e => {
    const [a, b] = [rel(e.touches[0]), rel(e.touches[1])]
    return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, m: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
  }
  const startOne = t => {
    gesture.current = current.current.s > 1
      ? { type: 'pan', p0: rel(t), z0: current.current }
      : { type: 'swipe', x0: t.clientX }
  }

  const touch = {
    onTouchStart: e => {
      // Not on a video (its own controls) or the viewer's buttons.
      if (e.target.closest('video, button') || !frameRef.current) { gesture.current = null; lastTap.current = 0; return }
      if (e.touches.length === 2) {
        gesture.current = { type: 'pinch', ...pinchOf(e), z0: current.current }
        return
      }
      if (e.touches.length !== 1) return
      const now = Date.now()
      if (now - lastTap.current < 300) {
        lastTap.current = 0
        gesture.current = null
        if (current.current.s > 1) setZoom(NO_ZOOM)
        else {
          const p = rel(e.touches[0])
          const s = 2.5
          setZoom({ s, x: p.x * (1 - s), y: p.y * (1 - s) })
        }
        return
      }
      lastTap.current = now
      startOne(e.touches[0])
    },
    onTouchMove: e => {
      const g = gesture.current
      if (!g) return
      if (g.type === 'pinch' && e.touches.length === 2) {
        const { d, m } = pinchOf(e)
        const s = clamp(g.z0.s * d / g.d, 1, MAX_ZOOM)
        // The spot that was under the fingers stays under them.
        const px = (g.m.x - g.z0.x) / g.z0.s, py = (g.m.y - g.z0.y) / g.z0.s
        setZoom({ s, x: m.x - s * px, y: m.y - s * py })
      } else if (g.type === 'pan' && e.touches.length === 1) {
        const p = rel(e.touches[0])
        setZoom({ s: g.z0.s, x: g.z0.x + p.x - g.p0.x, y: g.z0.y + p.y - g.p0.y })
      }
    },
    onTouchEnd: e => {
      const g = gesture.current
      if (!g) return
      if (g.type === 'swipe' && e.touches.length === 0) {
        const dx = e.changedTouches[0].clientX - g.x0
        if (Math.abs(dx) > 50) { lastTap.current = 0; go(dx < 0 ? 1 : -1) }
        gesture.current = null
      } else if (e.touches.length === 1) {
        // One finger lifted from a pinch: the other pans on (no swipe).
        lastTap.current = 0
        if (current.current.s > 1) startOne(e.touches[0])
        else gesture.current = null
      } else if (e.touches.length === 0) {
        if (g.type === 'pinch') lastTap.current = 0
        gesture.current = null
      }
    },
  }
  return { frameRef, zoom, touch }
}

// Full-screen viewer: the preview size (about 1440 px, never the original),
// with previous/next (buttons, arrow keys, a swipe) and Escape to close.
// Far from home a preview takes a moment, so the small thumbnail (already
// loaded for the day row or the map) shows at once, enlarged, until the
// preview has arrived; the neighbours' previews load in the background.
export function PhotoViewer({ photos, index, onClose }) {
  const [at, setAt] = useState(index)
  const go = useCallback(d => setAt(i => Math.min(Math.max(i + d, 0), photos.length - 1)), [photos.length])
  useEffect(() => {
    const key = e => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', key)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', key); document.body.style.overflow = prev }
  }, [go, onClose])
  const [loaded, setLoaded] = useState(() => new Set())
  const { frameRef, zoom, touch } = usePinchZoom(at, go)
  useEffect(() => {
    for (const n of [at + 1, at - 1, at + 2]) {
      const q = photos[n]
      if (q) new Image().src = photoSrc(q.preview)
    }
  }, [at, photos])
  const p = photos[at]
  if (!p) return null
  return createPortal(
    <div
      className="photo-viewer"
      role="dialog"
      aria-modal="true"
      aria-label="Photo"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      {...touch}
    >
      <div className="photo-viewer-frame" key={p.id} ref={frameRef}>
        <div className="photo-viewer-zoom" style={zoom.s > 1 ? { transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.s})` } : undefined}>
        {/* A video plays here, streamed from Immich through the server; the
            preview frame shows until it starts. */}
        {p.play ? (
          <video
            className="photo-viewer-img"
            src={photoSrc(p.play)}
            poster={photoSrc(p.preview)}
            controls
            autoPlay
            playsInline
            preload="metadata"
          />
        ) : !loaded.has(p.id) && <img className="photo-viewer-img photo-viewer-placeholder" src={photoSrc(p.thumb)} alt="" />}
        {!p.play && (
          <img
            className={`photo-viewer-img${loaded.has(p.id) ? '' : ' loading'}`}
            src={photoSrc(p.preview)}
            alt=""
            onLoad={() => setLoaded(s => new Set(s).add(p.id))}
          />
        )}
        </div>
      </div>
      <div className="photo-viewer-bar">
        <span>{p.at ? `${formatDay(dayOf(p.at))} · ${timeOf(p.at)}` : ''}{p.video && !p.play ? ' · video (still)' : ''}</span>
        <span>{at + 1} / {photos.length}</span>
      </div>
      <button type="button" className="photo-viewer-close" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
      {at > 0 && <button type="button" className="photo-viewer-nav prev" onClick={() => go(-1)} aria-label="Previous"><Icon name="chevron-left" /></button>}
      {at < photos.length - 1 && <button type="button" className="photo-viewer-nav next" onClick={() => go(1)} aria-label="Next"><Icon name="chevron-right" /></button>}
    </div>,
    document.body
  )
}

// Linking and unlinking albums.
export function AlbumsSheet({ tripId, albums, onChanged, onClose }) {
  const confirm = useConfirm()
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const add = async e => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await client.post(`/trips/${tripId}/albums`, { url }, { timeout: 30000 })
      setUrl('')
      onChanged()
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to add the album.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async a => {
    if (!(await confirm({ title: `Remove “${a.name}”?`, message: 'Its photos leave this trip. The album itself stays in Immich.', confirmLabel: 'Remove', danger: true }))) return
    setError('')
    try {
      await client.delete(`/trips/${tripId}/albums/${a.id}`)
      onChanged()
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to remove the album.')
    }
  }

  return (
    <Sheet title="Photos" onClose={onClose}>
      {albums.length > 0 && (
        <ul className="album-list">
          {albums.map(a => (
            <li key={a.id}>
              <Icon name="image" />
              <span className="album-list-text">
                <strong>{a.name}</strong>
                <span className={a.error ? 'error-text' : ''}>
                  {a.error || `${a.count} photo${a.count !== 1 ? 's' : ''}`}{a.addedBy ? ` · added by ${a.addedBy}` : ''}
                </span>
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(a)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add}>
        <Field label="Add an Immich album" hint="In Immich: open the album › Share › Create link, then paste the link here. Everyone on the trip sees its photos, with where and when they were taken.">
          <input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…/share/…" required />
        </Field>
        {error && <p className="error">{error}</p>}
        <SheetActions>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Done</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Adding…' : 'Add album'}</button>
        </SheetActions>
      </form>
    </Sheet>
  )
}
