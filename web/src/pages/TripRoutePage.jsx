import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router'
import client from '../api/client'
import Loading from '../components/Loading.jsx'
import BackLink from '../components/BackLink.jsx'
import PlacePicker from '../components/PlacePicker/PlacePicker.jsx'
import ConnectionCard from '../components/TripRoute/ConnectionCard.jsx'
import ConfirmConnection from '../components/TripRoute/ConfirmConnection.jsx'
import Expandable from '../components/Expandable/Expandable.jsx'
import { dayOf, timeOf, today, daysBetween, formatDay } from '../utils/trip.js'
import { useMediaQuery } from '../utils/useMediaQuery.js'

const RouteMap = lazy(() => import('../components/TripRoute/RouteMap.jsx'))

const MODES = [
  { value: 'all',  label: 'All' },
  { value: 'rail', label: '🚆 Rail' },
  { value: 'bus',  label: '🚌 Bus' },
]

// Beyond this many days ahead an empty answer more likely means "timetable not published yet" (Taiwan: ~8 weeks).
const FAR_AHEAD_DAYS = 28

const MOMENT = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/
const validMoment = m => (MOMENT.test(m || '') ? m : null)

// A place slot as the API wants it: a place of the trip by id, or a searched one by position.
const endParam = ref => (ref?.id ? ref.id : ref?.lat != null ? `${ref.lat},${ref.lon}` : null)

const connectionKey = it => `${it.departure}|${it.arrival}|${it.legs.map(l => `${l.start}${l.line}`).join(',')}`

