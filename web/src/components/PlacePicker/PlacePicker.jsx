import { useState, useRef, useEffect, useId } from 'react'
import client from '../../api/client'

// A place slot on a trip item. The value is null, {id} for a place the trip
// already has, or {name, address, lat, lon} for a new one — which is only
// created when the item is saved, so abandoning the form leaves nothing behind.
//
// One field for everything: focusing it lists the trip's places, typing
// filters them, and "Search the map" (or Enter) looks the text up. The map
// search is never sent while typing: Nominatim's usage policy forbids
// autocomplete (api/geocodeService.js).
//
// id:        for a <Field> label; it goes on the text field, or on the chosen
//            place's button
// suggested: the id of a trip place to offer first (where the last journey
//            ended), with `suggestedNote` as its reason
function PlacePicker({ value, onChange, places = [], placeholder = 'Search a place or address…', id, suggested, suggestedNote }) {
  const [editing, setEditing] = useState(false)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null) // map results for `searchedFor`
  const [searchedFor, setSearchedFor] = useState('')
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const rootRef = useRef(null)
  const inputRef = useRef(null)
  const listId = useId()

  const close = () => {
    setOpen(false)
    setEditing(false)
  }

  // Tapping outside closes the list (and, with a place still chosen, goes
  // back to showing it). Not on blur: tapping a row blurs the field first.
  useEffect(() => {
    if (!open) return
    const onDown = e => {
      if (rootRef.current?.contains(e.target)) return
      setOpen(false)
      setEditing(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const choose = place => {
    onChange(place)
    setQuery('')
    setResults(null)
    setSearchedFor('')
    setError('')
    close()
  }

  const search = async () => {
    const q = query.trim()
    if (q.length < 3 || searching) return
    setSearching(true)
    setError('')
    try {
      const { data } = await client.get('/trips/geocode', { params: { q } })
      setResults(data.results || [])
      setSearchedFor(q)
    } catch (err) {
      setResults(null)
      setError(err?.response?.data?.error || 'Place search is not available right now.')
    } finally {
      setSearching(false)
    }
  }

  const startEditing = () => {
    setEditing(true)
    setOpen(true)
    // Once the field has rendered.
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const existing = value?.id ? places.find(p => p.id === value.id) : null

  if (value && !editing) {
    const shown = existing ?? value
    return (
      <button type="button" id={id} className="place-chosen" onClick={startEditing}
        aria-labelledby={id ? `${id}-label ${id}` : undefined}>
        <span className="place-chosen-pin" aria-hidden="true">{shown.lat != null ? '📍' : '◌'}</span>
        <span className="place-chosen-text">
          <span className="place-chosen-name">{shown.name}</span>
          {shown.address && <span className="place-chosen-address">{shown.address}</span>}
          {shown.lat == null && <span className="place-chosen-address">Not on the map</span>}
        </span>
        <span className="place-chosen-change">Change</span>
      </button>
    )
  }

  const q = query.trim()
  const ql = q.toLowerCase()
  const matches = places
    .filter(p => !ql || p.name.toLowerCase().includes(ql) || (p.address || '').toLowerCase().includes(ql))
    .sort((a, b) => (b.id === suggested) - (a.id === suggested))
  const searchedCurrent = results && searchedFor === q

  return (
    <div className="place-picker" ref={rootRef}>
      <div className="place-field">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); setError('') }}
          onFocus={() => setOpen(true)}
          // Enter searches the map; it must not submit the surrounding form.
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); search() }
            if (e.key === 'Escape' && open) { e.preventDefault(); close() }
          }}
          placeholder={placeholder}
          enterKeyHint="search"
          autoComplete="off"
        />
      </div>

      {open && (
        <div className="place-list" id={listId}>
          {matches.length > 0 && <>
            <div className="place-list-label">In this trip</div>
            {matches.map(p => (
              <button type="button" key={p.id} className="place-row" onClick={() => choose({ id: p.id })}>
                <span className="place-row-icon" aria-hidden="true">{p.lat != null ? '📍' : '◌'}</span>
                <span className="place-row-text">
                  <span className="place-row-name">{p.name}</span>
                  <span className="place-row-meta">{p.id === suggested && suggestedNote ? suggestedNote : (p.address || 'Not on the map')}</span>
                </span>
              </button>
            ))}
          </>}

          {!q && matches.length === 0 && (
            <p className="place-list-hint">Type a place, station or address.</p>
          )}

          {q && <>
            {matches.length > 0 && <div className="place-list-sep" />}
            {searchedCurrent ? (
              <>
                <div className="place-list-label">On the map</div>
                {results.map((r, i) => (
                  <button type="button" key={i} className="place-row" onClick={() => choose(r)}>
                    <span className="place-row-icon" aria-hidden="true">📍</span>
                    <span className="place-row-text">
                      <span className="place-row-name">{r.name}</span>
                      <span className="place-row-meta">{r.address}</span>
                    </span>
                  </button>
                ))}
                {results.length === 0 && <p className="place-list-hint">Nothing on the map for “{searchedFor}”.</p>}
              </>
            ) : (
              <button type="button" className="place-row place-row-action" onClick={search} disabled={searching || q.length < 3}>
                <span className="place-row-icon" aria-hidden="true">🔍</span>
                <span className="place-row-text">
                  <span className="place-row-name">{searching ? 'Searching the map…' : `Search the map for “${q}”`}</span>
                  {q.length < 3 && <span className="place-row-meta">Type at least 3 letters</span>}
                </span>
              </button>
            )}
            {error && <p className="place-list-hint" style={{ color: 'var(--red-dark)' }}>{error}</p>}
            <button type="button" className="place-row" onClick={() => choose({ name: q, address: '', lat: null, lon: null })}>
              <span className="place-row-icon" aria-hidden="true">✎</span>
              <span className="place-row-text">
                <span className="place-row-name">Use “{q}” as typed</span>
                <span className="place-row-meta">Without a position on the map</span>
              </span>
            </button>
          </>}

          {value && (
            <button type="button" className="place-row place-row-muted" onClick={() => choose(null)}>
              <span className="place-row-icon" aria-hidden="true">✕</span>
              <span className="place-row-text"><span className="place-row-name">No place</span></span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default PlacePicker
