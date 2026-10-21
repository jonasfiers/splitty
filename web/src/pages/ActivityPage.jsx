import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'
import client from '../api/client'
import { formatCurrency } from '../utils/currency'
import { timeAgo } from '../utils/time.js'
import Loading from '../components/Loading.jsx'

export default function ActivityPage() {
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    client.get('/dash/activity')
      .then(r => setActivities(r.data.activities || []))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <Loading />

  if (activities.length === 0) return (
    <>
      <div className="page-header">
        <span className="page-title">Activity</span>
      </div>
      <div className="empty-state">
        <img src="/cat-empty.svg" alt="" />
        <p className="empty-state-title">No activity yet</p>
        <p className="empty-state-sub">When expenses are added or updated, they'll show up here.</p>
      </div>
    </>
  )

  return (
    <>
      <div className="page-header">
        <span className="page-title">Activity</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {activities.map((a, i) => (
          <div
            key={i}
            className="card"
            style={{ padding: '14px 16px', cursor: 'pointer' }}
            onClick={() => a.groupId && navigate(`/groups/${a.groupId}/expenses/${a.expenseId}`)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 'var(--r-md)', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
                background: a.isSettlement ? 'var(--green-light)' : (a.action === 'CREATED_BY' ? 'var(--green-light)' : 'var(--accent-subtle)'),
                color: a.isSettlement ? 'var(--green-dark)' : (a.action === 'CREATED_BY' ? 'var(--green-dark)' : 'var(--accent)'),
              }}>
                {a.isSettlement ? '✓' : (a.action === 'CREATED_BY' ? '＋' : '✎')}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.description}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                  {a.userName} {a.isSettlement ? 'recorded a settlement' : (a.action === 'CREATED_BY' ? 'added' : 'updated')} · {timeAgo(a.timestamp)}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{formatCurrency(a.amount, a.currencyIso)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}