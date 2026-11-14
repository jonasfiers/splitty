import { useState, useEffect, useMemo, Fragment, useCallback } from 'react'
import LoadFailed from '../components/LoadFailed.jsx'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, Label } from 'recharts'
import { Link, useSearchParams } from 'react-router'
import { formatCurrency, formatCompactCurrency } from '../utils/currency.js'
import Loading from '../components/Loading.jsx'
import { chartColour } from '../utils/categoryColours.js'
import { useTheme } from '../context/ThemeContext.jsx'
import TabHeader from '../components/PageHeader/TabHeader.jsx'
import Picker from '../components/Picker/Picker.jsx'
import EmptyState from '../components/EmptyState/EmptyState.jsx'
import { swr, swrOne } from '../utils/cache.js'
import Icon from '../components/Icon/Icon.jsx'
const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const PERIODS = [
  { key: 'month', label: 'This month' },
  { key: '3m', label: '3 months' },
  { key: '12m', label: '12 months' },
  { key: 'all', label: 'All time' },
]

// First day (YYYY-MM-DD) of the selected period, or null for all time.
function periodStart(period) {
  const now = new Date()
  const first = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}-01`
  if (period === 'month') return first(now.getFullYear(), now.getMonth())
  if (period === '3m') {
    const d = new Date(now.getFullYear(), now.getMonth() - 2, 1)
    return first(d.getFullYear(), d.getMonth())
  }
  if (period === '12m') {
    // The current month and the 11 before it: what the monthly chart shows.
    const d = new Date(now.getFullYear(), now.getMonth() - 11, 1)
    return first(d.getFullYear(), d.getMonth())
  }
  return null
}

// The period is remembered on this device; 12 months unless changed.
const PERIOD_KEY = 'splitty.insightsPeriod'
const savedPeriod = () => {
  try { const p = localStorage.getItem(PERIOD_KEY); return PERIODS.some(x => x.key === p) ? p : '12m' } catch { return '12m' }
}

// What the group picker can say: a group's id, "iso:GBP" (all groups in
// pounds) or '' (all groups; with groups in several currencies, all groups in
// the main one). The API sums in each group's own currency, so groups in
// different currencies are never added together.
const ISO_PREFIX = 'iso:'
// The currency most groups use; a tie goes to the group used most recently.
function mainCurrency(groups) {
  const count = new Map()
  for (const g of groups) if (g.iso) count.set(g.iso, (count.get(g.iso) || 0) + 1)
  const best = Math.max(0, ...count.values())
  const tied = new Set([...count].filter(([, n]) => n === best).map(([iso]) => iso))
  return [...groups].sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0)).find(g => tied.has(g.iso))?.iso
}

const shortMonth = m => {
  const [y, mo] = m.split('-')
  return new Date(+y, +mo - 1).toLocaleString('default', { month: 'short' })
}



export default function InsightsPage() {
  useTheme() // the charts' colours follow the theme (utils/categoryColours.js)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [hiddenMonthly, setHiddenMonthly] = useState([])
  const [hiddenPie, setHiddenPie] = useState([])
  const [activeCategory, setActiveCategory] = useState(null)
  // The heatmap square shown below it: hovered (mouse) or picked (tap, keys).
  const [hoveredCell, setHoveredCell] = useState(null)
  const [pickedCell, setPickedCell] = useState(null)
  const [period, setPeriodState] = useState(savedPeriod)
  const setPeriod = p => { setPeriodState(p); try { localStorage.setItem(PERIOD_KEY, p) } catch { /* private mode */ } }
  // ?group=<id>: opened from a group's total.
  const [searchParams] = useSearchParams()
  const [sel, setSel] = useState(() => searchParams.get('group') || '')
  const [scope, setScope] = useState('group')
  const [groups, setGroups] = useState(null) // null: not known yet
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  // The groups first (usually kept from Home): which currencies there are
  // decides what "all groups" may add up.
  useEffect(() => {
    swrOne('/dash/groups', r => setGroups(r.data.groups || [])).fresh.catch(() => setGroups(g => g || []))
  }, [])
  const currencies = useMemo(() => [...new Set((groups || []).map(g => g.iso).filter(Boolean))], [groups])
  const groupsKnown = groups !== null
  const mixed = currencies.length > 1
  const main = mixed ? mainCurrency(groups) : null
  // The currency asked for (null: whatever all the groups share) and the group.
  const isoFilter = sel.startsWith(ISO_PREFIX) ? sel.slice(ISO_PREFIX.length) : !sel ? main : null
  const groupFilter = sel && !sel.startsWith(ISO_PREFIX) ? sel : null
  const iso = isoFilter || (groupFilter && groups?.find(g => g.id === groupFilter)?.iso) || currencies[0] || 'EUR'

  // Refetch on every filter change; the previous figures stay up (dimmed) meanwhile.
  // The first load failing (nothing to show yet): the "couldn't load" state.
  const [loadError, setLoadError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => { setLoadError(null); setLoading(true); setAttempt(n => n + 1) }, [])

  useEffect(() => {
    if (!groupsKnown) return
    let current = true
    const from = periodStart(period)
    // Each selection's last figures at once (utils/cache.js), then fresh.
    const params = { ...(from && { from }), ...(groupFilter && { groupId: groupFilter }), ...(isoFilter && { iso: isoFilter }), ...(scope === 'mine' && { scope }) }
    const { cached, fresh } = swr([['/dash/insights', { params }]], ([r]) => {
      if (current) { setData(r.data); setError(''); setActiveCategory(null); setHiddenPie([]); setPickedCell(null) }
    }, { fresh: attempt > 0 })
    if (cached) setLoading(false)
    else setRefreshing(true)
    fresh
      .catch(err => { if (current && !cached) { setError('Insights could not be loaded. Please try again.'); setLoadError(err) } })
      .finally(() => { if (current) { setLoading(false); setRefreshing(false) } })
    return () => { current = false }
  }, [period, groupFilter, isoFilter, scope, attempt, groupsKnown])

  const { monthly, categories, chartData, stackKeys, members, dowMatrix, dowMax } = useMemo(() => {
    if (!data) return { monthly: [], categories: [], chartData: [], stackKeys: [], members: [], dowMatrix: [], dowMax: 1 }
    const { monthly, categories, members = [], byDow = [] } = data
    
    // Group all category spending by their root name for the bar chart
    const rootTotals = {}
    categories.forEach(c => {
      const rName = c.name.split(' - ')[0]
      rootTotals[rName] = (rootTotals[rName] || 0) + c.total
    })
    
    const sortedRootNames = Object.entries(rootTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(e => e[0])

    const chartData = monthly.map(m => {
      const row = { month: m.month, total: m.total }
      let otherSum = 0
      m.breakdown.forEach(b => {
        const rootName = b.name.split(' - ')[0]
        if (sortedRootNames.includes(rootName)) {
          row[rootName] = (row[rootName] || 0) + b.amount
        } else {
          otherSum += b.amount
        }
      })
      if (otherSum > 0) row['Other'] = (row['Other'] || 0) + otherSum
      return row
    })

    const stackKeys = [...sortedRootNames]
    if (chartData.some(d => d.Other > 0)) stackKeys.push('Other')

    const dowMax = Math.max(...(byDow.length ? byDow.map(d => d.total) : [0]), 1)
    const dowMatrix = Array.from({ length: 5 }, (_, w) =>
      Array.from({ length: 7 }, (_, d) => {
        const found = byDow.find(r => r.weekOfMonth === w + 1 && r.dow === d + 1)
        return { total: found?.total || 0, count: found?.count || 0 }
      })
    )

    return { monthly, categories, chartData, stackKeys, members, dowMatrix, dowMax }
  }, [data])

  const rootNames = useMemo(() => {
    if (!categories) return []
    return [...new Set(categories.map(c => c.name.split(' - ')[0]))]
  }, [categories])

  const { displayCategories, totalPieAmount } = useMemo(() => {
    if (!categories || !categories.length) return { displayCategories: [], totalPieAmount: 0 }

    const groups = {}
    const activePath = activeCategory || ''
    const depth = activeCategory ? activeCategory.split(' - ').length : 0

    categories.forEach(c => {
      const rootName = c.name.split(' - ')[0]
      if (activeCategory && c.name === activeCategory) {
        groups['__other__'] = groups['__other__'] || { id: '__other__', name: 'Other', fullPath: null, rootName, icon: c.icon, total: 0, hasChildren: false, _iconDepth: Infinity }
        groups['__other__'].total += c.total
      } else if (!activeCategory || c.name.startsWith(`${activePath} - `)) {
        // Spending in a sub-category of the current active category
        const parts = c.name.split(' - ')
        const nextPartName = parts[depth]
        if (nextPartName) {
          const nextFullPath = parts.slice(0, depth + 1).join(' - ')
          if (!groups[nextFullPath]) {
            groups[nextFullPath] = {
              id: nextFullPath,
              name: nextPartName,
              fullPath: nextFullPath,
              rootName,
              icon: c.icon,
              _iconDepth: parts.length,
              total: 0,
              hasChildren: false
            }
          }
          groups[nextFullPath].total += c.total
          if (parts.length > depth + 1) groups[nextFullPath].hasChildren = true
          if (parts.length < groups[nextFullPath]._iconDepth) {
            groups[nextFullPath].icon = c.icon
            groups[nextFullPath]._iconDepth = parts.length
          }
        }
      }
    })

    const result = Object.values(groups).map(({ _iconDepth, ...g }) => g)
    return { 
      displayCategories: result.sort((a, b) => b.total - a.total), 
      totalPieAmount: result
        .filter(c => !hiddenPie.includes(c.id))
        .reduce((sum, c) => sum + c.total, 0)
    }
  }, [categories, activeCategory, hiddenPie])

  const toggleMonthly = (name) => {
    setHiddenMonthly(prev =>
      prev.includes(name) ? prev.filter(c => c !== name) : [...prev, name]
    )
  }

  const togglePie = (id) => {
    setHiddenPie(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    )
  }

  // Each category in its top-level category's colour; "Other", "Uncategorized"
  // and anything unknown in the theme's neutral greys.
  const rootColours = Object.fromEntries((categories || []).map(c => [c.name.split(' - ')[0], c.colour]))
  const getCategoryColor = rootName => chartColour(rootColours[rootName]).fill
  const getCategoryStroke = rootName => chartColour(rootColours[rootName]).stroke
  // In the donut, the 2nd, 3rd… slice of one colour (subcategories) gets a deeper fill.
  const seenColour = {}
  const pieColours = displayCategories.map(c => {
    const key = c.id === '__other__' ? null : rootColours[c.rootName]
    const shade = key ? (seenColour[key] = (seenColour[key] ?? -1) + 1) : 0
    return chartColour(key, shade)
  })

  if (loading) return <Loading />
  if (!data && loadError) return <LoadFailed error={loadError} what="the insights" onRetry={retry} />

  const mine = scope === 'mine'
  const total = categories.reduce((sum, c) => sum + c.total, 0)
  // Average over the months the chart covers (at most the last 12).
  const months = monthly.length || 1
  const average = monthly.reduce((sum, m) => sum + m.total, 0) / months
  const topRoot = Object.entries(categories.reduce((acc, c) => {
    const root = c.name.split(' - ')[0]
    acc[root] = (acc[root] || 0) + c.total
    return acc
  }, {})).sort((a, b) => b[1] - a[1])[0]
  const topIcon = topRoot && categories.find(c => c.name.split(' - ')[0] === topRoot[0])?.icon
  const biggest = data?.biggest

  const controls = (
    <div className="insights-controls">
      <div className="filter-chips">
        {PERIODS.map(p => (
          <button key={p.key} className={`chip${period === p.key ? ' active' : ''}`} onClick={() => setPeriod(p.key)}>{p.label}</button>
        ))}
      </div>
      <div className="insights-controls-row">
        {groups?.length > 1 && (
          <Picker
            variant="chip"
            title="Show insights for"
            aria-label="Group"
            value={sel}
            onChange={setSel}
            options={mixed
              ? [
                ...[main, ...currencies.filter(c => c !== main)].map(c => ({ value: c === main ? '' : ISO_PREFIX + c, label: `All groups in ${c}`, section: 'Together', meta: (n => `${n} group${n !== 1 ? 's' : ''}`)(groups.filter(g => g.iso === c).length) })),
                ...groups.map(g => ({ value: g.id, label: g.title, icon: g.icon, meta: g.iso, section: 'One group' })),
              ]
              : [{ value: '', label: 'All groups' }, ...groups.map(g => ({ value: g.id, label: g.title, icon: g.icon }))]}
          />
        )}
        <div className="insights-scope" role="group" aria-label="Amounts">
          <button className={`chip${!mine ? ' active' : ''}`} onClick={() => setScope('group')}>Group total</button>
          <button className={`chip${mine ? ' active' : ''}`} onClick={() => setScope('mine')}>My share</button>
        </div>
      </div>
    </div>
  )

  return (
    <>
      <TabHeader title="Insights" />
      {controls}
      {error && <p className="error">{error}</p>}

      <div className={`insights-body${refreshing ? ' refreshing' : ''}`}>
      {total > 0 && (
        <div className="insights-kpis">
          <div className="card insights-kpi">
            <div className="insights-kpi-label">{mine ? 'Your share' : 'Spent'}</div>
            <div className="insights-kpi-value">{formatCurrency(total, iso)}</div>
          </div>
          <div className="card insights-kpi">
            <div className="insights-kpi-label">Per month</div>
            <div className="insights-kpi-value">{formatCurrency(Math.round(average), iso)}</div>
            <div className="insights-kpi-sub">average over {months} month{months !== 1 ? 's' : ''}</div>
          </div>
          {topRoot && (
            <div className="card insights-kpi">
              <div className="insights-kpi-label">Top category</div>
              <div className="insights-kpi-value insights-kpi-text"><Icon name={topIcon} /> {topRoot[0]}</div>
              <div className="insights-kpi-sub">{formatCurrency(topRoot[1], iso)} · {Math.round((topRoot[1] / total) * 100)}%</div>
            </div>
          )}
          {biggest && (
            <Link to={`/groups/${biggest.groupId}/expenses/${biggest.id}`} className="card insights-kpi insights-kpi-link">
              <div className="insights-kpi-label">Biggest expense</div>
              <div className="insights-kpi-value insights-kpi-text">{biggest.description}</div>
              <div className="insights-kpi-sub">{formatCurrency(biggest.amount, iso)}{mine && ' (your share)'}</div>
            </Link>
          )}
        </div>
      )}

      {period !== 'month' && monthly.length > 0 && (
        <>
          <div className="section-label">Monthly spending</div>
          <div className="card ins-chart-card">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={chartData} barSize={28} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <XAxis dataKey="month" tickFormatter={shortMonth} tick={{ fontSize: 12, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
                <YAxis width={56} tickFormatter={v => formatCompactCurrency(v, iso)} tick={{ fontSize: 11, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ fill: 'var(--surface-2)' }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload
                    return (
                      <div className="ins-tip ins-tip-wide">
                        <div className="ins-tip-head">{shortMonth(d.month)} {d.month.split('-')[0]}</div>
                        <div className="ins-tip-rows">
                          {stackKeys.map(key => (d[key] > 0 && !hiddenMonthly.includes(key)) && (
                            <div key={key} className="ins-tip-row">
                               <div className="ins-tip-key">
                                 <span className="ins-dot ins-dot-sm" style={{ background: getCategoryStroke(key) }} />
                                 <span className="ins-tip-label">{key}</span>
                               </div>
                               <span className="ins-tip-amt">{formatCurrency(d[key], iso)}</span>
                            </div>
                          ))}
                        </div>
                        <div className="ins-tip-total">
                          <span>Total</span>
                          <span className="ins-accent">{formatCurrency(d.total, iso)}</span>
                        </div>
                      </div>
                    )
                  }}
                />
                <Legend
                  verticalAlign="top"
                  align="right"
                  iconType="circle"
                  content={({ payload }) => (
                    <div className="ins-legend">
                      {payload.map((entry) => {
                        const isHidden = hiddenMonthly.includes(entry.value)
                        return (
                          <button
                            type="button"
                            key={entry.value}
                            onClick={() => toggleMonthly(entry.value)}
                            aria-pressed={!isHidden}
                            className={`ins-legend-item${isHidden ? ' hidden' : ''}`}
                          >
                            <span className="ins-dot" style={{ background: isHidden ? 'var(--border)' : getCategoryStroke(entry.value) }} />
                            {entry.value}
                          </button>
                        )
                      })}
                    </div>
                  )}
                />
                {stackKeys.map((key, i) => (
                  <Bar
                    key={key}
                    dataKey={key}
                    stackId="a"
                    fill={getCategoryColor(key)}
                    stroke={getCategoryStroke(key)}
                    strokeWidth={1}
                    hide={hiddenMonthly.includes(key)}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      <div className="insights-pair">
      {categories.length > 0 && (
        <div>
          <div className="ins-section-head">
            <div className="section-label">Spending by category</div>
            {activeCategory && (
              <div className="ins-crumbs">
                <button
                  type="button"
                  onClick={() => { setActiveCategory(null); setHiddenPie([]) }}
                  className="ins-crumb-link"
                >
                  All
                </button>
                {activeCategory.split(' - ').map((part, i, arr) => {
                  const path = arr.slice(0, i + 1).join(' - ')
                  const isLast = i === arr.length - 1
                  return (
                    <span key={path} className="ins-crumb">
                      <span className="ins-crumb-sep">/</span>
                      {isLast ? (
                        <span className="ins-crumb-current">{part}</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => { setActiveCategory(path); setHiddenPie([]) }}
                          className="ins-crumb-link"
                        >
                          {part}
                        </button>
                      )}
                    </span>
                  )
                })}
              </div>
            )}
          </div>
          <div className="card ins-pie-card">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  key={activeCategory || 'root'}
                  data={displayCategories}
                  cx="50%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={100}
                  paddingAngle={4}
                  dataKey="total"
                  strokeWidth={2}
                  stroke="var(--surface)"
                  style={{ cursor: 'pointer' }}
                  onClick={(entry) => {
                    const data = entry?.payload || entry
                    if (data && data.fullPath && data.hasChildren) {
                      setActiveCategory(data.fullPath)
                      setHiddenPie([])
                    }
                  }}
                  animationDuration={400}
                >
                  {displayCategories.map((cat, i) => (
                    <Cell
                      key={cat.id}
                      fill={pieColours[i].fill}
                      stroke={pieColours[i].stroke}
                      opacity={hiddenPie.includes(cat.id) ? 0.2 : 1}
                    />
                  ))}
                  <Label 
                    position="center"
                    content={({ viewBox: { cx, cy } }) => {
                      if (cx === undefined || cy === undefined) return null
                      const label = activeCategory ? activeCategory.split(' - ').pop() : 'Total'
                      return (
                        <g className="ins-no-pointer">
                          <text x={cx} y={cy - 10} textAnchor="middle" dominantBaseline="middle" className="ins-pie-label">
                            {label}
                          </text>
                          <text x={cx} y={cy + 16} textAnchor="middle" dominantBaseline="middle" className="ins-pie-total">
                            {formatCurrency(totalPieAmount, iso)}
                          </text>
                        </g>
                      )
                    }}
                  />
                </Pie>
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const { name, icon, total } = payload[0].payload
                const pct = totalPieAmount > 0 ? ((total / totalPieAmount) * 100).toFixed(1) : '0.0'
                  return (
                    <div className="ins-tip">
                      <div className="ins-tip-title"><Icon name={icon} /> {name}</div>
                      <div className="ins-tip-line">
                        <span className="ins-tip-amt-lg">{formatCurrency(total, iso)}</span>
                        <span className="ins-tip-pct">{pct}%</span>
                      </div>
                    </div>
                  )
                }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="ins-cat-grid">
              {displayCategories.map((cat, i) => {
                const isHidden = hiddenPie.includes(cat.id)
                const pct = totalPieAmount > 0 ? ((cat.total / totalPieAmount) * 100).toFixed(0) : 0
                return (
                  <button
                    type="button"
                    key={cat.id}
                    onClick={() => togglePie(cat.id)}
                    aria-pressed={!isHidden}
                    className={`ins-cat${isHidden ? ' hidden' : ''}`}
                  >
                    <div className="ins-cat-name-row">
                      <span className="ins-dot" style={{ background: pieColours[i].fill, boxShadow: `inset 0 0 0 2px ${pieColours[i].stroke}` }} />
                      <span className="ins-cat-name">
                        <Icon name={cat.icon} /> {cat.name}
                      </span>
                    </div>
                    <div className="ins-cat-figures">
                      <span className="ins-cat-amt">{formatCurrency(cat.total, iso)}</span>
                      <span className="ins-cat-pct">{pct}%</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {members.length > 0 && (
        <div>
          <div className="section-label">{mine ? 'Who paid for your share' : 'Paid by member'}</div>
          <div className="card ins-chart-card">
            <ResponsiveContainer width="100%" height={members.length * 44 + 16}>
              <BarChart data={members} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                <XAxis type="number" tickFormatter={v => formatCompactCurrency(v, iso)} tick={{ fontSize: 11, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 12, fill: 'var(--text-2)' }} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ fill: 'var(--surface-2)' }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const { name, total } = payload[0].payload
                    return (
                      <div className="ins-tip">
                        <div className="ins-tip-title">{name}</div>
                        <span className="ins-tip-amt-sm">{formatCurrency(total, iso)}</span>
                      </div>
                    )
                  }}
                />
                <Bar dataKey="total" fill={chartColour('blue').fill} stroke={chartColour('blue').stroke} strokeWidth={1} radius={[0, 4, 4, 0]} barSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      </div>

      {dowMatrix.some(row => row.some(cell => cell.total > 0)) && (
        <>
          <div className="section-label">Spending by day of week</div>
          <div className="card ins-heat-card">
            <div className="ins-heat">
              <div />
              {DOW_LABELS.map(d => (
                <div key={d} className="ins-heat-day">{d}</div>
              ))}
              {dowMatrix.map((row, w) => (
                <Fragment key={w}>
                  <div className="ins-heat-week">Wk {w + 1}</div>
                  {row.map((cell, d) => {
                    const intensity = cell.total > 0 ? Math.sqrt(cell.total / dowMax) : 0
                    const picked = pickedCell?.w === w && pickedCell?.d === d
                    return (
                      <button
                        type="button"
                        key={d}
                        // Mouse: hover shows it. Touch and keys: a tap or focus
                        // picks it, and it stays until another one is picked.
                        onMouseEnter={() => setHoveredCell({ w, d, ...cell })}
                        onMouseLeave={() => setHoveredCell(null)}
                        onFocus={() => setPickedCell({ w, d, ...cell })}
                        onClick={() => setPickedCell({ w, d, ...cell })}
                        aria-label={`${DOW_LABELS[d]}, week ${w + 1}: ${cell.total > 0 ? `${formatCurrency(cell.total, iso)}, ${cell.count} expense${cell.count !== 1 ? 's' : ''}` : 'nothing'}`}
                        className={`ins-heat-cell${picked ? ' picked' : ''}`}
                        style={cell.total > 0 ? { background: `color-mix(in srgb, var(--tint-blue-fg) ${Math.round((0.12 + intensity * 0.88) * 100)}%, transparent)` } : undefined}
                      />
                    )
                  })}
                </Fragment>
              ))}
            </div>
            <div className="ins-heat-caption" aria-live="polite">
              {(() => {
                const c = hoveredCell || pickedCell
                if (!c) return 'Tap a square to see what was spent'
                const when = `${DOW_LABELS[c.d]}, week ${c.w + 1}`
                return c.total > 0
                  ? <>{when} · <span className="ins-heat-amt">{formatCurrency(c.total, iso)}</span> · {c.count} expense{c.count !== 1 ? 's' : ''}</>
                  : `${when} · nothing spent`
              })()}
            </div>
          </div>
        </>
      )}

      {!error && total === 0 && (
        !sel && (period === '12m' || period === 'all')
          ? <EmptyState title="No insights yet">Add some expenses and they'll show up here.</EmptyState>
          : <EmptyState compact art={false} title="No expenses in this selection" />
      )}
      </div>
    </>
  )
}
