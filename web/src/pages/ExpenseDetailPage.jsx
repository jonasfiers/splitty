import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router'
import client from '../api/client'
import { formatCurrency, formatDate } from '../utils/currency.js'
import { Avatar, colorFor } from '../components/Avatar.jsx'
import Loading from '../components/Loading.jsx'
import PageHeader from '../components/PageHeader/PageHeader.jsx'
import { useMediaQuery } from '../utils/useMediaQuery.js'
import ExpenseHistory from '../components/ExpenseHistory.jsx'
import { DetailHero, DetailRows, DetailRow } from '../components/Detail/Detail.jsx'
import { useConfirm } from '../components/Confirm/ConfirmProvider.jsx'
import { useAuth } from '../context/AuthContext.jsx'

export default function ExpenseDetailPage() {
  const confirm = useConfirm()
  const { currentUser } = useAuth()
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

  // What this expense means for the person looking at it, in one line.
  const outcome = (() => {
    if (expense.isSettlement || expense.isTransfer || shares.length === 0 || !currentUser) return null
    const fmt = v => formatCurrency(v, expense.currencyIso)
    const others = shares.filter(sh => sh.userId !== expense.paidByUserId && sh.amount > 0)
    const mine = shares.find(sh => sh.userId === currentUser.id)?.amount ?? 0
    if (currentUser.id === expense.paidByUserId) {
      const back = others.reduce((sum, sh) => sum + Number(sh.amount), 0)
      if (back <= 0) return { tone: 'neutral', text: 'Only your own share' }
      if (others.length === 1) return { tone: 'positive', text: `${memberMap.get(others[0].userId)?.name ?? 'They'} owes you ${fmt(back)}` }
      return { tone: 'positive', text: `You get ${fmt(back)} back from ${others.length} people` }
    }
    if (mine > 0) return { tone: 'negative', text: `You owe ${expense.paidByName ?? 'the payer'} ${fmt(mine)}` }
    return { tone: 'neutral', text: "You're not part of this split" }
  })()

  const details = (
    <DetailRows>
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
              subtitle={[
                !expense.isSettlement && !expense.isTransfer && `Paid by ${expense.paidByName ?? '—'}`,
                expense.date && formatDate(expense.date),
              ].filter(Boolean).join(' · ')}
            />
            <div className="detail-amount">
              {formatCurrency(expense.amount, expense.currencyIso)}
              {expense.amountBase != null && expense.currencyIso !== expense.groupCurrencyIso && (
                <span className="detail-amount-base">≈ {formatCurrency(Number(expense.amountBase), expense.groupCurrencyIso)}</span>
              )}
            </div>

            {!wide && <hr className="divider" style={{ margin: '20px 0 16px' }} />}

            {!wide && details}
          </div>

          {!expense.isSettlement && !expense.isTransfer && shares.length > 0 && (
            <>
              <div className="section-label">Split</div>
              <div className="card">
                {outcome && <div className={`split-outcome ${outcome.tone}`}>{outcome.text}</div>}
                <div className="split-bar" aria-hidden="true">
                  {shares.filter(sh => sh.amount > 0).map(sh => {
                    const member = memberMap.get(sh.userId)
                    const color = colorFor(member?.avatarColor ?? member?.name ?? sh.userId)
                    return <span key={sh.userId} style={{ flexGrow: sh.amount, background: color.bg, borderColor: color.fg }} />
                  })}
                </div>
                <div className="members-section">
                  {shares.map(sh => {
                    const member = memberMap.get(sh.userId)
                    const isPayer = sh.userId === expense.paidByUserId
                    return (
                      <div key={sh.userId} className="member-row">
                        <Avatar name={member?.name} size={34} colorIndex={member?.avatarColor} emoji={member?.avatarEmoji} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="member-name">{member?.name ?? sh.userId}{sh.userId === currentUser?.id && ' (you)'}</div>
                          {isPayer && <div className="member-sub">paid {formatCurrency(expense.amount, expense.currencyIso)}</div>}
                        </div>
                        <span className="member-bal">{formatCurrency(sh.amount, expense.currencyIso)}</span>
                      </div>
                    )
                  })}
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
