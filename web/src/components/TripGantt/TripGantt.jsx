import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { addDays, daysBetween, dayOf, timeOf, formatDay, itemIcon, today } from '../../utils/trip.js'
import './TripGantt.css'

// The trip at a glance: days run left to right, with one lane each for where
// you sleep, how you travel and what you do. Bars sit at their real date and
// time; anything given as a whole day (no time) spans that day instead.
//
// Times are the trip's own wall-clock strings (see utils/trip.js), so a
// position is just "days since the first column + hour of day / 24".

const LANES = [
  { kind: 'stay', label: 'Stay' },
  { kind: 'transport', label: 'Travel' },
  { kind: 'activity', label: 'Do' },
]
// A stay given without times runs from mid-afternoon to late morning, which is
// how it reads at a glance: one bar per night.
const DEFAULT_CHECK_IN = 15
const DEFAULT_CHECK_OUT = 11
const MIN_BAR = 0.12 // of a day, so short or instant items stay clickable
const LABEL_W = 64
const MIN_DAY_W = 96 // narrower than this and bar titles stop being readable
// Zoom range: ~100 px an hour at the wide end; at the narrow end the whole trip
// just fills the card (never below ZOOM_MIN_W a day), so short trips stop at "Fit".
const ZOOM_MIN_W = 24
const ZOOM_MAX_W = 2400
const ZOOM_STEP = 1.5
// Hour marks and drag snapping follow the zoom.
const tickHours = dayWidth => (dayWidth >= 960 ? 1 : dayWidth >= 480 ? 3 : dayWidth >= 240 ? 6 : null)
const snapMinutes = dayWidth => (dayWidth >= 480 ? 15 : 30)
const CAPTION_BELOW = 48 // px: a bar narrower than this shows its title beside it

const hourOf = moment => {
  const t = timeOf(moment)
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  return h + m / 60
}

// [start, end] in days from the first column, or null when the item has no date.
function span(item, first) {
  const startDay = dayOf(item.start)
  if (!startDay) return null
  const endDay = dayOf(item.end) || startDay
  const startHour = hourOf(item.start)
  const endHour = hourOf(item.end)
  const at = (day, hour) => daysBetween(first, day) + hour / 24

  let start, end
  if (item.kind === 'stay') {
    start = at(startDay, startHour ?? DEFAULT_CHECK_IN)
    end = at(endDay, endHour ?? (endDay === startDay ? 24 : DEFAULT_CHECK_OUT))
  } else if (startHour == null) {
    // All day: from the start of the first day to the end of the last.
    start = at(startDay, 0)
    end = at(endDay, 24)
  } else {
    start = at(startDay, startHour)
    end = item.end ? at(endDay, endHour ?? 24) : start
  }
  return [start, Math.max(end, start + MIN_BAR)]
}

// Overlapping bars in one lane go on separate rows, first come first served.
// A bar's footprint [from, to] includes its caption when the title sits beside it.
function pack(bars) {
  const rowEnds = []
  for (const bar of [...bars].sort((a, b) => a.from - b.from)) {
    let row = rowEnds.findIndex(end => end <= bar.from)
    if (row === -1) { row = rowEnds.length; rowEnds.push(-Infinity) }
    rowEnds[row] = bar.to
    bar.row = row
  }
  return Math.max(rowEnds.length, 1)
}

// Rough rendered width of a bar's text at 12px, icon and padding included.
const textWidth = text => 30 + text.length * 6.6

const DRAG_THRESHOLD = 6 // px a mouse must move before a press counts as a drag

