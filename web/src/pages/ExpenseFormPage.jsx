import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import client from '../api/client'
import CurrencyInput from '../components/CurrencyInput/CurrencyInput.jsx'
import { formatCurrency } from '../utils/currency.js'
import Loading from '../components/Loading.jsx'
import BackLink from '../components/BackLink.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import CategoryPicker from '../components/CategoryPicker/CategoryPicker.jsx'

function recalculate(shares, total, payerId) {
  const included = shares.filter(s => s.included)
  if (!included.length || !total || isNaN(total)) return shares
  const n = included.length
  const base = Math.floor(total / n)
  const remainder = total - base * n
  const payerIncluded = included.some(s => s.userId === payerId)
  let remainderGiven = false
  return shares.map(s => {
    if (!s.included) return { ...s, amount: '' }
    const getPlusRemainder = payerIncluded ? s.userId === payerId : !remainderGiven
    if (!payerIncluded && getPlusRemainder) remainderGiven = true
    return { ...s, amount: s.included ? base + (getPlusRemainder ? remainder : 0) : 0 }
  })
}

export default function ExpenseFormPage() {
  const { id, groupId } = useParams()
  const { currentUser } = useAuth()
  const isEdit = Boolean(id)
  const navigate = useNavigate()

  const [form, setForm] = useState({
    groupId: groupId || '',
    description: '',
    categoryId: '',
    amount: '',
    currencyIso: '',
    date: new Date().toISOString().slice(0, 10),
    paidByUserId: '',
  })
  const [shares, setShares] = useState([])
  const [categories, setCategories] = useState([])
  const [currencies, setCurrencies] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const fetches = [
      client.get(`/categories?groupId=${groupId}`),
      client.get('/currencies'),
      ...(groupId ? [client.get(`/groups/${groupId}/members`)] : []),
      ...(groupId ? [client.get(`/groups/${groupId}`)] : [client.get('/groups')]),
      ...(isEdit ? [client.get(`/expenses/${id}`)] : []),
      ...(isEdit ? [client.get(`/shares/expense/${id}`)] : []),
    ]

    Promise.all(fetches).then(results => {
      let idx = 0
      const cats = results[idx++].data.categories || []
      const curs = results[idx++].data.currencies || []
      const usrs = groupId ? (results[idx++].data.members || []) : []
      const groupIso = groupId ? results[idx++]?.data?.groups?.[0]?.iso : null
      const expData = isEdit ? results[idx++]?.data : null
      const sharesData = isEdit ? results[idx]?.data : null

      setCategories(cats)
      setCurrencies(curs)
      setUsers(usrs)

      if (isEdit && expData?.expense) {
        const e = expData.expense
        setForm(f => ({
          ...f,
          description:  e.description  || '',
          amount:       e.amount,
          date:         e.date         || f.date,
          categoryId:   e.categoryId   || '',
          currencyIso:  e.currencyIso  || (curs[0]?.iso ?? ''),
          paidByUserId: e.paidByUserId || '',
        }))
      } else {
        setForm(f => ({
          ...f,
          currencyIso: groupIso || curs[0]?.iso || '',
          paidByUserId: currentUser?.id || '',
        }))
      }

      if (isEdit && sharesData?.shares?.length) {
        const shareMap = new Map(sharesData.shares.map(s => [s.userId, s]))
        setShares(usrs.map(u => shareMap.has(u.id)
          ? { userId: u.id, amount: shareMap.get(u.id).amount, included: true }
          : { userId: u.id, amount: 0, included: false }
        ))
      } else {
        const initial = usrs.map(u => ({ userId: u.id, amount: 0, included: true }))
        setShares(recalculate(initial, 0, ''))
      }
    }).finally(() => setLoading(false))
  }, [id, groupId, isEdit])

  // Recalculate equal split whenever total amount changes
  useEffect(() => {
    if (shares.length === 0) return
    setShares(prev => recalculate(prev, form.amount, form.paidByUserId))
  }, [form.amount, form.paidByUserId])

  const toggleMember = i => {
    setShares(prev => {
      const updated = prev.map((s, j) => j === i ? { ...s, included: !s.included } : s)
      return recalculate(updated, form.amount, form.paidByUserId)
    })
  }

  const splitEqually = () => {
    setShares(prev => recalculate(prev, form.amount, form.paidByUserId))
  }

  const handleSubmit = async e => {
    e.preventDefault()
    // Creating an expense is two round trips (POST /expenses, then POST /shares
    // per participant). Without this guard a second click before the first
    // finishes creates a whole second expense.
    if (saving) return
    setError('')
    if (!form.amount || form.amount === 0) {
      setError('Amount must be greater than 0.')
      return
    }
    if (!form.categoryId) {
      setError('Please select a category.')
      return
    }

    const sharesSum = shares.filter(s => s.included).reduce((sum, s) => sum + Number(s.amount || 0), 0)
    if (sharesSum !== Number(form.amount)) {
      setError(`Shares add up to ${formatCurrency(sharesSum, form.currencyIso)} but total is ${formatCurrency(form.amount, form.currencyIso)}. Use "Split equally" or adjust the amounts.`)
      return
    }
    const payload = {
      ...form
    }
    setSaving(true)
    try {
      let expenseId = id
      if (isEdit) {
        await client.put(`/expenses/${id}`, payload)
        const { data: old } = await client.get(`/shares/expense/${id}/excludePayer`)
        await Promise.all(
          (old.shares || []).map(s =>
            client.delete(`/shares/expense/${id}/user/${s.userId}`)
          )
        )
      } else {
        const { data } = await client.post('/expenses', payload)
        expenseId = data.id
      }

      await Promise.all(
        shares
          .filter(s => s.included && s.userId !== form.paidByUserId && s.amount !== '' && parseFloat(s.amount) > 0)
          .map(s =>
            client.post('/shares', {
              expenseId,
              userId: s.userId,
              amount: s.amount
            })
          )
      )

      navigate(form.groupId ? `/groups/${form.groupId}` : '/groups')
    } catch (err) {
      console.error('Save expense failed:', err)
      setError(err?.response?.data?.error || 'Failed to save expense.')
    } finally {
      setSaving(false)
    }
  }

  const backPath = groupId ? `/groups/${groupId}` : '/groups'

  if (loading) return <Loading />

  return (
    <>
      <BackLink to={backPath} className="back-link" />

      <div className="page-header">
        <h1>{isEdit ? 'Edit expense' : 'New expense'}</h1>
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Description</label>
            <input
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="What was this for?"
              required
            />
          </div>

          <div className="form-row form-row-compact">
            <div className="form-group">
              <label>Currency</label>
              <select
                value={form.currencyIso}
                onChange={e => {
                  const newIso = e.target.value
                  const newDec = currencies.find(c => c.iso === newIso)?.amountOfDecimals ?? 2
                  setForm(f => ({
                    ...f,
                    currencyIso: newIso,
                    amount: f.amount ? parseFloat(f.amount).toFixed(newDec) : '',
                  }))
                }}
                required
              >
                <option value="">Select…</option>
                {currencies.map(c => (
                  <option key={c.iso} value={c.iso}>{c.symbol} {c.iso}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Amount</label>
              <CurrencyInput
                iso={form.currencyIso}
                value={form.amount}
                onChange={val => setForm(f => ({ ...f, amount: val }))}
                required
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Date</label>
              <input
                type="date"
                value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                required
              />
            </div>
            <div className="form-group">
              <label>Category</label>
              <CategoryPicker
                value={form.categoryId || null}
                onChange={id => setForm(f => ({ ...f, categoryId: id ?? '' }))}
                categories={categories}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Paid by</label>
              <select
                value={form.paidByUserId}
                onChange={e => setForm(f => ({ ...f, paidByUserId: e.target.value }))}
                required
              >
                <option value="">Select…</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.id === currentUser?.id ? 'Me' : u.name}</option>
                ))}
              </select>
            </div>
            {!groupId && (
              <div className="form-group">
                <label>Group</label>
                <select
                  value={form.groupId}
                  onChange={e => setForm(f => ({ ...f, groupId: e.target.value }))}
                  required
                >
                  <option value="">Select…</option>
                  {groups.map(g => (
                    <option key={g.id} value={g.id}>{g.title}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {shares.length > 0 && (
            <div className="form-group" style={{ marginTop: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <label>Split</label>
                <button type="button" className="btn btn-ghost btn-sm" onClick={splitEqually}>Split equally</button>
              </div>
              {shares.map((s, i) => {
                const user = users.find(u => u.id === s.userId)
                return (
                  <div key={s.userId} className="form-row form-row-compact-reverse" style={{ alignItems: 'center', marginBottom: '0.4rem' }}>
                    <label style={{ flex: 2, marginBottom: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={s.included}
                        onChange={() => toggleMember(i)}
                        style={{ margin: 0 }}
                      />
                      <span style={{ color: s.included ? 'inherit' : 'var(--text-3)'}}>
                        {user?.name ?? s.userId}
                      </span>
                    </label>
                    <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                      <CurrencyInput
                          iso={form.currencyIso}
                          value={s.amount}
                          onChange={val => setShares(prev => prev.map((x, j) => j === i ? { ...x, amount: val } : x))}
                          required={s.included}
                      />
                    </div>
                  </div>
                )
              })}
              {(() => {
                const sum = shares.filter(s => s.included).reduce((acc, s) => acc + Number(s.amount || 0), 0)
                const total = Number(form.amount || 0)
                const diff = total - sum
                const ok = diff === 0
                return total > 0 ? (
                  <div style={{ fontSize: 12, marginTop: 8, textAlign: 'right', color: ok ? 'var(--green-dark)' : 'var(--red-dark)', fontWeight: 600 }}>
                    {ok ? '✓ Shares match total' : `${diff > 0 ? '+' : ''}${formatCurrency(diff, form.currencyIso)} unassigned`}
                  </div>
                ) : null
              })()}
            </div>
          )}

          {error && <p className="error">{error}</p>}

          <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
            <Link to={backPath} className="btn btn-ghost">Cancel</Link>
            <button type="submit" className="btn btn-secondary" disabled={saving}>
              {saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Add expense')}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}
