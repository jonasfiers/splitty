import { useState } from 'react'
import client from '../../api/client'

// A place slot on a trip item. The value is null, {id} for a place the trip
// already has, or {name, address, lat, lon} for a new one — which is only
// created when the item is saved, so abandoning the form leaves nothing behind.
function PlacePicker({ value, onChange, places = [], placeholder = 'Search a place or address…' }) {
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')

  const existing = value?.id ? places.find(p => p.id === value.id) : null

  const search = async () => {
    const q = query.trim()
    if (q.length < 3 || searching) return
    setSearching(true)
    setError('')
    try {
      const { data } = await client.get('/trips/geocode', { params: { q } })
      setResults(data.results || [])
    } catch (err) {
      setResults(null)
      setError(err?.response?.data?.error || 'Place search is not available right now.')
    } finally {
      setSearching(false)
    }
  }

  const choose = place => {
    onChange(place)
    setAdding(false)
    setQuery('')
    setResults(null)
    setError('')
  }

  if (value && !adding) {
    const shown = existing ?? value
    return (
      <div className="place-chosen">
        <span className="place-chosen-pin">{shown.lat != null ? '📍' : '◌'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="place-chosen-name">{shown.name}</div>
          {shown.address && <div className="place-chosen-address">{shown.address}</div>}
          {shown.lat == null && <div className="place-chosen-address">Not on the map</div>}
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(null)}>Change</button>
      </div>
    )
  }

  return (
    <div className="place-picker">
      {places.length > 0 && !adding && (
        <select value="" onChange={e => {
          if (e.target.value === '__new') setAdding(true)
          else if (e.target.value) choose({ id: e.target.value })
        }}>
          <option value="">No place</option>
          {places.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value="__new">＋ New place…</option>
        </select>
      )}

      {(adding || places.length === 0) && (
        <>
          <div className="place-search">
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              // Enter searches; it must not submit the surrounding item form.
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); search() } }}
              placeholder={placeholder}
              enterKeyHint="search"
            />
            <button type="button" className="btn btn-ghost btn-sm" onClick={search} disabled={searching || query.trim().length < 3}>
              {searching ? '…' : 'Search'}
            </button>
          </div>

          {error && <p className="place-hint" style={{ color: 'var(--red-dark)' }}>{error}</p>}

          {results && (
            <div className="place-results">
              {results.map((r, i) => (
                <button type="button" key={i} className="place-result" onClick={() => choose(r)}>
                  <span className="place-result-name">{r.name}</span>
                  <span className="place-result-address">{r.address}</span>
                </button>
              ))}
              {results.length === 0 && <p className="place-hint">Nothing found for “{query.trim()}”.</p>}
            </div>
          )}

          {query.trim() && (
            <button type="button" className="place-result" onClick={() => choose({ name: query.trim(), address: '', lat: null, lon: null })}>
              <span className="place-result-name">Use “{query.trim()}” as typed</span>
              <span className="place-result-address">Without a position on the map</span>
            </button>
          )}

          {places.length > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => { setAdding(false); setResults(null); setQuery('') }}>
              Pick an existing place
            </button>
          )}
        </>
      )}
    </div>
  )
}

export default PlacePicker
