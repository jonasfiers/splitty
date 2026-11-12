import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import LoadFailed from '../components/LoadFailed.jsx'
import { useParams, useNavigate, useLocation, useSearchParams, Link } from 'react-router'
import { syncTrip } from '../utils/offlineDocs.js'
import client from '../api/client'
import FabButton from '../components/FabButton/FabButton.jsx'
import Loading from '../components/Loading.jsx'
import PageHeader from '../components/PageHeader/PageHeader.jsx'
import TripFormSheet from '../components/TripForm/TripFormSheet.jsx'
import DuplicateTripSheet from '../components/TripForm/DuplicateTripSheet.jsx'
import QuickAddSheet from '../components/TripForm/QuickAddSheet.jsx'
import { formatCurrency } from '../utils/currency.js'
import { KINDS, TRANSPORT_MODES, itemIcon, buildTimeline, describe, formatDay, formatDateRange, formatMoment, daysBetween, today } from '../utils/trip.js'
import TripGantt from '../components/TripGantt/TripGantt.jsx'
import Expandable from '../components/Expandable/Expandable.jsx'
import { useMediaQuery } from '../utils/useMediaQuery.js'
import Sheet, { SheetActions } from '../components/Sheet/Sheet.jsx'
import TodayEntries, { quietDayEntries } from '../components/TodayEntries.jsx'
import { useTripNow } from '../utils/tripClock.js'
import Segmented from '../components/Segmented/Segmented.jsx'
import { leaveTo } from '../utils/history.js'
import { useConfirm } from '../components/Confirm/ConfirmProvider.jsx'
import EmptyState from '../components/EmptyState/EmptyState.jsx'
import { waitAtMost } from '../utils/pageGate.jsx'
import { swrOne } from '../utils/cache.js'
import { getOfflineTrip, asOf } from '../utils/offlineTrips.js'
import { useOffline, isOffline, isNetworkError, onReconnect } from '../utils/connection.js'
import OfflinePlaces from '../components/OfflinePlaces.jsx'

// Leaflet is only worth downloading once someone opens the map.
const TripMap = lazy(() => import('../components/TripMap/TripMap.jsx'))


// A new trip id (e.g. after copying) remounts the page, so nothing of the
// previous trip's state carries over.
export default function TripDetailPageForId() {
  const { id } = useParams()
  return <TripDetailPage key={id} />
}

