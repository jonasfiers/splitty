import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import client from '../api/client'
import { formatCurrency } from '../utils/currency.js'
import { timeAgo } from '../utils/time.js'
import { today, daysBetween, formatDateRange } from '../utils/trip.js'

const RECENT = 5
const TOP_CATEGORIES = 3

// Home's extra context: this month's spending, the next trip and the latest
// activity. Each panel loads on its own and simply stays away if its data
// fails to load, so the groups list never waits on or breaks because of them.
export default function HomePanels() {
  const [monthly, setMonthly] = useState(null)
  const [trips, setTrips] = useState(null)
  const [activity, setActivity] = useState(null)

  useEffect(() => {
    client.get('/dash/insights').then(r => setMonthly(r.data.monthly || [])).catch(() => {})
    client.get('/trips').then(r => setTrips(r.data.trips || [])).catch(() => {})
    client.get('/dash/activity').then(r => setActivity(r.data.activities || [])).catch(() => {})
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
        <span className="section-label" style={{ padding: 0, margin: 0 }}>This month</span>
        <Link to="/insights" className="home-panel-link">Insights</Link>
      </div>
      <div className="home-month-total">{formatCurrency(total)}</div>
      <div className="home-panel-sub">
        spent across your groups
        {change !== null && (
          <> · <span className={change > 0 ? 'home-up' : 'home-down'}>{change > 0 ? '+' : ''}{change}%</span> vs last month</>
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
  const next = trips.filter(t => t.endDate >= now).sort((a, b) => a.startDate.localeCompare(b.startDate))[0]
  if (!next) return null
  const days = daysBetween(now, next.startDate)
  const when = days <= 0 ? 'Happening now' : days === 1 ? 'Tomorrow' : `In ${days} days`

  return (
    <Link to={`/trips/${next.id}`} className="card home-panel home-trip">
      <div className="home-panel-head">
        <span className="section-label" style={{ padding: 0, margin: 0 }}>Up next</span>
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
    <div className="card home-panel">
      <div className="home-panel-head">
        <span className="section-label" style={{ padding: 0, margin: 0 }}>Recent activity</span>
        <Link to="/activity" className="home-panel-link">All</Link>
      </div>
      {activity.slice(0, RECENT).map((a, i) => (
        <Link
          key={i}
          to={a.groupId ? `/groups/${a.groupId}/expenses/${a.expenseId}` : '/activity'}
          className="home-activity-row"
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="home-activity-desc">{a.description}</div>
            <div className="home-panel-sub">
              {a.userName} {a.isSettlement ? 'settled up' : a.action === 'CREATED_BY' ? 'added' : 'updated'} · {timeAgo(a.timestamp)}
            </div>
          </div>
          <span className="home-activity-amt">{formatCurrency(a.amount, a.currencyIso)}</span>
        </Link>
      ))}
    </div>
  )
}
