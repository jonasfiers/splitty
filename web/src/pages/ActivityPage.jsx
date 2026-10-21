import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router'
import client from '../api/client'
import { formatCurrency } from '../utils/currency'
import Loading from '../components/Loading.jsx'
import { useMediaQuery } from '../utils/useMediaQuery.js'

const PAGE = 50
const TYPES = [
  { key: 'all', label: 'All' },
  { key: 'added', label: 'Added' },
  { key: 'edited', label: 'Edited' },
  { key: 'settlements', label: 'Settlements' },
]

const typeOf = a => (a.isSettlement ? 'settlements' : a.action === 'CREATED_BY' ? 'added' : 'edited')

const dayKey = ts => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dayLabel(key) {
  const today = dayKey(Date.now())
  const yesterday = dayKey(Date.now() - 86400000)
  if (key === today) return 'Today'
  if (key === yesterday) return 'Yesterday'
  const d = new Date(`${key}T12:00:00`)
  return d.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
    ...(d.getFullYear() !== new Date().getFullYear() && { year: 'numeric' }),
  })
}

const timeLabel = ts => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

export default function ActivityPage() {
  const [activities, setActivities] = useState([])
  const [groups, setGroups] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [type, setType] = useState('all')
  const [groupId, setGroupId] = useState('')
  const [shown, setShown] = useState(PAGE)
  const navigate = useNavigate()
  // Same breakpoint as the other two-column pages (see index.css).
  const wide = useMediaQuery('(min-width: 1180px)')

  useEffect(() => {
    client.get('/dash/activity')
      .then(r => setActivities(r.data.activities || []))
      .catch(() => setError('Activity could not be loaded. Please refresh the page.'))
      .finally(() => setLoading(false))
    // Group names and icons are a nice-to-have: without them the rows just omit the group.
    client.get('/dash/groups')
      .then(r => setGroups(new Map((r.data.groups || []).map(g => [g.id, g]))))
      .catch(() => {})
  }, [])

  const filtered = useMemo(
    () => activities.filter(a => (type === 'all' || typeOf(a) === type) && (!groupId || a.groupId === groupId)),
    [activities, type, groupId],
  )

  const days = useMemo(() => {
    const byDay = new Map()
    for (const a of filtered.slice(0, shown)) {
      const key = dayKey(a.timestamp)
      if (!byDay.has(key)) byDay.set(key, [])
      byDay.get(key).push(a)
    }
    return [...byDay]
  }, [filtered, shown])

  const week = useMemo(() => {
    const since = Date.now() - 7 * 86400000
    const recent = activities.filter(a => a.timestamp >= since)
    const people = new Map()
    for (const a of recent) people.set(a.userName, (people.get(a.userName) || 0) + 1)
    const [topName, topCount] = [...people].sort((x, y) => y[1] - x[1])[0] || []
    return {
      total: recent.length,
      added: recent.filter(a => typeOf(a) === 'added').length,
      settlements: recent.filter(a => typeOf(a) === 'settlements').length,
      topName, topCount,
    }
  }, [activities])

  const pickType = key => { setType(key); setShown(PAGE) }
  const pickGroup = id => { setGroupId(id); setShown(PAGE) }

  if (loading) return <Loading />

  const header = (
    <div className="page-header">
      <span className="page-title">Activity</span>
    </div>
  )

  if (error) return (
    <>
      {header}
      <p className="error">{error}</p>
    </>
  )

  if (activities.length === 0) return (
    <>
      {header}
      <div className="empty-state">
        <img src="/cat-empty.svg" alt="" />
        <p className="empty-state-title">No activity yet</p>
        <p className="empty-state-sub">When expenses are added or updated, they'll show up here.</p>
      </div>
    </>
  )

  const filters = (
    <div className="act-filters">
      <div className="filter-chips">
        {TYPES.map(t => (
          <button key={t.key} className={`chip${type === t.key ? ' active' : ''}`} onClick={() => pickType(t.key)}>{t.label}</button>
        ))}
      </div>
      {groups.size > 1 && (
        <div className="form-group" style={{ marginBottom: 0 }}>
          <select value={groupId} onChange={e => pickGroup(e.target.value)} aria-label="Group">
            <option value="">All groups</option>
            {[...groups.values()].map(g => <option key={g.id} value={g.id}>{g.icon ? `${g.icon} ` : ''}{g.title}</option>)}
          </select>
        </div>
      )}
    </div>
  )

  const summary = (
    <div className="card act-summary">
      <div className="section-label" style={{ padding: 0, margin: '0 0 8px' }}>Last 7 days</div>
      {week.total === 0 ? (
        <div className="act-summary-line">Nothing changed this week.</div>
      ) : (
        <>
          <div className="act-summary-big">{week.total} change{week.total !== 1 ? 's' : ''}</div>
          <div className="act-summary-line">
            {week.added} added{week.settlements > 0 && ` · ${week.settlements} settlement${week.settlements !== 1 ? 's' : ''}`}
          </div>
          {week.topName && <div className="act-summary-line">Most active: {week.topName} ({week.topCount})</div>}
        </>
      )}
    </div>
  )

  const feed = filtered.length === 0 ? (
    <div className="empty-state" style={{ padding: '32px 24px' }}>
      <p style={{ color: 'var(--text-3)', fontSize: 14 }}>Nothing matches these filters.</p>
    </div>
  ) : (
    <>
      {days.map(([key, items]) => (
        <section key={key} className="act-day">
          <div className="section-label act-day-label">{dayLabel(key)}</div>
          <div className="card act-day-card">
            {items.map((a, i) => {
              const g = groups.get(a.groupId)
              const kind = typeOf(a)
              return (
                <div
                  key={`${a.expenseId}-${a.timestamp}-${i}`}
                  className="act-row"
                  onClick={() => a.groupId && navigate(`/groups/${a.groupId}/expenses/${a.expenseId}`)}
                >
                  <div className={`act-icon ${kind}`}>{kind === 'settlements' ? '✓' : kind === 'added' ? '＋' : '✎'}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="act-desc">{a.description}</div>
                    <div className="act-meta">
                      {g && <>{g.icon ? `${g.icon} ` : ''}{g.title} · </>}
                      {a.userName} {kind === 'settlements' ? 'recorded a settlement' : kind === 'added' ? 'added' : 'updated'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div className="act-amt">{formatCurrency(a.amount, a.currencyIso)}</div>
                    <div className="act-meta">{timeLabel(a.timestamp)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ))}
      {filtered.length > shown && (
        <button className="btn-outline-amber" style={{ width: '100%', marginTop: 8 }} onClick={() => setShown(n => n + PAGE)}>
          Load more
        </button>
      )}
    </>
  )

  return (
    <>
      {header}
      <div className="act-layout">
        <div className="act-main">
          {!wide && filters}
          {feed}
        </div>
        {wide && (
          <aside className="act-aside">
            {summary}
            <div className="card">
              <div className="section-label" style={{ padding: 0, margin: '0 0 8px' }}>Show</div>
              {filters}
            </div>
          </aside>
        )}
      </div>
    </>
  )
}
