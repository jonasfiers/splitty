import { useEffect, useState } from 'react'
import client from '../api/client'
import { describeChange } from '../utils/expenseChanges.js'

const when = ts => new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

// Who created the expense and every edit since, with what changed. Edits made
// before change tracking existed (6 Nov 2026) have no details.
export default function ExpenseHistory({ expenseId, reloadKey }) {
  const [history, setHistory] = useState(null)

  useEffect(() => {
    client.get(`/expenses/${expenseId}/history`)
      .then(r => setHistory(r.data.history || []))
      .catch(() => setHistory([]))
  }, [expenseId, reloadKey])

  if (!history?.length) return null
  return (
    <div className="card expense-history">
      <div className="section-label" style={{ padding: 0, margin: '0 0 10px' }}>History</div>
      <ol className="eh-list">
        {[...history].reverse().map((h, i) => (
          <li key={i} className="eh-item">
            <div className="eh-head">
              <strong>{h.userName}</strong> {h.action === 'CREATED_BY' ? 'added this' : 'edited this'}
              <span className="eh-when">{when(h.on)}</span>
            </div>
            {h.action === 'UPDATED_BY' && (
              h.changes?.length
                ? <ul className="eh-changes">{h.changes.map((c, j) => <li key={j}>{describeChange(c)}</li>)}</ul>
                : <div className="eh-none">Details were not recorded for this edit.</div>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