// Find public-transport connections between two places (Transitous) and add
// the chosen one's legs to the trip as transport items. Times are local to the
// stops, as on every other item. ?when= (and ?by=, the end of a range dragged
// out on the timeline, used for "arrive by"), ?from= and ?to= (place ids)
// prefill the search; so do places handed over in the location state.
export default function TripRoutePage() {
  const { tripId } = useParams()
  const [searchParams] = useSearchParams()
  const { state } = useLocation()
  const navigate = useNavigate()
  const wide = useMediaQuery('(min-width: 1180px)')
  const resultsRef = useRef(null)

  const [places, setPlaces] = useState([])
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [prefill, setPrefill] = useState({ depart: null, arrive: null })
  const [form, setForm] = useState({ from: null, to: null, date: '', time: '', arriveBy: false, modes: 'all' })
  const [result, setResult] = useState(null) // { query, itineraries, previousCursor, nextCursor }
  const [searching, setSearching] = useState(null) // 'search' | 'earlier' | 'later'
  const [error, setError] = useState('')
  const [chosen, setChosen] = useState(null)
  // The connection highlighted on the map: under the pointer, or else the one
  // tapped (on the map, or with a card's Map button). Kept by key, not by
  // index, so earlier connections added on top do not shift it.
  const [hoverKey, setHoverKey] = useState(null)
  const [selectedKey, setSelectedKey] = useState(null)
  const [view, setView] = useState('list') // below 1180px: 'list' | 'map'

  useEffect(() => {
    client.get(`/trips/${tripId}`).then(({ data }) => {
      const { trip, items = [], places: tripPlaces = [] } = data
      setPlaces(tripPlaces)

      const now = today()
      const fallbackDay = now >= trip.startDate && now <= trip.endDate ? now : trip.startDate
      const when = validMoment(searchParams.get('when'))
      const by = validMoment(searchParams.get('by'))
      const depart = when ? (when.length === 16 ? when : `${when}T09:00`) : `${fallbackDay}T09:00`
      const arrive = by?.length === 16 ? by : null
      setPrefill({ depart, arrive })

      // Leaving the stay that ends that day for the one that starts it is the
      // usual travel day; only a guess, and only for places on the map.
      const day = dayOf(depart)
      const located = id => tripPlaces.some(p => p.id === id && p.lat != null)
      const placeParam = name => (located(searchParams.get(name)) ? { id: searchParams.get(name) } : null)
      const leaving = items.find(i => i.kind === 'stay' && dayOf(i.end) === day && located(i.placeId))
      const arriving = items.find(i => i.kind === 'stay' && dayOf(i.start) === day && located(i.placeId) && i.placeId !== leaving?.placeId)

      setForm(f => ({
        ...f,
        from: state?.from ?? placeParam('from') ?? (leaving ? { id: leaving.placeId } : null),
        to: state?.to ?? placeParam('to') ?? (arriving ? { id: arriving.placeId } : null),
        date: dayOf(depart),
        time: timeOf(depart),
      }))
    }).catch(() => setMissing(true)).finally(() => setLoading(false))
  }, [tripId])

  const set = patch => setForm(f => ({ ...f, ...patch }))

  // Switching between "depart after" and "arrive by" takes the other end of a
  // dragged range along, as long as the time was not changed by hand.
  const setArriveBy = arriveBy => {
    if (arriveBy === form.arriveBy) return
    const current = `${form.date}T${form.time}`
    const [was, next] = arriveBy ? [prefill.depart, prefill.arrive] : [prefill.arrive, prefill.depart]
    set({ arriveBy, ...(next && current === was ? { date: dayOf(next), time: timeOf(next) } : {}) })
  }

  const run = async (query, direction) => {
    setSearching(direction ?? 'search')
    setError('')
    try {
      const cursor = direction === 'earlier' ? result?.previousCursor : direction === 'later' ? result?.nextCursor : null
      // Pages continue the search as it was answered, widened or not.
      const { data } = await client.get(`/trips/${tripId}/routes`, {
        params: { ...query, ...(cursor && { cursor, ...(result.widened && { wide: 1 }) }) },
      })
      if (!direction) {
        setResult({ query, ...data })
        setHoverKey(null)
        setSelectedKey(null)
        if (!wide) setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
        return
      }
      setResult(prev => {
        const seen = new Set(prev.itineraries.map(connectionKey))
        const fresh = data.itineraries.filter(it => !seen.has(connectionKey(it)))
        return direction === 'earlier'
          ? { ...prev, itineraries: [...fresh, ...prev.itineraries], previousCursor: data.previousCursor }
          : { ...prev, itineraries: [...prev.itineraries, ...fresh], nextCursor: data.nextCursor }
      })
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not search for connections.')
    } finally {
      setSearching(null)
    }
  }

  const handleSearch = e => {
    e.preventDefault()
    if (searching) return
    const from = endParam(form.from), to = endParam(form.to)
    if (!form.from || !form.to) { setError('Pick where you leave from and where you go to.'); return }
    if (!from || !to) { setError('Pick a place found by searching, so it has a position on the map.'); return }
    if (!form.date || !form.time) { setError('Pick a date and a time.'); return }
    setChosen(null)
    run({ from, to, when: `${form.date}T${form.time}`, arriveBy: form.arriveBy ? 1 : 0, modes: form.modes })
  }

  const swap = () => set({ from: form.to, to: form.from })

  if (loading) return <Loading />
  if (missing) return <div className="empty-state"><p className="empty-state-title">Trip not found.</p></div>

  const header = (
    <div className="sub-header">
      <BackLink to={`/trips/${tripId}`} />
      <span className="sub-header-title">Find a route</span>
      <span aria-hidden="true" />
    </div>
  )

  if (chosen) {
    return (
      <div className="route-page">
        {header}
        <ConfirmConnection
          tripId={tripId}
          itinerary={chosen}
          onBack={() => setChosen(null)}
          onSaved={n => navigate(`/trips/${tripId}`, { replace: true, state: { notice: `Added ${n} item${n !== 1 ? 's' : ''} from the connection.` } })}
        />
      </div>
    )
  }

  const searchForm = (
    <form className="card route-form" onSubmit={handleSearch}>
      <div className="form-group">
        <label>From</label>
        <PlacePicker value={form.from} onChange={from => set({ from })} places={places} placeholder="Station, hotel, address…" />
      </div>
      <div className="route-swap-row">
        <button type="button" className="route-swap" onClick={swap} aria-label="Swap from and to">⇅ Swap</button>
      </div>
      <div className="form-group">
        <label>To</label>
        <PlacePicker value={form.to} onChange={to => set({ to })} places={places} placeholder="Station, hotel, address…" />
      </div>

      <div className="filter-chips" style={{ paddingTop: 0 }}>
        <button type="button" className={`chip${!form.arriveBy ? ' active' : ''}`} onClick={() => setArriveBy(false)}>Depart after</button>
        <button type="button" className={`chip${form.arriveBy ? ' active' : ''}`} onClick={() => setArriveBy(true)}>Arrive by</button>
      </div>

      <div className="form-row form-row-compact form-row-when">
        <div className="form-group">
          <label>Date</label>
          <input type="date" value={form.date} onChange={e => set({ date: e.target.value })} required />
        </div>
        <div className="form-group">
          <label>Time <span className="label-optional">{form.arriveBy ? 'at the destination' : 'at the start'}</span></label>
          <input type="time" value={form.time} onChange={e => set({ time: e.target.value })} required />
        </div>
      </div>

      <div className="form-group">
        <label>By</label>
        <div className="filter-chips" style={{ padding: 0 }}>
          {MODES.map(m => (
            <button key={m.value} type="button" className={`chip${form.modes === m.value ? ' active' : ''}`} onClick={() => set({ modes: m.value })}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <button type="submit" className="btn btn-primary" disabled={Boolean(searching)}>
        {searching === 'search' ? 'Searching…' : 'Search connections'}
      </button>
    </form>
  )

  const itineraries = result?.itineraries ?? []
  const keyAt = i => (i == null || !itineraries[i] ? null : connectionKey(itineraries[i]))
  const indexOf = key => (key ? itineraries.findIndex(it => connectionKey(it) === key) : -1)
  const highlightIndex = [indexOf(hoverKey), indexOf(selectedKey)].find(i => i >= 0) ?? null
  const showMap = itineraries.length > 0
  const pickOnMap = i => {
    setSelectedKey(keyAt(i))
    // Side by side, the list follows the map to the connection picked there.
    if (wide) document.querySelectorAll('.route-results .route-card')[i]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  const mapView = showMap && (
    <Suspense fallback={<Loading />}>
      <Expandable label="Connections · Map">
        <RouteMap itineraries={itineraries} highlight={highlightIndex} onHover={i => setHoverKey(keyAt(i))} onSelect={pickOnMap} />
      </Expandable>
    </Suspense>
  )

  const card = (it, extra = {}) => (
    <ConnectionCard
      key={connectionKey(it)}
      itinerary={it}
      searchDay={result.query.when.slice(0, 10)}
      onChoose={setChosen}
      active={showMap && connectionKey(it) === keyAt(highlightIndex)}
      onHover={on => setHoverKey(on ? connectionKey(it) : null)}
      {...extra}
    />
  )

  const list = (
    <>
      {result?.previousCursor && (
        <button type="button" className="btn btn-ghost btn-sm route-page-btn" onClick={() => run(result.query, 'earlier')} disabled={Boolean(searching)}>
          {searching === 'earlier' ? 'Searching…' : '↑ Earlier'}
        </button>
      )}
      {itineraries.map(it => card(it, wide ? {} : { onShowOnMap: () => { setSelectedKey(connectionKey(it)); setView('map') } }))}
      {result?.nextCursor && (
        <button type="button" className="btn btn-ghost btn-sm route-page-btn" onClick={() => run(result.query, 'later')} disabled={Boolean(searching)}>
          {searching === 'later' ? 'Searching…' : '↓ Later'}
        </button>
      )}
    </>
  )

  // Below 1180px the map takes the list's place, with the picked connection under it.
  const narrowMap = (
    <>
      {mapView}
      <div className="route-map-pick">
        {indexOf(selectedKey) >= 0
          ? card(itineraries[indexOf(selectedKey)])
          : <p className="route-hint">Tap a line to see that connection.</p>}
      </div>
    </>
  )

  const results = result && (
    <div ref={resultsRef} className="route-results">
      {!wide && showMap ? (
        <div className="filter-chips route-view-chips">
          <button type="button" className={`chip${view === 'list' ? ' active' : ''}`} onClick={() => setView('list')}>List · {itineraries.length}</button>
          <button type="button" className={`chip${view === 'map' ? ' active' : ''}`} onClick={() => setView('map')}>Map</button>
        </div>
      ) : (
        <div className="section-label">Connections</div>
      )}
      {itineraries.length === 0 ? (
        <div className="trip-day-empty route-empty">
          {daysBetween(today(), result.query.when.slice(0, 10)) > FAR_AHEAD_DAYS ? (
            <>
              No connections found for {formatDay(result.query.when.slice(0, 10))}. Operators publish their open
              timetables only a few weeks to months ahead, so they may not be out yet for a date this far away.
              Check again closer to the date, or try a date sooner to see whether these places are covered at all.
            </>
          ) : (
            <>
              No connections found. There may be no public transport between these places at that time, or the
              operators there may not publish open timetable data (coverage differs by region and by kind of
              transport). Try “All”, another time, or a station as the start or destination.
            </>
          )}
        </div>
      ) : (
        <>
          {result.widened && (
            <p className="route-hint">
              Nothing leaves or arrives right at these places, so stops up to {result.widenedMetres / 1000} km away
              are included. Walking times to them are estimates.
            </p>
          )}
          {!wide && view === 'map' ? narrowMap : list}
        </>
      )}
      <p className="route-attribution">
        Timetables via <a href="https://transitous.org/sources/" target="_blank" rel="noopener noreferrer">Transitous and its sources</a>
        {' · '}<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a>
      </p>
    </div>
  )

  return (
    <div className="route-page">
      {header}
      <div className="route-layout">
        <div className="route-layout-main">
          {searchForm}
          {results}
        </div>
        {wide && (
          <div className="route-layout-map">
            {showMap ? mapView : !result && (
              <p className="route-hint route-intro">
                Public transport between two places, from the community timetables of{' '}
                <a href="https://transitous.org/sources/" target="_blank" rel="noopener noreferrer">Transitous</a>.
                Pick a connection to add its trains, buses and ferries to the trip.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
