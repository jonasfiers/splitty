import { useState, useEffect } from 'react'
import client from '../../api/client'
import Sheet, { SheetActions } from '../Sheet/Sheet.jsx'
import Icon from '../Icon/Icon.jsx'
import { useConfirm } from '../Confirm/ConfirmProvider.jsx'

// "Follow my trip" links of a trip (api/followService.js): create, copy or
// share, change, remove. Anyone with a link sees the trip up to today without
// signing in; the page says plainly what it leaves out. Each link has its own
// photos (all, the ones starred in Immich, none) and may be kept after the
// trip, to share it as a slideshow (2026-11-25).
// The server says where links live (follow.jonasfiers.eu in production, so
// Android doesn't open them in the installed app).
const linkUrl = l => l.url || `${window.location.origin}/follow/${l.token}`

// "Opened 14 times · last 2 h ago": people who opened the page (counted once
// a day each, api/followService.js countView).
const ago = iso => {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (!(min >= 0)) return ''
  if (min < 2) return 'just now'
  if (min < 60) return `${min} min ago`
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`
  return `${Math.round(min / 1440)} days ago`
}
const PHOTO_LABELS = { all: 'All photos', favourites: 'Favourites only', none: 'No photos' }
const photoOptions = counts => [
  ['all', `All photos${counts ? ` (${counts.all})` : ''}`],
  ['favourites', `Favourites only${counts ? ` (${counts.favourites})` : ''}: starred in Immich`],
  ['none', 'No photos'],
]
const until = l => (l.keep ? 'slideshow, kept after the trip'
  : l.expiresOn ? `until ${new Date(`${l.expiresOn}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })}`
  : 'until 30 days after the trip')

const views = l => (l.views
  ? `Opened ${l.views === 1 ? 'once' : `${l.views} times`}${l.lastViewedOn ? `, last ${ago(l.lastViewedOn)}` : ''}`
  : 'Not opened yet')

export default function FollowSheet({ tripId, tripTitle, hasPhotos, onClose }) {
  const confirm = useConfirm()
  const [links, setLinks] = useState(null)
  const [photos, setPhotos] = useState('all')
  const [keep, setKeep] = useState(false)
  const [counts, setCounts] = useState(null)
  const [editing, setEditing] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')

  const load = () => client.get(`/trips/${tripId}/follow-links`)
    .then(r => { setLinks(r.data.links); setCounts(r.data.photoCounts ?? null) })
    .catch(() => setError('Failed to load the links.'))
  useEffect(() => { load() }, [tripId]) // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    setError('')
    setBusy(true)
    try {
      await client.post(`/trips/${tripId}/follow-links`, { photos: hasPhotos ? photos : 'none', keep })
      await load()
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to create the link.')
    } finally {
      setBusy(false)
    }
  }

  const share = async l => {
    const url = linkUrl(l)
    if (navigator.share) {
      try { await navigator.share({ title: `Follow my trip: ${tripTitle}`, url }); return } catch { /* cancelled: copy instead */ }
    }
    try {
      await navigator.clipboard.writeText(url)
      setCopied(l.token)
      setTimeout(() => setCopied(''), 2000)
    } catch {
      window.prompt('Copy this link', url)
    }
  }

  const change = async (l, patch) => {
    setError('')
    try {
      await client.patch(`/trips/${tripId}/follow-links/${l.token}`, patch)
      await load()
    } catch {
      setError('Failed to change the link.')
    }
  }

  const remove = async l => {
    if (!(await confirm({ title: 'Remove this link?', message: 'Anyone who has it can no longer follow the trip.', confirmLabel: 'Remove', danger: true }))) return
    setError('')
    try {
      await client.delete(`/trips/${tripId}/follow-links/${l.token}`)
      await load()
    } catch {
      setError('Failed to remove the link.')
    }
  }

  return (
    <Sheet title="Follow my trip" onClose={onClose}>
      <p className="field-note follow-explain">
        A link anyone can open without signing in. It shows the trip up to today: what you did, where, and when.
        Hotels show by town only. Booking references, ticket codes, notes, files, money and who else is going are never shown.
        It stops working 30 days after the trip, unless you keep it, or when you remove it.
        Once the trip has ended it opens as a slideshow; a kept link does so at once.
      </p>
      {links === null ? null : links.length > 0 && (
        <ul className="album-list">
          {links.map(l => (
            <li key={l.token}>
              <Icon name="globe" />
              <span className="album-list-text">
                <strong>{linkUrl(l).replace(/^https?:\/\//, '').replace(l.token, `${l.token.slice(0, 6)}…`)}</strong>
                <span>{views(l)} · {PHOTO_LABELS[l.photos] ?? 'No photos'} · {until(l)}{l.by ? ` · made by ${l.by}` : ''}</span>
                {editing === l.token && (
                  <span className="follow-edit">
                    {hasPhotos && (
                      <select value={l.photos} onChange={e => change(l, { photos: e.target.value })} aria-label="Photos on this link">
                        {photoOptions(counts).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                      </select>
                    )}
                    <label className="follow-check">
                      <input type="checkbox" checked={l.keep} onChange={e => change(l, { keep: e.target.checked })} />
                      Look back: a slideshow, and keep working after the trip
                    </label>
                  </span>
                )}
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(editing === l.token ? '' : l.token)} aria-expanded={editing === l.token} aria-label="Change link"><Icon name="pencil" /></button>
              <a className="btn btn-ghost btn-sm" href={linkUrl(l)} target="_blank" rel="noopener noreferrer">Open</a>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => share(l)}>{copied === l.token ? 'Copied' : navigator.share ? 'Share' : 'Copy'}</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(l)} aria-label="Remove link"><Icon name="x" /></button>
            </li>
          ))}
        </ul>
      )}
      {hasPhotos && (
        <label className="field follow-photos">
          <span>Photos on a new link (with where they were taken)</span>
          <select value={photos} onChange={e => setPhotos(e.target.value)}>
            {photoOptions(counts).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </label>
      )}
      <label className="follow-check">
        <input type="checkbox" checked={keep} onChange={e => setKeep(e.target.checked)} />
        Look back: a slideshow, and keep working after the trip (to share it afterwards)
      </label>
      {error && <p className="error">{error}</p>}
      <SheetActions>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Done</button>
        <button type="button" className="btn btn-primary" onClick={create} disabled={busy}>{busy ? 'Creating…' : 'New link'}</button>
      </SheetActions>
    </Sheet>
  )
}
