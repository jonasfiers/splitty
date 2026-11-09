import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import Sheet, { SheetActions } from '../Sheet/Sheet.jsx'

// Dates and times in the app's own sheet instead of the browser's pickers.
//
// <DatePicker value="2026-11-09" onChange={d => …} />
//   A calendar; tapping a day picks it and closes the sheet.
// <DateTimePicker date="2026-11-09" time="14:30" onChange={({ date, time }) => …} />
//   The calendar with hour and minute wheels under it, and Done.
//
// Values are plain strings: 'YYYY-MM-DD' and 'HH:mm' ('' for none), local
// wall-clock, the same as the <input>s they replace.
//
// Shared props:
//   min, max     'YYYY-MM-DD': days outside are greyed out
//   range        { start, end }: days lightly tinted (the trip's dates)
//   optional     a "No date" button; for DatePicker, onChange('')
//   required     the form won't submit while empty (opens the sheet instead)
//   title        the sheet's title (the field's label)
//   placeholder  shown while empty
//   id           for a <Field> label; goes on the button
//   shortcuts    ['today', 'yesterday']: buttons under the calendar
// DateTimePicker only:
//   timeOptional "No time" (all day) as a choice; otherwise a time is required
//   withTime     false: behaves as a date-only picker (a stay in quick add)
//   sameDayLabel a time without a date reads as "Same day · 14:30"

const pad = n => String(n).padStart(2, '0')
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parse = s => (s ? new Date(`${s.slice(0, 10)}T12:00:00`) : null)
const todayIso = () => iso(new Date())
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d) }

export function formatDate(s) {
  const d = parse(s)
  if (!d) return ''
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
}

const CalendarIcon = () => (
  <svg className="dp-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>
)

function Trigger({ id, text, placeholder, onClick, buttonRef }) {
  return (
    <button ref={buttonRef} type="button" id={id} className="picker-field-btn dp-trigger" onClick={onClick}
      aria-haspopup="dialog" aria-labelledby={id ? `${id}-label ${id}` : undefined}>
      <CalendarIcon />
      <span className={`picker-text${text ? '' : ' picker-placeholder'}`}>{text || placeholder}</span>
    </button>
  )
}

function Required({ value, onInvalid }) {
  return <input className="picker-required" tabIndex={-1} aria-hidden="true" required value={value} onChange={() => {}}
    onInvalid={e => { e.preventDefault(); onInvalid() }} />
}

// ── The month calendar ──

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

