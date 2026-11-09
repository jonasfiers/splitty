import { useEffect, useState } from 'react'
import client from '../../api/client'
import PlacePicker from '../PlacePicker/PlacePicker.jsx'
import { KINDS, TRANSPORT_MODES, dayOf, timeOf } from '../../utils/trip.js'
import Sheet, { SheetActions, SheetColumns, SheetSection } from '../Sheet/Sheet.jsx'
import Field from '../Field/Field.jsx'
import { DateTimePicker } from '../DatePicker/DatePicker.jsx'

const LABELS = {
  transport: { start: 'Departure', end: 'Arrival', title: 'Title', titleHint: 'Leave empty to use the route' },
  stay:      { start: 'Check-in', end: 'Check-out', title: 'Name', titleHint: 'Hotel, apartment, campsite…' },
  activity:  { start: 'Starts', end: 'Ends', title: 'What', titleHint: 'Museum, hike, dinner…' },
}

const moment = (date, time) => (date ? (time ? `${date}T${time}` : date) : '')

// The essentials of a new trip item, in a pop-up over the trip: what the
// timeline drag (or tap) already decided, plus a name, the place(s) and, for
// travel, the mode. "More details…" carries what is filled in over to the
// full form for the booking reference, link and notes.
function QuickAddSheet({ tripId, kind, start, end, places, onClose, onSaved, onMore, onFindRoute }) {
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

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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

  // Travel by train or bus: let the route planner fill it in, starting from
  // what is set here (the dragged range, and the places if already picked).
  const findRoute = () => onFindRoute({
    start: moment(form.startDate, form.startTime),
    end: moment(form.endDate || (form.endTime ? form.startDate : ''), form.endTime),
    from: form.from,
    to: form.to,
  })

  return (
    // Above the full-screen timeline too, where this can also be started.
    <Sheet title={<>{KINDS[kind].icon} Add {kind === 'transport' ? 'travel' : KINDS[kind].label.toLowerCase()}</>} onClose={onClose} className="quick-add" zIndex={1100}>
      <form onSubmit={handleSubmit}>
        {/* What and where | when: side by side on a wide screen. */}
        <SheetColumns>
        <SheetSection>
        {kind === 'transport' && onFindRoute && (
          <button type="button" className="btn btn-secondary quick-add-route" onClick={findRoute}>
            🔎 Find a train or bus connection
          </button>
        )}
        {kind === 'transport' && (
          <div className="filter-chips chips-flush-top chips-wrap">
            {TRANSPORT_MODES.map(m => (
              <button key={m.value} type="button" className={`chip${form.mode === m.value ? ' active' : ''}`} onClick={() => set({ mode: m.value })}>
                {m.icon} {m.label}
              </button>
            ))}
          </div>
        )}

        <Field label={labels.title}>
          <input value={form.title} onChange={e => set({ title: e.target.value })} placeholder={labels.titleHint} autoFocus />
        </Field>

        {kind === 'transport' ? (
          <div className="form-row">
            <Field label="From">
              <PlacePicker title="From" value={form.from} onChange={from => set({ from })} places={places} placeholder="Airport, station…" />
            </Field>
            <Field label="To">
              <PlacePicker title="To" value={form.to} onChange={to => set({ to })} places={places} placeholder="Airport, station…" />
            </Field>
          </div>
        ) : (
          <Field label="Where">
            <PlacePicker title="Where" value={form.place} onChange={place => set({ place })} places={places} />
          </Field>
        )}
        </SheetSection>

        <SheetSection narrow>
        <div className="form-row">
          <Field label={labels.start}>
            <DateTimePicker
              title={labels.start}
              date={form.startDate}
              time={form.startTime}
              onChange={({ date, time }) => set({ startDate: date, startTime: time })}
              withTime={kind !== 'stay'}
              shortcuts={[]}
              required
            />
          </Field>
          <Field label={labels.end}>
            <DateTimePicker
              title={labels.end}
              placeholder="—"
              date={form.endDate}
              time={form.endTime}
              min={form.startDate || undefined}
              onChange={({ date, time }) => set({ endDate: date, endTime: time })}
              withTime={kind !== 'stay'}
              shortcuts={[]}
              optional
              sameDayLabel
            />
          </Field>
        </div>
        </SheetSection>
        </SheetColumns>

        {error && <p className="error">{error}</p>}

        <SheetActions>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Adding…' : 'Add to trip'}
          </button>
          <div className="sheet-actions-row">
            <button type="button" className="btn btn-ghost" onClick={more}>More details…</button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </SheetActions>
      </form>
    </Sheet>
  )
}

export default QuickAddSheet
