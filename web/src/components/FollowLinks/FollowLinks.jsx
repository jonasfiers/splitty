import { useState, useEffect } from 'react'
import client from '../../api/client'
import Icon from '../Icon/Icon.jsx'
import { useConfirm } from '../Confirm/ConfirmProvider.jsx'

// A trip's follow links (api/followService.js), on their own page
// (TripFollowPage, the "Follow links" chip on the trip): create, open, share,
// change, remove. Anyone with a link sees the trip up to today without
// signing in. Each link has its own photos (all, the ones hearted in Immich,
// none) and may look back: a slideshow at once, working after the trip.
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
const shortDate = day => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

// All / Favourites / None, with how many photos each shows.
function PhotoChoice({ value, counts, onChange }) {
  const options = [
    ['all', 'All', counts?.all],
    ['favourites', 'Favourites', counts?.favourites],
    ['none', 'None', null],
  ]
  return (
    <div className="seg" role="group" aria-label="Photos on this link">
      {options.map(([v, label, n]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => value !== v && onChange(v)}>
          {label}{n != null && <span className="seg-n">{n}</span>}
        </button>
      ))}
    </div>
  )
}

function Switch({ on, onChange, label }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`toggle${on ? ' on' : ''}`} onClick={() => onChange(!on)} />
}

// The two settings, the same for a link and for a new one.
function Settings({ photos, keep, counts, expiresOn, onPhotos, onKeep }) {
  return (
    <div className="follow-settings">
      {counts && (
        <div className="follow-setting">
          <div className="follow-setting-text">
            <strong>Photos</strong>
            <span>Favourites are the ones with a heart in Immich.</span>
          </div>
          <PhotoChoice value={photos} counts={counts} onChange={onPhotos} />
        </div>
      )}
      <div className="follow-setting">
        <div className="follow-setting-text">
          <strong>Look back</strong>
          <span>
            {keep
              ? 'Opens as the slideshow now, and keeps working after the trip.'
              : `Follows along during the trip, a slideshow once it has ended. Stops working ${expiresOn ? `on ${shortDate(expiresOn)}` : '30 days after the trip'}.`}
          </span>
        </div>
        <Switch on={keep} onChange={onKeep} label="Look back" />
      </div>
    </div>
  )
}

export default function FollowLinks({ tripId, tripTitle }) {
  const confirm = useConfirm()
  const [links, setLinks] = useState(null)
  const [counts, setCounts] = useState(null)
  const [photos, setPhotos] = useState('all')
  const [keep, setKeep] = useState(false)
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
      await client.post(`/trips/${tripId}/follow-links`, { photos: counts ? photos : 'none', keep })
      await load()
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to create the link.')
    } finally {
      setBusy(false)
    }
  }

  const change = async (l, patch) => {
    setError('')
    setLinks(ls => ls.map(x => (x.token === l.token ? { ...x, ...patch } : x))) // at once; the server's answer follows
    try {
      await client.patch(`/trips/${tripId}/follow-links/${l.token}`, patch)
    } catch {
      setError('Failed to change the link.')
    }
    await load()
  }

  const share = async l => {
    const url = linkUrl(l)
    if (navigator.share) {
      try { await navigator.share({ title: `My trip: ${tripTitle}`, url }); return } catch { /* cancelled: copy instead */ }
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
    if (!(await confirm({ title: 'Remove this link?', message: 'Anyone who has it can no longer open the trip.', confirmLabel: 'Remove', danger: true }))) return
    setError('')
    try {
      await client.delete(`/trips/${tripId}/follow-links/${l.token}`)
      await load()
    } catch {
      setError('Failed to remove the link.')
    }
  }

  return (
    <div className="follow-links">
      <p className="follow-intro">
        A follow link opens the trip without signing in: what you did, where and when, up to today, with the photos you choose.
        Hotels show by town only. Booking references, ticket codes, notes, files, money and who else is going are never shown.
      </p>

      {error && <p className="error">{error}</p>}

      {links?.map(l => (
        <section key={l.token} className="card follow-link">
          <div className="follow-link-head">
            <Icon name="globe" />
            <div className="follow-link-name">
              <strong>{linkUrl(l).replace(/^https?:\/\//, '').replace(l.token, `${l.token.slice(0, 6)}…`)}</strong>
              <span>{views(l)}{l.by ? ` · made by ${l.by}` : ''}</span>
            </div>
          </div>
          <div className="follow-link-actions">
            <a className="btn btn-ghost btn-sm" href={linkUrl(l)} target="_blank" rel="noopener noreferrer">Open</a>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => share(l)}>{copied === l.token ? 'Copied' : navigator.share ? 'Share' : 'Copy'}</button>
            <button type="button" className="btn btn-ghost btn-sm follow-link-remove" onClick={() => remove(l)}>Remove</button>
          </div>
          <Settings photos={l.photos} keep={l.keep} counts={counts} expiresOn={l.expiresOn}
            onPhotos={v => change(l, { photos: v })} onKeep={v => change(l, { keep: v })} />
        </section>
      ))}

      {links && (
        <section className="card follow-link follow-new">
          <h2>{links.length ? 'Another link' : 'Make a link'}</h2>
          <p className="field-note">One per group of people, so each can have its own photos and be removed on its own.</p>
          <Settings photos={photos} keep={keep} counts={counts} onPhotos={setPhotos} onKeep={setKeep} />
          <button type="button" className="btn btn-primary" onClick={create} disabled={busy}>{busy ? 'Making…' : 'Make the link'}</button>
        </section>
      )}
    </div>
  )
}
