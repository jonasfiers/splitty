import { useState } from 'react'
import client from '../../api/client'

// Copy a trip under a new name: same group, dates, places and items; the
// expenses and files stay with the original.
function DuplicateTripSheet({ trip, onClose, onCopied }) {
  const [title, setTitle] = useState(`${trip.title} (copy)`.slice(0, 120))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async e => {
    e.preventDefault()
    if (saving) return
    setError('')
    setSaving(true)
    try {
      const { data } = await client.post(`/trips/${trip.id}/copy`, { title })
      onCopied(data.id, title)
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to copy the trip.')
      setSaving(false)
    }
  }

  return (
    <div className="sheet-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet">
        <div className="sheet-handle" />
        <p className="sheet-title">Copy trip</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Name of the copy</label>
            <input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} required autoFocus onFocus={e => e.target.select()} />
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px' }}>
            Dates, stays, travel, activities and places are copied. Expenses and attached files stay with the original.
          </p>

          {error && <p className="error">{error}</p>}

          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={saving}>
            {saving ? 'Copying…' : 'Copy trip'}
          </button>
          <button type="button" className="btn btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={onClose}>Cancel</button>
        </form>
      </div>
    </div>
  )
}

export default DuplicateTripSheet
