import { useState, useEffect, useCallback } from 'react'
import LoadFailed from '../components/LoadFailed.jsx'
import { useNavigate } from 'react-router'
import client from '../api/client'
import FabButton from '../components/FabButton/FabButton.jsx'
import EmojiPicker from '../components/EmojiPicker/EmojiPicker.jsx'
import { formatCurrency } from '../utils/currency.js'
import { useAuth } from '../context/AuthContext.jsx'
import { timeAgo } from '../utils/time.js'
import Loading from '../components/Loading.jsx'
import HomePanels from '../components/HomePanels.jsx'
import TodayTrip from '../components/TodayTrip.jsx'
import TabHeader from '../components/PageHeader/TabHeader.jsx'
import Sheet, { SheetActions } from '../components/Sheet/Sheet.jsx'
import { List, ListRow } from '../components/List/List.jsx'
import Field from '../components/Field/Field.jsx'
import Picker from '../components/Picker/Picker.jsx'
import EmptyState from '../components/EmptyState/EmptyState.jsx'
import { PageGate } from '../utils/pageGate.jsx'
import { swr } from '../utils/cache.js'

export default function GroupsPage() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const [balance, setBalance] = useState({ balanceOwed: 0, balanceLent: 0 })
  const [groups, setGroups] = useState([])
  const [currencies, setCurrencies] = useState([])
  const [showNewGroup, setShowNewGroup] = useState(false)
  const [showExpensePicker, setShowExpensePicker] = useState(false)
  const [form, setForm] = useState({ title: '', currencyIso: '' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // The first load's failure: shown instead of the page (an empty page would
  // say "You're all settled up!" and "No groups yet", untrue).
  const [loadError, setLoadError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => { setLoadError(null); setLoading(true); setAttempt(n => n + 1) }, [])

  // The last state at once, then fresh (utils/cache.js); "Try again" asks the server only.
  useEffect(() => {
    const { cached, fresh } = swr([['/dash/groups'], ['/currencies'], ['/dash/balance']], ([gr, cr, bal]) => {
        setGroups((gr.data.groups || []).sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0)))
        const curs = cr.data.currencies || []
        setCurrencies(curs)
        if (curs.length > 0) setForm(f => ({ ...f, currencyIso: curs[0].iso }))
        setBalance({
          balanceOwed: Number(bal.data.balanceOwed ?? 0),
          balanceLent: Number(bal.data.balanceLent ?? 0),
        })
    }, { fresh: attempt > 0 })
    if (cached) setLoading(false)
    fresh
      .catch(err => { if (!cached) setLoadError(err) })
      .finally(() => setLoading(false))
  }, [attempt])

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
  if (loadError) return (
    <>
      <TabHeader logo />
      <LoadFailed error={loadError} what="your groups and balances" onRetry={retry} />
    </>
  )

  return (
    <>
      <TabHeader logo />
      {/* In one go: the Today card and the panels load their own data (utils/pageGate.jsx). */}
      <PageGate>
      <div className="home-layout">
        <div className="home-main">
          {/* on a trip: today's plan comes first */}
          <TodayTrip />
          {/* What is open now, across all groups (per person, netted over groups) */}
          {(() => {
            const owed = balance.balanceLent
            const owe = balance.balanceOwed
            const net = owed - owe
            const settled = owed < 1 && owe < 1
            return (
              <div className="card home-balance">
                <div className="home-balance-lbl">Across all groups</div>
                <div className="home-balance-main">
                  {settled ? "You're all settled up"
                    : net >= 0 ? <>You're owed <span className="owed">{formatCurrency(net)}</span></>
                    : <>You owe <span className="owe">{formatCurrency(-net)}</span></>}
                </div>
                {owed >= 1 && owe >= 1 && (
                  <div className="home-balance-split">
                    <span>Owed to you<b>{formatCurrency(owed)}</b></span>
                    <span>You owe<b>{formatCurrency(owe)}</b></span>
                  </div>
                )}
              </div>
            )
          })()}

          <div className="home-section-head">
            <div className="section-label">Groups</div>
            <button type="button" className="home-section-link" onClick={() => setShowNewGroup(true)}>+ New group</button>
          </div>

          {groups.length === 0 ? (
            <EmptyState title="No groups yet" action={<button className="btn btn-primary" onClick={() => setShowNewGroup(true)}>+ New group</button>}>
              Create a group to start splitting expenses with friends.
            </EmptyState>
          ) : (
            <List>
              {groups.map(g => {
                const myBalance = g.members?.find(m => m.id === currentUser?.id)?.balance ?? 0
                const people = g.members?.length || 0
                const when = timeAgo(g.lastActivity)
                return (
                  <ListRow
                    key={g.id}
                    to={`/groups/${g.id}`}
                    icon={g.icon || '👥'}
                    title={g.title}
                    meta={`${people} ${people === 1 ? 'person' : 'people'}${when ? ` · ${when}` : ''}`}
                    chevron
                    aside={myBalance === 0 ? (
                      <span className="list-row-amt settled">Settled</span>
                    ) : <>
                      <span className={`list-row-amt ${myBalance > 0 ? 'positive' : 'negative'}`}>
                        {myBalance > 0 ? '+' : '−'}{formatCurrency(Math.abs(myBalance), g.iso)}
                      </span>
                      <span className="list-row-sub">{myBalance > 0 ? 'owed to you' : 'you owe'}</span>
                    </>}
                  />
                )
              })}
            </List>
          )}
        </div>
        <aside className="home-aside">
          <HomePanels />
        </aside>
      </div>
      </PageGate>

      {/* FAB — add expense */}
      <FabButton onClick={handleFabClick} label="Add expense" />

      {/* Group picker sheet (when multiple groups) */}
      {showExpensePicker && (
        <Sheet title="Add expense to…" onClose={() => setShowExpensePicker(false)}>
          <List>
            {groups.map(g => (
              <ListRow
                key={g.id}
                onClick={() => { setShowExpensePicker(false); navigate(`/groups/${g.id}/expenses/new`) }}
                icon={g.icon}
                title={g.title}
                chevron
              />
            ))}
          </List>
          <SheetActions><button className="btn btn-ghost" onClick={() => setShowExpensePicker(false)}>Cancel</button></SheetActions>
        </Sheet>
      )}

      {/* New group sheet */}
      {showNewGroup && (
        <Sheet title="New group" onClose={() => setShowNewGroup(false)}>
          <form onSubmit={handleCreate}>
            <div className="form-row form-row-compact">
              <Field label="Icon">
                <EmojiPicker value={form.icon} onChange={icon => setForm(f => ({ ...f, icon }))}/>
              </Field>
              <Field label="Group name">
                <input
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Weekend trip"
                  autoFocus
                  required
                />
              </Field>
            </div>
            <Field label="Currency">
              <Picker
                title="Currency"
                value={form.currencyIso}
                onChange={v => setForm(f => ({ ...f, currencyIso: v }))}
                options={currencies.map(c => ({ value: c.iso, label: c.iso, icon: c.symbol }))}
                required
              />
            </Field>
            {error && <p className="error">{error}</p>}
            <SheetActions>
              <button type="submit" className="btn btn-primary">Create group</button>
              <button type="button" className="btn btn-ghost" onClick={() => setShowNewGroup(false)}>Cancel</button>
            </SheetActions>
          </form>
        </Sheet>
      )}
    </>
  )
}
