import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import client from '../api/client'
import { KINDS, itemIcon, buildTimeline, describe, daysBetween, today } from '../utils/trip.js'

// Home's top card while a trip is on: what today holds, from the trip's own
// day list (same entries, same order), and where you sleep tonight. One card
// per trip happening today. Stays away if nothing loads, like the other panels.
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
  const navigate = useNavigate()
  const now = today()
  const day = buildTimeline(trip, items).find(d => d.day === now)
  const placeById = new Map(places.map(p => [p.id, p]))
  const placeName = id => placeById.get(id)?.name
  const dayNo = daysBetween(trip.startDate, now) + 1
  const total = daysBetween(trip.startDate, trip.endDate) + 1
  const entries = day?.entries || []
  const sleepingAt = day?.sleepingAt || []

  return (
    <div className="card today-trip">
      <Link to={`/trips/${trip.id}`} className="today-trip-head">
        <span className="today-trip-title">
          <span>{trip.icon || trip.groupIcon || '🧳'}</span>
          <span>Today in {trip.title}</span>
        </span>
        <span className="today-trip-day">Day {dayNo} of {total} ›</span>
      </Link>
      {entries.length === 0 ? (
        <div className="trip-day-empty">Nothing planned today</div>
      ) : (
        <div className="expense-list" style={{ marginBottom: 0 }}>
          {entries.map(({ item, time, phase }) => (
            <div key={`${item.id}-${phase}`} className="expense-item" onClick={() => navigate(`/trips/${trip.id}/items/${item.id}`)}>
              <div className="trip-entry-time">{time || 'All day'}</div>
              <div className="expense-icon">{itemIcon(item)}</div>
              <div className="expense-info">
                <div className="expense-name">{item.title}</div>
                <div className="expense-meta">
                  {[phase, describe(item, placeName)].filter(Boolean).join(' · ') || KINDS[item.kind].label}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {sleepingAt.length > 0 && (
        <div className="today-trip-night">🛏️ Tonight: {sleepingAt.map(s => s.title).join(', ')}</div>
      )}
    </div>
  )
}
