import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import client from '../api/client'
import FabButton from '../components/FabButton/FabButton.jsx'
import EmojiPicker from '../components/EmojiPicker/EmojiPicker.jsx'
import { formatCurrency } from '../utils/currency.js'
import { getInitials, AvatarStack } from '../components/Avatar.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { timeAgo } from '../utils/time.js'
import Loading from '../components/Loading.jsx'

export default function GroupsPage() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const [balance, setBalance] = useState({ balanceOwed: 0, balanceLent: 0, grossOwed: 0, grossLent: 0 })
  const [groups, setGroups] = useState([])
  const [currencies, setCurrencies] = useState([])
  const [showNewGroup, setShowNewGroup] = useState(false)
  const [showExpensePicker, setShowExpensePicker] = useState(false)
  const [form, setForm] = useState({ title: '', currencyIso: '' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([client.get('/dash/groups'), client.get('/currencies'), client.get('/dash/balance')])
      .then(([gr, cr,bal]) => {
        setGroups((gr.data.groups || []).sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0)))
        const curs = cr.data.currencies || []
        setCurrencies(curs)
        if (curs.length > 0) setForm(f => ({ ...f, currencyIso: curs[0].iso }))
        setBalance({ 
          balanceOwed: Number(bal.data.balanceOwed ?? 0), 
          balanceLent: Number(bal.data.balanceLent ?? 0),
          grossOwed: Number(bal.data.grossOwed ?? 0),
          grossLent: Number(bal.data.grossLent ?? 0)
        })
      })
        .catch((err) => {
          setError('Failed to load data. Please refresh the page.');
          console.error(err);
        })
      .finally(() => setLoading(false))
  }, [])

  const handleCreate = async e => {
    e.preventDefault()
    setError('')
    if (!form.icon) {
      setError('Pick an icon for the group — tap the + next to the name.')
      return
    }
    try {
      const { data } = await client.post('/groups', form)
      setGroups(gs => [...gs, { id: data.id, title: form.title }])
      setForm(f => ({ ...f, title: '' }))
      setShowNewGroup(false)
    } catch {
      setError('Failed to create group.')
    }
  }

  const handleFabClick = () => {
    if (groups.length === 0) {
      setShowNewGroup(true)
    } else if (groups.length === 1) {
      navigate(`/groups/${groups[0].id}/expenses/new`)
    } else {
      setShowExpensePicker(true)
    }
  }

  if (loading) return <Loading />

  return (
    <>
      {/* balance */}
      <div className="balance-banner">
        {(() => {
          const netTotal = balance.balanceLent + balance.balanceOwed
          const grossTotal = balance.grossLent + balance.grossOwed
          const net = balance.balanceLent - balance.balanceOwed
          const isSettled = netTotal < 0.01
          const pct = grossTotal > 0.01 ? (balance.grossLent / grossTotal) * 100 : 50

          return (
            <>
              <div className="balance-content" style={{ paddingBottom: isSettled ? 48 : 32 }}>
                {isSettled ? (
                  <div className="balance-settled-info">
                    <span className="balance-settled-icon">🎉</span>
                    <div className="balance-settled-text">You're all settled up!</div>
                  </div>
                ) : (
                  <>
                    <div className="balance-col">
                      <span className="balance-lbl">You paid</span>
                      <span className="balance-amt positive">{formatCurrency(balance.grossLent)}</span>
                    </div>
                    <div className="balance-divider" />
                    <div className="balance-col" style={{ alignItems: 'flex-end', textAlign: 'right' }}>
                      <span className="balance-lbl">You borrowed</span>
                      <span className="balance-amt negative">{formatCurrency(balance.grossOwed)}</span>
                    </div>
                  </>
                )}
              </div>

              <div className={`balance-bar-track ${isSettled ? 'settled' : ''}`}>
                <div 
                  className={`balance-net-marker ${isSettled ? 'settled' : net > 0 ? 'positive' : net < 0 ? 'negative' : ''}`}
                  style={{ left: `clamp(35px, ${pct}%, calc(100% - 35px))` }}
                >
                  {isSettled ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                      Settled
                    </span>
                  ) : (
                    <>{net > 0 ? '+' : ''}{formatCurrency(net)}</>
                  )}
                </div>
                {!isSettled && (
                  <>
                    <div 
                      className="balance-bar positive" 
                      style={{ flex: balance.grossLent, minWidth: balance.grossLent > 0 ? 4 : 0 }} 
                    />
                    <div 
                      className="balance-bar negative" 
                      style={{ flex: balance.grossOwed, minWidth: balance.grossOwed > 0 ? 4 : 0 }} 
                    />
                  </>
                )}
              </div>
            </>
          )
        })()}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="section-label" style={{ marginBottom: 0 }}>Your groups</div>
        <button className="btn-pill-outline" style={{ fontSize: 12, padding: '5px 12px' }} onClick={() => setShowNewGroup(true)}>
          + New group
        </button>
      </div>

      <div style={{ height: 10 }} />

      {groups.length === 0 ? (
        <div className="empty-state">
          <img src="/cat-empty.svg" alt="" />
          <p className="empty-state-title">No groups yet</p>
          <p className="empty-state-sub">Create a group to start splitting expenses with friends.</p>
          <button className="btn-pill" onClick={() => setShowNewGroup(true)}>+ New group</button>
        </div>
      ) : (
        <div className="group-cards">
          {groups.map(g => {
            const me = g.members?.find(m => m.id === currentUser?.id)
            const myBalance = me?.balance ?? 0
            const others = g.members?.filter(m => m.id !== currentUser?.id) || []

            return (
              <Link key={g.id} to={`/groups/${g.id}`} className="group-card">
                <div className="gc-top">
                  <div className="gc-top-row">
                    <div className="gc-title-area">
                      <span className="gc-icon">{g.icon || '👥'}</span>
                      <div className="gc-name">{g.title}</div>
                    </div>
                    {myBalance === 0 ? (
                      <span className="gc-bal settled">✓ settled</span>
                    ) : (
                      <span className={`gc-bal ${myBalance > 0 ? 'positive' : 'negative'}`}>
                        {myBalance > 0 ? '+' : ''}{formatCurrency(myBalance, g.iso)}
                      </span>
                    )}
                  </div>
                  <div className="gc-meta-row">
                    {timeAgo(g.lastActivity) ? (
                      <span className="gc-meta">{timeAgo(g.lastActivity)}</span>
                    ) : <div />}
                    <AvatarStack members={g.members || []} />
                  </div>
                </div>

                {(() => {
                  const debtors = others.filter(m => m.balance !== 0)
                  if (!debtors.length || (g.members?.length || 0) <= 2) return null
                  const maxAbs = Math.max(...debtors.map(m => Math.abs(m.balance)))
                  
                  return (
                    <div className="gc-members-list">
                      {debtors.map(m => {
                        const pct = maxAbs > 0 ? (Math.abs(m.balance) / maxAbs) * 50 : 0
                        const isPos = m.balance > 0
                        return (
                          <div key={m.id} className="gc-member-row">
                            <div className="gc-member-info">
                              <span className="gc-member-name">{m.name}</span>
                              <span className={`gc-member-amount ${isPos ? 'positive' : 'negative'}`}>
                                {isPos ? '+' : ''}{formatCurrency(m.balance, g.iso)}
                              </span>
                            </div>
                            {debtors.length > 1 && (
                              <div className="gc-member-bar-track">
                                <div className="gc-member-bar-center" />
                                <div 
                                  className={`gc-member-bar ${isPos ? 'positive' : 'negative'}`}
                                  style={{ 
                                    width: `${pct}%`, 
                                    ...(isPos ? { left: '50%' } : { right: '50%' }) 
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}
              </Link>
            )
          })}
        </div>
      )}

      {/* FAB — add expense */}
      <FabButton onClick={handleFabClick} label="Add expense" />

      {/* Group picker sheet (when multiple groups) */}
      {showExpensePicker && (
        <div className="sheet-overlay" onClick={e => { if (e.target === e.currentTarget) setShowExpensePicker(false) }}>
          <div className="sheet">
            <div className="sheet-handle" />
            <p className="sheet-title">Add expense to…</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {groups.map(g => (
                <button
                  key={g.id}
                  onClick={() => { setShowExpensePicker(false); navigate(`/groups/${g.id}/expenses/new`) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 14px', borderRadius: 'var(--r-md)',
                    background: 'var(--surface-2)', border: '1px solid var(--border)',
                    textAlign: 'left', cursor: 'pointer',
                    font: '500 14px var(--font-body)', color: 'var(--text)',
                    transition: 'background .12s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-light)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'var(--surface-2)'}
                >
                  <span style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: 'var(--accent-subtle)', color: 'var(--accent)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 700, flexShrink: 0,
                  }}>
                    {g.icon}
                  </span>
                  {g.title}
                </button>
              ))}
            </div>
            <button className="btn btn-ghost" style={{ width: '100%', marginTop: 12 }} onClick={() => setShowExpensePicker(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* New group sheet */}
      {showNewGroup && (
        <div className="sheet-overlay" onClick={e => { if (e.target === e.currentTarget) setShowNewGroup(false) }}>
          <div className="sheet">
            <div className="sheet-handle" />
            <p className="sheet-title">New group</p>
            <form onSubmit={handleCreate}>
              <div className="form-row form-row-compact">
                <div className="form-group">
                    <label>Icon</label>
                  <EmojiPicker value={form.icon} onChange={icon => setForm(f => ({ ...f, icon }))}/>
                </div>
                <div className="form-group">

                  <label>Group name</label>
                  <input
                    value={form.title}
                    onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="e.g. Weekend trip"
                    autoFocus
                    required
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Currency</label>
                <select
                  value={form.currencyIso}
                  onChange={e => setForm(f => ({ ...f, currencyIso: e.target.value }))}
                  required
                >
                  {currencies.map(c => (
                    <option key={c.iso} value={c.iso}>{c.iso}</option>
                  ))}
                </select>
              </div>
              {error && <p className="error">{error}</p>}
              <button type="submit" className="btn btn-primary">Create group</button>
              <button type="button" className="btn btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={() => setShowNewGroup(false)}>
                Cancel
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
