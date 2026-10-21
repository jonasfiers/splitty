import { useState } from 'react'
import client from '../../api/client'
import PlacePicker from '../PlacePicker/PlacePicker.jsx'
import { KINDS, TRANSPORT_MODES, dayOf, timeOf } from '../../utils/trip.js'

const LABELS = {
  transport: { start: 'Departure', end: 'Arrival', title: 'Title', titleHint: 'Leave empty to use the route' },
  stay:      { start: 'Check-in', end: 'Check-out', title: 'Name', titleHint: 'Hotel, apartment, campsite…' },
  activity:  { start: 'Starts', end: 'Ends', title: 'What', titleHint: 'Museum, hike, dinner…' },
}

const moment = (date, time) => (date ? (time ? `${date}T${time}` : date) : '')

// The essentials of a new trip item, in a pop-up over the trip: what the
// timeline drag (or tap) already decided, plus a name, the place(s) and, for
// travel, the mode. "More details…" carries what is filled in over to the
// full form for price, booking reference and notes.
function QuickAddSheet({ tripId, kind, start, end, places, onClose, onSaved, onMore }) {
  const [form, setForm] = useState({
    title: '',
    mode: 'flight',
    from: null, to: null, place: null,
    startDate: dayOf(start), startTime: timeOf(start),
    endDate: dayOf(end), endTime: timeOf(end),
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = patch => setForm(f => ({ ...f, ...patch }))
  const labels = LABELS[kind]

  const nameOf = ref => (ref?.id ? places.find(p => p.id === ref.id)?.name : ref?.name)
  const route = [nameOf(form.from), nameOf(form.to)].filter(Boolean).join(' → ')

  const handleSubmit = async e => {
    e.preventDefault()
    if (saving) return
    setError('')
    // Same fallback as the full form: an untitled journey is named by its route, then its mode.
    const title = form.title.trim() || (kind === 'transport' ? (route || TRANSPORT_MODES.find(m => m.value === form.mode)?.label) : '')
    if (!title) { setError('Give it a name.'); return }
    setSaving(true)
    try {
      await client.post(`/trips/${tripId}/items`, {
        kind,
        title,
        start: moment(form.startDate, form.startTime),
        end: moment(form.endDate || (form.endTime ? form.startDate : ''), form.endTime),
        price: null,
        ...(kind === 'transport' ? { mode: form.mode, from: form.from, to: form.to } : { place: form.place }),
      })
      onSaved(title)
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to save.')
      setSaving(false)
    }
  }

  const more = () => onMore({
    kind,
    ...(kind === 'transport' && { mode: form.mode }),
    start: moment(form.startDate, form.startTime),
    end: moment(form.endDate || (form.endTime ? form.startDate : ''), form.endTime),
    ...(form.title.trim() && { title: form.title.trim() }),
  })

  return (
    // Above the full-screen timeline too, where this can also be started.
    <div className="sheet-overlay" style={{ zIndex: 1100 }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet quick-add">
        <div className="sheet-handle" />
        <p className="sheet-title">{KINDS[kind].icon} Add {kind === 'transport' ? 'travel' : KINDS[kind].label.toLowerCase()}</p>
        <form onSubmit={handleSubmit}>
          {kind === 'transport' && (
            <div className="filter-chips" style={{ paddingTop: 0, flexWrap: 'wrap' }}>
              {TRANSPORT_MODES.map(m => (
                <button key={m.value} type="button" className={`chip${form.mode === m.value ? ' active' : ''}`} onClick={() => set({ mode: m.value })}>
                  {m.icon} {m.label}
                </button>
              ))}
            </div>
          )}

          <div className="form-group">
            <label>{labels.title}</label>
            <input value={form.title} onChange={e => set({ title: e.target.value })} placeholder={labels.titleHint} autoFocus />
          </div>

          {kind === 'transport' ? (
            <div className="form-row">
              <div className="form-group">
                <label>From</label>
                <PlacePicker value={form.from} onChange={from => set({ from })} places={places} placeholder="Airport, station…" />
              </div>
              <div className="form-group">
                <label>To</label>
                <PlacePicker value={form.to} onChange={to => set({ to })} places={places} placeholder="Airport, station…" />
              </div>
            </div>
          ) : (
            <div className="form-group">
              <label>Where</label>
              <PlacePicker value={form.place} onChange={place => set({ place })} places={places} />
            </div>
          )}

          <div className="form-row">
            <div className="form-group">
              <label>{labels.start}</label>
              <input type="date" value={form.startDate} onChange={e => set({ startDate: e.target.value })} required />
              {kind !== 'stay' && <input type="time" value={form.startTime} onChange={e => set({ startTime: e.target.value })} style={{ marginTop: 6 }} />}
            </div>
            <div className="form-group">
              <label>{labels.end}</label>
              <input type="date" value={form.endDate} min={form.startDate} onChange={e => set({ endDate: e.target.value })} />
              {kind !== 'stay' && <input type="time" value={form.endTime} onChange={e => set({ endTime: e.target.value })} style={{ marginTop: 6 }} />}
            </div>
          </div>

          {error && <p className="error">{error}</p>}

          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={saving}>
            {saving ? 'Adding…' : 'Add to trip'}
          </button>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={more}>More details…</button>
            <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default QuickAddSheet
