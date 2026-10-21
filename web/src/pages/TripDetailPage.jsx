import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { useParams, useNavigate, useLocation, Link } from 'react-router'
import client from '../api/client'
import FabButton from '../components/FabButton/FabButton.jsx'
import Loading from '../components/Loading.jsx'
import BackLink from '../components/BackLink.jsx'
import TripFormSheet from '../components/TripForm/TripFormSheet.jsx'
import { formatCurrency } from '../utils/currency.js'
import { KINDS, TRANSPORT_MODES, itemIcon, buildTimeline, formatDay, formatDateRange, daysBetween, today } from '../utils/trip.js'
import TripGantt from '../components/TripGantt/TripGantt.jsx'
import { useMediaQuery } from '../utils/useMediaQuery.js'

// Leaflet is only worth downloading once someone opens the map.
const TripMap = lazy(() => import('../components/TripMap/TripMap.jsx'))

// The second line of a timeline entry. Whatever the title already says (a
// hotel named after its place, a flight titled by its route) is left out.
const describe = (item, placeName) => {
  const parts = item.kind === 'transport'
    ? [
        [item.carrier, item.number].filter(Boolean).join(' '),
        [placeName(item.fromPlaceId), placeName(item.toPlaceId)].filter(Boolean).join(' → '),
      ]
    : [placeName(item.placeId)]
  return parts.filter(part => part && part !== item.title).join(' · ')
}

