import { useEffect, useState } from 'react'
import { today, DEFAULT_CHECK_IN } from './trip.js'

// "Now" during a trip, in the zone where the schedule puts you.
//
// Chrome keeps the time zone a page started with: open the installed app in
// Taipei after flying from Brussels and the phone's clock (getHours) can still
// read Brussels time. The moment itself (Date.now) is right; only the zone is
// stale. Trip times are wall-clock at the place they happen, so the schedule
// says which zone you are in: the zone of the last thing that has happened
// (a departure keeps you in its zone until the arrival), or of the first one
// still to come. Each place carries its zone (`tz`, from the API). Without any
// timed entry at a place with a zone, the phone's own clock is used.

export const pad = n => String(n).padStart(2, '0')
export const clock = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }

const formatters = new Map()
const partsIn = (ms, zone) => {
  if (!formatters.has(zone)) {
    formatters.set(zone, new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }))
  }
  const p = {}
  for (const { type, value } of formatters.get(zone).formatToParts(ms)) p[type] = value
  return p
}

// Wall-clock day and time in `zone` at `ms`, or null for an unknown zone.
export function wallClockIn(zone, ms = Date.now()) {
  try {
    const p = partsIn(ms, zone)
    return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, zone }
  } catch {
    return null
  }
}

// The zone's offset from UTC at `ms`, in milliseconds.
const offsetAt = (ms, zone) => {
  const p = partsIn(ms, zone)
  return Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(ms / 60000) * 60000
}

// 'YYYY-MM-DDTHH:MM' read in `zone`, as a moment (ms). Twice, for DST edges.
export function zonedToUtc(moment, zone) {
  const [d, t] = moment.split('T')
  const [y, mo, day] = d.split('-').map(Number)
  const [h, mi] = t.split(':').map(Number)
  const guess = Date.UTC(y, mo - 1, day, h, mi)
  const first = guess - offsetAt(guess, zone)
  return guess - offsetAt(first, zone)
}

const timed = m => (m?.length > 10 ? m : null)

// The trip's timed entries at places with a zone, as { at (ms), zone }, in order.
export function zoneEvents(items, places) {
  const zoneOf = new Map(places.map(p => [p.id, p.tz]))
  const events = []
  const add = (moment, placeId) => {
    const zone = zoneOf.get(placeId)
    if (!moment || !zone) return
    try { events.push({ at: zonedToUtc(moment, zone), zone }) } catch { /* unknown zone */ }
  }
  for (const item of items) {
    if (item.kind === 'transport') {
      add(timed(item.start), item.fromPlaceId)
      add(timed(item.end), item.toPlaceId)
    } else if (item.kind === 'stay') {
      // A stay entered without times checks in at the usual hour, as on the day list.
      add(timed(item.start) || (item.start ? `${item.start.slice(0, 10)}T${DEFAULT_CHECK_IN}` : null), item.placeId)
    } else {
      add(timed(item.start), item.placeId)
    }
  }
  return events.sort((a, b) => a.at - b.at)
}

// The zone the schedule puts you in at `ms`, or null when it can't tell.
export function scheduleZone(items, places, ms = Date.now()) {
  const events = zoneEvents(items, places)
  if (!events.length) return null
  let zone = events[0].zone
  for (const e of events) {
    if (e.at > ms) break
    zone = e.zone
  }
  return zone
}

// { day, time, zone } now: in the schedule's zone, else the phone's (zone null).
export function tripNow(items, places, ms = Date.now()) {
  const zone = scheduleZone(items, places, ms)
  return (zone && wallClockIn(zone, ms)) || { day: today(), time: clock(), zone: null }
}

// Calls `fn` on the minute, and right away when the app comes back to the
// screen: a phone freezes a page in the background, and its timers don't
// catch up, so a page opened at noon would still say noon in the evening.
export function onMinute(fn) {
  let t
  const schedule = () => {
    clearTimeout(t)
    t = setTimeout(() => { fn(); schedule() }, 60000 - (Date.now() % 60000) + 50)
  }
  const resume = () => { if (document.visibilityState !== 'hidden') { fn(); schedule() } }
  schedule()
  document.addEventListener('visibilitychange', resume)
  window.addEventListener('focus', resume)
  window.addEventListener('pageshow', resume)
  return () => {
    clearTimeout(t)
    document.removeEventListener('visibilitychange', resume)
    window.removeEventListener('focus', resume)
    window.removeEventListener('pageshow', resume)
  }
}

const same = (a, b) => a.day === b.day && a.time === b.time && a.zone === b.zone

// The trip's now, ticking every minute and current again on coming back.
export function useTripNow(items, places) {
  const [now, setNow] = useState(() => tripNow(items, places))
  useEffect(() => {
    const update = () => { const n = tripNow(items, places); setNow(prev => (same(prev, n) ? prev : n)) }
    update()
    return onMinute(update)
  }, [items, places])
  return now
}
