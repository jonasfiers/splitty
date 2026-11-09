import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router'
import client from '../api/client'
import CurrencyInput from '../components/CurrencyInput/CurrencyInput.jsx'
import { formatCurrency } from '../utils/currency.js'
import Loading from '../components/Loading.jsx'
import PageHeader from '../components/PageHeader/PageHeader.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { leaveTo } from '../utils/history.js'
import BackLink from '../components/BackLink.jsx'
import CategoryPicker from '../components/CategoryPicker/CategoryPicker.jsx'
import { useMediaQuery } from '../utils/useMediaQuery.js'
import Field from '../components/Field/Field.jsx'
import { FormColumns, FormColumn } from '../components/Field/FormColumns.jsx'
import Picker from '../components/Picker/Picker.jsx'
import { Avatar } from '../components/Avatar.jsx'
import DatePicker from '../components/DatePicker/DatePicker.jsx'
import { getOnce } from '../utils/cache.js'

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

// True while nobody has typed their own amounts: every included share is
// empty, or they differ by at most the rounding unit (as recalculate leaves them).
function isEqualSplit(shares) {
  const amounts = shares.filter(s => s.included).map(s => Number(s.amount) || 0)
  if (amounts.length === 0 || amounts.every(a => a === 0)) return true
  return Math.max(...amounts) - Math.min(...amounts) <= 1
}