function Calendar({ value, onPick, min, max, range }) {
  const start = parse(value || (range?.start && (!min || range.start >= min) ? range.start : null) || min || todayIso())
  const [month, setMonth] = useState(new Date(start.getFullYear(), start.getMonth(), 1))
  const today = todayIso()

  const first = month
  const lead = (first.getDay() + 6) % 7 // Monday first
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => iso(new Date(first.getFullYear(), first.getMonth(), i + 1)))]
  const shift = n => setMonth(m => new Date(m.getFullYear(), m.getMonth() + n, 1))

  return (
    <div className="dp-cal">
      <div className="dp-cal-head">
        <span className="dp-cal-month">{month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</span>
        <button type="button" className="dp-nav" onClick={() => shift(-1)} aria-label="Previous month">
          <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="15 6 9 12 15 18" /></svg>
        </button>
        <button type="button" className="dp-nav" onClick={() => shift(1)} aria-label="Next month">
          <svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 6 15 12 9 18" /></svg>
        </button>
      </div>
      <div className="dp-grid" role="grid">
        {WEEKDAYS.map(w => <span key={w} className="dp-wd" aria-hidden="true">{w}</span>)}
        {cells.map((d, i) => d === null ? <span key={`x${i}`} /> : (
          <button
            key={d}
            type="button"
            className={[
              'dp-day',
              d === value && 'selected',
              d === today && 'today',
              range?.start && d >= range.start && d <= (range.end || range.start) && 'in-range',
            ].filter(Boolean).join(' ')}
            disabled={(min && d < min) || (max && d > max)}
            aria-pressed={d === value}
            aria-label={parse(d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            onClick={() => onPick(d)}
          >
            {Number(d.slice(8))}
          </button>
        ))}
      </div>
    </div>
  )
}

function Shortcuts({ shortcuts, min, max, onPick }) {
  const items = shortcuts.map(s => s === 'today' ? ['Today', todayIso()] : s === 'yesterday' ? ['Yesterday', addDays(todayIso(), -1)] : null)
    .filter(x => x && (!min || x[1] >= min) && (!max || x[1] <= max))
  if (!items.length) return null
  return (
    <div className="dp-shortcuts">
      {items.map(([label, d]) => <button key={label} type="button" className="chip" onClick={() => onPick(d)}>{label}</button>)}
    </div>
  )
}

// ── Date ──

export default function DatePicker({
  value, onChange, min, max, range, optional = false, required = false, title = 'Date',
  placeholder = 'Pick a date', id, shortcuts = ['today'], clearLabel = 'No date',
}) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef(null)
  const close = () => { setOpen(false); buttonRef.current?.focus() }
  const pick = d => { if (d !== value) onChange(d); close() }

  return (
    <span className="picker picker-field">
      <Trigger id={id} buttonRef={buttonRef} text={formatDate(value)} placeholder={placeholder} onClick={() => setOpen(true)} />
      {required && <Required value={value || ''} onInvalid={() => setOpen(true)} />}
      {open && createPortal(
        <Sheet title={title} onClose={close} zIndex={300} className="dp-sheet">
          <Calendar value={value} onPick={pick} min={min} max={max} range={range} />
          <Shortcuts shortcuts={shortcuts} min={min} max={max} onPick={pick} />
          {optional && value && (
            <SheetActions><button type="button" className="btn btn-ghost" onClick={() => pick('')}>{clearLabel}</button></SheetActions>
          )}
        </Sheet>,
        document.body,
      )}
    </span>
  )
}

// ── Time wheels ──

// The wheels go round: the values are listed LOOPS times and the wheel starts
// in the middle copy; once it comes to rest it is moved back to the middle
// copy, invisibly (the same row, the same number), so it never reaches an end.
const LOOPS = 9

function Wheel({ values, value, onChange, format, label }) {
  const ref = useRef(null)
  const timer = useRef(null)
  const n = values.length
  const mid = Math.floor(LOOPS / 2) * n
  const index = Math.max(0, values.indexOf(value))
  const [pos, setPos] = useState(mid + index) // the row in the middle band
  // The row height comes from the CSS (smaller on short screens).
  const rowH = () => ref.current?.querySelector('.dp-wheel-item')?.offsetHeight || 36

  // To the current value on opening, and when the list changes (exact minutes).
  useLayoutEffect(() => {
    setPos(mid + index)
    if (ref.current) ref.current.scrollTop = (mid + index) * rowH()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n])
  useEffect(() => () => clearTimeout(timer.current), [])

  const settle = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const el = ref.current
      if (!el) return
      const h = rowH()
      let i = Math.round(el.scrollTop / h)
      const v = values[((i % n) + n) % n]
      if (Math.abs(i - mid) >= n) {
        i = mid + (((i % n) + n) % n)
        el.scrollTop = i * h
      }
      setPos(i)
      if (v !== value) onChange(v)
    }, 90)
  }
  const go = i => ref.current?.scrollTo({ top: i * rowH(), behavior: 'smooth' })

  return (
    <div
      ref={ref}
      className="dp-wheel"
      onScroll={settle}
      role="listbox"
      aria-label={label}
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); go(pos + 1) }
        if (e.key === 'ArrowUp') { e.preventDefault(); go(pos - 1) }
      }}
    >
      <div className="dp-wheel-pad" />
      {Array.from({ length: n * LOOPS }, (_, i) => {
        const v = values[i % n]
        // Only the middle copy is offered to screen readers.
        const real = i >= mid && i < mid + n
        return (
          <div
            key={i}
            {...(real ? { role: 'option', 'aria-selected': v === value } : { 'aria-hidden': true })}
            className={`dp-wheel-item${i === pos ? ' active' : ''}`}
            onClick={() => go(i)}
          >
            {format(v)}
          </div>
        )
      })}
      <div className="dp-wheel-pad" />
    </div>
  )
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES_5 = Array.from({ length: 12 }, (_, i) => i * 5)
const MINUTES_1 = Array.from({ length: 60 }, (_, i) => i)

