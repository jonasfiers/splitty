import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import client from '../api/client'
import PageHeader from '../components/PageHeader/PageHeader.jsx'
import Loading from '../components/Loading.jsx'
import LoadFailed from '../components/LoadFailed.jsx'
import EmptyState from '../components/EmptyState/EmptyState.jsx'
import { List, ListRow } from '../components/List/List.jsx'
import { getOnce } from '../utils/cache.js'
import { loadShared, clearShared, setPendingShare } from '../utils/shared.js'
import { readCodesFromFile, MAX_TICKETS } from '../utils/barcode.js'
import { today, formatDateRange, formatMoment, itemIcon, kindVars, formatBytes } from '../utils/trip.js'
import { tripIcon } from '../utils/icons.js'

// A ticket shared into Splitty from another app (2026-11-20): Android's share
// sheet → the service worker keeps the files (sw.js, utils/shared.js) → here.
// Splitty reads the codes in them; pick the trip, then the item (or a new
// one): the codes become the item's tickets and the files its attachments
// (either can be switched off). Then the item opens.
const KEEPABLE = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

export default function SharePage() {
  const navigate = useNavigate()
  const [files, setFiles] = useState(null) // null: still loading
  const [codes, setCodes] = useState(null) // null: still reading
  const [readNote, setReadNote] = useState('')
  const [useCodes, setUseCodes] = useState(true)
  const [attach, setAttach] = useState(true)
  const [trips, setTrips] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [showPast, setShowPast] = useState(false)
  const [trip, setTrip] = useState(null) // { trip, items } once picked
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let gone = false
    loadShared().then(async list => {
      if (gone) return
      setFiles(list)
      // Every code in every file, each once.
      const found = []
      const notes = []
      for (const file of list) {
        try {
          for (const c of await readCodesFromFile(file)) if (!found.some(f => f.text === c.text)) found.push(c)
        } catch (err) { notes.push(err.message) }
      }
      if (gone) return
      setCodes(found.slice(0, MAX_TICKETS))
      if (!found.length && notes.length) setReadNote(notes[0])
    }).catch(() => { if (!gone) { setFiles([]); setCodes([]) } })
    getOnce('/trips').then(r => { if (!gone) setTrips(r.data.trips || []) }).catch(err => { if (!gone) setLoadError(err) })
    return () => { gone = true }
  }, [])

  const keepable = (files || []).filter(f => KEEPABLE.includes(f.type))
  const skipped = (files || []).length - keepable.length
  const willCodes = useCodes && codes?.length > 0
  const willAttach = attach && keepable.length > 0

  const pickTrip = async t => {
    setError('')
    setBusy(true)
    try {
      const { data } = await getOnce(`/trips/${t.id}`)
      setTrip({ trip: data.trip, items: [...(data.items || [])].sort((a, b) => (a.start || '').localeCompare(b.start || '')) })
    } catch {
      setError('Couldn’t open that trip.')
    } finally {
      setBusy(false)
    }
  }

  const tickets = () => codes.map(c => ({ code: c.text, format: c.format, name: '' }))

  const addTo = async item => {
    if (busy) return
    setError('')
    setBusy(true)
    const failed = []
    try {
      if (willCodes) await client.post(`/trips/items/${item.id}/tickets`, { tickets: tickets() })
    } catch (err) {
      failed.push(err?.response?.data?.error || 'the ticket codes')
    }
    if (willAttach) {
      for (const file of keepable) {
        try {
          const body = new FormData()
          body.append('file', file)
          await client.post(`/trips/items/${item.id}/attachments`, body, { timeout: 120000 })
        } catch (err) {
          failed.push(err?.response?.status === 413 ? `${file.name} (over 10 MB)` : `${file.name}${err?.response?.data?.error ? ` (${err.response.data.error})` : ''}`)
        }
      }
    }
    if (failed.length) {
      setError(`Not added: ${failed.join(', ')}.`)
      setBusy(false)
      return
    }
    await clearShared()
    navigate(`/trips/${trip.trip.id}/items/${item.id}`, { replace: true })
  }

  // A new item: the form gets the codes and files, and attaches them once saved.
  const newItem = () => {
    setPendingShare({ tickets: willCodes ? tickets() : [], files: willAttach ? keepable : [] })
    navigate(`/trips/${trip.trip.id}/items/new?shared=1`)
  }

  const header = <PageHeader compact crumbs={[{ to: '/trips', label: 'Trips' }]} name="Shared ticket" />
  if (files === null) return <>{header}<Loading /></>
  if (files.length === 0) {
    return <>{header}<EmptyState title="Nothing was shared">Share a ticket (a PDF, a screenshot or a photo) to Splitty from another app.</EmptyState></>
  }

  const now = today()
  const upcoming = (trips || []).filter(t => t.endDate >= now)
  const past = (trips || []).filter(t => t.endDate < now).reverse()
  const nothingToAdd = !willCodes && !willAttach && codes !== null

  return (
    <>
      <PageHeader crumbs={[{ to: '/trips', label: 'Trips' }]} title="Shared ticket" name="Shared ticket" />

      <List label={files.length > 1 ? `${files.length} files` : 'File'}
        hint={skipped ? `${skipped === 1 ? 'One file is' : `${skipped} files are`} not a PDF or picture Splitty can keep; only its codes are used.` : undefined}>
        {files.map((f, n) => (
          <ListRow key={n} icon={f.type === 'application/pdf' ? 'file-text' : 'image'} title={f.name} meta={formatBytes(f.size)} />
        ))}
      </List>

      <List label="Add" hint={codes === null ? 'Reading the codes…' : codes.length === 0 ? (readNote || 'No codes found in it.') : undefined}>
        <ListRow
          title={codes?.length ? `${codes.length === 1 ? 'The ticket code' : `${codes.length} ticket codes`}` : 'Ticket codes'}
          meta={codes?.length ? 'As the item’s tickets' : codes === null ? 'Reading…' : 'None found'}
          aside={<Toggle on={willCodes} disabled={!codes?.length} onChange={setUseCodes} label="Add the ticket codes" />}
        />
        <ListRow
          title={keepable.length > 1 ? `The ${keepable.length} files` : 'The file'}
          meta={keepable.length ? 'As the item’s attachments' : 'Not a kind Splitty keeps'}
          aside={<Toggle on={willAttach} disabled={!keepable.length} onChange={setAttach} label="Attach the files" />}
        />
      </List>

      {error && <p className="error">{error}</p>}

      {!trip ? (
        loadError ? <LoadFailed error={loadError} what="your trips" docs={false} />
          : trips === null ? <Loading />
          : trips.length === 0 ? <EmptyState title="No trips yet">Plan a trip first; then share the ticket again.</EmptyState>
          : <>
            {upcoming.length > 0 && (
              <List label="To which trip?">
                {upcoming.map(t => <TripRow key={t.id} trip={t} onClick={() => pickTrip(t)} disabled={busy} />)}
              </List>
            )}
            {past.length > 0 && (showPast || upcoming.length === 0
              ? <List label={upcoming.length ? 'Earlier trips' : 'To which trip?'}>
                {past.map(t => <TripRow key={t.id} trip={t} onClick={() => pickTrip(t)} disabled={busy} />)}
              </List>
              : <button type="button" className="btn btn-ghost btn-block" onClick={() => setShowPast(true)}>Earlier trips</button>)}
          </>
      ) : (
        <>
          <List label="Trip">
            <ListRow icon={tripIcon(trip.trip)} title={trip.trip.title} meta={formatDateRange(trip.trip.startDate, trip.trip.endDate)}
              end={<button type="button" className="btn btn-ghost btn-sm" onClick={() => setTrip(null)} disabled={busy}>Change</button>} />
          </List>
          <List label="To which item?" hint={nothingToAdd ? 'Switch on the codes or the file to add something.' : busy ? 'Adding…' : undefined}>
            <ListRow icon="+" action title="New item…" onClick={newItem} disabled={busy || nothingToAdd || codes === null} />
            {trip.items.map(i => {
              const colours = kindVars(i.kind)
              return (
                <ListRow key={i.id} icon={itemIcon(i)} iconStyle={colours && { background: colours.bg, color: colours.fg }}
                  title={i.title} meta={formatMoment(i.start)} chevron
                  onClick={() => addTo(i)} disabled={busy || nothingToAdd || codes === null} />
              )
            })}
          </List>
        </>
      )}
    </>
  )
}

function TripRow({ trip, onClick, disabled }) {
  return <ListRow icon={tripIcon(trip)} title={trip.title} meta={formatDateRange(trip.startDate, trip.endDate)} chevron onClick={onClick} disabled={disabled} />
}

function Toggle({ on, disabled, onChange, label }) {
  return <button type="button" className={`toggle${on ? ' on' : ''}`} onClick={() => onChange(!on)} disabled={disabled} aria-label={label} aria-pressed={on} />
}
