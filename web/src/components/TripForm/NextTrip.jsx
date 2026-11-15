import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { formatCurrency } from '../../utils/currency.js'
import { buildTimeline, formatDay, formatDateRange, daysBetween, addDays, tripWhen } from '../../utils/trip.js'
import { useTripNow } from '../../utils/tripClock.js'
import { useGate } from '../../utils/pageGate.jsx'
import { swrOne } from '../../utils/cache.js'
import Icon from '../Icon/Icon.jsx'
import { tripIcon } from '../../utils/icons.js'
import { EntryRow, dayStates, quietDayEntries } from '../TripDay/TripDay.jsx'

const NONE = []
const SHOWN = 3

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

  // Today in the zone the schedule puts you in (utils/tripClock.js).
  const { day: now, time } = useTripNow(detail?.items || NONE, detail?.places || NONE)
  const nights = daysBetween(trip.startDate, trip.endDate)
  const when = tripWhen(trip, now)

  // What comes next, the same rows as the trip's days (TripDay/TripDay.jsx):
  // during the trip from now on (what is over today left out), before it
  // from the start; a handful, by day.
  const placeName = id => detail?.places.find(p => p.id === id)?.name
  const timeline = detail ? buildTimeline(trip, detail.items) : []
  const groups = []
  let count = 0
  for (const d of timeline.filter(d => d.day >= now)) {
    if (count >= SHOWN) break
    const live = d.day === now ? dayStates(now, time, d.entries) : null
    // A quiet today during a stay: where you sleep tonight.
    const entries = d.day === now && !d.entries.length ? quietDayEntries(d.sleepingAt)
      : d.entries.filter(e => !live || live.state(e) !== 'past')
    if (!entries.length) continue
    const shown = entries.slice(0, SHOWN - count)
    count += shown.length
    groups.push({ day: d.day, live, entries: shown })
  }
  const dayLabel = day => (day === now ? 'Today' : day === addDays(now, 1) ? 'Tomorrow' : formatDay(day))

  return (
    <Link to={`/trips/${trip.id}`} className="next-trip">
      <div className="next-trip-head">
        <span className="trip-card-icon" aria-hidden="true"><Icon name={tripIcon(trip)} /></span>
        <div className="next-trip-title">
          <span className="next-trip-label">{when.on ? 'Now' : 'Next up'}</span>
          <span className="next-trip-name">{trip.title}</span>
          <span className="next-trip-dates">
            {formatDateRange(trip.startDate, trip.endDate)}{nights > 0 && ` · ${nights} night${nights !== 1 ? 's' : ''}`}
            {trip.groupTitle && <span className="next-trip-group"><span className="next-trip-sep"> · </span>{trip.groupTitle}</span>}
          </span>
        </div>
        <span className={`trip-card-when${when.on ? ' now' : ''}`}>{when.label}</span>
      </div>

      {groups.length > 0 && (
        <div className="next-trip-days">
          {groups.map(g => (
            <div key={g.day} className="next-trip-day-group">
              <div className="next-trip-day">{dayLabel(g.day)}</div>
              <div className="list list-tight entry-list">
                {g.entries.map(e => (
                  <EntryRow key={`${e.item.id}-${e.phase}`} entry={e} state={g.live?.state(e)} placeName={placeName} showAside={false} />
                ))}
              </div>
            </div>
          ))}
        </div>
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
