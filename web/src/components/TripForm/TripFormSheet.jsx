import { useState } from 'react'
import client from '../../api/client'
import EmojiPicker from '../EmojiPicker/EmojiPicker.jsx'
import { today } from '../../utils/trip.js'

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
    <div className="sheet-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet">
        <div className="sheet-handle" />
        <p className="sheet-title">{isEdit ? 'Edit trip' : 'New trip'}</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Name</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <EmojiPicker value={form.icon} onChange={icon => setForm(f => ({ ...f, icon }))} />
              <input
                style={{ flex: 1 }}
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Where are you going?"
                maxLength={120}
                required
              />
            </div>
          </div>

          {!isEdit && !groupId && (
            <div className="form-group">
              <label>Group</label>
              <select value={form.groupId} onChange={e => setForm(f => ({ ...f, groupId: e.target.value }))} required>
                {groups.map(g => <option key={g.id} value={g.id}>{g.icon} {g.title}</option>)}
              </select>
            </div>
          )}

          <div className="form-row">
            <div className="form-group">
              <label>From</label>
              <input
                type="date"
                value={form.startDate}
                onChange={e => setForm(f => ({ ...f, startDate: e.target.value, endDate: f.endDate < e.target.value ? e.target.value : f.endDate }))}
                required
              />
            </div>
            <div className="form-group">
              <label>Until</label>
              <input
                type="date"
                value={form.endDate}
                min={form.startDate}
                onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label>Notes</label>
            <textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} maxLength={4000} />
          </div>

          {error && <p className="error">{error}</p>}

          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={saving}>
            {saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Create trip')}
          </button>
          <button type="button" className="btn btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={onClose}>Cancel</button>
        </form>
      </div>
    </div>
  )
}

export default TripFormSheet
