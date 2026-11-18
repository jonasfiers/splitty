import { useState, useEffect, useCallback } from 'react'
import client from '../api/client'
import Loading from '../components/Loading.jsx'
import LoadFailed from '../components/LoadFailed.jsx'
import PageHeader from '../components/PageHeader/PageHeader.jsx'
import Field from '../components/Field/Field.jsx'
import CategoryPicker from '../components/CategoryPicker/CategoryPicker.jsx'
import Icon from '../components/Icon/Icon.jsx'
import { KINDS, TRANSPORT_MODES } from '../utils/trip.js'
import { setTripKinds } from '../utils/tripKinds.js'

// Which expense category each trip entry kind (and transport mode) belongs
// to: an expense made from a trip entry starts in it, and the kind takes its
// colour on the trip screens. Saved per row as it is picked
// (PUT /categories/trip-kinds/:key, admin-only).
const ROWS = [
  { key: 'stay', label: KINDS.stay.label, icon: KINDS.stay.icon },
  { key: 'activity', label: KINDS.activity.label, icon: KINDS.activity.icon },
  { key: 'transport', label: KINDS.transport.label, icon: KINDS.transport.icon },
]
const MODE_ROWS = TRANSPORT_MODES.map(m => ({ key: `transport:${m.value}`, label: m.label, icon: m.icon }))

export default function TripCategoriesPage() {
  const [categories, setCategories] = useState([])
  const [links, setLinks] = useState({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState('')
  const [error, setError] = useState('')

  const take = list => {
    setLinks(Object.fromEntries((list || []).map(k => [k.key, k.categoryId])))
    setTripKinds(list) // the colours change here at once too
  }

  useEffect(() => {
    Promise.all([client.get('/categories'), client.get('/categories/trip-kinds')])
      .then(([c, k]) => { setCategories(c.data.categories || []); take(k.data.kinds) })
      .catch(err => setLoadError(err))
      .finally(() => setLoading(false))
  }, [attempt])
  const retry = useCallback(() => { setLoadError(null); setLoading(true); setAttempt(n => n + 1) }, [])

  const save = async (key, categoryId) => {
    setError('')
    setSaving(key)
    try {
      const { data } = await client.put(`/categories/trip-kinds/${encodeURIComponent(key)}`, { categoryId: categoryId || null })
      take(data.kinds)
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to save.')
    } finally {
      setSaving('')
    }
  }

  const header = <PageHeader crumbs={[{ to: '/admin', label: 'Admin' }]} title="Trip categories" name="Trip categories" />
  if (loading) return <>{header}<Loading /></>
  if (loadError) return <>{header}<LoadFailed error={loadError} what="the trip categories" onRetry={retry} /></>

  const row = (r, placeholder) => (
    <Field key={r.key} id={`tk-${r.key}`} label={<><Icon name={r.icon} /> {r.label}</>} aside={saving === r.key ? 'Saving…' : null}>
      <CategoryPicker
        id={`tk-${r.key}`}
        value={links[r.key] || null}
        onChange={id => save(r.key, id)}
        categories={categories}
        placeholder={placeholder}
      />
    </Field>
  )

  return (
    <>
      {header}
      <p className="admin-intro">
        An expense made from a trip entry starts in its category, and the entry takes that category's colour on the trip screens.
      </p>
      {error && <p className="error">{error}</p>}
      <div className="panel">
        <h3>Entries</h3>
        {ROWS.map(r => row(r, 'None'))}
      </div>
      <div className="panel">
        <h3>Transport modes</h3>
        <p className="field-note">Only needed where a mode has its own category; otherwise Transport's is used.</p>
        {MODE_ROWS.map(r => row(r, 'Same as Transport'))}
      </div>
    </>
  )
}
