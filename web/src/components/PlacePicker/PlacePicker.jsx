import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import client from '../../api/client'
import Sheet from '../Sheet/Sheet.jsx'

// A place slot on a trip item. The value is null, {id} for a place the trip
// already has, or {name, address, lat, lon} for a new one — which is only
// created when the item is saved, so abandoning the form leaves nothing behind.
//
// In the form it is a button showing the place; tapping it opens a tall sheet
// with the search field at the top (never under the keyboard) and the list
// under it: the trip's places, filtered as you type, then "Search the map"
// (or Enter). The map search is never sent while typing: Nominatim's usage
// policy forbids autocomplete (api/geocodeService.js).
//
// id:        for a <Field> label; goes on the button
// title:     the sheet's title (the field's label)
// suggested: the id of a trip place to offer first (where the last journey
//            ended), with `suggestedNote` as its reason
function PlacePicker({ value, onChange, places = [], placeholder = 'Search a place or address…', id, title = 'Place', suggested, suggestedNote }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null) // map results for `searchedFor`
  const [searchedFor, setSearchedFor] = useState('')
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const buttonRef = useRef(null)

  const close = () => {
    setOpen(false)
    setQuery('')
    setResults(null)
    setSearchedFor('')
    setError('')
    buttonRef.current?.focus()
  }

  const choose = place => {
    onChange(place)
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

  const existing = value?.id ? places.find(p => p.id === value.id) : null
  const shown = value ? (existing ?? value) : null

  const q = query.trim()
  const ql = q.toLowerCase()
  const matches = places
    .filter(p => !ql || p.name.toLowerCase().includes(ql) || (p.address || '').toLowerCase().includes(ql))
    .sort((a, b) => (b.id === suggested) - (a.id === suggested))
  const searchedCurrent = results && searchedFor === q

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        id={id}
        tabIndex={0} // in the Tab order like a field (Macs otherwise skip buttons)
        className={`place-trigger${shown ? '' : ' place-trigger-empty'}`}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-labelledby={id ? `${id}-label ${id}` : undefined}
      >
        {shown ? <>
          <span className="place-trigger-pin" aria-hidden="true">{shown.lat != null ? '📍' : '◌'}</span>
          <span className="place-trigger-text">
            <span className="place-trigger-name">{shown.name}</span>
            <span className="place-trigger-address">{shown.address || (shown.lat == null ? 'Not on the map' : '')}</span>
          </span>
        </> : <>
          <svg className="place-trigger-search" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <span className="place-trigger-text"><span className="place-trigger-placeholder">{placeholder}</span></span>
        </>}
      </button>

      {open && createPortal(
        <Sheet title={title} onClose={close} className="place-sheet">
          <div className="place-field">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <input
              type="search"
              value={query}
              onChange={e => { setQuery(e.target.value); setError('') }}
              // Enter searches the map.
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); search() } }}
              placeholder={placeholder}
              aria-label={`${title}: search`}
              enterKeyHint="search"
              autoComplete="off"
              autoFocus
            />
          </div>

          <div className="place-list">
            {matches.length > 0 && <>
              <div className="place-list-label">In this trip</div>
              {matches.map(p => (
                <button type="button" key={p.id} className="place-row" onClick={() => choose({ id: p.id })} aria-current={value?.id === p.id || undefined}>
                  <span className="place-row-icon" aria-hidden="true">{p.lat != null ? '📍' : '◌'}</span>
                  <span className="place-row-text">
                    <span className="place-row-name">{p.name}</span>
                    <span className="place-row-meta">{p.id === suggested && suggestedNote ? suggestedNote : (p.address || 'Not on the map')}</span>
                  </span>
                  {value?.id === p.id && <svg className="picker-check" viewBox="0 0 24 24" aria-hidden="true"><polyline points="5 12 10 17 19 7" /></svg>}
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
        </Sheet>,
        document.body,
      )}
    </>
  )
}

export default PlacePicker