function TripDetailPage() {
  const confirm = useConfirm()
  const { id } = useParams()
  const navigate = useNavigate()
  const { state } = useLocation()
  // From here on the day list and the map fit side by side, so no tabs.
  const wide = useMediaQuery('(min-width: 1180px)')

  const [trip, setTrip] = useState(null)
  const [items, setItems] = useState([])
  const [places, setPlaces] = useState([])
  // Today and its clock in the zone the schedule puts you in (utils/tripClock.js).
  const { day: now, time: nowTime } = useTripNow(items, places)
  // Narrower than that: Plan (the day list, opening on today), Timeline or
  // Map. Kept in the URL, so coming back from an item lands on the same view.
  const [searchParams, setSearchParams] = useSearchParams()
  const view = ['timeline', 'map'].includes(searchParams.get('view')) ? searchParams.get('view') : 'plan'
  const setView = v => setSearchParams(v === 'plan' ? {} : { view: v }, { replace: true })
  // Item ids under the pointer in the timeline or on the map; the other one lights them up.
  const [highlight, setHighlight] = useState(null)
  const [showKinds, setShowKinds] = useState(false)
  const [showPast, setShowPast] = useState(false) // during the trip: the days before today
  // A range dragged out (or a day tapped) on the timeline: { kind, start, end }.
  const [quickAdd, setQuickAdd] = useState(null)
  const [added, setAdded] = useState(null) // title of the item just added that way
  // The last bar moved on the timeline, offered for undo for a few seconds.
  const [moved, setMoved] = useState(null) // { item, before: { start, end } }
  const [showEdit, setShowEdit] = useState(false)
  const [showCopy, setShowCopy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Shown from the copy kept on this device (utils/offlineTrips.js): when it
  // was saved. Without a connection nothing can be changed, whichever copy
  // is on screen.
  const [offlineAsOf, setOfflineAsOf] = useState(null)
  const offline = useOffline()
  const readOnly = offline || !!offlineAsOf

  // How many documents this user sees here, for the chip (the list itself
  // is on the Documents page). Quiet on failure: the chip just has no count.
  // The same list also tidies this trip's copies kept on the device: one
  // deleted or made private by its owner goes (utils/offlineDocs.js).
  const [docIds, setDocIds] = useState(null)
  const loadDocs = useCallback(({ fresh = true } = {}) => {
    const { cached, fresh: answer } = swrOne(`/trips/${id}/documents`, ({ data }) => setDocIds(data.documents.map(d => d.id)), { fresh })
    return cached ? Promise.resolve() : answer.catch(() => {})
  }, [id])
  const docCount = docIds?.length ?? 0
  useEffect(() => {
    if (docIds && trip?.title) syncTrip({ id, title: trip.title }, docIds).catch(() => {})
  }, [docIds, trip?.title, id])

  // With the documents count, so the chip doesn't change after the page shows;
  // it waits for that at most 1.5 s (utils/pageGate.jsx).
  // Opening it shows the last state at once and refreshes it (utils/cache.js);
  // a reload after a change (the default) asks the server only.
  const load = useCallback(async ({ fresh = true } = {}) => {
    const { cached, fresh: answer } = swrOne(`/trips/${id}`, ({ data }) => {
      setTrip(data.trip)
      setItems(data.items || [])
      setPlaces(data.places || [])
      setOfflineAsOf(null)
    }, { fresh })
    if (cached) setLoading(false)
    const docs = loadDocs({ fresh })
    const showKept = kept => {
      setTrip(kept.trip)
      setItems(kept.items)
      setPlaces(kept.places)
      setDocIds((kept.documents ?? []).map(d => d.id))
      setOfflineAsOf(kept.savedAt)
    }
    // Known to be offline: the copy kept on this device at once, rather
    // than after the request has failed (a server answer still replaces it).
    let shown = cached
    if (!shown && isOffline()) {
      const kept = await getOfflineTrip(id)
      if (kept) { showKept(kept); setLoading(false); shown = true }
    }
    // With something on screen a failed refresh changes nothing. No answer
    // at all and nothing on screen: the copy kept on this device.
    const fromDevice = async err => {
      if (shown) return
      const kept = isNetworkError(err) && await getOfflineTrip(id)
      if (!kept) throw err
      showKept(kept)
    }
    await Promise.all([answer.catch(fromDevice), waitAtMost(docs)])
  }, [id, loadDocs])

  // Loading failed (not "no such trip": that is a 404): the "couldn't load"
  // state, not "Trip not found.".
  const [loadError, setLoadError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => { setLoadError(null); setLoading(true); setAttempt(n => n + 1) }, [])
  useEffect(() => {
    load({ fresh: attempt > 0 }).catch(err => { setTrip(null); if (err.response?.status !== 404) setLoadError(err) }).finally(() => setLoading(false))
  }, [load, attempt])

  // Back online: the server's version replaces the kept copy.
  useEffect(() => {
    if (!offlineAsOf) return
    return onReconnect(() => { load().catch(() => {}) })
  }, [offlineAsOf, load])

  const openItem = useCallback(item => navigate(`/trips/${id}/items/${item.id}`), [navigate, id])

  const newItemUrl = (kind, { mode, start, end, title } = {}) => {
    const q = new URLSearchParams({ kind, ...(mode && { mode }), ...(start && { start }), ...(end && { end }), ...(title && { title }) })
    return `/trips/${id}/items/new?${q}`
  }
  // Dragging a bar saves at once; the page shows the new times straight away
  // and puts them back if the server refuses.
  const reschedule = async (item, when) => {
    const before = { start: item.start, end: item.end ?? null }
    setItems(prev => prev.map(i => (i.id === item.id ? { ...i, ...when } : i)))
    try {
      await client.patch(`/trips/items/${item.id}/when`, when)
      setMoved({ item: { ...item, ...when }, before })
    } catch (err) {
      setItems(prev => prev.map(i => (i.id === item.id ? { ...i, ...before } : i)))
      setError(err.response?.data?.error || `Could not move "${item.title}".`)
    }
  }
  const undoMove = async () => {
    if (!moved) return
    const { item, before } = moved
    setMoved(null)
    await reschedule(item, before)
    setMoved(null)
  }
  useEffect(() => {
    if (!moved) return
    const t = setTimeout(() => setMoved(null), 6000)
    return () => clearTimeout(t)
  }, [moved])

  // Deleting from the timeline has no confirm dialog: the item leaves the page
  // at once and is only deleted on the server after a few seconds, so Undo is
  // just cancelling that. Leaving the page sends it straight away.
  const [removed, setRemoved] = useState(null) // { item, timer }
  const removedRef = useRef(null)
  const sendDelete = useCallback(async item => {
    try { await client.delete(`/trips/items/${item.id}`) } catch {
      setItems(prev => (prev.some(i => i.id === item.id) ? prev : [...prev, item]))
      setError(`Could not delete "${item.title}".`)
    }
  }, [])
  // Returns the delete request, so a caller can wait until the server has it.
  const flushRemoved = useCallback(() => {
    const r = removedRef.current
    if (!r) return Promise.resolve()
    removedRef.current = null
    clearTimeout(r.timer)
    setRemoved(null)
    return sendDelete(r.item)
  }, [sendDelete])
  const removeItem = item => {
    flushRemoved()
    setItems(prev => prev.filter(i => i.id !== item.id))
    const r = { item, timer: setTimeout(flushRemoved, 6000) }
    removedRef.current = r
    setRemoved(r)
  }
  const undoRemove = () => {
    const r = removedRef.current
    if (!r) return
    removedRef.current = null
    clearTimeout(r.timer)
    setRemoved(null)
    setItems(prev => [...prev, r.item])
  }
  useEffect(() => flushRemoved, [flushRemoved])

  // A copy is made from what the server has, so a pending delete goes out
  // (and is done) first, and no Undo of the original lingers.
  const openCopy = async () => {
    setMoved(null)
    await flushRemoved()
    setShowCopy(true)
  }

  // The route planner, from the add sheet or with a range dragged out on the
  // timeline (its start to depart after, its end to arrive by).
  const findRoute = ({ start, end, from, to } = {}) => {
    const q = new URLSearchParams({ ...(start && { when: start }), ...(end && { by: end }) })
    navigate(`/trips/${id}/route${q.toString() ? `?${q}` : ''}`, { state: { from, to, fromTrip: true } })
  }

  const createFromTimeline = range => setQuickAdd(range)
  const quickAdded = async title => {
    setQuickAdd(null)
    await load()
    setAdded(title)
  }
  useEffect(() => {
    if (!added) return
    const t = setTimeout(() => setAdded(null), 4000)
    return () => clearTimeout(t)
  }, [added])

  const handleDelete = async () => {
    if (!(await confirm({ title: `Delete "${trip.title}"?`, message: 'Everything planned in it goes too. Its expenses stay in the group. This cannot be undone.', confirmLabel: 'Delete trip', danger: true }))) return
    try {
      await client.delete(`/trips/${id}`)
      leaveTo(navigate, '/trips')
    } catch { setError('Failed to delete the trip.') }
  }

  // While loading or when it fails: the bar with its way back stays.
  const bare = <PageHeader compact crumbs={[{ to: '/trips', label: 'Trips' }]} name="Trip" />
  if (loading) return <>{bare}<Loading /></>
  if (loadError) return <>{bare}<LoadFailed error={loadError} what="this trip" onRetry={retry} /></>
  if (!trip) return <>{bare}<EmptyState art={false} title="Trip not found" /></>

  const placeById = new Map(places.map(p => [p.id, p]))
  const placeName = placeId => placeById.get(placeId)?.name
  const timeline = buildTimeline(trip, items)

  // What has been paid for the trip, counted by the server so an expense linked
  // to several items (both legs of a connecting flight) counts once.
  const paid = Number(trip.paidBase || 0)
  const nights = daysBetween(trip.startDate, trip.endDate)

  // While the trip is on, the day list opens on today: earlier days fold away
  // behind a link (whole days, so today itself is always complete).
  const onTrip = trip.startDate <= now && now <= trip.endDate
  const pastDays = onTrip ? timeline.filter(d => d.day < now).length : 0
  const shownDays = pastDays && !showPast ? timeline.filter(d => d.day >= now) : timeline

  const dayList = (
    <div className="trip-timeline">
      {pastDays > 0 && (
        <button type="button" className="trip-past-toggle" onClick={() => setShowPast(v => !v)} aria-expanded={showPast}>
          {showPast ? 'Hide earlier days' : `Show ${pastDays} earlier day${pastDays !== 1 ? 's' : ''}`}
        </button>
      )}
      {shownDays.map(({ day, entries, sleepingAt, outsideTrip }) => (
        <div key={day} className={`trip-day${day === now ? ' today' : ''}`}>
          <div className="trip-day-head">
            <span className="trip-day-name">{formatDay(day)}</span>
            <span className="trip-day-meta">
              {outsideTrip ? 'Outside the trip dates' : `Day ${daysBetween(trip.startDate, day) + 1}`}
              {sleepingAt.length > 0 && ` · 🛏️ ${sleepingAt.map(s => s.title).join(', ')}`}
            </span>
          </div>
          {day === now && entries.length === 0 && sleepingAt.length > 0 ? (
            // An empty today during a stay: the hotel, live like the rest of today.
            <TodayEntries tripId={id} day={day} time={nowTime} entries={quietDayEntries(sleepingAt)} places={places} />
          ) : entries.length === 0 ? (
            <div className="trip-day-empty">Nothing planned</div>
          ) : day === now ? (
            // Today is live, the same rows as Home's Today card.
            <TodayEntries tripId={id} day={day} time={nowTime} entries={entries} places={places} />
          ) : (
            <div className="list list-tight">
              {entries.map(({ item, time, phase, assumed }) => (
                <button key={`${item.id}-${phase}`} type="button" className="list-row list-row-link" onClick={() => openItem(item)}>
                  <span className={`trip-entry-time${assumed ? ' assumed' : ''}`} title={assumed ? 'Usual hotel time; no time set on this stay' : undefined}>{time || 'All day'}</span>
                  <span className="list-row-icon" aria-hidden="true">{itemIcon(item)}</span>
                  <span className="list-row-text">
                    <span className="list-row-title">{item.title}</span>
                    <span className="list-row-meta">
                      {[phase, describe(item, placeName)].filter(Boolean).join(' · ') || KINDS[item.kind].label}
                    </span>
                  </span>
                  <span className="list-row-aside">
                    <span className="list-row-sub">
                      {item.expenseCount > 0 ? '✓ paid' : ''}
                      {item.attachmentCount > 0 && ` 📎${item.attachmentCount}`}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )

  const emptyPlan = (
    <EmptyState compact title="Nothing planned yet">Add a flight, a stay or something to do.</EmptyState>
  )

  const ganttView = (
    <Expandable
      label={`${trip.title} · Timeline`}
      splitKey="trip-timeline"
      extra={!readOnly && places.some(p => p.lat != null) && (
        <Suspense fallback={<Loading />}>
          <TripMap places={places} items={items} onOpenItem={openItem} highlight={highlight} onHover={setHighlight} />
        </Suspense>
      )}
    >
      <TripGantt trip={trip} items={items} placeName={placeName} onOpenItem={openItem} {...(!readOnly && { onCreate: createFromTimeline, onReschedule: reschedule, onDelete: removeItem })} highlight={highlight} onHover={setHighlight} />
    </Expandable>
  )

  // Without a connection there are no map tiles: the places as a list.
  const mapView = readOnly ? <OfflinePlaces places={places} items={items} onOpenItem={openItem} /> : (
    <Suspense fallback={<Loading />}>
      <Expandable label={`${trip.title} · Map`}>
        <TripMap places={places} items={items} onOpenItem={openItem} highlight={highlight} onHover={setHighlight} />
      </Expandable>
      {places.some(p => p.lat == null) && (
        <p className="field-note">
          Not on the map: {places.filter(p => p.lat == null).map(p => p.name).join(', ')}
        </p>
      )}
    </Suspense>
  )

  return (
    <>
      <PageHeader
        crumbs={[{ to: '/trips', label: 'Trips' }]}
        title={<>{trip.icon} {trip.title}</>}
        name={trip.title}
        actions={readOnly ? [] : [
          { label: 'Edit', onClick: () => setShowEdit(true), primary: true },
          { label: 'Copy trip', onClick: openCopy },
          { label: 'Delete trip', onClick: handleDelete, danger: true },
        ]}
      >
        {formatDateRange(trip.startDate, trip.endDate)}
        {nights > 0 && ` · ${nights} night${nights !== 1 ? 's' : ''}`}
        {' · '}
        <Link to={`/groups/${trip.groupId}`} className="accent-link">{trip.groupIcon} {trip.groupTitle}</Link>
      </PageHeader>

      {/* Documents and money: a row of chips, so the page opens on the plan. */}
      <div className="trip-chips">
        <Link to={`/trips/${id}/documents`} className="trip-chip">
          <span aria-hidden="true">📄</span> Documents{docCount ? ` · ${docCount}` : ''} <span className="trip-chip-chevron" aria-hidden="true">›</span>
        </Link>
        {paid > 0 && (
          <span className="trip-paid" title="Paid so far, in the group's currency">
            {formatCurrency(paid, trip.groupIso)} paid
          </span>
        )}
      </div>

      {readOnly && (
        <p className="offline-copy-note" role="status">
          {offlineAsOf ? <>Offline · {asOf(offlineAsOf)}</> : 'Offline'}
          <span> · changes need a connection</span>
        </p>
      )}
      {state?.notice && <p className="notice">{state.notice}</p>}
      {error && <p className="error">{error}</p>}

      {trip.notes && <p className="trip-notes">{trip.notes}</p>}


      {wide ? (
        <>
        {ganttView}
        <div className="trip-split">
          <div>
            <div className="section-label">Day by day</div>
            {items.length > 0 ? dayList : emptyPlan}
          </div>
          <div className="trip-split-map">
            <div className="section-label">Map {places.length > 0 && `· ${places.length}`}</div>
            {mapView}
          </div>
        </div>
        </>
      ) : (
        <>
          <Segmented
            label="Show"
            value={view}
            onChange={setView}
            options={[
              { value: 'plan', label: 'Plan' },
              { value: 'timeline', label: 'Timeline' },
              { value: 'map', label: places.length > 0 ? `Map · ${places.length}` : 'Map' },
            ]}
          />
          {view === 'plan' && (items.length > 0 ? dayList : emptyPlan)}
          {view === 'timeline' && ganttView}
          {view === 'map' && mapView}
        </>
      )}

      {!readOnly && <FabButton onClick={() => setShowKinds(true)} label="Add to trip" />}

      {moved && !removed && (
        <div className="trip-toast" role="status">
          <span>Moved “{moved.item.title}” to {formatMoment(moved.item.start)}</span>
          <button type="button" onClick={undoMove}>Undo</button>
        </div>
      )}

      {removed && (
        <div className="trip-toast" role="status">
          <span>Deleted “{removed.item.title}”</span>
          <button type="button" onClick={undoRemove}>Undo</button>
        </div>
      )}

      {added && !moved && !removed && (
        <div className="trip-toast" role="status"><span>Added “{added}”</span></div>
      )}

      {quickAdd && (
        <QuickAddSheet
          tripId={id}
          {...quickAdd}
          places={places}
          onClose={() => setQuickAdd(null)}
          onSaved={quickAdded}
          onMore={({ kind, ...rest }) => navigate(newItemUrl(kind, rest))}
          onFindRoute={findRoute}
        />
      )}

      {showKinds && (
        <Sheet title="Add to trip" onClose={() => setShowKinds(false)}>
          <div className="trip-kind-grid">
            <button className="trip-kind trip-kind-wide" onClick={() => findRoute()}>
              <span>🔎</span>Find a public-transport route
            </button>
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
          <SheetActions><button className="btn btn-ghost" onClick={() => setShowKinds(false)}>Cancel</button></SheetActions>
        </Sheet>
      )}

      {showCopy && (
        <DuplicateTripSheet
          trip={trip}
          onClose={() => setShowCopy(false)}
          onCopied={(newId, title) => { setShowCopy(false); navigate(`/trips/${newId}`, { state: { notice: `Copied to "${title}". You are looking at the copy.` } }) }}
        />
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
