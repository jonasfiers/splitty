import { useState } from 'react'
import client from '../../api/client'
import Sheet, { SheetActions } from '../Sheet/Sheet.jsx'
import Field from '../Field/Field.jsx'

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
    <Sheet title="Copy trip" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <Field label="Name of the copy">
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} required autoFocus onFocus={e => e.target.select()} />
        </Field>
        <p className="field-note duplicate-note">
          Dates, stays, travel, activities and places are copied. Expenses and attached files stay with the original.
        </p>

        {error && <p className="error">{error}</p>}

        <SheetActions>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Copying…' : 'Copy trip'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </SheetActions>
      </form>
    </Sheet>
  )
}

export default DuplicateTripSheet
