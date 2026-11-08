import { useEffect, useState } from 'react'
import client from '../../api/client'
import { formatCurrency, formatDate } from '../../utils/currency.js'
import Sheet, { SheetActions } from '../Sheet/Sheet.jsx'

const LIMIT = 50

// Pick an expense the group already has and link it to a trip item (for a
// booking that was entered as an expense before the trip was planned).
// Settlements and transfers are not expenses for anything, so they are left out.
function LinkExpenseSheet({ itemId, groupId, linkedIds, onClose, onLinked }) {
  const [query, setQuery] = useState('')
  const [expenses, setExpenses] = useState(null)
  const [error, setError] = useState('')
  const [linking, setLinking] = useState(null)

  useEffect(() => {
    let current = true
    const t = setTimeout(() => {
      const params = new URLSearchParams({ skip: 0, limit: LIMIT, ...(query.trim() && { keyword: query.trim() }) })
      client.get(`/groups/${groupId}/expenses?${params}`)
        .then(r => {
          if (!current) return
          // One row per expense, even if the list ever repeats one.
          const unique = [...new Map((r.data.expenses || []).map(e => [e.id, e])).values()]
          setExpenses(unique.filter(e => !e.isSettlement && !e.isTransfer))
        })
        .catch(() => { if (current) setError('Could not load the group’s expenses.') })
    }, query ? 250 : 0)
    return () => { current = false; clearTimeout(t) }
  }, [groupId, query])

  const link = async expense => {
    if (linking) return
    setLinking(expense.id)
    setError('')
    try {
      await client.post(`/trips/items/${itemId}/expenses`, { expenseId: expense.id })
      onLinked(expense)
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to link the expense.')
      setLinking(null)
    }
  }

  return (
    <Sheet title="Link an existing expense" onClose={onClose} className="link-expense">
      <div className="form-group">
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search the group’s expenses…" autoFocus />
      </div>
      {error && <p className="error">{error}</p>}
      <div className="link-expense-list">
        {expenses === null ? (
          <p className="link-expense-empty">Loading…</p>
        ) : expenses.length === 0 ? (
          <p className="link-expense-empty">{query ? 'No expenses match.' : 'This group has no expenses yet.'}</p>
        ) : expenses.map(e => {
          const linked = linkedIds.includes(e.id)
          return (
            <button key={e.id} type="button" className="link-expense-row" disabled={linked || linking} onClick={() => link(e)}>
              <span className="link-expense-info">
                <span className="link-expense-name">{e.description}</span>
                <span className="link-expense-meta">
                  {e.paidByName ? `Paid by ${e.paidByName}` : 'Paid by —'}{e.date ? ` · ${formatDate(e.date)}` : ''}
                </span>
              </span>
              <span className="link-expense-amount">
                {formatCurrency(e.amount, e.currencyIso)}
                {linked && <span className="link-expense-tag">linked</span>}
                {linking === e.id && <span className="link-expense-tag">linking…</span>}
              </span>
            </button>
          )
        })}
      </div>
      <SheetActions><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button></SheetActions>
    </Sheet>
  )
}

export default LinkExpenseSheet
