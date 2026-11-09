import { useState, useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router'
import client from '../api/client'
import PlacePicker from '../components/PlacePicker/PlacePicker.jsx'
import Loading from '../components/Loading.jsx'
import PageHeader from '../components/PageHeader/PageHeader.jsx'
import { leaveTo } from '../utils/history.js'
import BackLink from '../components/BackLink.jsx'
import { KINDS, TRANSPORT_MODES, dayOf, timeOf } from '../utils/trip.js'
import { useMediaQuery } from '../utils/useMediaQuery.js'
import Field from '../components/Field/Field.jsx'
import { FormColumns, FormColumn } from '../components/Field/FormColumns.jsx'
import Segmented from '../components/Segmented/Segmented.jsx'
import { DateTimePicker } from '../components/DatePicker/DatePicker.jsx'
import EmptyState from '../components/EmptyState/EmptyState.jsx'
import { getOnce } from '../utils/cache.js'

const LABELS = {
  transport: { start: 'Departure', end: 'Arrival', title: 'Title', titleHint: 'Leave empty to use the route' },
  stay:      { start: 'Check-in', end: 'Check-out', title: 'Name', titleHint: 'Hotel, apartment, campsite…' },
  activity:  { start: 'Starts', end: 'Ends', title: 'What', titleHint: 'Museum, hike, dinner…' },
}

// 'YYYY-MM-DD' for all day, 'YYYY-MM-DDTHH:mm' with a time. Local wall-clock
// time as printed on the ticket; no timezone is involved anywhere.
const moment = (date, time) => (date ? (time ? `${date}T${time}` : date) : '')

export default function TripItemFormPage() {
  const { tripId, itemId } = useParams()
  const [searchParams] = useSearchParams()
  const isEdit = Boolean(itemId)
  const navigate = useNavigate()

  const [kind, setKind] = useState(KINDS[searchParams.get('kind')] ? searchParams.get('kind') : 'activity')
  const [form, setForm] = useState({
    title: '',
    mode: TRANSPORT_MODES.some(m => m.value === searchParams.get('mode')) ? searchParams.get('mode') : 'flight',
    carrier: '',
    number: '',
    startDate: '', startTime: '',
    endDate: '', endTime: '',
    from: null, to: null, place: null,
    confirmationRef: '',
    url: '',
    notes: '',
  })
  const [places, setPlaces] = useState([])
  const [showMore, setShowMore] = useState(false) // Link and Notes
  const [tripRange, setTripRange] = useState(null) // the trip's dates, tinted in the calendar
  const [items, setItems] = useState([]) // the trip's other items, for the From suggestion
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const wide = useMediaQuery('(min-width: 768px)') // the header's own breakpoint
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    Promise.all([
      // The trip (its places, its dates) from the cache when kept
      // (utils/cache.js); the item being edited always fresh.
      getOnce(`/trips/${tripId}`),
      ...(isEdit ? [client.get(`/trips/items/${itemId}`)] : []),
    ]).then(([tripRes, itemRes]) => {
      const trip = tripRes.data.trip
      setTripRange({ start: trip.startDate, end: trip.endDate })
      setPlaces(tripRes.data.places || [])
      setItems(tripRes.data.items || [])

      if (isEdit) {
        const i = itemRes.data.item
        setKind(i.kind)
        setForm(f => ({
          ...f,
          title: i.title || '',
          mode: i.mode || f.mode,
          carrier: i.carrier || '',
          number: i.number || '',
          startDate: dayOf(i.start), startTime: timeOf(i.start),
          endDate: dayOf(i.end), endTime: timeOf(i.end),
          from: i.from ? { id: i.from.id } : null,
          to: i.to ? { id: i.to.id } : null,
          place: i.place ? { id: i.place.id } : null,
          confirmationRef: i.confirmationRef || '',
          url: i.url || '',
          notes: i.notes || '',
        }))
      } else {
        // ?start= / ?end= ('YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm') come from dragging
        // out a range on the trip timeline.
        const valid = m => /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(m || '')
        const start = valid(searchParams.get('start')) ? searchParams.get('start') : null
        const end = valid(searchParams.get('end')) ? searchParams.get('end') : null
        setForm(f => ({
          ...f,
          // ?title= comes along from the quick-add pop-up's "More details…".
          title: (searchParams.get('title') || '').slice(0, 160),
          startDate: start ? dayOf(start) : trip.startDate,
          startTime: start ? timeOf(start) : '',
          // A stay is the one item that nearly always has an end: the whole trip.
          endDate: end ? dayOf(end) : searchParams.get('kind') === 'stay' && !start ? trip.endDate : '',
          endTime: end ? timeOf(end) : '',
        }))
      }
    }).catch(() => setMissing(true)).finally(() => setLoading(false))
  }, [tripId, itemId, isEdit])

  const set = patch => setForm(f => ({ ...f, ...patch }))
  // Another kind (a stay entered as an activity): the place goes along, as
  // the journey's destination or the stay's or activity's place.
  const switchKind = next => {
    if (next === kind) return
    setForm(f => next === 'transport'
      ? { ...f, to: f.to ?? f.place, place: null }
      : kind === 'transport' ? { ...f, place: f.place ?? f.to ?? f.from, from: null, to: null } : f)
    setKind(next)
  }
  const backPath = isEdit ? `/trips/${tripId}/items/${itemId}` : `/trips/${tripId}`
  // From: where the journey before this one ended (the train after the flight
  // starts at the airport).
  const startMoment = moment(form.startDate, form.startTime)
  const lastArrival = items
    .filter(i => i.kind === 'transport' && i.id !== itemId && i.toPlaceId && startMoment && (i.end || i.start) <= startMoment)
    .sort((a, b) => (a.end || a.start).localeCompare(b.end || b.start))
    .at(-1)?.toPlaceId
  const nameOf = ref => (ref?.id ? places.find(p => p.id === ref.id)?.name : ref?.name)

  const handleSubmit = async e => {
    e.preventDefault()
    if (saving) return
    setError('')

    const route = [nameOf(form.from), nameOf(form.to)].filter(Boolean).join(' → ')
    const title = form.title.trim()
      || (kind === 'transport' ? (route || TRANSPORT_MODES.find(m => m.value === form.mode)?.label) : '')
    if (!title) {
      setError('Give it a name.')
      return
    }

    const payload = {
      kind,
      title,
      start: moment(form.startDate, form.startTime),
      // A time alone means "same day".
      end: moment(form.endDate || (form.endTime ? form.startDate : ''), form.endTime),
      confirmationRef: form.confirmationRef,
      url: form.url.trim(),
      notes: form.notes,
      ...(kind === 'transport'
        ? { mode: form.mode, carrier: form.carrier, number: form.number, from: form.from, to: form.to }
        : { place: form.place }),
    }

    setSaving(true)
    try {
      if (isEdit) {
        await client.put(`/trips/items/${itemId}`, payload)
        leaveTo(navigate, `/trips/${tripId}/items/${itemId}`)
      } else {
        const { data } = await client.post(`/trips/${tripId}/items`, payload)
        navigate(`/trips/${tripId}/items/${data.id}`, { replace: true })
      }
    } catch (err) {
      console.error('Save trip item failed:', err)
      setError(err?.response?.data?.error || 'Failed to save.')
      setSaving(false)
    }
  }

  if (loading) return <><PageHeader compact back={{ to: backPath }} name={isEdit ? 'Edit item' : 'New item'} /><Loading /></>
  if (missing) return <><PageHeader compact crumbs={[{ to: '/trips', label: 'Trips' }]} name="Trip" /><EmptyState art={false} title="Trip not found" /></>

  const labels = LABELS[kind]
  const titleField = (
    <Field label={labels.title} optional={kind === 'transport'}>
      <input
        value={form.title}
        onChange={e => set({ title: e.target.value })}
        placeholder={labels.titleHint}
        maxLength={160}
        required={kind !== 'transport'}
      />
    </Field>
  )
  const formTitle = `${isEdit ? 'Edit' : 'New'} ${(kind === 'transport' && form.mode !== 'other'
    ? TRANSPORT_MODES.find(m => m.value === form.mode).label
    : KINDS[kind].label).toLowerCase()}`

  return (
    <>
      <PageHeader
        back={{ to: backPath }}
        title={formTitle}
        name={formTitle}
        // On phones Save sits in the bar (as on the expense form).
        actions={wide ? [] : [{ label: saving ? 'Saving…' : (isEdit ? 'Save' : 'Add'), form: 'trip-item-form', disabled: saving, primary: true }]}
      />

      <div className="card form-card-wide">
        <form id="trip-item-form" onSubmit={handleSubmit}>
          {error && <p className="error">{error}</p>}
          <FormColumns>
          <FormColumn>
          <Segmented
            label="Kind"
            value={kind}
            onChange={switchKind}
            options={[
              { value: 'transport', label: `${KINDS.transport.icon} Travel` },
              { value: 'stay', label: `${KINDS.stay.icon} Stay` },
              { value: 'activity', label: `${KINDS.activity.icon} Activity` },
            ]}
          />
          {kind === 'transport' && (
            <Field label="By" group>
              <div className="mode-grid">
                {TRANSPORT_MODES.map(m => (
                  <button type="button" key={m.value} className={`mode-tile${form.mode === m.value ? ' active' : ''}`}
                    aria-pressed={form.mode === m.value} onClick={() => set({ mode: m.value })}>
                    <span className="mode-tile-icon" aria-hidden="true">{m.icon}</span>
                    {m.label}
                  </button>
                ))}
              </div>
            </Field>
          )}

          {kind === 'transport' ? (
            <>
              <Field label="From">
                <PlacePicker title="From" value={form.from} onChange={from => set({ from })} places={places} placeholder="Airport, station, address…" suggested={lastArrival} suggestedNote="Where your last journey ended" />
              </Field>
              <Field label="To">
                <PlacePicker title="To" value={form.to} onChange={to => set({ to })} places={places} placeholder="Airport, station, address…" />
              </Field>
            </>
          ) : null}

          {/* A stay or activity starts with what and where; a journey with its
              route and times, its title is optional and comes later. */}
          {kind !== 'transport' && <>
            {titleField}
            <Field label="Where">
              <PlacePicker title="Where" value={form.place} onChange={place => set({ place })} places={places} />
            </Field>
          </>}

          <div className="form-row">
            <Field label={labels.start}>
              <DateTimePicker
                title={labels.start}
                date={form.startDate}
                time={form.startTime}
                onChange={({ date, time }) => set({ startDate: date, startTime: time })}
                range={tripRange}
                shortcuts={[]}
                required
              />
            </Field>
            <Field label={labels.end} optional>
              <DateTimePicker
                title={labels.end}
                placeholder="—"
                date={form.endDate}
                time={form.endTime}
                min={form.startDate || undefined}
                onChange={({ date, time }) => set({ endDate: date, endTime: time })}
                range={tripRange}
                shortcuts={[]}
                optional
                sameDayLabel
              />
            </Field>
          </div>

          </FormColumn>

          <FormColumn>
          {kind === 'transport' && (
            <div className="form-row">
              <Field label={form.mode === 'flight' ? 'Airline' : form.mode === 'car' ? 'Rental company' : 'Operator'}>
                <input value={form.carrier} onChange={e => set({ carrier: e.target.value })} maxLength={80} />
              </Field>
              <Field label={form.mode === 'flight' ? 'Flight number' : form.mode === 'car' ? 'Car / plate' : 'Number'}>
                <input value={form.number} onChange={e => set({ number: e.target.value })} maxLength={40} />
              </Field>
            </div>
          )}

          <Field label="Booking reference" optional>
            <input value={form.confirmationRef} onChange={e => set({ confirmationRef: e.target.value })} maxLength={80} autoCapitalize="characters" />
          </Field>

          {kind === 'transport' && titleField}

          {/* Rarely needed, so folded away on a phone, and open by itself when
              there is something in them. With room for two columns they are
              always shown (index.css: the right column would be empty anyway). */}
          {(() => {
            const open = showMore || form.url || form.notes
            return <>
              <div className={`form-more-fields${open ? '' : ' folded'}`}>
                <Field label="Link" optional>
                  <input type="url" value={form.url} onChange={e => set({ url: e.target.value })} placeholder="https://…" maxLength={600} />
                </Field>
                <Field label="Notes" optional>
                  <textarea rows={3} value={form.notes} onChange={e => set({ notes: e.target.value })} maxLength={4000} />
                </Field>
              </div>
              {!open && (
                <button type="button" className="form-more" onClick={() => setShowMore(true)} aria-expanded={false}>
                  <span aria-hidden="true">＋</span> Link and notes
                </button>
              )}
            </>
          })()}
          </FormColumn>
          </FormColumns>

          {wide && <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
            <BackLink to={backPath} replace className="btn btn-ghost">Cancel</BackLink>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Add to trip')}
            </button>
          </div>}
        </form>
      </div>
    </>
  )
}
