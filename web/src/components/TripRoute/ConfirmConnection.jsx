import { useEffect, useMemo, useState, lazy, Suspense } from 'react'
import client from '../../api/client'
import { TRANSPORT_MODES, dayOf, timeOf, formatDay, formatDuration } from '../../utils/trip.js'
import { legIcon, legLabel, crossesZones, isTight, tightLabel, spareMinutes } from './ConnectionCard.jsx'
import Expandable from '../Expandable/Expandable.jsx'
import Loading from '../Loading.jsx'

const RouteMap = lazy(() => import('./RouteMap.jsx'))

// Without the server's matching (it failed, or the limit was hit) every stop
// is a new place under its timetable name; the same stop twice is one place.
function unmatched(itinerary) {
  const places = []
  const keys = itinerary.legs.flatMap(l => [l.from, l.to]).map(stop => {
    const same = places.find(p => p.name === stop.name && p.lat === stop.lat && p.lon === stop.lon)
    if (same) return same.key
    const key = `new:${places.length}`
    places.push({ key, name: stop.name, originalName: stop.name, lat: stop.lat, lon: stop.lon })
    return key
  })
  return { places, keys }
}

// The confirm step for a chosen connection: its legs, each with an editable
// title, operator and number (timetables often have neither a train number nor
// an English operator name) and a switch to leave it out, plus the names of the
// stops that become new places. Everything is added in one go.
function ConfirmConnection({ tripId, itinerary, onBack, onSaved }) {
  const [places, setPlaces] = useState(null) // key -> {key, id?, name, originalName, lat, lon}
  const [order, setOrder] = useState([]) // place keys in journey order
  const [names, setNames] = useState({}) // key -> edited name, for new places
  const [legs, setLegs] = useState(() => itinerary.legs.map(leg => ({
    include: true, title: null, mode: leg.mode, carrier: leg.carrier, number: leg.number, fromKey: null, toKey: null,
  })))
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let current = true
    const apply = ({ places: list, keys }) => {
      if (!current) return
      setPlaces(Object.fromEntries(list.map(p => [p.key, p])))
      setOrder([...new Set(keys)])
      setLegs(prev => prev.map((leg, i) => ({ ...leg, fromKey: keys[2 * i], toKey: keys[2 * i + 1] })))
    }
    const stops = itinerary.legs.flatMap(l => [l.from, l.to]).map(({ name, lat, lon }) => ({ name, lat, lon }))
    client.post(`/trips/${tripId}/routes/places`, { stops })
      .then(({ data }) => apply(data))
      .catch(() => {
        apply(unmatched(itinerary))
        if (current) setNotice('Could not match the stops to this trip’s places, so each stop becomes a new place under its timetable name.')
      })
    return () => { current = false }
  }, [tripId, itinerary])

  const setLeg = (i, patch) => setLegs(prev => prev.map((leg, j) => (j === i ? { ...leg, ...patch } : leg)))
  const nameOf = key => {
    const place = places?.[key]
    if (!place) return ''
    return place.id ? place.name : (names[key] ?? place.name).trim() || place.originalName
  }
  const autoTitle = leg => `${nameOf(leg.fromKey)} → ${nameOf(leg.toKey)}`
  const titleOf = leg => (leg.title ?? autoTitle(leg)).trim() || autoTitle(leg)

  // Brief and factual: the line and direction, and how long the change after it is.
  const notesFor = (found, leg, i) => {
    const line = found.line && found.line !== leg.number ? `Line ${found.line}` : ''
    const direction = found.headsign ? `${line ? 'towards' : 'Towards'} ${found.headsign}` : ''
    const parts = [[line, direction].filter(Boolean).join(', ')]
    // A leg that crosses westward into another zone ends on its departure clock.
    if (found.arrivalNote) parts.push(found.arrivalNote.replace(/\.$/, ''))
    const change = found.change
    const next = legs[i + 1]
    if (change && next?.include) {
      const walkTo = next.fromKey !== leg.toKey ? ` to ${nameOf(next.fromKey)}` : ''
      // The wait includes the walk, so a note with a walk also says what is left.
      parts.push(`${change.waitMinutes} min to change at ${nameOf(leg.toKey)}${change.walkMinutes ? ` (${change.walkMinutes} min walk${walkTo}, ${spareMinutes(change)} min to spare)` : ''}`)
    }
    return parts.filter(Boolean).map(p => `${p}.`).join(' ')
  }

  const chosen = legs.map((leg, i) => ({ leg, found: itinerary.legs[i], i })).filter(x => x.leg.include)
  // The map shows this connection alone, numbered as in the results; legs
  // switched off drop out of it.
  const alone = useMemo(() => [itinerary], [itinerary])
  const skipKey = legs.map(l => (l.include ? 1 : 0)).join('')
  const skip = useMemo(() => [...skipKey].flatMap((on, i) => (on === '1' ? [] : [i])), [skipKey])

  const handleSave = async () => {
    if (saving || chosen.length === 0) return
    setError('')
    const used = [...new Set(chosen.flatMap(({ leg }) => [leg.fromKey, leg.toKey]))]
    const payload = {
      places: used.map(key => {
        const p = places[key]
        if (p.id) return { key, id: p.id }
        const name = nameOf(key)
        // The timetable's own name stays on the place as its address: it is
        // what the signs and the ticket machines say.
        return { key, name, address: name !== p.originalName ? p.originalName : '', lat: p.lat, lon: p.lon }
      }),
      legs: chosen.map(({ leg, found, i }) => ({
        fromKey: leg.fromKey,
        toKey: leg.toKey,
        title: titleOf(leg),
        mode: leg.mode,
        carrier: leg.carrier.trim(),
        number: leg.number.trim(),
        start: found.start,
        end: found.end,
        notes: notesFor(found, leg, i),
      })),
    }
    setSaving(true)
    try {
      await client.post(`/trips/${tripId}/routes`, payload)
      onSaved(chosen.length)
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to add the connection.')
      setSaving(false)
    }
  }

  const newPlaces = order.map(key => places?.[key]).filter(p => p && !p.id)
  const knownPlaces = order.map(key => places?.[key]).filter(p => p?.id)

  return (
    <div className="route-confirm">
      <button type="button" className="back-link route-back" onClick={onBack}>‹ Other connections</button>

      <div className="route-confirm-head">
        <div className="route-card-times">
          {formatDay(dayOf(itinerary.departure))} · {timeOf(itinerary.departure)} → {timeOf(itinerary.arrival)}
        </div>
        <div className="route-card-meta">
          {formatDuration(itinerary.minutes)} · {itinerary.changes === 0 ? 'direct' : `${itinerary.changes} change${itinerary.changes !== 1 ? 's' : ''}`}
          {crossesZones(itinerary) && ' · local times'}
        </div>
      </div>

      <Suspense fallback={<Loading />}>
        <div className="route-confirm-map">
          <Expandable label="Connection · Map">
            <RouteMap itineraries={alone} skip={skip} />
          </Expandable>
        </div>
      </Suspense>

      {places === null ? (
        <p className="route-hint">Matching the stops to this trip’s places…</p>
      ) : (
        <>
          {notice && <p className="route-hint">{notice}</p>}

          {newPlaces.length > 0 && (
            <>
              <div className="section-label">New places</div>
              <div className="card route-places">
                {newPlaces.map(p => (
                  <div key={p.key} className="form-group">
                    <label htmlFor={`place-${p.key}`}>📍 {p.originalName}</label>
                    <input
                      id={`place-${p.key}`}
                      value={names[p.key] ?? p.name}
                      onChange={e => setNames(n => ({ ...n, [p.key]: e.target.value }))}
                      maxLength={160}
                    />
                  </div>
                ))}
                {knownPlaces.length > 0 && (
                  <p className="route-hint">Already in this trip: {knownPlaces.map(p => p.name).join(', ')}</p>
                )}
              </div>
            </>
          )}
          {newPlaces.length === 0 && knownPlaces.length > 0 && (
            <p className="route-hint">Every stop is already a place of this trip: {knownPlaces.map(p => p.name).join(', ')}</p>
          )}

          <div className="section-label">Legs</div>
          {legs.map((leg, i) => {
            const found = itinerary.legs[i]
            return (
              <div key={i} className={`card route-confirm-leg${leg.include ? '' : ' excluded'}`}>
                <label className="route-confirm-toggle">
                  <input type="checkbox" checked={leg.include} onChange={e => setLeg(i, { include: e.target.checked })} />
                  <span className="route-leg-icon" aria-hidden="true">{legIcon(found)}</span>
                  <span className="route-confirm-when">
                    {timeOf(found.start)} → {timeOf(found.end)}
                    {dayOf(found.end) !== dayOf(found.start) && ` (${formatDay(dayOf(found.end))})`}
                  </span>
                  <span className="route-confirm-line">{legLabel(found)}</span>
                </label>

                {leg.include && (
                  <>
                    <div className="form-group">
                      <label htmlFor={`title-${i}`}>Title</label>
                      <input id={`title-${i}`} value={leg.title ?? autoTitle(leg)} onChange={e => setLeg(i, { title: e.target.value })} maxLength={160} />
                    </div>
                    <div className="form-row">
                      <div className="form-group">
                        <label htmlFor={`carrier-${i}`}>Operator</label>
                        <input id={`carrier-${i}`} value={leg.carrier} onChange={e => setLeg(i, { carrier: e.target.value })} maxLength={80} />
                      </div>
                      <div className="form-group">
                        <label htmlFor={`number-${i}`}>Number</label>
                        <input id={`number-${i}`} value={leg.number} onChange={e => setLeg(i, { number: e.target.value })} maxLength={40} placeholder="Train or bus number" />
                      </div>
                    </div>
                    <div className="filter-chips route-confirm-modes">
                      {TRANSPORT_MODES.filter(m => m.value !== 'car').map(m => (
                        <button key={m.value} type="button" className={`chip${leg.mode === m.value ? ' active' : ''}`} onClick={() => setLeg(i, { mode: m.value })}>
                          {m.icon} {m.label}
                        </button>
                      ))}
                    </div>
                    {notesFor(found, leg, i) && <p className="route-hint">Note: {notesFor(found, leg, i)}</p>}
                  </>
                )}

                {found.change && legs[i + 1] && (
                  <p className={`route-change${isTight(found.change) ? ' tight' : ''}`}>
                    <span>{found.change.waitMinutes} min to change{found.change.walkMinutes ? `, ${found.change.walkMinutes} min walk` : ''}</span>
                    {isTight(found.change) && <span className="route-tag">{tightLabel(found.change)}</span>}
                  </p>
                )}
              </div>
            )
          })}
        </>
      )}

      {error && <p className="error">{error}</p>}

      <p className="route-attribution">
        Timetables via <a href="https://transitous.org/sources/" target="_blank" rel="noopener noreferrer">Transitous and its sources</a>
        {' · '}<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a>
      </p>

      <div className="panel-actions route-confirm-actions">
        <button type="button" className="btn btn-ghost" onClick={onBack}>Back</button>
        <button type="button" className="btn btn-secondary" onClick={handleSave} disabled={saving || places === null || chosen.length === 0}>
          {saving ? 'Adding…' : `Add ${chosen.length} item${chosen.length !== 1 ? 's' : ''} to trip`}
        </button>
      </div>
    </div>
  )
}

export default ConfirmConnection
