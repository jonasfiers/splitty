import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import client from '../api/client'
import { itemIcon, buildTimeline, daysBetween, today, addDays } from '../utils/trip.js'
import TodayEntries, { useClock } from './TodayEntries.jsx'

// Home's top card while a trip is on: what today holds, from the trip's own
// day list (same entries, same order), and where you sleep tonight. One card
// per trip happening today. Stays away if nothing loads, like the other panels.
//
// The rows are TodayEntries (live: now, next, booking code, directions), the
// same as the trip page's today. In the evening, tomorrow's first entry too.
const EVENING = '18:00'

export const isActive = (trip, day = today()) => trip.startDate <= day && day <= trip.endDate

export default function TodayTrip() {
  const [trips, setTrips] = useState([])

  useEffect(() => {
    let live = true
    client.get('/trips').then(async ({ data }) => {
      const active = (data.trips || []).filter(t => isActive(t))
      const full = await Promise.all(active.map(t => client.get(`/trips/${t.id}`).then(r => r.data).catch(() => null)))
      if (live) setTrips(full.filter(Boolean))
    }).catch(() => {})
    return () => { live = false }
  }, [])

  return trips.map(t => <TodayCard key={t.trip.id} trip={t.trip} items={t.items || []} places={t.places || []} />)
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
