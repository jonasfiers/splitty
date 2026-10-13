// Trip times are local wall-clock strings as printed on the ticket:
// 'YYYY-MM-DD' (all day) or 'YYYY-MM-DDTHH:mm'. No timezone is stored, so
// nothing here may run them through a timezone-aware Date; day arithmetic is
// done in UTC purely as a calendar.

export const KINDS = {
  transport: { label: 'Transport', icon: '🧭' },
  stay:      { label: 'Stay',      icon: '🛏️' },
  activity:  { label: 'Activity',  icon: '🎟️' },
}

export const TRANSPORT_MODES = [
  { value: 'flight', label: 'Flight', icon: '✈️' },
  { value: 'train',  label: 'Train',  icon: '🚆' },
  { value: 'car',    label: 'Car',    icon: '🚗' },
  { value: 'bus',    label: 'Bus',    icon: '🚌' },
  { value: 'ferry',  label: 'Ferry',  icon: '⛴️' },
  { value: 'other',  label: 'Other',  icon: '🧭' },
]

export const itemIcon = item =>
  item.kind === 'transport'
    ? (TRANSPORT_MODES.find(m => m.value === item.mode)?.icon ?? KINDS.transport.icon)
    : KINDS[item.kind]?.icon ?? '•'

export const dayOf = moment => (moment ? moment.slice(0, 10) : '')
export const timeOf = moment => (moment && moment.length > 10 ? moment.slice(11, 16) : '')

const asUtc = day => new Date(`${day}T00:00:00Z`)

export const addDays = (day, n) => {
  const d = asUtc(day)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export const daysBetween = (from, to) => Math.round((asUtc(to) - asUtc(from)) / 86400000)

export const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const formatDay = (day, options = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  day ? new Intl.DateTimeFormat(navigator.language, { ...options, timeZone: 'UTC' }).format(asUtc(day)) : ''

export const formatDateRange = (start, end) => {
  if (!start) return ''
  if (!end || end === start) return formatDay(start, { day: 'numeric', month: 'short', year: 'numeric' })
  const sameYear = start.slice(0, 4) === end.slice(0, 4)
  return `${formatDay(start, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })} – ${formatDay(end, { day: 'numeric', month: 'short', year: 'numeric' })}`
}

export const formatMoment = moment => {
  if (!moment) return ''
  const time = timeOf(moment)
  return `${formatDay(dayOf(moment))}${time ? ` · ${time}` : ''}`
}

// The itinerary is derived, never stored: one entry per day from the first to
// the last day that matters, each holding what happens on it. A stay shows on
// the day you check in and the day you check out, and is named in the header
// of every night in between.
export function buildTimeline(trip, items) {
  const days = [trip.startDate, trip.endDate, ...items.flatMap(i => [dayOf(i.start), dayOf(i.end)])].filter(Boolean).sort()
  if (days.length === 0) return []
  const first = days[0], last = days[days.length - 1]

  const timeline = []
  for (let day = first; day <= last; day = addDays(day, 1)) {
    const entries = []
    for (const item of items) {
      const start = dayOf(item.start), end = dayOf(item.end)
      if (start === day) {
        entries.push({ item, time: timeOf(item.start), phase: item.kind === 'stay' ? 'Check-in' : null })
      } else if (item.kind === 'stay' && end === day) {
        entries.push({ item, time: timeOf(item.end), phase: 'Check-out' })
      } else if (item.kind !== 'stay' && end === day) {
        entries.push({ item, time: timeOf(item.end), phase: item.kind === 'transport' ? 'Arrival' : 'Ends' })
      }
    }
    // Timed entries in order; all-day ones first.
    entries.sort((a, b) => a.time.localeCompare(b.time))
    const sleepingAt = items.filter(i => i.kind === 'stay' && dayOf(i.start) <= day && day < (dayOf(i.end) || dayOf(i.start)))
    timeline.push({ day, entries, sleepingAt, outsideTrip: day < trip.startDate || day > trip.endDate })
  }
  return timeline
}

export const mapsUrl = place =>
  place?.lat != null && place?.lon != null
    ? `https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lon}#map=16/${place.lat}/${place.lon}`
    : null

export const formatBytes = bytes =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} kB`
