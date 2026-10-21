import { useState, useEffect, useMemo, Fragment } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, Label } from 'recharts'
import client from '../api/client'
import { Link } from 'react-router'
import { formatCurrency, formatCompactCurrency } from '../utils/currency.js'
import Loading from '../components/Loading.jsx'
import { COLOURS, STROKES } from '../utils/chartColors.js'
const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const PERIODS = [
  { key: 'month', label: 'This month' },
  { key: '3m', label: '3 months' },
  { key: 'year', label: 'This year' },
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
  if (period === 'year') return `${now.getFullYear()}-01-01`
  return null
}

const shortMonth = m => {
  const [y, mo] = m.split('-')
  return new Date(+y, +mo - 1).toLocaleString('default', { month: 'short' })
}



export default function InsightsPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [hiddenMonthly, setHiddenMonthly] = useState([])
  const [hiddenPie, setHiddenPie] = useState([])
  const [activeCategory, setActiveCategory] = useState(null)
  const [hoveredCell, setHoveredCell] = useState(null)
  const [period, setPeriod] = useState('all')
  const [groupId, setGroupId] = useState('')
  const [scope, setScope] = useState('group')
  const [groups, setGroups] = useState([])
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    client.get('/dash/groups').then(r => setGroups(r.data.groups || [])).catch(() => {})
  }, [])

  // Refetch on every filter change; the previous figures stay up (dimmed) meanwhile.
  useEffect(() => {
    let current = true
    const from = periodStart(period)
    setRefreshing(true)
    client.get('/dash/insights', { params: { ...(from && { from }), ...(groupId && { groupId }), ...(scope === 'mine' && { scope }) } })
      .then(r => { if (current) { setData(r.data); setError(''); setActiveCategory(null); setHiddenPie([]) } })
      .catch(() => { if (current) setError('Insights could not be loaded. Please try again.') })
      .finally(() => { if (current) { setLoading(false); setRefreshing(false) } })
    return () => { current = false }
  }, [period, groupId, scope])

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

  const getCategoryColor = (rootName) => {
    if (!rootName || rootName === 'Other') return '#F3F4F6'
    const index = rootNames.indexOf(rootName)
    if (index !== -1) return COLOURS[index % COLOURS.length]
    return '#F3F4F6'
  }

  const getCategoryStroke = (rootName) => {
    if (!rootName || rootName === 'Other') return '#9CA3AF'
    const index = rootNames.indexOf(rootName)
    if (index !== -1) return STROKES[index % STROKES.length]
    return '#9CA3AF'
  }

  if (loading) return <Loading />

  const iso = 'EUR'
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
        {groups.length > 1 && (
          <div className="form-group" style={{ marginBottom: 0, flex: 1, minWidth: 0 }}>
            <select value={groupId} onChange={e => setGroupId(e.target.value)} aria-label="Group">
              <option value="">All groups</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.icon ? `${g.icon} ` : ''}{g.title}</option>)}
            </select>
          </div>
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
      <div className="page-header"><h1>Insights</h1></div>
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
              <div className="insights-kpi-value insights-kpi-text">{topIcon} {topRoot[0]}</div>
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
          <div className="card" style={{ padding: '24px 16px 16px' }}>
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
                      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px', fontSize: 13, boxShadow: 'var(--shadow-lg)', minWidth: 160 }}>
                        <div style={{ color: 'var(--text-3)', marginBottom: 8, fontWeight: 500 }}>{shortMonth(d.month)} {d.month.split('-')[0]}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {stackKeys.map(key => (d[key] > 0 && !hiddenMonthly.includes(key)) && (
                            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                               <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                 <span style={{ width: 6, height: 6, borderRadius: '50%', background: getCategoryStroke(key) }} />
                                 <span style={{ color: 'var(--text-2)' }}>{key}</span>
                               </div>
                               <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{formatCurrency(d[key])}</span>
                            </div>
                          ))}
                        </div>
                        <div style={{ borderTop: '1px solid var(--border)', marginTop: 10, paddingTop: 10, display: 'flex', justifyContent: 'space-between', fontWeight: 600, fontSize: 14 }}>
                          <span>Total</span>
                          <span style={{ color: 'var(--accent)' }}>{formatCurrency(d.total)}</span>
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
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', justifyContent: 'center', marginBottom: 20 }}>
                      {payload.map((entry) => {
                        const isHidden = hiddenMonthly.includes(entry.value)
                        return (
                          <span
                            key={entry.value}
                            onClick={() => toggleMonthly(entry.value)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              fontSize: 12,
                              color: isHidden ? 'var(--text-3)' : 'var(--text-2)',
                              cursor: 'pointer',
                              transition: 'opacity 0.2s'
                            }}
                          >
                            <span style={{ width: 8, height: 8, borderRadius: '50%', background: isHidden ? 'var(--border)' : entry.color, flexShrink: 0 }} />
                            {entry.value}
                          </span>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div className="section-label">Spending by category</div>
            {activeCategory && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, paddingBottom: 8 }}>
                <span
                  onClick={() => { setActiveCategory(null); setHiddenPie([]) }}
                  style={{ color: 'var(--accent)', cursor: 'pointer', fontWeight: 500 }}
                >
                  All
                </span>
                {activeCategory.split(' - ').map((part, i, arr) => {
                  const path = arr.slice(0, i + 1).join(' - ')
                  const isLast = i === arr.length - 1
                  return (
                    <span key={path} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ color: 'var(--text-3)' }}>/</span>
                      {isLast ? (
                        <span style={{ color: 'var(--text-2)', fontWeight: 500 }}>{part}</span>
                      ) : (
                        <span
                          onClick={() => { setActiveCategory(path); setHiddenPie([]) }}
                          style={{ color: 'var(--accent)', cursor: 'pointer', fontWeight: 500 }}
                        >
                          {part}
                        </span>
                      )}
                    </span>
                  )
                })}
              </div>
            )}
          </div>
          <div className="card" style={{ padding: '24px 16px' }}>
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
                      fill={getCategoryColor(cat.rootName)}
                      stroke={getCategoryStroke(cat.rootName)}
                      opacity={hiddenPie.includes(cat.id) ? 0.2 : 1}
                    />
                  ))}
                  <Label 
                    position="center"
                    content={({ viewBox: { cx, cy } }) => {
                      if (cx === undefined || cy === undefined) return null
                      const label = activeCategory ? activeCategory.split(' - ').pop() : 'Total'
                      return (
                        <g style={{ pointerEvents: 'none' }}>
                          <text x={cx} y={cy - 10} textAnchor="middle" dominantBaseline="middle" style={{ fontSize: 14, fill: 'var(--text-3)', fontWeight: 600 }}>
                            {label}
                          </text>
                          <text x={cx} y={cy + 16} textAnchor="middle" dominantBaseline="middle" style={{ fontSize: 22, fill: 'var(--text)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
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
                    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 14px', fontSize: 13, boxShadow: 'var(--shadow-lg)' }}>
                      <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>{icon} {name}</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                        <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 600 }}>{formatCurrency(total)}</span>
                        <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{pct}%</span>
                      </div>
                    </div>
                  )
                }} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px 12px', marginTop: 16 }}>
              {displayCategories.map((cat) => {
                const isHidden = hiddenPie.includes(cat.id)
                const pct = totalPieAmount > 0 ? ((cat.total / totalPieAmount) * 100).toFixed(0) : 0
                return (
                  <div
                    key={cat.id}
                    onClick={() => togglePie(cat.id)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                      padding: '6px 10px',
                      borderRadius: 10,
                      background: isHidden ? 'transparent' : 'var(--surface-2)',
                      border: `1px solid ${isHidden ? 'transparent' : 'var(--border)'}`,
                      cursor: 'pointer',
                      opacity: isHidden ? 0.5 : 1,
                      transition: 'all 0.2s',
                      overflow: 'hidden'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: getCategoryStroke(cat.rootName), flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: 'var(--text-2)', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden', fontWeight: 500 }}>
                        {cat.icon} {cat.name}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, paddingLeft: 16 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{formatCurrency(cat.total)}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{pct}%</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {members.length > 0 && (
        <div>
          <div className="section-label">{mine ? 'Who paid for your share' : 'Paid by member'}</div>
          <div className="card" style={{ padding: '24px 16px 16px' }}>
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
                      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 14px', fontSize: 13, boxShadow: 'var(--shadow-lg)' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>{name}</div>
                        <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{formatCurrency(total)}</span>
                      </div>
                    )
                  }}
                />
                <Bar dataKey="total" fill={COLOURS[2]} stroke={STROKES[2]} strokeWidth={1} radius={[0, 4, 4, 0]} barSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      </div>

      {dowMatrix.some(row => row.some(cell => cell.total > 0)) && (
        <>
          <div className="section-label">Spending by day of week</div>
          <div className="card" style={{ padding: '20px 16px 16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto repeat(7, 1fr)', gap: 4 }}>
              <div />
              {DOW_LABELS.map(d => (
                <div key={d} style={{ fontSize: 10, textAlign: 'center', color: 'var(--text-3)', paddingBottom: 4, fontWeight: 600 }}>{d}</div>
              ))}
              {dowMatrix.map((row, w) => (
                <Fragment key={w}>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', display: 'flex', alignItems: 'center', paddingRight: 8, whiteSpace: 'nowrap', fontWeight: 500 }}>Wk {w + 1}</div>
                  {row.map((cell, d) => {
                    const intensity = cell.total > 0 ? Math.sqrt(cell.total / dowMax) : 0
                    return (
                      <div
                        key={d}
                        onMouseEnter={() => setHoveredCell({ w, d, ...cell })}
                        onMouseLeave={() => setHoveredCell(null)}
                        style={{
                          height: 36,
                          borderRadius: 6,
                          background: cell.total > 0
                            ? `rgba(220, 38, 38, ${(0.12 + intensity * 0.88).toFixed(2)})`
                            : 'var(--surface-2)',
                          transition: 'background 0.15s',
                        }}
                      />
                    )
                  })}
                </Fragment>
              ))}
            </div>
            <div style={{ minHeight: 20, fontSize: 12, color: 'var(--text-3)', textAlign: 'center', marginTop: 12 }}>
              {hoveredCell?.total > 0
                ? `${DOW_LABELS[hoveredCell.d]}, Week ${hoveredCell.w + 1} — ${formatCurrency(hoveredCell.total)} · ${hoveredCell.count} expense${hoveredCell.count !== 1 ? 's' : ''}`
                : ' '}
            </div>
          </div>
        </>
      )}

      {!error && total === 0 && (
        <div className="empty-state">
          <img src="/cat-empty.svg" alt="" style={{ width: 80, height: 80 }} />
          <p style={{ color: 'var(--text-3)', fontSize: 14 }}>
            {period === 'all' && !groupId ? 'No data yet. Add some expenses to see insights.' : 'No expenses for this selection.'}
          </p>
        </div>
      )}
      </div>
    </>
  )
}
