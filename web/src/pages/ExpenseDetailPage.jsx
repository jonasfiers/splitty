import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router'
import client from '../api/client'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { formatCurrency, formatDate } from '../utils/currency.js'
import { Avatar, colorFor } from '../components/Avatar.jsx'
import Loading from '../components/Loading.jsx'
import ChartTooltip from '../components/ChartTooltip.jsx'
import PageHeader from '../components/PageHeader/PageHeader.jsx'
import { useMediaQuery } from '../utils/useMediaQuery.js'
import ExpenseHistory from '../components/ExpenseHistory.jsx'
import { DetailHero, DetailRows, DetailRow } from '../components/Detail/Detail.jsx'
import { useConfirm } from '../components/Confirm/ConfirmProvider.jsx'

export default function ExpenseDetailPage() {
  const confirm = useConfirm()
  const { groupId, id } = useParams()
  const navigate = useNavigate()
  // Same breakpoint as the group page and the .expense-detail-layout rule in index.css.
  const wide = useMediaQuery('(min-width: 1180px)')

  const [expense, setExpense] = useState(null)
  const [shares, setShares] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const handleDelete = async () => {
    const what = expense.isTransfer ? 'transfer' : expense.isSettlement ? 'settlement' : 'expense'
    const ok = await confirm({
      title: expense.isTransfer || expense.isSettlement ? `Cancel this ${what}?` : `Delete "${expense.description}"?`,
      confirmLabel: expense.isTransfer || expense.isSettlement ? `Cancel ${what}` : 'Delete',
      danger: true,
    })
    if (!ok) return
    try {
      await client.delete(`/expenses/${id}`)
      navigate(`/groups/${groupId}`, { state: { notice: `"${expense.description}" was deleted.` } })
    } catch {
      setError('Failed to delete expense.')
    }
  }

  useEffect(() => {
    Promise.all([
      client.get(`/expenses/${id}`),
      client.get(`/shares/expense/${id}`),
      client.get(`/groups/${groupId}/members`),
    ]).then(([expRes, sharesRes, membersRes]) => {
      const expense = expRes.data.expense
      if (!expense) {
        navigate(`/groups/${groupId}`, { state: { notice: 'This expense no longer exists.' }, replace: true })
        return
      }
      setExpense(expense)
      setShares(sharesRes.data.shares || [])
      setMembers(membersRes.data.members || [])
    }).catch(() => {
      navigate(`/groups/${groupId}`, { state: { notice: 'This expense could not be found.' }, replace: true })
    }).finally(() => setLoading(false))
  }, [id, groupId])

  if (loading) return <Loading />
  if (!expense) return null

  const icon = expense.isTransfer ? '⇄' : expense.isSettlement ? '✓' : (expense.categoryIcon || expense.description?.[0]?.toUpperCase() || '?')
  const memberMap = new Map(members.map(m => [m.id, m]))

  const details = (
    <DetailRows>
      {wide && !expense.isSettlement && !expense.isTransfer && (
        <DetailRow label="Paid by">{expense.paidByName ?? '—'}</DetailRow>
      )}
      {wide && expense.date && <DetailRow label="Date">{formatDate(expense.date)}</DetailRow>}
      {(expense.isSettlement || expense.isTransfer) ? (
        <>
          <DetailRow label="From">{expense.paidByName}</DetailRow>
          <DetailRow label="To">
            {memberMap.get(shares.find(s => s.userId !== expense.paidByUserId)?.userId)?.name ?? '—'}
          </DetailRow>
        </>
      ) : (
        expense.categoryName && <DetailRow label="Category">{expense.categoryName}</DetailRow>
      )}
      {expense.tripItem && (
        <DetailRow label="Trip">
          <Link to={`/trips/${expense.tripItem.tripId}/items/${expense.tripItem.id}`}>
            {expense.tripItem.title} · {expense.tripItem.tripTitle}
          </Link>
        </DetailRow>
      )}
    </DetailRows>
  )

  return (
    <>
      <PageHeader
        compact
        crumbs={[{ to: '/groups', label: 'Home' }, { to: `/groups/${groupId}`, label: expense.groupTitle || 'Group' }]}
        name={expense.isTransfer ? 'Transfer' : expense.isSettlement ? 'Settlement' : 'Expense'}
        actions={wide ? [] : [
          ...(!expense.isSettlement && !expense.isTransfer
            ? [{ label: 'Edit', onClick: () => navigate(`/groups/${groupId}/expenses/${id}/edit`), primary: true }]
            : []),
          { label: expense.isTransfer ? 'Cancel transfer' : expense.isSettlement ? 'Cancel settlement' : 'Delete expense', onClick: handleDelete, danger: true },
        ]}
      />
      {error && <p className="error">{error}</p>}

      <div className="expense-detail-layout">
        <div className="expense-detail-main">
          <div className="card">
            <DetailHero
              icon={icon}
              iconStyle={expense.isTransfer ? { background: 'var(--accent-light)', color: 'var(--accent-text)' }
                : expense.isSettlement ? { background: 'var(--green-light)', color: 'var(--green-dark)' }
                : undefined}
              title={expense.description}
              subtitle={expense.paidByName ?? '—'}
              aside={
                <>
                  <div style={{ fontSize: 22, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--accent-text)' }}>
                    {formatCurrency(expense.amount, expense.currencyIso)}
                  </div>
                  {expense.amountBase != null && expense.currencyIso !== expense.groupCurrencyIso && (
                    <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                      ≈ {formatCurrency(Number(expense.amountBase), expense.groupCurrencyIso)}
                    </div>
                  )}
                  {expense.date && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3 }}>{formatDate(expense.date)}</div>}
                </>
              }
            />

            {!wide && <hr className="divider" style={{ margin: '20px 0 16px' }} />}

            {!wide && details}
          </div>

          {!expense.isSettlement && !expense.isTransfer && shares.length > 0 && (
            <>
              <div className="section-label">Split</div>
              <div className="card" style={{ paddingBottom: 8 }}>
                <div className="expense-split-body">
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={shares.map(s => ({ name: memberMap.get(s.userId)?.name ?? s.userId, value: s.amount }))}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={3}
                        dataKey="value"
                      >
                        {shares.map(s => {
                          const member = memberMap.get(s.userId)
                          const color = colorFor(member?.avatarColor !== undefined && member?.avatarColor !== null ? member.avatarColor : (member?.name ?? s.userId))
                          return <Cell key={s.userId} fill={color.bg} stroke={color.fg} strokeWidth={1.5} />
                        })}
                      </Pie>
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null
                          const { name, value } = payload[0].payload
                          return <ChartTooltip title={name} value={formatCurrency(value, expense.currencyIso)} />
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="members-section expense-split-members">
                    {shares.map(s => {
                      const member = memberMap.get(s.userId)
                      const isPayer = s.userId === expense.paidByUserId
                      return (
                        <div key={s.userId} className="member-row">
                          <Avatar name={member?.name} size={34} colorIndex={member?.avatarColor} emoji={member?.avatarEmoji} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="member-name">{member?.name ?? s.userId}</div>
                            {isPayer && <div style={{ fontSize: 11, color: 'var(--text-3)' }}>paid</div>}
                          </div>
                          <span className="member-bal" style={{ color: isPayer ? 'var(--green-dark)' : 'var(--text-2)' }}>
                            {formatCurrency(s.amount, expense.currencyIso)}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </>
          )}
          {!expense.isSettlement && !expense.isTransfer && <ExpenseHistory expenseId={id} />}
        </div>
        {wide && (
          <aside className="expense-detail-aside">
            <div className="card">{details}</div>
            <div className="expense-detail-actions">
              {!expense.isSettlement && !expense.isTransfer && (
                <button className="btn btn-secondary" onClick={() => navigate(`/groups/${groupId}/expenses/${id}/edit`)}>
                  Edit expense
                </button>
              )}
              <button className="btn btn-ghost" onClick={handleDelete}>
                {expense.isTransfer ? 'Cancel transfer' : expense.isSettlement ? 'Cancel settlement' : 'Delete'}
              </button>
            </div>
          </aside>
        )}
      </div>
    </>
  )
}
