import { useNavigate } from 'react-router'
import { List, ListRow } from '../List/List.jsx'
import { formatDateRange, daysBetween, tripWhen } from '../../utils/trip.js'
import Icon from '../Icon/Icon.jsx'
import { tripIcon } from '../../utils/icons.js'

function TripList({ trips, showGroup = false }) {
  return (
    <List>
      {trips.map(t => (
        <ListRow
          key={t.id}
          to={`/trips/${t.id}`}
          icon={tripIcon(t)}
          title={t.title}
          meta={<>{formatDateRange(t.startDate, t.endDate)}{showGroup && t.groupTitle ? ` · ${t.groupTitle}` : ''}</>}
          aside={<>
            <span className="list-row-amt list-row-when">{tripWhen(t).label}</span>
            <span className="list-row-sub">{t.itemCount} item{t.itemCount !== 1 ? 's' : ''}</span>
          </>}
        />
      ))}
    </List>
  )
}

// Wider screens: the same trips as cards in a grid, with a bit more on each.
export function TripCards({ trips, past = false }) {
  const navigate = useNavigate()
  return (
    <div className="trip-cards">
      {trips.map(t => {
        const nights = daysBetween(t.startDate, t.endDate)
        const when = tripWhen(t)
        return (
          <button key={t.id} type="button" className={`trip-card${past ? ' past' : ''}`} onClick={() => navigate(`/trips/${t.id}`)}>
            <div className="trip-card-top">
              <span className="trip-card-icon"><Icon name={tripIcon(t)} /></span>
              <span className={`trip-card-when${when.on ? ' now' : ''}`}>{when.label}</span>
            </div>
            <div className="trip-card-title">{t.title}</div>
            <div className="trip-card-dates">
              {formatDateRange(t.startDate, t.endDate)}{nights > 0 && ` · ${nights} night${nights !== 1 ? 's' : ''}`}
            </div>
            <div className="trip-card-foot">
              <span>{t.groupTitle}</span>
              <span>{t.itemCount} item{t.itemCount !== 1 ? 's' : ''}</span>
            </div>
          </button>
        )
      })}
    </div>
  )
}

export default TripList
