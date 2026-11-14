import { useState, useEffect } from 'react'
import client from '../../api/client'
import IconPicker from '../IconPicker/IconPicker.jsx'
import Sheet, { SheetActions } from '../Sheet/Sheet.jsx'
import Field from '../Field/Field.jsx'
import Picker from '../Picker/Picker.jsx'

// Name, icon and currency of a group. The currency only while nothing has
// been spent: amounts are stored without one, so changing it later would
// relabel every expense (€40 becoming $40) instead of converting it.
export default function GroupEditSheet({ group, canChangeCurrency, onClose, onSaved }) {
  const [form, setForm] = useState({ title: group.title, icon: group.icon, currencyIso: group.iso })
  const [currencies, setCurrencies] = useState([{ iso: group.iso }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!canChangeCurrency) return
    client.get('/currencies').then(({ data }) => { if (data.currencies?.length) setCurrencies(data.currencies) }).catch(() => {})
  }, [canChangeCurrency])

  const save = async e => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await client.put(`/groups/${group.id}`, { ...form, title: form.title.trim() })
      onSaved()
    } catch {
      setError('Could not save the group.')
      setSaving(false)
    }
  }

  return (
    <Sheet title="Edit group" onClose={onClose}>
      <form onSubmit={save}>
        {error && <p className="error">{error}</p>}
        <div className="form-row form-row-compact">
          <Field label="Icon">
            <IconPicker value={form.icon} onChange={icon => setForm(f => ({ ...f, icon }))} />
          </Field>
          <div className="form-group">
            <label htmlFor="group-edit-title">Group name</label>
            <input
              id="group-edit-title"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              required
            />
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="group-edit-currency">Currency</label>
          <Picker
            id="group-edit-currency"
            title="Currency"
            value={form.currencyIso}
            onChange={v => setForm(f => ({ ...f, currencyIso: v }))}
            options={currencies.map(c => ({ value: c.iso, label: c.iso, icon: c.symbol }))}
            disabled={!canChangeCurrency}
          />
          {!canChangeCurrency && (
            <p className="field-note">Fixed once the group has expenses.</p>
          )}
        </div>
        <SheetActions>
          <button type="submit" className="btn btn-primary" disabled={saving || !form.title.trim()}>{saving ? 'Saving…' : 'Save'}</button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </SheetActions>
      </form>
    </Sheet>
  )
}
