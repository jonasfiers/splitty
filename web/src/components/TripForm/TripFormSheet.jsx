import { useState } from 'react'
import client from '../../api/client'
import EmojiPicker from '../EmojiPicker/EmojiPicker.jsx'
import { today } from '../../utils/trip.js'
import Sheet, { SheetActions } from '../Sheet/Sheet.jsx'
import Field from '../Field/Field.jsx'
import Picker from '../Picker/Picker.jsx'

// Create or edit a trip. `groups` is only needed when the group is not fixed.
function TripFormSheet({ trip, groupId, groups = [], onClose, onSaved }) {
  const isEdit = Boolean(trip)
  const [form, setForm] = useState({
    groupId: trip?.groupId ?? groupId ?? groups[0]?.id ?? '',
    title: trip?.title ?? '',
    icon: trip?.icon ?? '',
    startDate: trip?.startDate ?? today(),
    endDate: trip?.endDate ?? today(),
    notes: trip?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async e => {
    e.preventDefault()
    if (saving) return
    setError('')
    setSaving(true)
    try {
      if (isEdit) {
        await client.put(`/trips/${trip.id}`, form)
        onSaved(trip.id)
      } else {
        const { data } = await client.post('/trips', form)
        onSaved(data.id)
      }
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to save the trip.')
      setSaving(false)
    }
  }

  return (
    <Sheet title={isEdit ? 'Edit trip' : 'New trip'} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <Field label="Name" id="trip-form-title">
          <div style={{ display: 'flex', gap: 8 }}>
            <EmojiPicker value={form.icon} onChange={icon => setForm(f => ({ ...f, icon }))} />
            <input
              id="trip-form-title"
              style={{ flex: 1 }}
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Where are you going?"
              maxLength={120}
              required
            />
          </div>
        </Field>

        {!isEdit && !groupId && (
          <Field label="Group">
            <Picker title="Group" value={form.groupId} onChange={v => setForm(f => ({ ...f, groupId: v }))} options={groups.map(g => ({ value: g.id, label: g.title, icon: g.icon }))} required />
          </Field>
        )}

        <div className="form-row">
          <Field label="From">
            <input
              type="date"
              value={form.startDate}
              onChange={e => setForm(f => ({ ...f, startDate: e.target.value, endDate: f.endDate < e.target.value ? e.target.value : f.endDate }))}
              required
            />
          </Field>
          <Field label="Until">
            <input
              type="date"
              value={form.endDate}
              min={form.startDate}
              onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
              required
            />
          </Field>
        </div>

        <Field label="Notes">
          <textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} maxLength={4000} />
        </Field>

        {error && <p className="error">{error}</p>}

        <SheetActions>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Create trip')}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </SheetActions>
      </form>
    </Sheet>
  )
}

export default TripFormSheet
