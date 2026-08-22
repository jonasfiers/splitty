import { useState, useEffect, useCallback } from 'react'
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom'
import client from '../api/client'
import CurrencyInput from '../components/CurrencyInput/CurrencyInput.jsx'
import FabButton from '../components/FabButton/FabButton.jsx'
import { formatCurrency, formatDate } from '../utils/currency.js'
import { useAuth } from '../context/AuthContext.jsx'
import { Avatar, AvatarStack } from '../components/Avatar.jsx'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import Loading from '../components/Loading.jsx'
import BackLink from '../components/BackLink.jsx'
import ChartTooltip from '../components/ChartTooltip.jsx'
import { COLOURS, STROKES } from '../utils/chartColors.js'
import CategoryPicker from '../components/CategoryPicker/CategoryPicker.jsx'

const FILTERS = ['All', 'You paid', 'You owe']

export default function GroupDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { state } = useLocation()
  const { currentUser } = useAuth()

  const [group, setGroup] = useState(null)
  const [expenses, setExpenses] = useState([])
  const [members, setMembers] = useState([])
  const [balance, setBalance] = useState(null)
  const [tab, setTab] = useState('expenses')
  const [filter, setFilter] = useState('All')
  const [showSettlement, setShowSettlement] = useState(false)
  const [settlementForm, setSettlementForm] = useState({
    paidByUserId: '',
    receivedByUserId: '',
    amount: '',
    date: new Date().toISOString().slice(0, 10),
  })
  const [showTransfer, setShowTransfer] = useState(false)
  const [transferTarget, setTransferTarget] = useState(null)
  const [transferBilateral, setTransferBilateral] = useState(0)
  const [sharedGroups, setSharedGroups] = useState([])
  const [transferGroupId, setTransferGroupId] = useState('')
  const [categories, setCategories] = useState([])
  const [categoryTotals, setCategoryTotals] = useState([])
  const [filters, setFilters] = useState({ keyword: '', categoryId: null, paidByUserId: '', startDate: '', endDate: '' })
  const [debouncedKeyword, setDebouncedKeyword] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [inviteLink, setInviteLink] = useState(null)
  const [copied, setCopied] = useState(false)

  const PAGE = 25

  useEffect(() => {
    const t = setTimeout(() => setDebouncedKeyword(filters.keyword), 300)
    return () => clearTimeout(t)
  }, [filters.keyword])

  const buildQuery = useCallback((skip, f) => {
    const p = new URLSearchParams({ skip, limit: PAGE })
    if (f.keyword)       p.set('keyword',      f.keyword)
    if (f.categoryId)    p.set('categoryId',   f.categoryId)
    if (f.paidByUserId)  p.set('paidByUserId', f.paidByUserId)
    if (f.startDate)     p.set('startDate',    f.startDate)
    if (f.endDate)       p.set('endDate',      f.endDate)
    return p.toString()
  }, [])

  const load = useCallback(async () => {
    const activeFilters = { ...filters, keyword: debouncedKeyword }
    const [groupRes, expensesRes, membersRes, catRes, catsRes] = await Promise.all([
      client.get(`/groups/${id}`),
      client.get(`/groups/${id}/expenses?${buildQuery(0, activeFilters)}`),
      client.get(`/groups/${id}/members`),
      client.get(`/groups/${id}/category-totals`),
      client.get('/categories'),
    ])
    const g = groupRes.data.groups?.[0] ?? null
    setGroup(g)
    setExpenses(expensesRes.data.expenses || [])
    setHasMore(expensesRes.data.hasMore || false)
    const mbs = g?.members || membersRes.data.members || []
    setMembers(mbs)
    const me = mbs.find(m => m.id === currentUser?.id)
    setBalance(g ? { amount: me?.balance ?? 0, iso: g.iso } : null)
    setCategoryTotals(catRes.data.categories || [])
    setCategories(catsRes.data.categories || [])
  }, [id, filters, debouncedKeyword, buildQuery])

  const loadMore = async () => {
    setLoadingMore(true)
    try {
      const qs = buildQuery(expenses.length, { ...filters, keyword: debouncedKeyword })
      const res = await client.get(`/groups/${id}/expenses?${qs}`)
      setExpenses(prev => [...prev, ...(res.data.expenses || [])])
      setHasMore(res.data.hasMore || false)
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => { load().finally(() => setLoading(false)) }, [load])

  const handleRemoveMember = async userId => {
    const isSelf = userId === currentUser?.id
    const member = members.find(m => m.id === userId)
    const message = isSelf
      ? 'Leave this group? You will no longer have access to it.'
      : `Remove ${member?.name ?? 'this member'} from the group?`
    if (!window.confirm(message)) return
    try {
      await client.delete(`/groups/${id}/${userId}`)
      if (isSelf) { navigate('/groups'); return }
      await load()
    } catch { setError('Failed to remove member.') }
  }

  const handleDeleteGroup = async () => {
    if (!window.confirm(`Delete "${group?.title}"? This cannot be undone.`)) return
    try {
      await client.delete(`/groups/${id}`)
      navigate('/groups')
    } catch { setError('Failed to delete group.') }
  }

  const handleDeleteExpense = async expenseId => {
    if (!window.confirm('Delete this expense?')) return
    try {
      await client.delete(`/expenses/${expenseId}`)
      setExpenses(es => es.filter(e => e.id !== expenseId))
    } catch { setError('Failed to delete expense.') }
  }

  const handleNewExpense = () => navigate(`/groups/${id}/expenses/new`);

  const handleInvite = async () => {
    try {
      const { data } = await client.post(`/invites/groups/${id}`)
      setInviteLink(`${window.location.origin}/invite/${data.token}`)
    } catch { setError('Failed to generate invite link.') }
  }

  const handleSettlement = async e => {
    e.preventDefault()
    setError('')
    try {
      await client.post('/settlements', {
        ...settlementForm,
        groupId: id,
        currencyIso: group.iso,
        amount: Number(settlementForm.amount),
      })
      setShowSettlement(false)
      await load()
    } catch {
      setError('Failed to record settlement.')
    }
  }

  const openSettlement = (member) => {
    // member.balance is their net balance in the group: sum(lent) - sum(owed)
    // If member.balance < 0, they owe money (they should pay).
    // If member.balance > 0, they are owed money (they should receive).
    
    if (member.balance < 0) {
      // Member owes money -> They are the payer
      setSettlementForm({
        paidByUserId: member.id,
        receivedByUserId: currentUser.id,
        amount: Math.abs(member.balance),
        date: new Date().toISOString().slice(0, 10),
      })
    } else {
      // Member is owed money -> They are the receiver
      setSettlementForm({
        paidByUserId: currentUser.id,
        receivedByUserId: member.id,
        amount: Math.abs(member.balance),
        date: new Date().toISOString().slice(0, 10),
      })
    }
    setShowSettlement(true)
  }

  const openTransfer = async (member) => {
    try {
      const res = await client.get(`/groups/${id}/shared-groups/${member.id}`)
      setSharedGroups(res.data.groups || [])
      setTransferBilateral(res.data.bilateralBalance ?? 0)
      setTransferTarget(member)
      setTransferGroupId(res.data.groups?.[0]?.id || '')
      setShowTransfer(true)
    } catch {
      setError('Could not load shared groups.')
    }
  }

  const handleTransfer = async e => {
    e.preventDefault()
    setError('')
    try {
      await client.post('/settlements/transfer', {
        sourceGroupId: id,
        targetGroupId: transferGroupId,
        targetUserId: transferTarget.id,
      })
      setShowTransfer(false)
      await load()
    } catch {
      setError('Failed to transfer balance.')
    }
  }

  if (loading) return <Loading />
  if (!group) return <div className="empty-state"><p className="empty-state-title">Group not found.</p></div>

  // Expense icon: use emoji field if present, otherwise first letter of description
  const expenseIcon = e => e.isTransfer ? '⇄' : e.isSettlement ? '✓' : (e.categoryIcon || (e.description?.[0]?.toUpperCase() ?? '?'))

  const totalAmount = categoryTotals.reduce((s, c) => s + Number(c.total || 0), 0)
  const DONUT_MAX = 6
  const donutData = categoryTotals.length > DONUT_MAX
    ? [...categoryTotals.slice(0, DONUT_MAX), {
        categoryId: null,
        name: 'Other',
        icon: '',
        total: categoryTotals.slice(DONUT_MAX).reduce((s, c) => s + c.total, 0),
      }]
    : categoryTotals

  const activeFilterCount = [debouncedKeyword, filters.categoryId, filters.paidByUserId, filters.startDate, filters.endDate].filter(Boolean).length

  const filteredExpenses = expenses.filter(e => {
    if (filter === 'You paid') return e.paidByUserId === currentUser?.id
    if (filter === 'You owe') return e.paidByUserId !== currentUser?.id && e.shareAmount != null
    return true
  })

  return (
    <>
      {/* Sub-header */}
      <div className="sub-header">
        <BackLink to="/groups" />
        <span className="sub-header-title">Group</span>
        <button className="sub-header-del" onClick={handleDeleteGroup}>Delete</button>
      </div>

      {/* Group info */}
      <div className="group-info-bar">
        <div className="group-info-name">{group.title}</div>
        <div className="group-info-meta">
          <AvatarStack members={members} />
          <span className="group-info-count">
            {members.length} member{members.length !== 1 ? 's' : ''}
            {totalAmount > 0 && ` · ${formatCurrency(totalAmount)} total`}
          </span>
        </div>
      </div>

      {state?.notice && <p className="error" style={{ background: 'var(--accent-light)', color: 'var(--accent)', borderColor: 'var(--accent-subtle)' }}>{state.notice}</p>}
      {error && <p className="error">{error}</p>}

      {balance !== null && (
        <div className="debt-banners">
          {!balance.amount ? (
            <div className="debt-banner settled">
              <span style={{ fontSize: 16, marginRight: 6 }}>✓</span>
              <span className="debt-banner-text">All settled up</span>
            </div>
          ) : balance.amount > 0 ? (
            <div className="debt-banner owed">
              <span className="debt-banner-text">You are owed {formatCurrency(balance.amount, balance.iso)}</span>
              <button className="btn-pill-white" style={{ marginLeft: 'auto', color: 'inherit' }} onClick={() => {
                const owers = members.filter(m => m.id !== currentUser.id && m.balance < 0)
                if (owers.length === 1) openSettlement(owers[0])
                else setShowSettlement(true)
              }}>Settle up</button>
            </div>
          ) : (
            <div className="debt-banner owes">
              <span className="debt-banner-text">You owe {formatCurrency(Math.abs(balance.amount), balance.iso)}</span>
              <button className="btn-pill-white" style={{ marginLeft: 'auto', color: 'inherit' }} onClick={() => {
                const lenders = members.filter(m => m.id !== currentUser.id && m.balance > 0)
                if (lenders.length === 1) openSettlement(lenders[0])
                else setShowSettlement(true)
              }}>Settle up</button>
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="filter-chips">
        <button className={`chip${tab === 'expenses' ? ' active' : ''}`} onClick={() => setTab('expenses')}>Expenses</button>
        <button className={`chip${tab === 'members' ? ' active' : ''}`} onClick={() => setTab('members')}>
          Members {members.length > 0 && `· ${members.length}`}
        </button>
      </div>

      {tab === 'expenses' && <>
        {/* Category breakdown */}
        {categoryTotals.length > 0 && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div className="section-label" style={{ padding: 0 }}>Spending by category</div>
              {filters.categoryId && (
                <button className="btn btn-ghost btn-sm" onClick={() => setFilters(f => ({ ...f, categoryId: null }))}>Clear filter</button>
              )}
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={donutData}
                  cx="50%" cy="50%"
                  innerRadius={55} outerRadius={80}
                  paddingAngle={3}
                  dataKey="total"
                  nameKey="name"
                  onClick={entry => setFilters(f => ({ ...f, categoryId: f.categoryId === entry.categoryId ? null : entry.categoryId }))}
                  style={{ cursor: 'pointer' }}
                >
                  {donutData.map((cat, i) => {
                    const isSelected = !filters.categoryId || filters.categoryId === cat.categoryId
                    return <Cell key={cat.name} fill={COLOURS[i % COLOURS.length]} stroke={STROKES[i % STROKES.length]} strokeWidth={isSelected ? 1.5 : 0.5} opacity={isSelected ? 1 : 0.3} />
                  })}
                </Pie>
                <Tooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const { name, icon, total } = payload[0].payload
                  return <ChartTooltip title={<>{icon} {name}</>} value={formatCurrency(total, balance?.iso)} />
                }} />
              </PieChart>
            </ResponsiveContainer>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', justifyContent: 'center', marginTop: 8 }}>
              {donutData.map((cat, i) => {
                const isSelected = !filters.categoryId || filters.categoryId === cat.categoryId
                return (
                  <span key={cat.name} onClick={() => setFilters(f => ({ ...f, categoryId: f.categoryId === cat.categoryId ? null : cat.categoryId }))} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-2)', opacity: isSelected ? 1 : 0.3, cursor: 'pointer', transition: 'opacity 0.2s' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: STROKES[i % STROKES.length], flexShrink: 0 }} />
                    {cat.icon} {cat.name}
                  </span>
                )
              })}
            </div>
          </div>
        )}

        {/* Filter chips */}
        <div className="filter-chips">
          {FILTERS.map(f => (
            <button key={f} className={`chip${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>

        {/* Search & filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0 8px' }}>
          <button
            className={`btn btn-ghost btn-sm${showFilters ? ' active' : ''}`}
            style={{ position: 'relative' }}
            onClick={() => setShowFilters(v => !v)}
          >
            Filters
            {activeFilterCount > 0 && (
              <span style={{
                position: 'absolute', top: -6, right: -6,
                background: 'var(--accent)', color: '#fff',
                borderRadius: 'var(--r-pill)', fontSize: 10, fontWeight: 700,
                padding: '1px 5px', lineHeight: '14px',
              }}>{activeFilterCount}</span>
            )}
          </button>
          {activeFilterCount > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => {
              setFilters({ keyword: '', categoryId: null, paidByUserId: '', startDate: '', endDate: '' })
              setDebouncedKeyword('')
            }}>Clear all</button>
          )}
        </div>

        {showFilters && (
          <div className="card" style={{ marginBottom: 12, padding: 16 }}>
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label>Search</label>
              <input
                type="text"
                placeholder="Filter by description…"
                value={filters.keyword}
                onChange={e => setFilters(f => ({ ...f, keyword: e.target.value }))}
              />
            </div>
            <div className="form-row" style={{ marginBottom: 12 }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>From</label>
                <input
                  type="date"
                  value={filters.startDate}
                  onChange={e => setFilters(f => ({ ...f, startDate: e.target.value }))}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>To</label>
                <input
                  type="date"
                  value={filters.endDate}
                  onChange={e => setFilters(f => ({ ...f, endDate: e.target.value }))}
                />
              </div>
            </div>
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label>Category</label>
              <CategoryPicker
                value={filters.categoryId}
                onChange={id => setFilters(f => ({ ...f, categoryId: id }))}
                categories={categories}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Paid by</label>
              <select
                value={filters.paidByUserId}
                onChange={e => setFilters(f => ({ ...f, paidByUserId: e.target.value }))}
              >
                <option value="">Anyone</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>
        )}

        {filteredExpenses.length === 0 ? (
          <div className="empty-state" style={{ padding: '32px 24px' }}>
            <img src="/cat-empty.svg" alt="" style={{ width: 80, height: 80 }} />
            <p style={{ color: 'var(--text-3)', fontSize: 14 }}>No expenses yet.</p>
          </div>
        ) : (
          <div className="expense-list">
            {filteredExpenses.map(e => (
              <div
                key={e.id}
                className="expense-item"
                onClick={() => navigate(`/groups/${id}/expenses/${e.id}`)}
              >
                <div className="expense-icon" style={
                  e.isTransfer ? { background: 'var(--accent-light)', color: 'var(--accent)' }
                  : e.isSettlement ? { background: 'var(--green-light)', color: 'var(--green-dark)' }
                  : {}
                }>
                  {expenseIcon(e)}
                </div>
                <div className="expense-info">
                  <div className="expense-name">{e.description}</div>
                  <div className="expense-meta">
                    {e.paidByName ? `Paid by ${e.paidByName}` : 'Paid by —'}
                    {e.date ? ` · ${formatDate(e.date)}` : ''}
                  </div>
                </div>
                <div className="expense-amounts">
                  <div className="expense-share">{formatCurrency(e.amount)}</div>
                  {e.isSettlement ? (
                    e.paidByUserId === currentUser.id
                      ? <div className="expense-total">you settled up</div>
                      : e.shareAmount != null && <div className="expense-total">you received {formatCurrency(e.shareAmount, e.currencyIso)}</div>
                  ) : e.isTransfer ? (
                    e.paidByUserId === currentUser.id
                      ? <div className="expense-total">you transferred</div>
                      : e.shareAmount != null && <div className="expense-total">transferred to you</div>
                  ) : (
                    e.paidByUserId === currentUser.id
                      ? <div className="expense-total">you paid</div>
                      : e.shareAmount != null && <div className="expense-total">you owe {formatCurrency(e.shareAmount, e.currencyIso)}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {hasMore && (
          <button className="btn-outline-amber" style={{ width: '100%', marginTop: 8 }} onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        )}
      </>}

      {tab === 'members' && <>
        <div className="members-section">
          {members.map(m => (
            <div key={m.id} className="member-row">
              <Avatar name={m.name} size={34} colorIndex={m.avatarColor} emoji={m.avatarEmoji} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="member-name">{m.name}</div>
                <div className="member-email">{m.email}</div>
              </div>
              <span className="member-bal" style={{ color: m.balance > 0 ? 'var(--green)' : m.balance < 0 ? 'var(--red)' : 'var(--text-3)' }}>
                {m.balance ? formatCurrency(Math.abs(m.balance), balance?.iso) : '—'}
              </span>
              <div className="member-actions">
                {m.id !== currentUser.id && m.balance !== 0 && (
                  <>
                    <button className="btn-pill-outline" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => openSettlement(m)}>
                      Settle
                    </button>
                    <button className="btn-pill-outline" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => openTransfer(m)}>
                      Transfer
                    </button>
                  </>
                )}
                <button className="member-rm-btn" onClick={() => handleRemoveMember(m.id)} title="Remove">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6M14 11v6"/>
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                  </svg>
                </button>
              </div>
            </div>
          ))}

          <button className="btn-pill-outline" style={{ marginTop: 12, width: '100%', padding: '10px' }} onClick={handleInvite}>
            Invite via link
          </button>

        </div>
      </>}

      <FabButton onClick={handleNewExpense} label="Add expense" />

      {/* Invite sheet */}
      {inviteLink && (
        <div className="sheet-overlay" onClick={e => { if (e.target === e.currentTarget) setInviteLink(null) }}>
          <div className="sheet">
            <div className="sheet-handle" />
            <p className="sheet-title">Invite to group</p>
            <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 16 }}>Share this link. It expires in 7 days and can only be used once.</p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px', marginBottom: 16, wordBreak: 'break-all', fontSize: 13 }}>
              <span style={{ flex: 1 }}>{inviteLink}</span>
            </div>
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => { navigator.clipboard.writeText(inviteLink); setCopied(true); setTimeout(() => setCopied(false), 2000) }}>
              {copied ? 'Link copied!' : 'Copy link'}
            </button>
            <button className="btn btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={() => { setInviteLink(null); setCopied(false) }}>Close</button>
          </div>
        </div>
      )}

      {/* Balance transfer sheet */}
      {showTransfer && (
        <div className="sheet-overlay" onClick={e => { if (e.target === e.currentTarget) setShowTransfer(false) }}>
          <div className="sheet">
            <div className="sheet-handle" />
            <p className="sheet-title">Transfer balance</p>
            {sharedGroups.length === 0 ? (
              <>
                <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 16 }}>
                  You and {transferTarget?.name} don't share any other groups to transfer the balance to.
                </p>
                <button className="btn btn-ghost" style={{ width: '100%' }} onClick={() => setShowTransfer(false)}>Close</button>
              </>
            ) : transferBilateral === 0 ? (
              <>
                <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 16 }}>
                  You have no direct balance with {transferTarget?.name} in this group to transfer.
                </p>
                <button className="btn btn-ghost" style={{ width: '100%' }} onClick={() => setShowTransfer(false)}>Close</button>
              </>
            ) : (
              <form onSubmit={handleTransfer}>
                <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 16 }}>
                  Move the full balance of {formatCurrency(Math.abs(transferBilateral), balance?.iso)} with {transferTarget?.name} from this group to:
                </p>
                <div className="form-group">
                  <label>Destination group</label>
                  <select
                    value={transferGroupId}
                    onChange={e => setTransferGroupId(e.target.value)}
                    required
                  >
                    {sharedGroups.map(g => (
                      <option key={g.id} value={g.id}>{g.icon} {g.title}</option>
                    ))}
                  </select>
                </div>
                <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>Transfer balance</button>
                <button type="button" className="btn btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={() => setShowTransfer(false)}>Cancel</button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Settlement sheet */}
      {showSettlement && (
        <div className="sheet-overlay" onClick={e => { if (e.target === e.currentTarget) setShowSettlement(false) }}>
          <div className="sheet">
            <div className="sheet-handle" />
            <p className="sheet-title">Record a settlement</p>
            <form onSubmit={handleSettlement}>
              <div className="form-group">
                <label>Who paid?</label>
                <select
                  value={settlementForm.paidByUserId}
                  onChange={e => setSettlementForm(f => ({ ...f, paidByUserId: e.target.value }))}
                  required
                >
                  <option value="">Select user…</option>
                  {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Who received?</label>
                <select
                  value={settlementForm.receivedByUserId}
                  onChange={e => setSettlementForm(f => ({ ...f, receivedByUserId: e.target.value }))}
                  required
                >
                  <option value="">Select user…</option>
                  {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Amount</label>
                <CurrencyInput
                  iso={group.iso}
                  value={settlementForm.amount}
                  onChange={val => setSettlementForm(f => ({ ...f, amount: val }))}
                  required
                />
              </div>
              <div className="form-group">
                <label>Date</label>
                <input
                  type="date"
                  value={settlementForm.date}
                  onChange={e => setSettlementForm(f => ({ ...f, date: e.target.value }))}
                  required
                />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>Record settlement</button>
              <button type="button" className="btn btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={() => setShowSettlement(false)}>
                Cancel
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  )
}