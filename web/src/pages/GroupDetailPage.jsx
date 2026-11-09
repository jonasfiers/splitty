import { useState, useEffect, useCallback, useRef } from 'react'
import LoadFailed from '../components/LoadFailed.jsx'
import { useParams, Link, useNavigate, useLocation } from 'react-router'
import client from '../api/client'
import CurrencyInput from '../components/CurrencyInput/CurrencyInput.jsx'
import FabButton from '../components/FabButton/FabButton.jsx'
import { formatCurrency, formatDate } from '../utils/currency.js'
import { useAuth } from '../context/AuthContext.jsx'
import { Avatar, AvatarStack } from '../components/Avatar.jsx'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import Loading from '../components/Loading.jsx'
import PageHeader from '../components/PageHeader/PageHeader.jsx'
import ChartTooltip from '../components/ChartTooltip.jsx'
import { COLOURS, STROKES } from '../utils/chartColors.js'
import CategoryPicker from '../components/CategoryPicker/CategoryPicker.jsx'
import TripList from '../components/TripForm/TripList.jsx'
import TripFormSheet from '../components/TripForm/TripFormSheet.jsx'
import { useMediaQuery } from '../utils/useMediaQuery.js'
import Sheet, { SheetActions } from '../components/Sheet/Sheet.jsx'
import { useConfirm } from '../components/Confirm/ConfirmProvider.jsx'
import Segmented from '../components/Segmented/Segmented.jsx'
import { leaveTo } from '../utils/history.js'
import { List, ListRow } from '../components/List/List.jsx'
import GroupEditSheet from '../components/GroupForm/GroupEditSheet.jsx'

// Keep in sync with the .group-layout breakpoint in index.css.
const WIDE_QUERY = '(min-width: 1180px)'

