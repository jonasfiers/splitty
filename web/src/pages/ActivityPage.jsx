import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router'
import client from '../api/client'
import { formatCurrency } from '../utils/currency'
import Loading from '../components/Loading.jsx'
import { useMediaQuery } from '../utils/useMediaQuery.js'
import TabHeader from '../components/PageHeader/TabHeader.jsx'
import { activityLink, activityVerb, activityMatches, activityIcon, activityTone, isTripActivity, isDeletedActivity, actionOf } from '../utils/activity.js'
import { summarizeChanges } from '../utils/expenseChanges.js'

const PAGE = 50
const CONTEXTS = [
  { key: 'all', label: 'All' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'trips', label: 'Trips' },
]
const ACTIONS = [
  { key: 'all', label: 'Any change' },
  { key: 'added', label: 'Added' },
  { key: 'edited', label: 'Edited' },
  { key: 'deleted', label: 'Deleted' },
]

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
  const [context, setContext] = useState('all')
  const [action, setAction] = useState('all')
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
    () => activities.filter(a => activityMatches(a, context, action) && (!groupId || a.groupId === groupId)),
    [activities, context, action, groupId],
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
      added: recent.filter(a => actionOf(a) === 'added').length,
      deleted: recent.filter(a => actionOf(a) === 'deleted').length,
      topName, topCount,
    }
  }, [activities])

  const pickContext = key => { setContext(key); setShown(PAGE) }
  const pickAction = key => { setAction(key); setShown(PAGE) }
  const pickGroup = id => { setGroupId(id); setShown(PAGE) }

  if (loading) return <Loading />

  const header = (
    <TabHeader title="Activity" />
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
      <div className="filter-chips" role="group" aria-label="Show">
        {CONTEXTS.map(t => (
          <button key={t.key} className={`chip${context === t.key ? ' active' : ''}`} aria-pressed={context === t.key} onClick={() => pickContext(t.key)}>{t.label}</button>
        ))}
      </div>
      <div className="filter-chips act-actions" role="group" aria-label="Change">
        {ACTIONS.map(t => (
          <button key={t.key} className={`chip chip-sm${action === t.key ? ' active' : ''}`} aria-pressed={action === t.key} onClick={() => pickAction(t.key)}>{t.label}</button>
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
            {week.added} added{week.deleted > 0 && ` · ${week.deleted} deleted`}
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
              const trip = isTripActivity(a)
              return (
                <div
                  key={`${a.kind}-${a.expenseId || a.itemId || a.tripId}-${a.timestamp}-${i}`}
                  className={`act-row${isDeletedActivity(a) ? ' act-row-deleted' : ''}`}
                  onClick={() => { const to = activityLink(a); if (to) navigate(to) }}
                >
                  <div className="act-icon">
                    <span aria-hidden="true">{activityIcon(a)}</span>
                    <ActionBadge action={activityTone(a)} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="act-desc">{a.description}</div>
                    <div className="act-meta">
                      {g && <>{g.icon ? `${g.icon} ` : ''}{g.title} · </>}
                      {a.userName} {activityVerb(a, { settled: 'recorded a settlement' })}
                    </div>
                    {a.changes?.length > 0 && <div className="act-changes">{summarizeChanges(a.changes)}</div>}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    {!trip && <div className="act-amt">{formatCurrency(a.amount, a.currencyIso)}</div>}
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

// Drawn, not typed: text glyphs (+ ✎ ×) sit at different heights in the
// font and never centre exactly in a badge this small.
const BADGE_PATHS = {
  added: 'M12 6v12M6 12h12',
  edited: 'M15.5 5.5l3 3L9 18l-4 1 1-4z',
  deleted: 'M7 7l10 10M17 7L7 17',
}
function ActionBadge({ action }) {
  return (
    <span className={`act-badge ${action}`} aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d={BADGE_PATHS[action]} /></svg>
    </span>
  )
}
