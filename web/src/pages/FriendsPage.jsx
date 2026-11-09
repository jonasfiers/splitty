import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router'
import LoadFailed from '../components/LoadFailed.jsx'
import Loading from '../components/Loading.jsx'
import { Avatar } from '../components/Avatar.jsx'
import PageHeader from '../components/PageHeader/PageHeader.jsx'
import { List, ListRow } from '../components/List/List.jsx'
import Sheet, { SheetActions } from '../components/Sheet/Sheet.jsx'
import { formatCurrency } from '../utils/currency.js'
import EmptyState from '../components/EmptyState/EmptyState.jsx'
import { swrOne } from '../utils/cache.js'

// What is open with someone, per currency: groups in the same currency add
// up, different currencies are listed side by side rather than converted.
function totals(friend) {
  const byIso = new Map()
  for (const g of friend.groups) if (g.net) byIso.set(g.iso, (byIso.get(g.iso) || 0) + g.net)
  return [...byIso].filter(([, net]) => net).map(([iso, net]) => ({ iso, net }))
}

function Amounts({ list }) {
  if (list.length === 0) return <span className="list-row-amt settled">Settled</span>
  // One direction: "owes you" / "you owe". Mixed (owes you € but you owe £):
  // each amount says it itself.
  const allPos = list.every(t => t.net > 0), allNeg = list.every(t => t.net < 0)
  return <>
    {list.map(t => (
      <span key={t.iso} className={`list-row-amt ${t.net > 0 ? 'positive' : 'negative'}`}>
        {!allPos && !allNeg && (t.net > 0 ? '+' : '−')}{formatCurrency(Math.abs(t.net), t.iso)}
      </span>
    ))}
    <span className="list-row-sub">{allPos ? 'owes you' : allNeg ? 'you owe' : 'mixed'}</span>
  </>
}

export default function FriendsPage() {
  const navigate = useNavigate()
  const [friends, setFriends] = useState([])
  const [open, setOpen] = useState(null) // the friend whose groups are shown
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => { setLoadError(null); setLoading(true); setAttempt(n => n + 1) }, [])

  useEffect(() => {
    const { cached, fresh } = swrOne('/dash/friends', r => setFriends(r.data.friends || []), { fresh: attempt > 0 })
    if (cached) setLoading(false)
    fresh
      .catch(err => { if (!cached) setLoadError(err) })
      .finally(() => setLoading(false))
  }, [attempt])

  const bare = <PageHeader compact crumbs={[{ to: '/profile', label: 'Profile' }]} name="Friends" />
  if (loading) return <>{bare}<Loading /></>
  if (loadError) return <>{bare}<LoadFailed error={loadError} what="your friends" onRetry={retry} /></>

  // Open balances first, the largest on top; then the settled ones by name.
  const rows = friends.map(f => ({ ...f, totals: totals(f) }))
  const weight = f => f.totals.reduce((s, t) => s + Math.abs(t.net), 0)
  const openRows = rows.filter(f => f.totals.length).sort((a, b) => weight(b) - weight(a))
  const settled = rows.filter(f => !f.totals.length).sort((a, b) => a.name.localeCompare(b.name))

  const row = f => (
    <ListRow
      key={f.id}
      onClick={() => setOpen(f)}
      icon={<Avatar name={f.name} size={36} colorIndex={f.avatarColor} emoji={f.avatarEmoji} />}
      className="list-row-person"
      title={f.name}
      meta={f.groups.map(g => g.title).join(', ')}
      aside={<Amounts list={f.totals} />}
      chevron
    />
  )

  const settle = (friend, g) => navigate(`/groups/${g.id}`, { state: { settleWith: { userId: friend.id, amount: g.net } } })

  return (
    <>
      <PageHeader crumbs={[{ to: '/profile', label: 'Profile' }]} title="Friends" name="Friends" />

      {friends.length === 0 ? (
        <EmptyState title="No friends yet">People you share a group with appear here. Invite someone from a group's Members tab.</EmptyState>
      ) : <>
        {openRows.length > 0 && <List label="Open balances">{openRows.map(row)}</List>}
        {settled.length > 0 && <List label={openRows.length ? 'Settled up' : undefined}>{settled.map(row)}</List>}
      </>}

      {open && (
        <Sheet title={open.name} onClose={() => setOpen(null)}>
          <div className="member-sheet-head">
            <Avatar name={open.name} size={56} colorIndex={open.avatarColor} emoji={open.avatarEmoji} />
            <div className="member-sheet-status">
              {open.totals.length === 0 ? 'All settled up'
                : open.totals.map(t => (
                  <div key={t.iso}>
                    {t.net > 0 ? <>Owes you <span className="owed">{formatCurrency(t.net, t.iso)}</span></>
                      : <>You owe <span className="owe">{formatCurrency(-t.net, t.iso)}</span></>}
                  </div>
                ))}
            </div>
          </div>
          <List label="Per group">
            {open.groups.map(g => (
              <ListRow
                key={g.id}
                icon={g.icon}
                title={g.title}
                meta={!g.net ? 'Settled' : g.net > 0 ? `Owes you ${formatCurrency(g.net, g.iso)}` : `You owe ${formatCurrency(-g.net, g.iso)}`}
                {...(g.net
                  ? { onClick: () => settle(open, g), aside: <span className="list-row-link-text">Settle up</span>, chevron: true }
                  : { to: `/groups/${g.id}`, chevron: true })}
              />
            ))}
          </List>
          <SheetActions><button type="button" className="btn btn-ghost" onClick={() => setOpen(null)}>Close</button></SheetActions>
        </Sheet>
      )}
    </>
  )
}
