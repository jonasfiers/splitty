import { useState, useEffect } from 'react'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import client from '../api/client'
import CurrencyInput from '../components/CurrencyInput/CurrencyInput.jsx'
import PlacePicker from '../components/PlacePicker/PlacePicker.jsx'
import Loading from '../components/Loading.jsx'
import BackLink from '../components/BackLink.jsx'
import { KINDS, TRANSPORT_MODES, dayOf, timeOf } from '../utils/trip.js'

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
    price: 0,
    currencyIso: '',
    confirmationRef: '',
    url: '',
    notes: '',
  })
  const [places, setPlaces] = useState([])
  const [currencies, setCurrencies] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    Promise.all([
      client.get(`/trips/${tripId}`),
      client.get('/currencies'),
      ...(isEdit ? [client.get(`/trips/items/${itemId}`)] : []),
    ]).then(([tripRes, curRes, itemRes]) => {
      const trip = tripRes.data.trip
      setPlaces(tripRes.data.places || [])
      setCurrencies(curRes.data.currencies || [])

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
          price: i.price ?? 0,
          currencyIso: i.currencyIso || trip.groupIso || '',
          confirmationRef: i.confirmationRef || '',
          url: i.url || '',
          notes: i.notes || '',
        }))
      } else {
        setForm(f => ({
          ...f,
          startDate: trip.startDate,
          // A stay is the one item that nearly always has an end: the whole trip.
          endDate: searchParams.get('kind') === 'stay' ? trip.endDate : '',
          currencyIso: trip.groupIso || '',
        }))
      }
    }).catch(() => setMissing(true)).finally(() => setLoading(false))
  }, [tripId, itemId, isEdit])

  const set = patch => setForm(f => ({ ...f, ...patch }))
  const backPath = isEdit ? `/trips/${tripId}/items/${itemId}` : `/trips/${tripId}`
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
      price: form.price > 0 ? form.price : null,
      currencyIso: form.price > 0 ? form.currencyIso : '',
      ...(kind === 'transport'
        ? { mode: form.mode, carrier: form.carrier, number: form.number, from: form.from, to: form.to }
        : { place: form.place }),
    }

    setSaving(true)
    try {
      if (isEdit) {
        await client.put(`/trips/items/${itemId}`, payload)
        navigate(`/trips/${tripId}/items/${itemId}`)
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

  if (loading) return <Loading />
  if (missing) return <div className="empty-state"><p className="empty-state-title">Trip not found.</p></div>

  const labels = LABELS[kind]

  return (
    <>
      <BackLink to={backPath} className="back-link" />

      <div className="page-header">
        <h1>{isEdit ? 'Edit' : 'New'} {(kind === 'transport' && form.mode !== 'other'
          ? TRANSPORT_MODES.find(m => m.value === form.mode).label
          : KINDS[kind].label).toLowerCase()}</h1>
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        <form onSubmit={handleSubmit}>
          {kind === 'transport' && (
            <div className="form-group">
              <label>By</label>
              <div className="filter-chips" style={{ padding: 0 }}>
                {TRANSPORT_MODES.map(m => (
                  <button type="button" key={m.value} className={`chip${form.mode === m.value ? ' active' : ''}`} onClick={() => set({ mode: m.value })}>
                    {m.icon} {m.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {kind === 'transport' ? (
            <>
              <div className="form-group">
                <label>From</label>
                <PlacePicker value={form.from} onChange={from => set({ from })} places={places} placeholder="Airport, station, address…" />
              </div>
              <div className="form-group">
                <label>To</label>
                <PlacePicker value={form.to} onChange={to => set({ to })} places={places} placeholder="Airport, station, address…" />
              </div>
            </>
          ) : null}

          <div className="form-group">
            <label>{labels.title}</label>
            <input
              value={form.title}
              onChange={e => set({ title: e.target.value })}
              placeholder={labels.titleHint}
              maxLength={160}
              required={kind !== 'transport'}
            />
          </div>

          {kind !== 'transport' && (
            <div className="form-group">
              <label>Where</label>
              <PlacePicker value={form.place} onChange={place => set({ place })} places={places} />
            </div>
          )}

          {kind === 'transport' && (
            <div className="form-row">
              <div className="form-group">
                <label>{form.mode === 'flight' ? 'Airline' : form.mode === 'car' ? 'Rental company' : 'Operator'}</label>
                <input value={form.carrier} onChange={e => set({ carrier: e.target.value })} maxLength={80} />
              </div>
              <div className="form-group">
                <label>{form.mode === 'flight' ? 'Flight number' : form.mode === 'car' ? 'Car / plate' : 'Number'}</label>
                <input value={form.number} onChange={e => set({ number: e.target.value })} maxLength={40} />
              </div>
            </div>
          )}

          <div className="form-row form-row-compact form-row-when">
            <div className="form-group">
              <label>{labels.start}</label>
              <input type="date" value={form.startDate} onChange={e => set({ startDate: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>Time <span className="label-optional">optional</span></label>
              <input type="time" value={form.startTime} onChange={e => set({ startTime: e.target.value })} />
            </div>
          </div>

          <div className="form-row form-row-compact form-row-when">
            <div className="form-group">
              <label>{labels.end} <span className="label-optional">optional</span></label>
              <input type="date" value={form.endDate} min={form.startDate} onChange={e => set({ endDate: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Time <span className="label-optional">optional</span></label>
              <input type="time" value={form.endTime} onChange={e => set({ endTime: e.target.value })} />
            </div>
          </div>

          <div className="form-row form-row-compact">
            <div className="form-group">
              <label>Currency</label>
              <select value={form.currencyIso} onChange={e => set({ currencyIso: e.target.value })}>
                {currencies.map(c => <option key={c.iso} value={c.iso}>{c.symbol} {c.iso}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Price <span className="label-optional">optional</span></label>
              <CurrencyInput iso={form.currencyIso || 'EUR'} value={form.price} onChange={price => set({ price })} />
            </div>
          </div>

          <div className="form-group">
            <label>Booking reference <span className="label-optional">optional</span></label>
            <input value={form.confirmationRef} onChange={e => set({ confirmationRef: e.target.value })} maxLength={80} autoCapitalize="characters" />
          </div>

          <div className="form-group">
            <label>Link <span className="label-optional">optional</span></label>
            <input type="url" value={form.url} onChange={e => set({ url: e.target.value })} placeholder="https://…" maxLength={600} />
          </div>

          <div className="form-group">
            <label>Notes <span className="label-optional">optional</span></label>
            <textarea rows={3} value={form.notes} onChange={e => set({ notes: e.target.value })} maxLength={4000} />
          </div>

          {error && <p className="error">{error}</p>}

          <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
            <Link to={backPath} className="btn btn-ghost">Cancel</Link>
            <button type="submit" className="btn btn-secondary" disabled={saving}>
              {saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Add to trip')}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}
