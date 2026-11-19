import { useState, useEffect } from 'react'
import client from '../../api/client'
import Sheet, { SheetActions } from '../Sheet/Sheet.jsx'
import Icon from '../Icon/Icon.jsx'
import { useConfirm } from '../Confirm/ConfirmProvider.jsx'

// "Follow my trip" links of a trip (api/followService.js): create, copy or
// share, remove. Anyone with a link sees the trip up to today without signing
// in; the page says plainly what it leaves out.
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
const views = l => (l.views
  ? `Opened ${l.views === 1 ? 'once' : `${l.views} times`}${l.lastViewedOn ? `, last ${ago(l.lastViewedOn)}` : ''}`
  : 'Not opened yet')

export default function FollowSheet({ tripId, tripTitle, hasPhotos, onClose }) {
  const confirm = useConfirm()
  const [links, setLinks] = useState(null)
  const [photos, setPhotos] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')

  const load = () => client.get(`/trips/${tripId}/follow-links`)
    .then(r => setLinks(r.data.links))
    .catch(() => setError('Failed to load the links.'))
  useEffect(() => { load() }, [tripId]) // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    setError('')
    setBusy(true)
    try {
      await client.post(`/trips/${tripId}/follow-links`, { photos: hasPhotos && photos })
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
        It stops working 30 days after the trip, or when you remove it.
      </p>
      {links === null ? null : links.length > 0 && (
        <ul className="album-list">
          {links.map(l => (
            <li key={l.token}>
              <Icon name="globe" />
              <span className="album-list-text">
                <strong>{linkUrl(l).replace(/^https?:\/\//, '').replace(l.token, `${l.token.slice(0, 6)}…`)}</strong>
                <span>{views(l)} · {l.photos ? 'with photos' : 'without photos'}{l.by ? ` · made by ${l.by}` : ''}</span>
              </span>
              <a className="btn btn-ghost btn-sm" href={linkUrl(l)} target="_blank" rel="noopener noreferrer">Open</a>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => share(l)}>{copied === l.token ? 'Copied' : navigator.share ? 'Share' : 'Copy'}</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(l)} aria-label="Remove link"><Icon name="x" /></button>
            </li>
          ))}
        </ul>
      )}
      {hasPhotos && (
        <label className="follow-check">
          <input type="checkbox" checked={photos} onChange={e => setPhotos(e.target.checked)} />
          Include the trip’s photos (with where they were taken)
        </label>
      )}
      {error && <p className="error">{error}</p>}
      <SheetActions>
        <button type="button" className="btn btn-ghost" onClick={onClose}>Done</button>
        <button type="button" className="btn btn-primary" onClick={create} disabled={busy}>{busy ? 'Creating…' : 'New link'}</button>
      </SheetActions>
    </Sheet>
  )
}