function TimeWheels({ time, onChange }) {
  const [h, m] = time.split(':').map(Number)
  const [exact, setExact] = useState(m % 5 !== 0)
  const minutes = exact ? MINUTES_1 : MINUTES_5
  const set = (hh, mm) => onChange(`${pad(hh)}:${pad(mm)}`)
  return (
    <div className="dp-time">
      <div className="dp-wheels">
        <Wheel label="Hour" values={HOURS} value={h} onChange={hh => set(hh, m)} format={pad} />
        <span className="dp-colon" aria-hidden="true">:</span>
        <Wheel label="Minute" values={minutes} value={exact ? m : Math.round(m / 5) * 5 % 60} onChange={mm => set(h, mm)} format={pad} />
      </div>
      <button type="button" className="dp-exact" onClick={() => setExact(x => !x)} aria-pressed={exact}>
        {exact ? '5-minute steps' : 'Exact minutes'}
      </button>
    </div>
  )
}

// ── Date and time ──

export function DateTimePicker({
  date, time, onChange, min, max, range, optional = false, timeOptional = true, withTime = true,
  required = false, title = 'When', placeholder = 'Pick a date', id, shortcuts = ['today'], sameDayLabel = false,
  defaultTime = '12:00',
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(null) // { date, time } while the sheet is open
  const buttonRef = useRef(null)

  const show = () => { setDraft({ date: date || '', time: time || (timeOptional ? '' : defaultTime) }); setOpen(true) }
  const close = () => { setOpen(false); setDraft(null); buttonRef.current?.focus() }
  const done = () => { onChange(withTime ? draft : { date: draft.date, time: '' }); close() }

  const text = date
    ? `${formatDate(date)}${withTime && time ? ` · ${time}` : ''}`
    : withTime && time && sameDayLabel ? `Same day · ${time}` : ''

  // Without time, the calendar alone: tapping a day is the choice.
  if (!withTime) {
    return (
      <DatePicker value={date} onChange={d => onChange({ date: d, time: '' })} min={min} max={max} range={range}
        optional={optional} required={required} title={title} placeholder={placeholder} id={id} shortcuts={shortcuts} />
    )
  }

  return (
    <span className="picker picker-field">
      <Trigger id={id} buttonRef={buttonRef} text={text} placeholder={placeholder} onClick={show} />
      {required && <Required value={date || ''} onInvalid={show} />}
      {open && createPortal(
        <Sheet title={title} onClose={close} zIndex={300} className="dp-sheet">
          <Calendar value={draft.date} onPick={d => setDraft(x => ({ ...x, date: d }))} min={min} max={max} range={range} />
          <Shortcuts shortcuts={shortcuts} min={min} max={max} onPick={d => setDraft(x => ({ ...x, date: d }))} />

          <div className="dp-time-head">
            <span className="dp-time-label">Time</span>
            {timeOptional && (
              <div className="segmented dp-time-toggle" role="tablist" aria-label="Time">
                <button type="button" role="tab" aria-selected={!draft.time} className={!draft.time ? 'active' : undefined}
                  onClick={() => setDraft(x => ({ ...x, time: '' }))}>No time</button>
                <button type="button" role="tab" aria-selected={!!draft.time} className={draft.time ? 'active' : undefined}
                  onClick={() => setDraft(x => ({ ...x, time: x.time || defaultTime }))}>Set time</button>
              </div>
            )}
          </div>
          {draft.time && <TimeWheels time={draft.time} onChange={t => setDraft(x => ({ ...x, time: t }))} />}

          <SheetActions>
            <button type="button" className="btn btn-primary" onClick={done} disabled={required && !draft.date}>Done</button>
            {optional && (date || time) && (
              <button type="button" className="btn btn-ghost" onClick={() => { onChange({ date: '', time: '' }); close() }}>Clear</button>
            )}
          </SheetActions>
        </Sheet>,
        document.body,
      )}
    </span>
  )
}