export default function TripDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { state } = useLocation()
  // From here on the day list and the map fit side by side, so no tabs.
  const wide = useMediaQuery('(min-width: 1180px)')

  const [trip, setTrip] = useState(null)
  const [items, setItems] = useState([])
  const [places, setPlaces] = useState([])
  const [tab, setTab] = useState('timeline')
  // Item ids under the pointer in the timeline or on the map; the other one lights them up.
  const [highlight, setHighlight] = useState(null)
  const [showKinds, setShowKinds] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data } = await client.get(`/trips/${id}`)
    setTrip(data.trip)
    setItems(data.items || [])
    setPlaces(data.places || [])
  }, [id])

  useEffect(() => {
    load().catch(() => setTrip(null)).finally(() => setLoading(false))
  }, [load])

  const openItem = useCallback(item => navigate(`/trips/${id}/items/${item.id}`), [navigate, id])

  const handleDelete = async () => {
    if (!window.confirm(`Delete "${trip.title}" with everything planned in it? Its expenses stay in the group. This cannot be undone.`)) return
    try {
      await client.delete(`/trips/${id}`)
      navigate('/trips')
    } catch { setError('Failed to delete the trip.') }
  }

  if (loading) return <Loading />
  if (!trip) return <div className="empty-state"><p className="empty-state-title">Trip not found.</p></div>

  const placeById = new Map(places.map(p => [p.id, p]))
  const placeName = placeId => placeById.get(placeId)?.name
  const timeline = buildTimeline(trip, items)
  const now = today()

  // Planned prices can be in several currencies and are never converted; what
  // was paid is already in the group's currency, like every balance.
  const planned = items.reduce((acc, i) => {
    if (i.price != null && i.currencyIso) acc[i.currencyIso] = (acc[i.currencyIso] ?? 0) + Number(i.price)
    return acc
  }, {})
  const paid = items.reduce((sum, i) => sum + Number(i.paidBase || 0), 0)
  const nights = daysBetween(trip.startDate, trip.endDate)

  const dayList = (
    <div className="trip-timeline">
      {timeline.map(({ day, entries, sleepingAt, outsideTrip }) => (
        <div key={day} className={`trip-day${day === now ? ' today' : ''}`}>
          <div className="trip-day-head">
            <span className="trip-day-name">{formatDay(day)}</span>
            <span className="trip-day-meta">
              {outsideTrip ? 'Outside the trip dates' : `Day ${daysBetween(trip.startDate, day) + 1}`}
              {sleepingAt.length > 0 && ` · 🛏️ ${sleepingAt.map(s => s.title).join(', ')}`}
            </span>
          </div>
          {entries.length === 0 ? (
            <div className="trip-day-empty">Nothing planned</div>
          ) : (
            <div className="expense-list" style={{ marginBottom: 0 }}>
              {entries.map(({ item, time, phase }) => (
                <div key={`${item.id}-${phase}`} className="expense-item" onClick={() => openItem(item)}>
                  <div className="trip-entry-time">{time || 'All day'}</div>
                  <div className="expense-icon">{itemIcon(item)}</div>
                  <div className="expense-info">
                    <div className="expense-name">{item.title}</div>
                    <div className="expense-meta">
                      {[phase, describe(item, placeName)].filter(Boolean).join(' · ') || KINDS[item.kind].label}
                    </div>
                  </div>
                  <div className="expense-amounts">
                    {item.price != null && item.currencyIso && (
                      <div className="expense-share">{formatCurrency(item.price, item.currencyIso)}</div>
                    )}
                    <div className="expense-total">
                      {item.expenseCount > 0 ? '✓ paid' : item.price != null ? 'not paid yet' : ''}
                      {item.attachmentCount > 0 && ` 📎${item.attachmentCount}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )

  const mapView = (
    <Suspense fallback={<Loading />}>
      <TripMap places={places} items={items} onOpenItem={openItem} highlight={highlight} onHover={setHighlight} />
      {places.some(p => p.lat == null) && (
        <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>
          Not on the map: {places.filter(p => p.lat == null).map(p => p.name).join(', ')}
        </p>
      )}
    </Suspense>
  )

  return (
    <>
      <div className="sub-header">
        <BackLink to="/trips" />
        <span className="sub-header-title">Trip</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="sub-header-del" style={{ color: 'var(--accent)' }} onClick={() => setShowEdit(true)}>Edit</button>
          <button className="sub-header-del" onClick={handleDelete}>Delete</button>
        </div>
      </div>

      <div className="group-info-bar">
        <div className="group-info-name">{trip.icon} {trip.title}</div>
        <div className="group-info-meta">
          <span className="group-info-count">
            {formatDateRange(trip.startDate, trip.endDate)}
            {nights > 0 && ` · ${nights} night${nights !== 1 ? 's' : ''}`}
            {' · '}
            <Link to={`/groups/${trip.groupId}`} style={{ color: 'var(--accent)' }}>{trip.groupIcon} {trip.groupTitle}</Link>
          </span>
        </div>
      </div>

      {state?.notice && <p className="error" style={{ background: 'var(--accent-light)', color: 'var(--accent)', borderColor: 'var(--accent-subtle)' }}>{state.notice}</p>}
      {error && <p className="error">{error}</p>}

      {trip.notes && <p className="trip-notes">{trip.notes}</p>}

      {(Object.keys(planned).length > 0 || paid > 0) && (
        <div className="trip-costs">
          <div>
            <div className="trip-costs-label">Planned</div>
            <div className="trip-costs-value">
              {Object.keys(planned).length === 0 ? '—' : Object.entries(planned).map(([iso, amount]) => formatCurrency(amount, iso)).join(' + ')}
            </div>
          </div>
          <div>
            <div className="trip-costs-label">Paid so far</div>
            <div className="trip-costs-value">{formatCurrency(paid, trip.groupIso)}</div>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="empty-state" style={{ padding: '32px 24px' }}>
          <img src="/cat-empty.svg" alt="" style={{ width: 80, height: 80 }} />
          <p style={{ color: 'var(--text-3)', fontSize: 14 }}>Nothing planned yet. Add a flight, a stay or something to do.</p>
        </div>
      ) : (
        <TripGantt trip={trip} items={items} placeName={placeName} onOpenItem={openItem} highlight={highlight} onHover={setHighlight} />
      )}

      {wide ? (
        <div className="trip-split">
          <div>
            <div className="section-label">Day by day</div>
            {items.length > 0 && dayList}
          </div>
          <div className="trip-split-map">
            <div className="section-label">Map {places.length > 0 && `· ${places.length}`}</div>
            {mapView}
          </div>
        </div>
      ) : (
        <>
          <div className="filter-chips">
            <button className={`chip${tab === 'timeline' ? ' active' : ''}`} onClick={() => setTab('timeline')}>Day by day</button>
            <button className={`chip${tab === 'map' ? ' active' : ''}`} onClick={() => setTab('map')}>
              Map {places.length > 0 && `· ${places.length}`}
            </button>
          </div>
          {tab === 'timeline' && items.length > 0 && dayList}
          {tab === 'map' && mapView}
        </>
      )}

      <FabButton onClick={() => setShowKinds(true)} label="Add to trip" />

      {showKinds && (
        <div className="sheet-overlay" onClick={e => { if (e.target === e.currentTarget) setShowKinds(false) }}>
          <div className="sheet">
            <div className="sheet-handle" />
            <p className="sheet-title">Add to trip</p>
            <div className="trip-kind-grid">
              {TRANSPORT_MODES.filter(m => m.value !== 'other').map(m => (
                <button key={m.value} className="trip-kind" onClick={() => navigate(`/trips/${id}/items/new?kind=transport&mode=${m.value}`)}>
                  <span>{m.icon}</span>{m.label}
                </button>
              ))}
              <button className="trip-kind" onClick={() => navigate(`/trips/${id}/items/new?kind=transport&mode=other`)}>
                <span>{KINDS.transport.icon}</span>Other transport
              </button>
              <button className="trip-kind" onClick={() => navigate(`/trips/${id}/items/new?kind=stay`)}>
                <span>{KINDS.stay.icon}</span>Stay
              </button>
              <button className="trip-kind" onClick={() => navigate(`/trips/${id}/items/new?kind=activity`)}>
                <span>{KINDS.activity.icon}</span>Activity
              </button>
            </div>
            <button className="btn btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={() => setShowKinds(false)}>Cancel</button>
          </div>
        </div>
      )}

      {showEdit && (
        <TripFormSheet
          trip={trip}
          onClose={() => setShowEdit(false)}
          onSaved={async () => { setShowEdit(false); await load() }}
        />
      )}
    </>
  )
}
