import { Fragment, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { KINDS, itemIcon, describe, mapsLink, linkTarget, today } from '../utils/trip.js'
import BigReference from './BigReference/BigReference.jsx'
import { pad, clock, onMinute } from '../utils/tripClock.js'

export { pad, clock }

// Today's entries as live rows: against the phone's clock (trip times are
// local wall-clock, like the phone on the spot) what is on now, a countdown to
// what is next, earlier entries folded away; each with its booking reference
// (full screen) and directions a tap away. Shared by Home's Today card and the
// trip page's today, so the same day never looks two ways ("today is live,
// every other day is the plan").
const NO_END_MINUTES = 60

// 'YYYY-MM-DDTHH:MM' plus some minutes, as local wall-clock time again.
const plusMinutes = (moment, mins) => {
  const [d, t] = moment.split('T')
  const [y, mo, day] = d.split('-').map(Number)
  const [h, mi] = t.split(':').map(Number)
  const x = new Date(y, mo - 1, day, h, mi + mins)
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`
}

const minutes = hhmm => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
const countdown = mins => (mins < 60 ? `in ${mins} min` : `in ${Math.floor(mins / 60)} h${mins % 60 ? ` ${pad(mins % 60)}` : ''}`)

// The place an entry is about: where a journey leaves from (or, for its
// arrival, where it ends), otherwise the item's own place.
const placeOf = (item, phase) =>
  item.kind === 'transport' ? (phase === 'Arrival' ? item.toPlaceId : item.fromPlaceId) : item.placeId


// The clock, ticking every minute (and current again on coming back).
export function useClock() {
  const [time, setTime] = useState(clock)
  useEffect(() => onMinute(() => setTime(clock())), [])
  return time
}

// Today's date, changing at midnight (or on coming back the next day).
export function useToday() {
  const [day, setDay] = useState(today)
  useEffect(() => onMinute(() => setDay(today())), [])
  return day
}

// `time` is the trip's now (utils/tripClock.js, in the schedule's zone);
// without it, the phone's clock.
// A day with nothing planned during a stay: the stay itself, as tonight's row
// (a stay only has entries on its first and last day), so its booking code
// and the way back stay a tap away.
export const quietDayEntries = sleepingAt => sleepingAt.map(item => ({ item, time: '', label: 'Tonight', phase: 'Staying' }))

export default function TodayEntries({ tripId, day, entries, places, time: tripTime }) {
  const phoneTime = useClock()
  const time = tripTime ?? phoneTime
  const [bigRef, setBigRef] = useState(null)
  const [showPast, setShowPast] = useState(false)
  const closeBigRef = useCallback(() => setBigRef(null), [])
  const placeById = new Map(places.map(p => [p.id, p]))
  const placeName = id => placeById.get(id)?.name

  // Now: an item under way (started, not ended). Next: the first timed entry
  // still to come. Past: timed entries before now that are not under way.
  const moment = `${day}T${time}`
  // An item with a start time but no end (a dinner, a train entered without
  // its arrival) counts as under way for an hour, not as past a minute in.
  const endOf = item => (item.end?.length > 10 ? item.end : item.start?.length > 10 ? plusMinutes(item.start, NO_END_MINUTES) : null)
  const isOn = item => item.start?.length > 10 && item.start <= moment && moment < endOf(item)
  const next = entries.find(e => e.time && e.time > time && !isOn(e.item))
  // Check-in is "from" its time: the row (and the hotel's booking code) stays
  // until the day is over, however late you arrive.
  const isPast = e => !isOn(e.item) && e.phase !== 'Check-in' && e.time && e.time <= time
  const pastCount = entries.filter(isPast).length
  // Earlier entries fold into one line where the timed part of the day starts.
  const firstTimed = entries.find(e => e.time)

  return (
    <>
      <div className="list list-tight today-list">
          {entries.map(entry => {
            const { item, time: at, phase } = entry
            const on = isOn(item)
            const past = isPast(entry)
            const link = mapsLink(placeById.get(placeOf(item, phase)))
            return (
              <Fragment key={`${item.id}-${phase}`}>
              {entry === firstTimed && pastCount > 0 && (
                <button type="button" className="today-earlier" onClick={() => setShowPast(v => !v)} aria-expanded={showPast}>
                  {showPast ? 'Hide earlier' : `Show ${pastCount} earlier`}
                </button>
              )}
              {(!past || showPast) && (
              <div className={`list-row list-row-link today-entry${past ? ' past' : ''}${on ? ' on' : ''}`}>
                <div className="today-when">
                  <div className={`trip-entry-time${at ? '' : ' allday'}${entry.assumed ? ' assumed' : ''}`} title={entry.assumed ? 'Usual hotel time; no time set on this stay' : undefined}>{at || entry.label || 'All day'}</div>
                  {on && <span className="today-badge">Now</span>}
                  {entry === next && <span className="today-badge next">{countdown(minutes(at) - minutes(time))}</span>}
                  <div className="today-icon">{itemIcon(item)}</div>
                </div>
                <div className="list-row-text">
                  <Link to={`/trips/${tripId}/items/${item.id}`} className="list-row-title list-row-stretch">{item.title}</Link>
                  <div className="list-row-meta today-meta">
                    {[phase, describe(item, placeName)].filter(Boolean).join(' · ') || KINDS[item.kind].label}
                  </div>
                  {(item.confirmationRef || link) && (
                    <div className="today-actions">
                      {item.confirmationRef && (
                        <button type="button" className="today-ref" onClick={() => setBigRef(item)} title="Show big" aria-label={`Show booking reference ${item.confirmationRef} full screen`}>
                          <span>{item.confirmationRef}</span>
                        </button>
                      )}
                      {link && (
                        <a className="today-nav" href={link.url} target={linkTarget(link.url)} rel="noopener noreferrer" title={link.label} aria-label={`${link.label}: ${placeName(placeOf(item, phase))}`}>
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l18-8-8 18-2-8-8-2z" /></svg>
                          Go
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </div>
              )}
              </Fragment>
            )
          })}
        </div>
      {bigRef && <BigReference value={bigRef.confirmationRef} label={`${bigRef.title} · Booking reference`} onClose={closeBigRef} />}
    </>
  )
}
