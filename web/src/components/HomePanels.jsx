import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { List, ListRow } from './List/List.jsx'
import { formatCurrency } from '../utils/currency.js'
import { timeAgo } from '../utils/time.js'
import { today, daysBetween, formatDateRange } from '../utils/trip.js'
import { isActive } from './TodayTrip.jsx'
import { activityLink, activityVerb, isTripActivity } from '../utils/activity.js'
import { useGate } from '../utils/pageGate.jsx'
import { swrOne } from '../utils/cache.js'

const RECENT = 5
const TOP_CATEGORIES = 3

// Home's extra context: this month's spending, the next trip and the latest
// activity. Each panel loads on its own and simply stays away if its data
// fails to load, so the groups list never waits on or breaks because of them.
export default function HomePanels() {
  const [monthly, setMonthly] = useState(null)
  const [trips, setTrips] = useState(null)
  const [activity, setActivity] = useState(null)
  const gate = useGate() // Home shows once these are in too (utils/pageGate.jsx)

  useEffect(() => {
    // Each shows its last state at once (utils/cache.js); Home waits only for what wasn't kept.
    for (const [url, apply] of [
      ['/dash/insights', r => setMonthly(r.data.monthly || [])],
      ['/trips', r => setTrips(r.data.trips || [])],
      ['/dash/activity', r => setActivity(r.data.activities || [])],
    ]) {
      const { cached, fresh } = swrOne(url, apply)
      const done = fresh.catch(() => {})
      if (!cached) gate(done)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="home-panels">
      <ThisMonth monthly={monthly} />
      <NextTrip trips={trips} />
      <RecentActivity activity={activity} />
    </div>
  )
}

function ThisMonth({ monthly }) {
  if (!monthly) return null
  const now = today().slice(0, 7)
  const prevDate = new Date(`${now}-01T00:00:00Z`)
  prevDate.setUTCMonth(prevDate.getUTCMonth() - 1)
  const prev = prevDate.toISOString().slice(0, 7)
  const current = monthly.find(m => m.month === now)
  const last = monthly.find(m => m.month === prev)
  const total = current?.total ?? 0
  const change = last?.total ? Math.round(((total - last.total) / last.total) * 100) : null
  const top = (current?.breakdown ?? []).slice(0, TOP_CATEGORIES)
  const max = top[0]?.amount || 1

  return (
    <div className="card home-panel">
      <div className="home-panel-head">
        <span className="section-label home-panel-label">This month</span>
        <Link to="/insights" className="home-panel-link">Insights</Link>
      </div>
      <div className="home-month-total">{formatCurrency(total)}</div>
      <div className="home-panel-sub">
        spent across your groups
        {change !== null && (
          <> · <span className={change > 0 ? 'home-up' : 'home-down'}>{change > 0 ? '↑' : change < 0 ? '↓' : ''}{Math.abs(change)}%</span> vs last month</>
        )}
      </div>
      {top.length > 0 && (
        <div className="home-cats">
          {top.map(c => (
            <div key={c.name} className="home-cat">
              <div className="home-cat-row">
                <span className="home-cat-name">{c.name}</span>
                <span className="home-cat-amt">{formatCurrency(c.amount)}</span>
              </div>
              <div className="home-cat-track"><div className="home-cat-bar" style={{ width: `${(c.amount / max) * 100}%` }} /></div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function NextTrip({ trips }) {
  if (!trips) return null
  const now = today()
  // A trip happening now has its own card at the top of Home.
  const next = trips.filter(t => t.endDate >= now && !isActive(t, now)).sort((a, b) => a.startDate.localeCompare(b.startDate))[0]
  if (!next) return null
  const days = daysBetween(now, next.startDate)
  const when = days <= 0 ? 'Happening now' : days === 1 ? 'Tomorrow' : `In ${days} days`

  return (
    <Link to={`/trips/${next.id}`} className="card home-panel home-trip">
      <div className="home-panel-head">
        <span className="section-label home-panel-label">Up next</span>
        <span className="home-trip-when">{when}</span>
      </div>
      <div className="home-trip-title">
        <span>{next.icon || next.groupIcon || '🧳'}</span>
        <span>{next.title}</span>
      </div>
      <div className="home-panel-sub">
        {formatDateRange(next.startDate, next.endDate)} · {next.groupTitle}
        {next.itemCount > 0 && ` · ${next.itemCount} planned`}
      </div>
    </Link>
  )
}

function RecentActivity({ activity }) {
  if (!activity?.length) return null

  return (
    <div className="card home-panel home-panel-flush">
      <div className="home-panel-head">
        <span className="section-label home-panel-label">Recent activity</span>
        <Link to="/activity" className="home-panel-link">All</Link>
      </div>
      <List className="list-flush">
        {activity.slice(0, RECENT).map((a, i) => (
          <ListRow
            key={i}
            to={activityLink(a) || '/activity'}
            title={a.description}
            meta={`${a.userName} ${activityVerb(a)} · ${timeAgo(a.timestamp)}`}
            aside={!isTripActivity(a) && <span className="list-row-amt">{formatCurrency(a.amount, a.currencyIso)}</span>}
          />
        ))}
      </List>
    </div>
  )
}