export default function ExpenseFormPage() {
  const { id, groupId } = useParams()
  const { currentUser } = useAuth()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  // Set when the form is opened from a trip item: the expense starts from the
  // item's details and is linked back to it once saved.
  const { tripItem, prefill } = useLocation().state ?? {}

  const [form, setForm] = useState({
    groupId: groupId || '',
    description: (!isEdit && prefill?.description) || '',
    categoryId: '',
    amount: (!isEdit && prefill?.amount) || '',
    currencyIso: '',
    date: new Date().toISOString().slice(0, 10),
    paidByUserId: '',
  })
  const [shares, setShares] = useState([])
  const [categories, setCategories] = useState([])
  const [currencies, setCurrencies] = useState([])
  const [groups, setGroups] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const wide = useMediaQuery('(min-width: 768px)') // the header's own breakpoint
  const mouse = useMediaQuery('(hover: hover) and (pointer: fine)') // a real keyboard, most likely
  const [error, setError] = useState('')
  // The amount an edited expense was loaded with: filling it in is not a
  // change by the user and must not re-split the loaded shares.
  const loaded = useRef(null)

  useEffect(() => {
    const fetches = [
      // The lists around the form from the cache when kept (utils/cache.js);
      // the expense being edited always fresh.
      getOnce(`/categories?groupId=${groupId}`),
      getOnce('/currencies'),
      getOnce('/groups'),
      ...(groupId ? [getOnce(`/groups/${groupId}/members`)] : []),
      ...(isEdit ? [client.get(`/expenses/${id}`)] : []),
      ...(isEdit ? [client.get(`/shares/expense/${id}`)] : []),
    ]

    Promise.all(fetches).then(results => {
      let idx = 0
      const cats = results[idx++].data.categories || []
      const curs = results[idx++].data.currencies || []
      const grps = results[idx++].data.groups || []
      const usrs = groupId ? (results[idx++].data.members || []) : []
      const groupIso = grps.find(g => g.id === groupId)?.iso
      const expData = isEdit ? results[idx++]?.data : null
      const sharesData = isEdit ? results[idx]?.data : null

      setCategories(cats)
      setCurrencies(curs)
      setGroups(grps)
      setUsers(usrs)

      if (isEdit && expData?.expense) {
        const e = expData.expense
        loaded.current = { amount: e.amount }
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
          currencyIso: prefill?.currencyIso || groupIso || curs[0]?.iso || '',
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
        // Split a prefilled amount here: the effect below only re-splits when
        // the amount or the payer changes, and neither does after this.
        setShares(recalculate(initial, Number(prefill?.amount) || 0, currentUser?.id || ''))
      }
    }).finally(() => setLoading(false))
  }, [id, groupId, isEdit])

  // Split equally again when the user changes the total, but not when an
  // edited expense has just been loaded with its own shares. Changing who
  // paid leaves the shares alone: what each person owes does not depend on
  // who paid (the payer only gets the rounding cent of an equal split).
  //
  // A custom split is never replaced: its shares stay as they are, the
  // "shares don't match the total" check shows, and the user adjusts them or
  // presses "Split equally". Only a split that is still equal follows the
  // new total.
  useEffect(() => {
    if (shares.length === 0) return
    const l = loaded.current
    if (l && String(form.amount) === String(l.amount)) return
    loaded.current = null
    setShares(prev => (isEqualSplit(prev) ? recalculate(prev, form.amount, form.paidByUserId) : prev))
  }, [form.amount])

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
      const otherShares = shares
        .filter(s => s.included && s.userId !== form.paidByUserId && s.amount !== '' && parseFloat(s.amount) > 0)
        .map(s => ({ userId: s.userId, amount: s.amount }))
      if (isEdit) {
        // One request each way: the expense and its shares are saved
        // together, and on an edit the server records what changed.
        await client.put(`/expenses/${id}`, { ...payload, shares: otherShares })
      } else {
        const { data } = await client.post('/expenses', { ...payload, shares: otherShares })
        expenseId = data.id
      }

      if (tripItem && !isEdit) {
        await client.post(`/trips/items/${tripItem.id}/expenses`, { expenseId })
        leaveTo(navigate, `/trips/${tripItem.tripId}/items/${tripItem.id}`)
        return
      }

      // Saved: out of the form, back where it was opened from (the expense
      // for an edit, the group for a new one), so Back does not reopen it.
      leaveTo(navigate, isEdit ? `/groups/${form.groupId || groupId}/expenses/${id}` : form.groupId ? `/groups/${form.groupId}` : '/groups')
    } catch (err) {
      console.error('Save expense failed:', err)
      setError(err?.response?.data?.error || 'Failed to save expense.')
    } finally {
      setSaving(false)
    }
  }

  const backPath = tripItem && !isEdit
    ? `/trips/${tripItem.tripId}/items/${tripItem.id}`
    : isEdit && groupId ? `/groups/${groupId}/expenses/${id}`
    : groupId ? `/groups/${groupId}` : '/groups'

  if (loading) return <><PageHeader compact back={{ to: backPath }} name={isEdit ? 'Edit expense' : 'New expense'} /><Loading /></>

  return (
    <>
      <PageHeader
        back={{ to: backPath }}
        title={isEdit ? 'Edit expense' : 'New expense'}
        name={isEdit ? 'Edit expense' : 'New expense'}
        // On phones Save sits in the bar, always in reach above the keyboard;
        // wider screens keep the buttons under the form.
        actions={wide ? [] : [{ label: saving ? 'Saving…' : (isEdit ? 'Save' : 'Add'), form: 'expense-form', disabled: saving, primary: true }]}
      />

      {tripItem && !isEdit && (
        <p style={{ fontSize: 13, color: 'var(--text-3)', margin: '-8px 0 12px' }}>For “{tripItem.title}”</p>
      )}

      <div className="card form-card-wide">
        <form id="expense-form" onSubmit={handleSubmit}>
          {error && <p className="error">{error}</p>}
          {/* The expense | how it is split: side by side when the form is wide enough. */}
          <FormColumns>
            <FormColumn>
              <div className="form-row form-row-compact expense-amount">
                <Field label="Currency">
                  <Picker
                    title="Currency"
                    value={form.currencyIso}
                    onChange={newIso => {
                      const newDec = currencies.find(c => c.iso === newIso)?.amountOfDecimals ?? 2
                      setForm(f => ({
                        ...f,
                        currencyIso: newIso,
                        amount: f.amount ? parseFloat(f.amount).toFixed(newDec) : '',
                      }))
                    }}
                    options={currencies.map(c => ({ value: c.iso, label: c.iso, icon: c.symbol }))}
                    required
                  />
                </Field>
                <Field label="Amount">
                  <CurrencyInput
                    iso={form.currencyIso}
                    value={form.amount}
                    onChange={val => setForm(f => ({ ...f, amount: val }))}
                    autoFocus={!isEdit}
                    required
                  />
                </Field>
              </div>

              <Field label="Description">
                <input
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="What was this for?"
                  // "Done", not "Next": a phone's Next only goes to the next typing
                  // field, so it skipped the pickers below (category, date) and
                  // jumped to the shares. Done closes the keyboard instead.
                  enterKeyHint="done"
                  // On a touch screen Done only closes the keyboard: it must not
                  // submit the expense before the category and the rest are set.
                  // With a mouse and keyboard Enter saves, as forms do there.
                  onKeyDown={e => { if (e.key === 'Enter' && !mouse) { e.preventDefault(); e.currentTarget.blur() } }}
                  required
                />
              </Field>

              <Field label="Category">
                <CategoryPicker
                  value={form.categoryId || null}
                  onChange={id => setForm(f => ({ ...f, categoryId: id ?? '' }))}
                  categories={categories}
                />
              </Field>
              <div className="form-row">
                <Field label="Date">
                  <DatePicker
                    value={form.date}
                    onChange={d => setForm(f => ({ ...f, date: d }))}
                    shortcuts={['today', 'yesterday']}
                    required
                  />
                </Field>
                <Field label="Paid by">
                  <Picker
                    title="Paid by"
                    value={form.paidByUserId}
                    onChange={v => setForm(f => ({ ...f, paidByUserId: v }))}
                    options={users.map(u => ({ value: u.id, label: u.id === currentUser?.id ? 'Me' : u.name, icon: <Avatar name={u.name} size={28} colorIndex={u.avatarColor} emoji={u.avatarEmoji} /> }))}
                    required
                  />
                </Field>
                {(!groupId || isEdit) && (
                  <Field label="Group">
                    <Picker
                      title="Group"
                      value={form.groupId}
                      onChange={v => setForm(f => ({ ...f, groupId: v }))}
                      options={groups.map(g => ({ value: g.id, label: g.title, icon: g.icon }))}
                      required
                    />
                  </Field>
                )}
              </div>
            </FormColumn>

            {shares.length > 0 && (
              <FormColumn>
              <Field label="Split" group className="expense-form-split" aside={<button type="button" className="btn btn-ghost btn-sm" onClick={splitEqually}>Split equally</button>}>
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
                            aria-label={`${user?.name ?? 'Their'} share`}
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
                    <div style={{ fontSize: 12, marginTop: 8, textAlign: 'right', color: ok ? 'var(--text-3)' : 'var(--red-dark)', fontWeight: ok ? 500 : 600 }}>
                      {ok ? '✓ Shares match total' : `${diff > 0 ? '+' : ''}${formatCurrency(diff, form.currencyIso)} unassigned`}
                    </div>
                  ) : null
                })()}
              </Field>
              </FormColumn>
            )}
          </FormColumns>

          {wide && <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
            <BackLink to={backPath} replace className="btn btn-ghost">Cancel</BackLink>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Add expense')}
            </button>
          </div>}
        </form>
      </div>
    </>
  )
}