export default function GroupDetailPage() {
  const confirm = useConfirm()
  const { id } = useParams()
  const navigate = useNavigate()
  const { state } = useLocation()
  const { currentUser } = useAuth()
  const wide = useMediaQuery(WIDE_QUERY)

  const [group, setGroup] = useState(null)
  const [expenses, setExpenses] = useState([])
  const [members, setMembers] = useState([])
  const [balance, setBalance] = useState(null)
  const [tab, setTab] = useState('expenses')
  const [showEdit, setShowEdit] = useState(false)
  const [showSettlePick, setShowSettlePick] = useState(false) // Settle up with several people: who first
  const [memberSheet, setMemberSheet] = useState(null) // the member tapped on the Members tab
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
  const [trips, setTrips] = useState([])
  const [showNewTrip, setShowNewTrip] = useState(false)
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

  // The expenses query for the current search and filters. Built from the
  // debounced keyword, so typing does not reload on every letter.
  const query = buildQuery(0, { ...filters, keyword: debouncedKeyword })
  const queryRef = useRef(query)
  queryRef.current = query
  // Which query the list shows, and a counter so a slow older answer cannot
  // replace a newer one.
  const loadedQuery = useRef(null)
  const expensesSeq = useRef(0)

  // Everything on the page: on opening it, on Try again, and after a change
  // (member removed, settlement). Search and filters reload only the
  // expenses (below): six requests per letter typed ran into the server's
  // rate limit.
  const load = useCallback(async () => {
    const seq = ++expensesSeq.current
    loadedQuery.current = queryRef.current
    const [groupRes, expensesRes, membersRes, catRes, catsRes, tripsRes] = await Promise.all([
      client.get(`/groups/${id}`),
      client.get(`/groups/${id}/expenses?${queryRef.current}`),
      client.get(`/groups/${id}/members`),
      client.get(`/groups/${id}/category-totals`),
      client.get('/categories'),
      client.get(`/trips?groupId=${id}`),
    ])
    const g = groupRes.data.groups?.[0] ?? null
    setGroup(g)
    if (seq === expensesSeq.current) {
      setExpenses(expensesRes.data.expenses || [])
      setHasMore(expensesRes.data.hasMore || false)
    }
    const mbs = g?.members || membersRes.data.members || []
    setMembers(mbs)
    const me = mbs.find(m => m.id === currentUser?.id)
    setBalance(g ? { amount: me?.balance ?? 0, iso: g.iso } : null)
    setCategoryTotals(catRes.data.categories || [])
    setCategories(catsRes.data.categories || [])
    setTrips(tripsRes.data.trips || [])
  }, [id])

  const loadMore = async () => {
    setLoadingMore(true)
    try {
      const qs = buildQuery(expenses.length, { ...filters, keyword: debouncedKeyword })
      const seq = expensesSeq.current
      const res = await client.get(`/groups/${id}/expenses?${qs}`)
      if (seq !== expensesSeq.current) return
      setExpenses(prev => [...prev, ...(res.data.expenses || [])])
      setHasMore(res.data.hasMore || false)
    } finally {
      setLoadingMore(false)
    }
  }

  // Loading failed (not "no such group": that is a 404): the "couldn't load"
  // state, not "Group not found.".
  const [loadError, setLoadError] = useState(null)
  const fetchAll = useCallback(() => load()
    .then(() => setLoadError(null))
    .catch(err => { if (err.response?.status !== 404) setLoadError(err) })
    .finally(() => setLoading(false)), [load])
  useEffect(() => { fetchAll() }, [fetchAll])

  // A search or filter change: only the expenses, and the page stays as it
  // is if that fails (a message instead of "Couldn't load this group").
  useEffect(() => {
    if (loadedQuery.current === null || loadedQuery.current === query) return
    loadedQuery.current = query
    const seq = ++expensesSeq.current
    client.get(`/groups/${id}/expenses?${query}`)
      .then(res => {
        if (seq !== expensesSeq.current) return
        setExpenses(res.data.expenses || [])
        setHasMore(res.data.hasMore || false)
      })
      .catch(() => { if (seq === expensesSeq.current) setError('Couldn’t load the expenses for this search. Try again.') })
  }, [id, query])
  const retry = useCallback(() => { setLoading(true); fetchAll() }, [fetchAll])

  const handleRemoveMember = async userId => {
    const isSelf = userId === currentUser?.id
    const member = members.find(m => m.id === userId)
    const ok = await confirm(isSelf
      ? { title: 'Leave this group?', message: 'You will no longer have access to it.', confirmLabel: 'Leave group', danger: true }
      : { title: `Remove ${member?.name ?? 'this member'} from the group?`, confirmLabel: 'Remove', danger: true })
    if (!ok) return
    try {
      await client.delete(`/groups/${id}/${userId}`)
      if (isSelf) { leaveTo(navigate, '/groups'); return }
      await load()
    } catch { setError('Failed to remove member.') }
  }

  const handleDeleteGroup = async () => {
    const withTrips = trips.length > 0 ? ` and its ${trips.length} trip${trips.length !== 1 ? 's' : ''}` : ''
    if (!(await confirm({ title: `Delete "${group?.title}"${withTrips}?`, message: 'This cannot be undone.', confirmLabel: 'Delete group', danger: true }))) return
    try {
      await client.delete(`/groups/${id}`)
      leaveTo(navigate, '/groups')
    } catch { setError('Failed to delete group.') }
  }

  const handleNewExpense = () => navigate(`/groups/${id}/expenses/new`);

  const handleInvite = async () => {
    try {
      const { data } = await client.post(`/invites/groups/${id}`)
      const link = `${window.location.origin}/invite/${data.token}`
      // The phone's share sheet when there is one; otherwise ours, with the link to copy.
      if (navigator.share) {
        try {
          await navigator.share({ title: `Join ${group.title} on Splitty`, url: link })
          return
        } catch (err) {
          if (err.name === 'AbortError') return
        }
      }
      setInviteLink(link)
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

  // While loading or when it fails: the bar with its way back stays.
  const bare = <PageHeader compact crumbs={[{ to: '/groups', label: 'Home' }]} name="Group" />
  if (loading) return <>{bare}<Loading /></>
  if (loadError) return <>{bare}<LoadFailed error={loadError} what="this group" onRetry={retry} /></>
  if (!group) return <>{bare}<div className="empty-state"><p className="empty-state-title">Group not found.</p></div></>

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

  // The filters in the panel (the keyword has its own field).
  const panelFilterCount = [filters.categoryId, filters.paidByUserId, filters.startDate, filters.endDate].filter(Boolean).length
  const clearFilters = () => {
    setFilters({ keyword: '', categoryId: null, paidByUserId: '', startDate: '', endDate: '' })
    setDebouncedKeyword('')
  }

  // The list by month: "November", or "October 2025" for another year.
  const thisYear = new Date().getFullYear()
  const months = []
  for (const e of expenses) {
    const d = e.date ? new Date(`${e.date.slice(0, 10)}T12:00:00`) : null
    const key = d ? `${d.getFullYear()}-${d.getMonth()}` : 'none'
    if (months.at(-1)?.key !== key) {
      const label = !d ? 'No date'
        : d.toLocaleDateString(undefined, d.getFullYear() === thisYear ? { month: 'long' } : { month: 'long', year: 'numeric' })
      months.push({ key, label, items: [] })
    }
    months.at(-1).items.push(e)
  }

  // Who the balance is with: the members on the other side of it.
  const counterparts = !balance?.amount ? [] : members.filter(m =>
    m.id !== currentUser?.id && (balance.amount > 0 ? m.balance < 0 : m.balance > 0))
  const openSettleUp = () => {
    if (counterparts.length === 1) openSettlement(counterparts[0])
    else if (counterparts.length > 1) setShowSettlePick(true)
    else setShowSettlement(true)
  }
  const withWhom = counterparts.length === 1 ? counterparts[0].name
    : counterparts.length === 2 ? `${counterparts[0].name} and ${counterparts[1].name}`
    : counterparts.length > 2 ? `${counterparts[0].name} and ${counterparts.length - 1} others`
    : null

  const balanceCard = balance !== null && (
    <div className="balance-card">
      <div className="balance-card-text">
        {!balance.amount ? (
          <div className="balance-card-main">All settled up</div>
        ) : balance.amount > 0 ? (
          <>
            <div className="balance-card-main">You're owed <span className="owed">{formatCurrency(balance.amount, balance.iso)}</span></div>
            {withWhom && <div className="balance-card-sub">from {withWhom}</div>}
          </>
        ) : (
          <>
            <div className="balance-card-main">You owe <span className="owe">{formatCurrency(Math.abs(balance.amount), balance.iso)}</span></div>
            {withWhom && <div className="balance-card-sub">to {withWhom}</div>}
          </>
        )}
      </div>
      {!!balance.amount && <button type="button" className="btn btn-primary btn-sm" onClick={openSettleUp}>Settle up</button>}
    </div>
  )

  const categoryCard = categoryTotals.length > 0 && (
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
  )

  // Wide screens only: who owes what, always in view next to the expenses.
  const membersCard = (
    <div className="card">
      <div className="section-label" style={{ padding: 0, marginBottom: 8 }}>Members</div>
      {members.map(m => (
        <div key={m.id} className="group-aside-member">
          <Avatar name={m.name} size={28} colorIndex={m.avatarColor} emoji={m.avatarEmoji} />
          <span className="member-name" style={{ flex: 1, minWidth: 0 }}>{m.name}</span>
          <span className="member-bal" style={{ color: m.balance > 0 ? 'var(--green)' : m.balance < 0 ? 'var(--red)' : 'var(--text-3)' }}>
            {m.balance ? formatCurrency(Math.abs(m.balance), balance?.iso) : '—'}
          </span>
        </div>
      ))}
    </div>
  )

  return (
    <>
      <PageHeader
        crumbs={[{ to: '/groups', label: 'Home' }]}
        title={group.title}
        name={group.title}
        actions={[
          { label: 'Invite', onClick: handleInvite, primary: true },
          { label: 'Edit group', onClick: () => setShowEdit(true) },
          { label: 'Leave group', onClick: () => handleRemoveMember(currentUser.id) },
          { label: 'Delete group', onClick: handleDeleteGroup, danger: true },
        ]}
      >
        <div className="group-info-meta">
          <AvatarStack members={members} />
          <span className="group-info-count">
            {members.length} member{members.length !== 1 ? 's' : ''}
            {totalAmount > 0 && <> · <Link to={`/insights?group=${id}`} className="group-total-link">{formatCurrency(totalAmount, group.iso)} total</Link></>}
          </span>
        </div>
      </PageHeader>

      {state?.notice && <p className="error" style={{ background: 'var(--accent-light)', color: 'var(--accent-text)', borderColor: 'var(--accent-subtle)' }}>{state.notice}</p>}
      {error && <p className="error">{error}</p>}

      {!wide && balanceCard}

      <div className="group-layout">
        <div className="group-main">
          <Segmented
            label="Show"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'expenses', label: 'Expenses' },
              { value: 'members', label: `Members · ${members.length}` },
              { value: 'trips', label: trips.length ? `Trips · ${trips.length}` : 'Trips' },
            ]}
          />

          {tab === 'expenses' && <>
            <div className="search-row">
              <label className="search-field">
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
                <input
                  type="search"
                  placeholder="Search expenses"
                  aria-label="Search expenses"
                  value={filters.keyword}
                  onChange={e => setFilters(f => ({ ...f, keyword: e.target.value }))}
                />
              </label>
              <button
                type="button"
                className={`icon-btn${showFilters || panelFilterCount ? ' active' : ''}`}
                aria-label={panelFilterCount ? `Filters, ${panelFilterCount} on` : 'Filters'}
                aria-expanded={showFilters}
                onClick={() => setShowFilters(v => !v)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
                {panelFilterCount > 0 && <span className="icon-btn-badge">{panelFilterCount}</span>}
              </button>
            </div>

            {showFilters && (
              <div className="card" style={{ marginBottom: 12, padding: 16 }}>
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
                    {members.map(m => <option key={m.id} value={m.id}>{m.id === currentUser?.id ? 'You' : m.name}</option>)}
                  </select>
                </div>
                {panelFilterCount > 0 && (
                  <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={clearFilters}>Clear filters</button>
                )}
              </div>
            )}

            {expenses.length === 0 ? (
              <div className="empty-state" style={{ padding: '32px 24px' }}>
                <img src="/cat-empty.svg" alt="" style={{ width: 80, height: 80 }} />
                {activeFilterCount > 0 ? <>
                  <p style={{ color: 'var(--text-3)', fontSize: 14 }}>Nothing matches.</p>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>Clear search and filters</button>
                </> : <p style={{ color: 'var(--text-3)', fontSize: 14 }}>No expenses yet.</p>}
              </div>
            ) : months.map(month => (
              <section key={month.key} className="expense-month">
              <div className="section-label">{month.label}</div>
              <List>
                {month.items.map(e => {
                  const mine = e.paidByUserId === currentUser.id
                  const sub = e.isSettlement ? (mine ? 'you settled up' : e.shareAmount != null && `you received ${formatCurrency(e.shareAmount, e.currencyIso)}`)
                    : e.isTransfer ? (mine ? 'you transferred' : e.shareAmount != null && 'transferred to you')
                    : (mine ? 'you paid' : e.shareAmount != null && `you owe ${formatCurrency(e.shareAmount, e.currencyIso)}`)
                  return (
                    <ListRow
                      key={e.id}
                      to={`/groups/${id}/expenses/${e.id}`}
                      icon={expenseIcon(e)}
                      iconStyle={e.isTransfer ? { background: 'var(--accent-light)', color: 'var(--accent-text)' }
                        : e.isSettlement ? { background: 'var(--green-light)', color: 'var(--green-dark)' }
                        : undefined}
                      title={e.description}
                      meta={<>{e.paidByName ? `Paid by ${e.paidByName}` : 'Paid by —'}{e.date ? ` · ${formatDate(e.date)}` : ''}</>}
                      aside={<>
                        <span className="list-row-amt">{formatCurrency(e.amount, e.currencyIso)}</span>
                        {sub && <span className="list-row-sub">{sub}</span>}
                      </>}
                    />
                  )
                })}
              </List>
              </section>
            ))}

            {hasMore && (
              <button className="btn-outline-amber" style={{ width: '100%', marginTop: 8 }} onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </button>
            )}
          </>}

          {tab === 'members' && <>
            <List>
              {members.map(m => {
                const self = m.id === currentUser.id
                return (
                  <ListRow
                    key={m.id}
                    onClick={self ? undefined : () => setMemberSheet(m)}
                    icon={<Avatar name={m.name} size={36} colorIndex={m.avatarColor} emoji={m.avatarEmoji} />}
                    className="list-row-person"
                    title={self ? `${m.name} (you)` : m.name}
                    meta={m.email}
                    aside={m.balance ? <>
                      <span className={`list-row-amt ${m.balance > 0 ? 'positive' : 'negative'}`}>{formatCurrency(Math.abs(m.balance), group.iso)}</span>
                      <span className="list-row-sub">{m.balance > 0 ? 'gets back' : 'owes'}</span>
                    </> : <span className="list-row-amt settled">Settled</span>}
                    chevron={!self}
                  />
                )
              })}
              <ListRow onClick={handleInvite} action icon="+" title="Invite people" />
            </List>
          </>}

          {tab === 'trips' && (
            trips.length === 0 ? (
              <div className="empty-state" style={{ padding: '32px 24px' }}>
                <img src="/cat-empty.svg" alt="" style={{ width: 80, height: 80 }} />
                <p style={{ color: 'var(--text-3)', fontSize: 14 }}>No trips planned with this group yet.</p>
              </div>
            ) : (
              <TripList trips={trips} />
            )
          )}
        </div>
        {wide && (
          <aside className="group-aside">
            {balanceCard}
            {categoryCard}
            {membersCard}
          </aside>
        )}
      </div>

      {tab === 'trips'
        ? <FabButton onClick={() => setShowNewTrip(true)} label="New trip" />
        : <FabButton onClick={handleNewExpense} label="Add expense" />}

      {showNewTrip && (
        <TripFormSheet
          groupId={id}
          onClose={() => setShowNewTrip(false)}
          onSaved={tripId => navigate(`/trips/${tripId}`)}
        />
      )}

      {/* Invite sheet */}
      {inviteLink && (
        <Sheet title="Invite to group" onClose={() => setInviteLink(null)}>
          <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 16 }}>Share this link. It expires in 7 days and can only be used once.</p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--surface-2)', borderRadius: 8, padding: '10px 12px', marginBottom: 16, wordBreak: 'break-all', fontSize: 13 }}>
            <span style={{ flex: 1 }}>{inviteLink}</span>
          </div>
          <SheetActions>
            <button className="btn btn-primary" onClick={() => { navigator.clipboard.writeText(inviteLink); setCopied(true); setTimeout(() => setCopied(false), 2000) }}>
              {copied ? 'Link copied!' : 'Copy link'}
            </button>
            <button className="btn btn-ghost" onClick={() => { setInviteLink(null); setCopied(false) }}>Close</button>
          </SheetActions>
        </Sheet>
      )}

      {/* Balance transfer sheet */}
      {showTransfer && (
        <Sheet title="Transfer balance" onClose={() => setShowTransfer(false)}>
          {sharedGroups.length === 0 ? (
            <>
              <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 16 }}>
                You and {transferTarget?.name} don't share any other groups to transfer the balance to.
              </p>
              <SheetActions><button className="btn btn-ghost" onClick={() => setShowTransfer(false)}>Close</button></SheetActions>
            </>
          ) : transferBilateral === 0 ? (
            <>
              <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 16 }}>
                You have no direct balance with {transferTarget?.name} in this group to transfer.
              </p>
              <SheetActions><button className="btn btn-ghost" onClick={() => setShowTransfer(false)}>Close</button></SheetActions>
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
              <SheetActions>
                <button type="submit" className="btn btn-primary">Transfer balance</button>
                <button type="button" className="btn btn-ghost" onClick={() => setShowTransfer(false)}>Cancel</button>
              </SheetActions>
            </form>
          )}
        </Sheet>
      )}

      {showEdit && (
        <GroupEditSheet
          group={group}
          canChangeCurrency={expenses.length === 0 && activeFilterCount === 0}
          onClose={() => setShowEdit(false)}
          onSaved={async () => { setShowEdit(false); await load() }}
        />
      )}

      {showSettlePick && (
        <Sheet title="Settle up with…" onClose={() => setShowSettlePick(false)}>
          <List>
            {counterparts.map(m => (
              <ListRow
                key={m.id}
                onClick={() => { setShowSettlePick(false); openSettlement(m) }}
                icon={<Avatar name={m.name} size={36} colorIndex={m.avatarColor} emoji={m.avatarEmoji} />}
                className="list-row-person"
                title={m.name}
                aside={<>
                  <span className={`list-row-amt ${m.balance > 0 ? 'positive' : 'negative'}`}>{formatCurrency(Math.abs(m.balance), group.iso)}</span>
                  <span className="list-row-sub">{m.balance > 0 ? 'gets back' : 'owes'}</span>
                </>}
                chevron
              />
            ))}
          </List>
          <SheetActions><button type="button" className="btn btn-ghost" onClick={() => setShowSettlePick(false)}>Cancel</button></SheetActions>
        </Sheet>
      )}

      {memberSheet && (() => {
        const m = memberSheet
        const close = () => setMemberSheet(null)
        return (
          <Sheet title={m.name} onClose={close}>
            <div className="member-sheet-head">
              <Avatar name={m.name} size={56} colorIndex={m.avatarColor} emoji={m.avatarEmoji} />
              <div className="member-sheet-status">
                {!m.balance ? 'Settled up in this group'
                  : m.balance < 0 ? <>Owes <span className="owe">{formatCurrency(Math.abs(m.balance), group.iso)}</span> in this group</>
                  : <>Gets back <span className="owed">{formatCurrency(m.balance, group.iso)}</span> in this group</>}
              </div>
              {m.email && <div className="member-sheet-email">{m.email}</div>}
            </div>
            <SheetActions>
              {!!m.balance && <button type="button" className="btn btn-primary" onClick={() => { close(); openSettlement(m) }}>Settle up</button>}
              {!!m.balance && <button type="button" className="btn btn-ghost" onClick={() => { close(); openTransfer(m) }}>Move balance to another group</button>}
              <button type="button" className="btn btn-danger" onClick={() => { close(); handleRemoveMember(m.id) }}>Remove from group</button>
              <button type="button" className="btn btn-ghost" onClick={close}>Cancel</button>
            </SheetActions>
          </Sheet>
        )
      })()}

      {/* Settlement sheet */}
      {showSettlement && (
        <Sheet title="Record a settlement" onClose={() => setShowSettlement(false)}>
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
            <SheetActions>
              <button type="submit" className="btn btn-primary">Record settlement</button>
              <button type="button" className="btn btn-ghost" onClick={() => setShowSettlement(false)}>Cancel</button>
            </SheetActions>
          </form>
        </Sheet>
      )}
    </>
  )
}