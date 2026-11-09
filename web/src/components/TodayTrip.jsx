import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { itemIcon, buildTimeline, daysBetween, today, addDays } from '../utils/trip.js'
import TodayEntries, { useClock } from './TodayEntries.jsx'
import { useGate } from '../utils/pageGate.jsx'
import { swrOne } from '../utils/cache.js'

// Home's top card while a trip is on: what today holds, from the trip's own
// day list (same entries, same order), and where you sleep tonight. One card
// per trip happening today. Stays away if nothing loads, like the other panels.
//
// The rows are TodayEntries (live: now, next, booking code, directions), the
// same as the trip page's today. In the evening, tomorrow's first entry too.
const EVENING = '18:00'

export const isActive = (trip, day = today()) => trip.startDate <= day && day <= trip.endDate

export default function TodayTrip() {
  const [active, setActive] = useState([]) // ids of the trips that are on today
  const [details, setDetails] = useState({}) // id -> { trip, items, places }
  const gate = useGate()

  // The trips, then each one that is on: the last state at once, then fresh
  // (utils/cache.js); Home waits only for what wasn't kept.
  useEffect(() => {
    let live = true
    const loadTrip = id => {
      const { cached, fresh } = swrOne(`/trips/${id}`, r => { if (live) setDetails(d => ({ ...d, [id]: r.data })) })
      return cached ? Promise.resolve() : fresh.catch(() => {})
    }
    const asked = new Set()
    let details = Promise.resolve() // the trips-that-are-on still loading
    const { cached, fresh } = swrOne('/trips', ({ data }) => {
      const ids = (data.trips || []).filter(t => isActive(t)).map(t => t.id)
      if (!live) return
      setActive(ids)
      const fresh = ids.filter(id => !asked.has(id))
      fresh.forEach(id => asked.add(id))
      details = Promise.all([details, ...fresh.map(loadTrip)])
    })
    // Home waits for the list and the trips that are on (unless they were kept).
    if (!cached) gate(fresh.then(() => details).catch(() => {}))
    return () => { live = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return active.filter(id => details[id]).map(id => {
    const t = details[id]
    return <TodayCard key={id} trip={t.trip} items={t.items || []} places={t.places || []} />
  })
}

function TodayCard({ trip, items, places }) {
  const time = useClock()
  const now = today()
  const timeline = buildTimeline(trip, items)
  const day = timeline.find(d => d.day === now)
  const tomorrow = timeline.find(d => d.day === addDays(now, 1))
  const dayNo = daysBetween(trip.startDate, now) + 1
  const total = daysBetween(trip.startDate, trip.endDate) + 1
  const entries = day?.entries || []
  const sleepingAt = day?.sleepingAt || []
  const firstTomorrow = time >= EVENING && tomorrow?.entries.length
    ? tomorrow.entries.find(e => e.time) || tomorrow.entries[0]
    : null

  return (
    <div className="card today-trip">
      <Link to={`/trips/${trip.id}`} className="today-trip-head">
        <span className="today-trip-title">
          <span>{trip.icon || trip.groupIcon || '🧳'}</span>
          <span className="today-trip-name">Today in {trip.title}</span>
        </span>
        <span className="today-trip-day">Day {dayNo} of {total} ›</span>
      </Link>
      {entries.length === 0 ? (
        <div className="trip-day-empty">Nothing planned today</div>
      ) : (
        <TodayEntries tripId={trip.id} day={now} entries={entries} places={places} />
      )}
      {sleepingAt.length > 0 && (
        <div className="today-trip-night">🛏️ Tonight: {sleepingAt.map(s => s.title).join(', ')}</div>
      )}
      {firstTomorrow && (
        <Link to={`/trips/${trip.id}/items/${firstTomorrow.item.id}`} className="today-trip-tomorrow">
          Tomorrow {firstTomorrow.time || ''} · {itemIcon(firstTomorrow.item)} {[firstTomorrow.phase, firstTomorrow.item.title].filter(Boolean).join(' ')} ›
        </Link>
      )}
    </div>
  )
}
