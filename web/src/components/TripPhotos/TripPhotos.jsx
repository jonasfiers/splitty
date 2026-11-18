import { useState, useEffect, useCallback } from 'react'
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

// The photos of each day: { 'YYYY-MM-DD': [photo] }.
export const photosByDay = photos => {
  const out = {}
  for (const p of photos) if (p.at) (out[dayOf(p.at)] ??= []).push(p)
  return out
}

// A row of thumbnails under a day; opens the viewer on the tapped one.
export function DayPhotos({ photos, onOpen, max = 12 }) {
  if (!photos?.length) return null
  const shown = photos.slice(0, max)
  const more = photos.length - shown.length
  return (
    <div className="day-photos" aria-label={`${photos.length} photo${photos.length !== 1 ? 's' : ''}`}>
      {shown.map((p, i) => (
        <button key={p.id} type="button" className="day-photo" onClick={() => onOpen(photos, i)} aria-label={`Photo at ${timeOf(p.at)}`}>
          <img src={photoSrc(p.thumb)} alt="" loading="lazy" decoding="async" />
          {p.video && <span className="day-photo-video" aria-hidden="true"><Icon name="play" /></span>}
          {i === shown.length - 1 && more > 0 && <span className="day-photo-more">+{more}</span>}
        </button>
      ))}
    </div>
  )
}

// Full-screen viewer: the preview size, with previous/next (buttons, arrow
// keys, a swipe) and Escape to close.
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
  const [touchX, setTouchX] = useState(null)
  const p = photos[at]
  if (!p) return null
  return createPortal(
    <div
      className="photo-viewer"
      role="dialog"
      aria-modal="true"
      aria-label="Photo"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
      onTouchStart={e => setTouchX(e.touches[0].clientX)}
      onTouchEnd={e => {
        if (touchX == null) return
        const dx = e.changedTouches[0].clientX - touchX
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1)
        setTouchX(null)
      }}
    >
      <img key={p.id} className="photo-viewer-img" src={photoSrc(p.preview)} alt="" />
      <div className="photo-viewer-bar">
        <span>{p.at ? `${formatDay(dayOf(p.at))} · ${timeOf(p.at)}` : ''}{p.video ? ' · video (still)' : ''}</span>
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
