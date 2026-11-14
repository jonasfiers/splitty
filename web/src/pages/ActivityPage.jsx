import { useState, useEffect, useMemo, useCallback } from 'react'
import Picker from '../components/Picker/Picker.jsx'
import LoadFailed from '../components/LoadFailed.jsx'
import { Link } from 'react-router'
import { formatCurrency } from '../utils/currency'
import Loading from '../components/Loading.jsx'
import { useMediaQuery } from '../utils/useMediaQuery.js'
import TabHeader from '../components/PageHeader/TabHeader.jsx'
import { tintClass, moneyTile } from '../utils/categoryColours.js'
import { activityLink, activityVerb, activityMatches, activityIcon, activityTone, isTripActivity, isDeletedActivity, actionOf } from '../utils/activity.js'
import { summarizeChanges } from '../utils/expenseChanges.js'
import EmptyState from '../components/EmptyState/EmptyState.jsx'
import { waitAtMost } from '../utils/pageGate.jsx'
import { swrOne } from '../utils/cache.js'
import Icon from '../components/Icon/Icon.jsx'

const PAGE = 50
// Nothing chosen means everything: tapping the active chip again clears it.
const CONTEXTS = [
  { key: 'expenses', label: 'Expenses' },
  { key: 'trips', label: 'Trips' },
]
const ACTIONS = [
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
  // '' for everything, 'g:<id>' for a group (its trips included), 't:<id>' for one trip.
  const [scope, setScope] = useState('')
  const [trips, setTrips] = useState([])
  const [shown, setShown] = useState(PAGE)
  // Same breakpoint as the other two-column pages (see index.css).
  const wide = useMediaQuery('(min-width: 1180px)')

  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => { setError(null); setLoading(true); setAttempt(n => n + 1) }, [])

  useEffect(() => {
    // Each the last state at once, then fresh (utils/cache.js).
    const fresh = { fresh: attempt > 0 }
    // Group names and icons are a nice-to-have: without them the rows just omit the group.
    const groups = swrOne('/dash/groups', r => setGroups(new Map((r.data.groups || []).map(g => [g.id, g]))), fresh)
    // Likewise the trips, for the group-or-trip picker.
    const trips = swrOne('/trips', r => setTrips(r.data.trips || []), fresh)
    const feed = swrOne('/dash/activity', r => setActivities(r.data.activities || []), fresh)
    const extra = ({ cached, fresh }) => (cached ? null : waitAtMost(fresh))
    if (feed.cached && groups.cached && trips.cached) setLoading(false)
    // The feed shows with them, so names don't pop in; for them it waits at
    // most 1.5 s (utils/pageGate.jsx).
    Promise.all([feed.fresh, extra(groups), extra(trips)])
      .catch(err => { if (!feed.cached) setError(err) })
      .finally(() => setLoading(false))
  }, [attempt])

  const filtered = useMemo(
    () => {
      const [kind, id] = scope ? scope.split(':') : []
      return activities.filter(a => activityMatches(a, kind === 't' ? 'all' : context, action)
        && (!kind || (kind === 'g' ? a.groupId === id : a.tripId === id)))
    },
    [activities, context, action, scope],
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

  const pickContext = key => { setContext(c => (c === key ? 'all' : key)); setShown(PAGE) }
  const pickAction = key => { setAction(a => (a === key ? 'all' : key)); setShown(PAGE) }
  const pickScope = value => { setScope(value); setShown(PAGE) }

  if (loading) return <Loading />

  const header = (
    <TabHeader title="Activity" />
  )

  if (error) return (
    <>
      {header}
      <LoadFailed error={error} what="the activity" onRetry={retry} />
    </>
  )

  if (activities.length === 0) return (
    <>
      {header}
      <EmptyState title="No activity yet">When expenses are added or updated, they'll show up here.</EmptyState>
    </>
  )

  // The picker: each group, with its trips under it.
  const tripsOf = gid => trips.filter(t => t.groupId === gid)
  const scopeLabel = (() => {
    const [kind, id] = scope ? scope.split(':') : []
    const thing = kind === 'g' ? groups.get(id) : kind === 't' ? trips.find(t => t.id === id) : null
    return thing ? thing.title : 'All groups'
  })()
  const showPicker = groups.size > 1 || trips.length > 0
  const tripScope = scope.startsWith('t:')

  const filters = (
    <div className="act-filters">
      <div className="filter-chips" role="group" aria-label="Filter the activity">
        {showPicker && (
          <Picker
            variant="chip"
            title="Show activity of"
            aria-label={`Group or trip: ${scopeLabel}`}
            value={scope}
            onChange={pickScope}
            options={[
              { value: '', label: 'All groups and trips', short: 'All groups' },
              ...[...groups.values()].flatMap(g => [
                { value: `g:${g.id}`, label: g.title, icon: <Icon name={g.icon} fallback="users" /> },
                ...tripsOf(g.id).map(t => ({ value: `t:${t.id}`, label: t.title, icon: <Icon name={t.icon} fallback="luggage" />, indent: true })),
              ]),
            ]}
          />
        )}
        {/* With one trip picked there is nothing left to choose between. */}
        {!tripScope && CONTEXTS.map(t => (
          <button key={t.key} type="button" className={`chip${context === t.key ? ' active' : ''}`} aria-pressed={context === t.key} onClick={() => pickContext(t.key)}>{t.label}</button>
        ))}
        <span className="chip-sep" aria-hidden="true">·</span>
        {ACTIONS.map(t => (
          <button key={t.key} type="button" className={`chip${action === t.key ? ' active' : ''}`} aria-pressed={action === t.key} onClick={() => pickAction(t.key)}>{t.label}</button>
        ))}
      </div>
    </div>
  )

  const summary = (
    <div className="card act-summary">
      <div className="section-label act-card-label">Last 7 days</div>
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
    <EmptyState compact art={false} title="Nothing matches these filters"
      action={<button type="button" className="btn btn-ghost btn-sm" onClick={() => { setContext('all'); setAction('all'); setScope(''); setShown(PAGE) }}>Clear filters</button>} />
  ) : (
    <>
      {days.map(([key, items]) => (
        <section key={key} className="act-day">
          <div className="section-label act-day-label">{dayLabel(key)}</div>
          <div className="card act-day-card">
            {items.map((a, i) => {
              const g = groups.get(a.groupId)
              const trip = isTripActivity(a)
              const to = activityLink(a)
              const Row = to ? Link : 'div'
              return (
                <Row
                  key={`${a.kind}-${a.expenseId || a.itemId || a.tripId}-${a.timestamp}-${i}`}
                  className={`act-row${isDeletedActivity(a) ? ' act-row-deleted' : ''}`}
                  {...(to && { to })}
                >
                  <div className={`act-icon ${a.kind === 'expense' && !a.isSettlement && !a.isTransfer ? tintClass(a.categoryColour) : ''}${a.isSettlement || a.isTransfer ? ' money' : ''}`.trim()} style={moneyTile(a)}>
                    <span aria-hidden="true"><Icon name={activityIcon(a)} /></span>
                    <ActionBadge action={activityTone(a)} />
                  </div>
                  <div className="act-text">
                    <div className="act-desc">{a.description}</div>
                    <div className="act-meta">
                      {g && groups.size > 1 && <>{g.title} · </>}
                      {a.userName} {activityVerb(a, { settled: 'recorded a settlement' })}
                    </div>
                    {a.changes?.length > 0 && <div className="act-changes">{summarizeChanges(a.changes)}</div>}
                  </div>
                  <div className="act-end">
                    {!trip && <div className="act-amt">{formatCurrency(a.amount, a.currencyIso)}</div>}
                    <div className="act-meta">{timeLabel(a.timestamp)}</div>
                  </div>
                </Row>
              )
            })}
          </div>
        </section>
      ))}
      {filtered.length > shown && (
        <button className="btn btn-secondary btn-block load-more" onClick={() => setShown(n => n + PAGE)}>
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
              <div className="section-label act-card-label">Show</div>
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
