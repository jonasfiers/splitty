import { Fragment } from 'react'
import { TRANSPORT_MODES, dayOf, timeOf, daysBetween, formatDay, formatDuration } from '../../utils/trip.js'

// A change with less time than this to spare is easy to miss with luggage or
// a late train. The wait between two vehicles includes any walk between their
// stops, so what is spare is the wait minus the walk.
export const TIGHT_MINUTES = 10
export const spareMinutes = change => Math.max(0, change.waitMinutes - change.walkMinutes)
export const isTight = change => spareMinutes(change) < TIGHT_MINUTES
export const tightLabel = change => (change.walkMinutes ? `Tight · ${spareMinutes(change)} min spare` : 'Tight')

const TRANSIT_ICONS = { HIGHSPEED_RAIL: '🚄', SUBWAY: '🚇', METRO: '🚇', TRAM: '🚊', COACH: '🚌' }

export const legIcon = leg =>
  TRANSIT_ICONS[leg.transitMode] ?? TRANSPORT_MODES.find(m => m.value === leg.mode)?.icon ?? '🧭'

// What a leg is called on the platform: the line, plus the number when the
// line name does not already include it ("EST 9316" vs "9316").
export const legLabel = leg =>
  [leg.line, leg.number && !leg.line.includes(leg.number) ? leg.number : ''].filter(Boolean).join(' ')
  || TRANSPORT_MODES.find(m => m.value === leg.mode)?.label

export const changeText = (change, at = change.at) =>
  `${change.waitMinutes} min to change at ${at}${change.walkMinutes ? `, ${change.walkMinutes} min walk` : ''}`

// The stops of a connection span more than one timezone (Brussels → London).
export const crossesZones = itinerary =>
  new Set(itinerary.legs.flatMap(l => [l.from.tz, l.to.tz])).size > 1

// One connection in the search results: when, how long, how many changes,
// and every leg with the wait between them. Choosing it opens the confirm step.
// `active` marks it as the one highlighted on the map; `onHover` reports the
// pointer over it, and `onShowOnMap` (narrow screens) adds a button for the map.
function ConnectionCard({ itinerary: it, searchDay, onChoose, active = false, onHover = null, onShowOnMap = null }) {
  const nextDay = daysBetween(dayOf(it.departure), dayOf(it.arrival))
  const choose = () => onChoose(it)

  return (
    <div
      className={`route-card${active ? ' active' : ''}`}
      role="button"
      tabIndex={0}
      onClick={choose}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose() } }}
      onMouseEnter={onHover ? () => onHover(true) : undefined}
      onMouseLeave={onHover ? () => onHover(false) : undefined}
    >
      <div className="route-card-head">
        <div className="route-card-times">
          {dayOf(it.departure) !== searchDay && <span className="route-card-day">{formatDay(dayOf(it.departure))}</span>}
          {timeOf(it.departure)} → {timeOf(it.arrival)}
          {nextDay > 0 && <sup className="route-card-plus">+{nextDay}</sup>}
        </div>
        <div className="route-card-meta">
          {formatDuration(it.minutes)} · {it.changes === 0 ? 'direct' : `${it.changes} change${it.changes !== 1 ? 's' : ''}`}
        </div>
      </div>

      <div className="route-chain">
        {it.legs.map((leg, i) => (
          <Fragment key={i}>
            {i > 0 && <span className="route-chain-sep" aria-hidden="true">›</span>}
            <span className="route-chain-leg">{legIcon(leg)} {legLabel(leg)}</span>
          </Fragment>
        ))}
      </div>

      <ol className="route-legs">
        {it.legs.map((leg, i) => (
          <Fragment key={i}>
            <li className="route-leg">
              <div className="route-leg-times">
                <span>{timeOf(leg.start)}</span>
                <span>{timeOf(leg.end)}</span>
              </div>
              <div className="route-leg-icon" aria-hidden="true">{legIcon(leg)}</div>
              <div className="route-leg-info">
                <div className="route-leg-stops">{leg.from.name} → {leg.to.name}</div>
                <div className="route-leg-meta">
                  {[legLabel(leg), leg.headsign && `towards ${leg.headsign}`, leg.carrier, leg.arrivalNote?.replace(/\.$/, '')].filter(Boolean).join(' · ')}
                </div>
              </div>
            </li>
            {leg.change && (
              <li className={`route-change${isTight(leg.change) ? ' tight' : ''}`}>
                <span>{changeText(leg.change)}</span>
                {isTight(leg.change) && <span className="route-tag">{tightLabel(leg.change)}</span>}
              </li>
            )}
          </Fragment>
        ))}
      </ol>

      <div className="route-card-foot">
        <span>
          {[
            it.walkBefore > 2 && `${it.walkBefore} min walk to the first stop`,
            it.walkAfter > 2 && `${it.walkAfter} min walk at the end`,
            crossesZones(it) && 'local times',
          ].filter(Boolean).join(' · ')}
        </span>
        <span className="route-card-actions">
          {onShowOnMap && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); onShowOnMap() }}>Map</button>
          )}
          <span className="route-card-choose">Choose ›</span>
        </span>
      </div>
    </div>
  )
}

export default ConnectionCard
