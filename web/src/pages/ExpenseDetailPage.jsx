import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import client from '../api/client'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { formatCurrency, formatDate } from '../utils/currency.js'
import { Avatar, colorFor } from '../components/Avatar.jsx'
import Loading from '../components/Loading.jsx'
import ChartTooltip from '../components/ChartTooltip.jsx'
import BackLink from '../components/BackLink.jsx'

export default function ExpenseDetailPage() {
  const { groupId, id } = useParams()
  const navigate = useNavigate()

  const [expense, setExpense] = useState(null)
  const [shares, setShares] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showMove, setShowMove] = useState(false)
  const [moveGroups, setMoveGroups] = useState([])
  const [moveGroupId, setMoveGroupId] = useState('')

  const handleDelete = async () => {
    if (!window.confirm('Delete this expense?')) return
    try {
      await client.delete(`/expenses/${id}`)
      navigate(`/groups/${groupId}`, { state: { notice: `"${expense.description}" was deleted.` } })
    } catch {
      setError('Failed to delete expense.')
    }
  }

  const openMove = async () => {
    try {
      const res = await client.get('/groups')
      const others = (res.data.groups || []).filter(g => g.id !== groupId)
      setMoveGroups(others)
      setMoveGroupId(others[0]?.id || '')
      setShowMove(true)
    } catch {
      setError('Could not load groups.')
    }
  }

  const handleMove = async e => {
    e.preventDefault()
    setError('')
    try {
      await client.put(`/expenses/${id}/group`, { groupId: moveGroupId })
      const target = moveGroups.find(g => g.id === moveGroupId)
      navigate(`/groups/${moveGroupId}`, { state: { notice: `"${expense.description}" was moved to ${target?.title ?? 'the group'}.` } })
    } catch {
      setError('Failed to move expense.')
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

  return (
    <>
      <div className="sub-header">
        <BackLink to={`/groups/${groupId}`} />
        <span className="sub-header-title">{expense.isTransfer ? 'Transfer' : expense.isSettlement ? 'Settlement' : 'Expense'}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {!expense.isSettlement && !expense.isTransfer && (
            <button
              className="sub-header-del"
              style={{ color: 'var(--accent)' }}
              onClick={() => navigate(`/groups/${groupId}/expenses/${id}/edit`)}
            >
              Edit
            </button>
          )}
          {!expense.isSettlement && !expense.isTransfer && (
            <button className="sub-header-del" style={{ color: 'var(--accent)' }} onClick={openMove}>
              Move
            </button>
          )}
          <button className="sub-header-del" onClick={handleDelete}>
            {expense.isTransfer ? 'Cancel transfer' : expense.isSettlement ? 'Cancel settlement' : 'Delete'}
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <div className="expense-icon" style={{
            width: 56, height: 56, fontSize: 26, borderRadius: 'var(--r-lg)', flexShrink: 0,
            ...(expense.isTransfer ? { background: 'var(--accent-light)', color: 'var(--accent)' }
              : expense.isSettlement ? { background: 'var(--green-light)', color: 'var(--green-dark)' }
              : {})
          }}>
            {icon}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>{expense.description}</div>
            <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{expense.paidByName ?? '—'}</div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 22, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--accent)' }}>
              {formatCurrency(expense.amount, expense.currencyIso)}
            </div>
            {expense.amountBase != null && expense.currencyIso !== expense.groupCurrencyIso && (
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                ≈ {formatCurrency(Number(expense.amountBase), expense.groupCurrencyIso)}
              </div>
            )}
            {expense.date && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3 }}>{formatDate(expense.date)}</div>}
          </div>
        </div>

        <hr className="divider" style={{ margin: '0 0 16px' }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {(expense.isSettlement || expense.isTransfer) ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--text-3)' }}>From</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{expense.paidByName}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--text-3)' }}>To</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                  {memberMap.get(shares.find(s => s.userId !== expense.paidByUserId)?.userId)?.name ?? '—'}
                </span>
              </div>
            </>
          ) : (
            expense.categoryName && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--text-3)' }}>Category</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{expense.categoryName}</span>
              </div>
            )
          )}
        </div>
      </div>

      {!expense.isSettlement && !expense.isTransfer && shares.length > 0 && (
        <>
          <div className="section-label">Split</div>
          <div className="card" style={{ paddingBottom: 8 }}>
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
            <div className="members-section" style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 4 }}>
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
        </>
      )}

      {/* Move expense sheet */}
      {showMove && (
        <div className="sheet-overlay" onClick={e => { if (e.target === e.currentTarget) setShowMove(false) }}>
          <div className="sheet">
            <div className="sheet-handle" />
            <p className="sheet-title">Move expense</p>
            {moveGroups.length === 0 ? (
              <>
                <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 16 }}>
                  You don't have any other groups to move this expense to.
                </p>
                <button className="btn btn-ghost" style={{ width: '100%' }} onClick={() => setShowMove(false)}>Close</button>
              </>
            ) : (
              <form onSubmit={handleMove}>
                <p style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 16 }}>
                  Move "{expense.description}" to:
                </p>
                <div className="form-group">
                  <label>Destination group</label>
                  <select value={moveGroupId} onChange={e => setMoveGroupId(e.target.value)} required>
                    {moveGroups.map(g => (
                      <option key={g.id} value={g.id}>{g.icon} {g.title}</option>
                    ))}
                  </select>
                </div>
                <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>Move expense</button>
                <button type="button" className="btn btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={() => setShowMove(false)}>Cancel</button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  )
}
