import { Fragment, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { KINDS, itemIcon, itemColour, describe, mapsLink, linkTarget, formatDay, daysBetween } from '../../utils/trip.js'
import BigReference from '../BigReference/BigReference.jsx'
import { pad, clock, onMinute } from '../../utils/tripClock.js'
import Icon from '../Icon/Icon.jsx'
import { formatCurrency } from '../../utils/currency.js'

export { pad, clock }

// A trip's day, drawn one way everywhere: the trip page's days, Home's Today
// card and the Trips page's next-trip card all use these.
//
//   TripDayBody  a day's entries (or "Nothing planned", or tonight's hotel on
//                a quiet day), and the Tonight line under a live today
//   DayEntries   the entries on their line; live (today) it knows what is
//                over, on now and next, folds what is over and gives the rest
//                their booking code and directions
//   EntryRow     one entry: time (and Now/next badge), dot, icon, title,
//                what and where, paid and attachments
//   EntryNode    the dot on the day's line, in the entry's kind colour
//   Tonight      where you sleep tonight, with its booking code and directions
//
// Live means against a clock: `time` is the trip's now (utils/tripClock.js,
// in the schedule's zone); trip times are local wall-clock, like the phone on
// the spot.
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

// An item with a start time but no end (a dinner, a train entered without
// its arrival) counts as under way for an hour, not as past a minute in.
// A stay is never under way: it spans days, and would sit as "Now" next to
// whatever you are actually doing. Its check-in and check-out are moments
// (a countdown before, then done), like any other timed entry.
const endOf = item => (item.end?.length > 10 ? item.end : item.start?.length > 10 ? plusMinutes(item.start, NO_END_MINUTES) : null)
const isOnAt = (item, moment) => item.kind !== 'stay' && item.start?.length > 10 && item.start <= moment && moment < endOf(item)

// Whether today still holds something timed: an entry to come or one under way.
export const moreToday = (day, time, entries) =>
  entries.some(e => (e.time && e.time > time) || isOnAt(e.item, `${day}T${time}`))

// Where each of a live day's entries stands. Now: under way (started, not
// ended). Next: the first timed entry still to come. Over: timed, before now
// and not under way (a check-in too: the hotel stays on the Tonight line).
// Once everything timed is over, the last of it stays in view (`keep`).
export function dayStates(day, time, entries) {
  const moment = `${day}T${time}`
  const on = e => isOnAt(e.item, moment)
  const over = e => !on(e) && e.time && e.time <= time
  const next = entries.find(e => e.time && e.time > time && !on(e))
  const overs = entries.filter(over)
  const keep = entries.every(e => !e.time || over(e)) ? overs[overs.length - 1] : null
  return {
    state: e => (on(e) ? 'now' : over(e) ? 'past' : null),
    next,
    folded: overs.length - (keep ? 1 : 0),
    keep,
  }
}

// A day with nothing planned during a stay: the stay itself, as tonight's row
// (a stay only has entries on its first and last day), so its booking code
// and the way back stay a tap away.
export const quietDayEntries = sleepingAt => sleepingAt.map(item => ({ item, time: '', label: 'Tonight', phase: 'Staying' }))

// The dot on the day's line, in the entry's kind colour (utils/trip.js
// itemColour: the matching category's): a ring while still to come, filled
// (and a bit bigger) while on now, washed out once over. An all-day entry
// sits off the line: it is not a moment in the day's order.
export function EntryNode({ item, state, allDay = false }) {
  return (
    <span className={`entry-node${state ? ` ${state}` : ''}${allDay ? ' allday' : ''}`} style={{ '--kind': `var(--cat-${itemColour(item) ?? 'slate'})` }} aria-hidden="true">
      <span className="entry-dot" />
    </span>
  )
}

// A booking reference (opens full screen) and directions, as two chips.
function Actions({ item, place, onBigRef }) {
  const link = mapsLink(place)
  if (!item.confirmationRef && !link) return null
  return (
    <span className="today-actions">
      {item.confirmationRef && (
        <button type="button" className="today-ref" onClick={() => onBigRef(item)} title="Show big" aria-label={`Show booking reference ${item.confirmationRef} full screen`}>
          <span>{item.confirmationRef}</span>
        </button>
      )}
      {link && (
        <a className="today-nav" href={link.url} target={linkTarget(link.url)} rel="noopener noreferrer" title={link.label} aria-label={`${link.label}: ${place?.name ?? item.title}`}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l18-8-8 18-2-8-8-2z" /></svg>
          Go
        </a>
      )}
    </span>
  )
}

// One entry. `to` makes it open the item (the whole row); without it, it is
// plain (inside a card that is a link itself). `actions` is the third line.
// On the right, on the title's line: what was paid for it (in the group's
// currency, `iso`) and a paperclip for its files (counted from two).
export function EntryRow({ entry, state, badge, to, placeName, actions, iso, showAside = true }) {
  const { item, time, phase, assumed, label } = entry
  const title = to
    ? <Link to={to} className="list-row-title list-row-stretch">{item.title}</Link>
    : <span className="list-row-title">{item.title}</span>
  return (
    <div className={`list-row entry-row${to ? ' list-row-link' : ''}${state ? ` ${state}` : ''}`}>
      <div className="entry-when">
        <span className={`trip-entry-time${time ? '' : ' allday'}${assumed ? ' assumed' : ''}`} title={assumed ? 'Usual hotel time; no time set on this stay' : undefined}>
          {time || label || 'All day'}
        </span>
        {badge}
      </div>
      <EntryNode item={item} state={state} allDay={!time} />
      <span className="entry-icon" aria-hidden="true"><Icon name={itemIcon(item, phase)} /></span>
      <div className="list-row-text">
        {title}
        <div className="list-row-meta entry-meta">
          {[phase, describe(item, placeName)].filter(Boolean).join(' · ') || KINDS[item.kind].label}
        </div>
        {actions}
      </div>
      {showAside && (item.expenseCount > 0 || item.attachmentCount > 0) && (
        <span className="list-row-aside entry-aside">
          {item.expenseCount > 0 && <span className="entry-paid">{formatCurrency(item.paidBase, iso)}</span>}
          {item.attachmentCount > 0 && (
            <span className="entry-files" title={`${item.attachmentCount} file${item.attachmentCount !== 1 ? 's' : ''}`}>
              <Icon name="paperclip" label={`${item.attachmentCount} file${item.attachmentCount !== 1 ? 's' : ''}`} />{item.attachmentCount > 1 && item.attachmentCount}
            </span>
          )}
        </span>
      )}
    </div>
  )
}

// A day's entries on their line. Live (`time` given): over, now and next,
// what is over folded away behind one line, booking codes and directions on
// what is not over yet. Otherwise the plan: all over if `past`.
export function DayEntries({ tripId, day, entries, places, time, iso, past = false }) {
  const [bigRef, setBigRef] = useState(null)
  const [showFolded, setShowFolded] = useState(false)
  const closeBigRef = useCallback(() => setBigRef(null), [])
  const placeById = new Map(places.map(p => [p.id, p]))
  const placeName = id => placeById.get(id)?.name
  const live = time != null ? dayStates(day, time, entries) : null
  // Folded entries go where the timed part of the day starts.
  const firstTimed = entries.find(e => e.time)

  return (
    <>
      <div className="list list-tight entry-list">
        {entries.map(entry => {
          const { item, phase } = entry
          const state = live ? live.state(entry) : past ? 'past' : null
          const hidden = live && state === 'past' && !showFolded && entry !== live.keep
          const badge = live && (state === 'now'
            ? <span className="today-badge">Now</span>
            : entry === live.next ? <span className="today-badge next">{countdown(minutes(entry.time) - minutes(time))}</span> : null)
          return (
            <Fragment key={`${item.id}-${phase}`}>
              {live && entry === firstTimed && live.folded > 0 && (
                <button type="button" className="today-earlier" onClick={() => setShowFolded(v => !v)} aria-expanded={showFolded}>
                  {showFolded ? 'Hide earlier' : `Show ${live.folded} earlier`}
                </button>
              )}
              {!hidden && (
                <EntryRow
                  entry={entry}
                  state={state}
                  badge={badge}
                  to={`/trips/${tripId}/items/${item.id}`}
                  placeName={placeName}
                  iso={iso}
                  // What is over is history: no code or directions (the row
                  // still opens the item; tonight's hotel is on Tonight).
                  actions={live && state !== 'past' && <Actions item={item} place={placeById.get(placeOf(item, phase))} onBigRef={setBigRef} />}
                />
              )}
            </Fragment>
          )
        })}
      </div>
      {bigRef && <BigReference value={bigRef.confirmationRef} label={`${bigRef.title} · Booking reference`} onClose={closeBigRef} />}
    </>
  )
}

// Where you sleep tonight, under today's entries: each hotel with its booking
// code and directions, there all evening, however late you arrive (the
// check-in row itself folds away once its time has passed).
export function Tonight({ stays, places }) {
  const [bigRef, setBigRef] = useState(null)
  const closeBigRef = useCallback(() => setBigRef(null), [])
  const placeById = new Map(places.map(p => [p.id, p]))
  return (
    <div className="tonight">
      {stays.map(stay => (
        <div key={stay.id} className="tonight-row">
          <span className="tonight-name"><Icon name="bed-double" /> Tonight: {stay.title}</span>
          <Actions item={stay} place={placeById.get(stay.placeId)} onBigRef={setBigRef} />
        </div>
      ))}
      {bigRef && <BigReference value={bigRef.confirmationRef} label={`${bigRef.title} · Booking reference`} onClose={closeBigRef} />}
    </div>
  )
}

// A day of the trip (utils/trip.js buildTimeline): its entries, or "Nothing
// planned", or, on a quiet day of a stay that is today, the hotel itself as
// the day's row. Today (`time` given) is live, with Tonight under it.
export function TripDayBody({ tripId, day: { day, entries, sleepingAt }, places, time, iso, past = false, nothing = 'Nothing planned' }) {
  const live = time != null
  if (!entries.length) {
    return live && sleepingAt.length
      ? <DayEntries tripId={tripId} day={day} entries={quietDayEntries(sleepingAt)} places={places} time={time} iso={iso} />
      : <div className="trip-day-empty">{nothing}</div>
  }
  return (
    <>
      <DayEntries tripId={tripId} day={day} entries={entries} places={places} time={time} iso={iso} past={past} />
      {live && sleepingAt.length > 0 && <Tonight stays={sleepingAt} places={places} />}
    </>
  )
}

// A day's heading on the trip page: the date, which day of the trip, and
// where you sleep.
export function DayHead({ trip, day: { day, sleepingAt, outsideTrip } }) {
  return (
    <div className="trip-day-head">
      <span className="trip-day-name">{formatDay(day)}</span>
      <span className="trip-day-meta">
        {outsideTrip ? 'Outside the trip dates' : `Day ${daysBetween(trip.startDate, day) + 1}`}
        {sleepingAt.length > 0 && <> · <Icon name="bed-double" /> {sleepingAt.map(s => s.title).join(', ')}</>}
      </span>
    </div>
  )
}
