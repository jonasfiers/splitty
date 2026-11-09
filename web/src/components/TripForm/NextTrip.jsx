import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { formatCurrency } from '../../utils/currency.js'
import { buildTimeline, describe, itemIcon, formatDay, formatDateRange, daysBetween, today } from '../../utils/trip.js'
import { useGate } from '../../utils/pageGate.jsx'
import { swrOne } from '../../utils/cache.js'

// The trip that is on, or the next one: what comes first, at a glance.
// It loads the trip's items itself; until then (or if that fails) it shows
// what the trips list already knows.
export default function NextTrip({ trip }) {
  const [detail, setDetail] = useState(null) // { items, places, paid, iso }
  const [docCount, setDocCount] = useState(null)
  const gate = useGate() // the Trips page shows once this card is filled (utils/pageGate.jsx)

  useEffect(() => {
    // The last state at once (utils/cache.js); the page waits only for what wasn't kept.
    const a = swrOne(`/trips/${trip.id}`, ({ data }) => setDetail({ items: data.items || [], places: data.places || [], paid: Number(data.trip?.paidBase || 0), iso: data.trip?.groupIso }))
    const b = swrOne(`/trips/${trip.id}/documents`, ({ data }) => setDocCount(data.documents.length))
    for (const { cached, fresh } of [a, b]) {
      const done = fresh.catch(() => {})
      if (!cached) gate(done)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id])

  const now = today()
  const on = trip.startDate <= now
  const nights = daysBetween(trip.startDate, trip.endDate)
  const when = on
    ? `Day ${daysBetween(trip.startDate, now) + 1} of ${nights + 1}`
    : (d => (d === 1 ? 'Tomorrow' : `In ${d} days`))(daysBetween(now, trip.startDate))

  // What comes next: during the trip from today, before it from the start;
  // a handful of entries, by day.
  const placeName = id => detail?.places.find(p => p.id === id)?.name
  const days = detail ? buildTimeline(trip, detail.items).filter(d => d.day >= now && d.entries.length) : []
  const next = []
  for (const d of days) {
    for (const e of d.entries) if (next.length < 3) next.push({ day: d.day, ...e })
    if (next.length >= 3) break
  }

  return (
    <Link to={`/trips/${trip.id}`} className="next-trip">
      <div className="next-trip-head">
        <span className="trip-card-icon" aria-hidden="true">{trip.icon || '🧳'}</span>
        <div className="next-trip-title">
          <span className="next-trip-label">{on ? 'Now' : 'Next up'}</span>
          <span className="next-trip-name">{trip.title}</span>
          <span className="next-trip-dates">
            {formatDateRange(trip.startDate, trip.endDate)}{nights > 0 && ` · ${nights} night${nights !== 1 ? 's' : ''}`}
            {trip.groupTitle && <span className="next-trip-group"><span className="next-trip-sep"> · </span>{trip.groupIcon ? `${trip.groupIcon} ` : ''}{trip.groupTitle}</span>}
          </span>
        </div>
        <span className={`trip-card-when${on ? ' now' : ''}`}>{when}</span>
      </div>

      {next.length > 0 && (
        <ul className="next-trip-items">
          {next.map((e, i) => (
            <li key={`${e.item.id}-${e.phase}`} className="next-trip-item">
              <span className="next-trip-day">{i === 0 || next[i - 1].day !== e.day ? (e.day === now ? 'Today' : formatDay(e.day)) : ''}</span>
              <span className="next-trip-time">{e.time || 'All day'}</span>
              <span className="next-trip-icon" aria-hidden="true">{itemIcon(e.item)}</span>
              <span className="next-trip-what">
                {e.item.title}
                {/* The phase changes what the line means (check-out, not in);
                    the place is extra, left out on a phone. */}
                {e.phase && <span className="next-trip-phase"> · {e.phase}</span>}
                {describe(e.item, placeName) && <span className="next-trip-meta"> · {describe(e.item, placeName)}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="next-trip-foot">
        <span>
          {trip.itemCount} item{trip.itemCount !== 1 ? 's' : ''}
          {docCount > 0 && ` · ${docCount} document${docCount !== 1 ? 's' : ''}`}
          {detail?.paid > 0 && ` · ${formatCurrency(detail.paid, detail.iso)} paid`}
        </span>
        <span className="next-trip-open">Open trip ›</span>
      </div>
    </Link>
  )
}