const pad = n => String(n).padStart(2, '0')
// Position (days from the first column) -> 'YYYY-MM-DDTHH:mm', snapped to `step` minutes.
// Travel and activities snap like this; stays snap to whole days.
function momentAt(first, pos, step) {
  const perDay = 1440 / step
  const slots = Math.round(pos * perDay)
  const day = Math.floor(slots / perDay)
  const minutes = (slots - day * perDay) * step
  return `${addDays(first, day)}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

// A moment moved by `delta` days: a timed one snaps to `step` minutes, a
// date-only one moves by whole days and stays date-only.
function shifted(first, moment, delta, step) {
  if (!moment) return moment
  if (!timeOf(moment)) return addDays(dayOf(moment), Math.round(delta))
  return momentAt(first, daysBetween(first, dayOf(moment)) + hourOf(moment) / 24 + delta, step)
}

// The same ordering rules as the server: the end may not come before the
// start, and a stay lasts at least one night.
function inOrder(kind, start, end) {
  if (!end) return true
  if (kind === 'stay') return dayOf(end) > dayOf(start)
  if (dayOf(end) !== dayOf(start)) return dayOf(end) > dayOf(start)
  return !timeOf(end) || !timeOf(start) || timeOf(end) > timeOf(start)
}

// New start and end for an item dragged by `delta` days, by its body ('move')
// or by one of its ends; null when the result would be out of order.
function rescheduled(first, item, mode, delta, step) {
  let { start, end } = item
  if (mode === 'move') {
    start = shifted(first, start, delta, step)
    end = shifted(first, end, delta, step)
  } else if (mode === 'start') {
    start = shifted(first, start, delta, step)
  } else {
    // An item without an end gets one by dragging its right edge.
    end = end ? shifted(first, end, delta, step) : timeOf(start) ? shifted(first, start, delta, step) : addDays(dayOf(start), Math.round(delta))
  }
  return inOrder(item.kind, start, end) ? { start, end } : null
}

// The item a press-and-drag (or a tap) on a lane describes.
function rangeFor(kind, first, from, to, tapped, step) {
  const lo = Math.min(from, to), hi = Math.max(from, to)
  if (kind === 'stay') {
    const checkIn = Math.floor(lo)
    const checkOut = Math.max(Math.floor(hi), checkIn + 1)
    return { start: addDays(first, checkIn), end: addDays(first, checkOut) }
  }
  // A tap only picks the day; the times are for the form.
  if (tapped) return { start: addDays(first, Math.floor(lo)), end: null }
  const min = step / 1440
  const start = momentAt(first, lo, step)
  const end = momentAt(first, Math.max(hi, lo + min), step)
  return { start, end: end === start ? momentAt(first, lo + min, step) : end }
}

// `onCreate({ kind, start, end })`, when given, lets a drag across a lane (or a
// tap on a touch screen, where a drag scrolls) start a new item there.
// `onReschedule(item, { start, end })`, when given, lets a mouse drag a bar to
// move it, or drag its ends to change when it starts or ends.
export default function TripGantt({ trip, items: allItems, placeName, onOpenItem, onCreate = null, onReschedule = null, highlight = null, onHover = () => {} }) {
  const scroller = useRef(null)
  const [boxWidth, setBoxWidth] = useState(0)
  const [ghost, setGhost] = useState(null) // { kind, from, to } while dragging
  const press = useRef(null)
  const [preview, setPreview] = useState(null) // { id, start, end } while a bar is dragged
  const barDrag = useRef(null)
  const skipClick = useRef(false)
  // While a bar is dragged it is drawn (and packed) at its new times.
  const items = preview ? allItems.map(i => (i.id === preview.id ? { ...i, start: preview.start, end: preview.end } : i)) : allItems
  const now = today()

  // Short trips stretch to fill the card; long ones keep a readable day width and scroll.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setBoxWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const dated = items.filter(item => dayOf(item.start))
  const days = [trip.startDate, trip.endDate, ...items.flatMap(i => [dayOf(i.start), dayOf(i.end)])].filter(Boolean).sort()
  const first = days[0]
  const last = days[days.length - 1]
  const dayCount = daysBetween(first, last) + 1
  const columns = Array.from({ length: dayCount }, (_, i) => addDays(first, i))
  // Opening view: the trip fills the card, but days never get too narrow to
  // read, so a long trip scrolls. "Fit" (and the furthest zoom-out) shows the
  // whole trip without scrolling instead; for short trips the two are the same.
  const fillWidth = Math.floor((boxWidth - LABEL_W) / dayCount) || MIN_DAY_W
  const openWidth = Math.max(MIN_DAY_W, fillWidth)
  const minWidth = Math.max(ZOOM_MIN_W, Math.min(openWidth, fillWidth))
  const [zoomWidth, setZoomWidth] = useState(null) // null = the opening view
  const dayWidth = zoomWidth ?? openWidth
  const fitted = dayWidth === minWidth
  const step = snapMinutes(dayWidth)
  const ticks = tickHours(dayWidth)

  // Zooming keeps the moment under the pointer (or the middle of the view)
  // in place: work out its position now, scroll to it once the new width is drawn.
  const pendingScroll = useRef(null)
  const widthRef = useRef(dayWidth)
  widthRef.current = dayWidth
  const minWidthRef = useRef(minWidth)
  minWidthRef.current = minWidth
  const zoomTo = (width, clientX) => {
    const el = scroller.current
    if (!el) return
    const next = Math.min(ZOOM_MAX_W, Math.max(minWidthRef.current, width))
    const rect = el.getBoundingClientRect()
    const x = (clientX ?? rect.left + (rect.width + LABEL_W) / 2) - rect.left - LABEL_W
    pendingScroll.current = ((el.scrollLeft + x) / widthRef.current) * next - x
    setZoomWidth(next)
  }
  useLayoutEffect(() => {
    if (pendingScroll.current == null || !scroller.current) return
    scroller.current.scrollLeft = Math.max(0, pendingScroll.current)
    pendingScroll.current = null
  }, [dayWidth])

  // Ctrl/⌘ + scroll wheel, and trackpad pinch (which browsers report the same
  // way). Plain scrolling is left alone. Needs a non-passive listener to stop
  // the page itself from zooming.
  const zoomRef = useRef(zoomTo)
  zoomRef.current = zoomTo
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onWheel = e => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025))
      zoomRef.current(widthRef.current * factor, e.clientX)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const label = item => {
    if (item.kind !== 'transport') return item.title
    const route = [placeName(item.fromPlaceId), placeName(item.toPlaceId)].filter(Boolean).join(' → ')
    return route && route !== item.title ? `${item.title} · ${route}` : item.title
  }

  const lanes = LANES.map(lane => {
    const bars = dated
      .filter(item => item.kind === lane.kind)
      .map(item => {
        const [start, end] = span(item, first)
        // Too narrow for any text: the bar keeps its icon and the title sits
        // beside it, on the left when there is no room before the last day ends.
        const captioned = (end - start) * dayWidth < CAPTION_BELOW
        const caption = textWidth(item.title) / dayWidth
        const flipped = captioned && end + caption > dayCount
        return {
          item, start, end, captioned, flipped,
          from: flipped ? start - caption : start,
          to: captioned && !flipped ? end + caption : end,
        }
      })
    return { ...lane, bars, rows: pack(bars) }
  })

  // Open on today when the trip is under way, otherwise at its start; once the
  // card has a width, and not again on every zoom.
  const opened = useRef(false)
  useEffect(() => {
    const el = scroller.current
    if (!el || !boxWidth || opened.current) return
    opened.current = true
    const offset = now > first && now <= last ? daysBetween(first, now) - 0.5 : 0
    el.scrollLeft = Math.max(0, offset * dayWidth)
  }, [first, last, now, dayWidth, boxWidth])

  const tooltip = item => {
    const when = [item.start, item.end].filter(Boolean)
      .map(m => `${formatDay(dayOf(m))}${timeOf(m) ? ` ${timeOf(m)}` : ''}`).join(' – ')
    return `${label(item)}\n${when}`
  }

  const width = dayCount * dayWidth

  const posOf = (e, track) => Math.min(Math.max((e.clientX - track.getBoundingClientRect().left) / dayWidth, 0), dayCount)
  const startPress = kind => e => {
    if (!onCreate || e.button > 0 || e.target.closest('.gantt-bar')) return
    const track = e.currentTarget
    press.current = { kind, track, x: e.clientX, from: posOf(e, track), touch: e.pointerType !== 'mouse', dragging: false }
    if (e.pointerType === 'mouse') {
      e.preventDefault() // no text selection while dragging
      track.setPointerCapture(e.pointerId)
    }
  }
  const movePress = e => {
    const p = press.current
    if (!p || p.touch) return
    if (!p.dragging && Math.abs(e.clientX - p.x) < DRAG_THRESHOLD) return
    p.dragging = true
    setGhost({ kind: p.kind, from: p.from, to: posOf(e, p.track) })
  }
  const endPress = e => {
    const p = press.current
    press.current = null
    setGhost(null)
    if (!p) return
    const to = p.dragging ? posOf(e, p.track) : p.from
    // A mouse click without a drag does nothing: on desktop, creating is a drag.
    if (!p.dragging && !p.touch) return
    onCreate({ kind: p.kind, ...rangeFor(p.kind, first, p.from, to, !p.dragging, step) })
  }
  const cancelPress = () => { press.current = null; setGhost(null) }

  const startBarDrag = item => e => {
    if (!onReschedule || e.pointerType !== 'mouse' || e.button > 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    barDrag.current = { item, mode: e.target.dataset.handle || 'move', x: e.clientX, dragging: false, when: null }
  }
  const moveBarDrag = e => {
    const d = barDrag.current
    if (!d) return
    if (!d.dragging && Math.abs(e.clientX - d.x) < DRAG_THRESHOLD) return
    d.dragging = true
    const when = rescheduled(first, d.item, d.mode, (e.clientX - d.x) / dayWidth, step)
    if (when) { d.when = when; setPreview({ id: d.item.id, ...when }) }
  }
  const endBarDrag = () => {
    const d = barDrag.current
    barDrag.current = null
    if (!d?.dragging) return
    skipClick.current = true
    if (d.when && (d.when.start !== d.item.start || (d.when.end ?? null) !== (d.item.end ?? null))) onReschedule(d.item, d.when)
    setPreview(null)
  }
  const cancelBarDrag = () => { barDrag.current = null; setPreview(null) }
  const lit = highlight?.length ? new Set(highlight) : null
  const todayIndex = daysBetween(first, now)

  const hours = ticks ? Array.from({ length: 24 / ticks - 1 }, (_, i) => (i + 1) * ticks) : []

  return (
    <div className="gantt-wrap">
    <div className="gantt-zoom" role="group" aria-label="Zoom">
      <button type="button" onClick={() => zoomTo(dayWidth / ZOOM_STEP)} disabled={dayWidth <= minWidth} title="Zoom out" aria-label="Zoom timeline out">−</button>
      <button type="button" className={fitted ? 'active' : ''} onClick={() => zoomTo(minWidth)} title="Fit the whole trip" aria-label="Fit the whole trip">Fit</button>
      <button type="button" onClick={() => zoomTo(dayWidth * ZOOM_STEP)} disabled={dayWidth >= ZOOM_MAX_W} title="Zoom in (or Ctrl/⌘ + scroll, or pinch)" aria-label="Zoom timeline in">+</button>
    </div>
    <div className="gantt" ref={scroller}>
      <div className="gantt-inner" style={{ width: width + LABEL_W }}>
        <div className="gantt-head">
          <div className="gantt-label" />
          <div className={`gantt-days${hours.length ? ' ticked' : ''}`} style={{ width }}>
            {columns.map(day => {
              const weekday = new Date(`${day}T00:00:00Z`).getUTCDay()
              return (
                <div
                  key={day}
                  className={`gantt-day${day === now ? ' today' : ''}${day < trip.startDate || day > trip.endDate ? ' outside' : ''}${weekday === 0 || weekday === 6 ? ' weekend' : ''}`}
                  style={{ width: dayWidth }}
                >
                  {dayWidth >= 60 ? formatDay(day, { weekday: 'short', day: 'numeric' }) : formatDay(day, { day: 'numeric' })}
                  {dayWidth >= 60 && <span className="gantt-month">{day.endsWith('-01') || day === first ? formatDay(day, { month: 'short' }) : ''}</span>}
                  {hours.map(h => (
                    <span key={h} className="gantt-tick-label" style={{ left: (h / 24) * dayWidth }}>{pad(h)}</span>
                  ))}
                </div>
              )
            })}
          </div>
        </div>

        {lanes.map(lane => (
          <div key={lane.kind} className="gantt-lane">
            <div className="gantt-label">{lane.label}</div>
            <div
              className={`gantt-track${onCreate ? ' creatable' : ''}`}
              style={{ width, height: lane.rows * 34 + 10 }}
              onPointerDown={startPress(lane.kind)}
              onPointerMove={movePress}
              onPointerUp={endPress}
              onPointerCancel={cancelPress}
            >
              {columns.map((day, i) => (
                <div
                  key={day}
                  className={`gantt-cell${day < trip.startDate || day > trip.endDate ? ' outside' : ''}`}
                  style={{ left: i * dayWidth, width: dayWidth }}
                >
                  {hours.map(h => <span key={h} className="gantt-tick" style={{ left: (h / 24) * dayWidth }} />)}
                </div>
              ))}
              {todayIndex >= 0 && todayIndex < dayCount && (
                <div className="gantt-now" style={{ left: (todayIndex + (new Date().getHours() + new Date().getMinutes() / 60) / 24) * dayWidth }} />
              )}
              {ghost?.kind === lane.kind && (() => {
                const r = rangeFor(lane.kind, first, ghost.from, ghost.to, false, step)
                const s = daysBetween(first, dayOf(r.start)) + (lane.kind === 'stay' ? DEFAULT_CHECK_IN / 24 : (hourOf(r.start) ?? 0) / 24)
                const e = daysBetween(first, dayOf(r.end)) + (lane.kind === 'stay' ? DEFAULT_CHECK_OUT / 24 : (hourOf(r.end) ?? 24) / 24)
                const nights = daysBetween(dayOf(r.start), dayOf(r.end))
                return (
                  <div className={`gantt-ghost ${lane.kind}`} style={{ left: s * dayWidth, width: Math.max((e - s) * dayWidth, 4) }}>
                    <span>
                      {lane.kind === 'stay'
                        ? `${nights} night${nights !== 1 ? 's' : ''}`
                        : `${timeOf(r.start)} – ${timeOf(r.end)}`}
                    </span>
                  </div>
                )
              })()}
              {lane.bars.map(({ item, start, end, row, captioned, flipped }) => (
                <button
                  key={item.id}
                  type="button"
                  className={`gantt-bar ${lane.kind}${captioned ? ' captioned' : ''}${flipped ? ' flipped' : ''}${lit ? (lit.has(item.id) ? ' lit' : ' faded') : ''}${onReschedule ? ' movable' : ''}${preview?.id === item.id ? ' dragging' : ''}`}
                  style={{ left: start * dayWidth, width: (end - start) * dayWidth, top: row * 34 + 5 }}
                  title={preview ? undefined : tooltip(item)}
                  onClick={() => {
                    if (skipClick.current) { skipClick.current = false; return }
                    onOpenItem(item)
                  }}
                  onMouseEnter={() => onHover([item.id])}
                  onMouseLeave={() => onHover(null)}
                  onPointerDown={startBarDrag(item)}
                  onPointerMove={moveBarDrag}
                  onPointerUp={endBarDrag}
                  onPointerCancel={cancelBarDrag}
                >
                  {onReschedule && !captioned && <span className="gantt-handle start" data-handle="start" />}
                  <span className="gantt-bar-icon">{itemIcon(item)}</span>
                  {captioned
                    ? <span className="gantt-caption">{item.title}</span>
                    : <span className="gantt-bar-text">{label(item)}</span>}
                  {onReschedule && !captioned && <span className="gantt-handle end" data-handle="end" />}
                  {preview?.id === item.id && (
                    <span className="gantt-drag-tag">
                      {[item.start, item.end].filter(Boolean).map(m => `${formatDay(dayOf(m), { weekday: 'short', day: 'numeric' })}${timeOf(m) ? ` ${timeOf(m)}` : ''}`).join(' – ')}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {onCreate && (
        <div className="gantt-hint">
          <span className="gantt-hint-pointer">
            Drag across a lane to add something there{onReschedule && ' · drag a bar, or its ends, to change when it happens'} · Ctrl/⌘ + scroll or pinch to zoom
          </span>
          <span className="gantt-hint-touch">Tap an empty spot in a lane to add something on that day</span>
        </div>
      )}
    </div>
    </div>
  )
}
