import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import client from '../../api/client'
import Sheet from '../Sheet/Sheet.jsx'
import Icon from '../Icon/Icon.jsx'
import SearchField from '../SearchField/SearchField.jsx'

// A place slot on a trip item. The value is null, {id} for a place the trip
// already has, or {name, address, lat, lon} for a new one — which is only
// created when the item is saved, so abandoning the form leaves nothing behind.
//
// In the form it is a button showing the place; tapping it opens a tall sheet
// with the search field at the top (never under the keyboard) and the list
// under it: the trip's places, filtered as you type, then places on the map,
// searched as you type (Photon, after a short pause; api/geocodeService.js),
// near the trip's places first. When that search is down, Enter searches
// Nominatim instead, which must never be searched while typing.
//
// id:        for a <Field> label; goes on the button
// title:     the sheet's title (the field's label)
// suggested: the id of a trip place to offer first (where the last journey
//            ended), with `suggestedNote` as its reason
// near:      {lat, lon} to rank map results around; by default the middle of
//            the trip's places
// transit:   stations and stops first (the route finder)
// The address without the place's own name in front of it: map search
// answers often start with it ("Brussels-Midi, Galerie M, …"), and the name is
// already the line above.
const addressOnly = (name, address) => {
  if (!address) return ''
  const rest = name && address.toLowerCase().startsWith(name.toLowerCase())
    ? address.slice(name.length).replace(/^[\s,–-]+/, '') : address
  return rest || address
}

// The icon for a kind of place found on the map (`type` from the API).
const TYPE_ICONS = {
  station: 'train-front', tram: 'tram-front', bus: 'bus', airport: 'plane', ferry: 'ship',
  stay: 'hotel', camp: 'tent', food: 'utensils', cafe: 'coffee', water: 'waves-horizontal',
  beach: 'umbrella', mountain: 'mountain', town: 'building', area: 'map', address: 'house', street: 'route',
}
const TYPING_PAUSE_MS = 300

// The middle of the places that are on the map, or null.
function middleOf(places) {
  const located = places.filter(p => p.lat != null && p.lon != null)
  if (!located.length) return null
  const sum = located.reduce((a, p) => ({ lat: a.lat + p.lat, lon: a.lon + p.lon }), { lat: 0, lon: 0 })
  return { lat: sum.lat / located.length, lon: sum.lon / located.length }
}

function PlacePicker({ value, onChange, places = [], placeholder = 'Search a place or address…', id, title = 'Place', suggested, suggestedNote, near, transit = false }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null) // map results for `searchedFor`
  const [searchedFor, setSearchedFor] = useState('')
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [typingFailed, setTypingFailed] = useState(false) // then Enter searches the fallback
  const buttonRef = useRef(null)
  const latest = useRef('') // the query the newest search was sent for
  const middle = useMemo(() => near ?? middleOf(places), [near, places])

  const close = () => {
    setOpen(false)
    setQuery('')
    setResults(null)
    setSearchedFor('')
    setError('')
    setTypingFailed(false)
    latest.current = ''
    buttonRef.current?.focus()
  }

  const choose = place => {
    onChange(place)
    close()
  }

  // An answer that arrives after a newer search was sent is dropped.
  const search = async (q, typing) => {
    if (q.length < 3) return
    latest.current = q
    setSearching(true)
    setError('')
    try {
      const params = { q, ...(typing && { typing: 1 }), ...(transit && { transit: 1 }), ...(middle && { near: `${middle.lat.toFixed(3)},${middle.lon.toFixed(3)}` }) }
      const { data } = await client.get('/trips/geocode', { params })
      if (latest.current !== q) return
      setResults(data.results || [])
      setSearchedFor(q)
      setTypingFailed(false)
    } catch (err) {
      if (latest.current !== q) return
      if (typing) setTypingFailed(true)
      else setError(err?.response?.data?.error || 'Place search is not available right now.')
    } finally {
      if (latest.current === q) setSearching(false)
    }
  }

  // Searched once typing pauses.
  const typed = query.trim()
  useEffect(() => {
    if (!open || typed.length < 3 || typed === latest.current) return
    const timer = setTimeout(() => search(typed, true), TYPING_PAUSE_MS)
    return () => clearTimeout(timer)
  }, [typed, open]) // eslint-disable-line react-hooks/exhaustive-deps

  const existing = value?.id ? places.find(p => p.id === value.id) : null
  const shown = value ? (existing ?? value) : null

  const q = query.trim()
  const ql = q.toLowerCase()
  const matches = places
    .filter(p => !ql || p.name.toLowerCase().includes(ql) || (p.address || '').toLowerCase().includes(ql))
    .sort((a, b) => (b.id === suggested) - (a.id === suggested))
  // The last answer stays up while the next one loads, unless it no longer fits what is typed.
  const shownResults = results && q.length >= 3 && q.toLowerCase().startsWith(searchedFor.toLowerCase().slice(0, 3)) ? results : null

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
          <span className="place-trigger-pin" aria-hidden="true">{shown.lat != null ? <Icon name="map-pin" /> : '◌'}</span>
          <span className="place-trigger-text">
            <span className="place-trigger-name">{shown.name}</span>
            <span className="place-trigger-address">{addressOnly(shown.name, shown.address) || (shown.lat == null ? 'Not on the map' : '')}</span>
          </span>
        </> : <>
          <svg className="place-trigger-search" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <span className="place-trigger-text"><span className="place-trigger-placeholder">{placeholder}</span></span>
        </>}
      </button>

      {open && createPortal(
        <Sheet title={title} onClose={close} className="place-sheet" search>
          <SearchField
            value={query}
            onChange={e => { setQuery(e.target.value); setError('') }}
            // Enter searches the map.
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (q !== searchedFor) search(q, !typingFailed) } }}
            placeholder={placeholder}
            aria-label={`${title}: search`}
            enterKeyHint="search"
            autoComplete="off"
            autoFocus
          />

          <div className="place-list sheet-scroll">
            {matches.length > 0 && <>
              <div className="place-list-label">In this trip</div>
              {matches.map(p => (
                <button type="button" key={p.id} className="place-row" onClick={() => choose({ id: p.id })} aria-current={value?.id === p.id || undefined}>
                  <span className="place-row-icon" aria-hidden="true">{p.lat != null ? <Icon name="map-pin" /> : '◌'}</span>
                  <span className="place-row-text">
                    <span className="place-row-name">{p.name}</span>
                    <span className="place-row-meta">{p.id === suggested && suggestedNote ? suggestedNote : (addressOnly(p.name, p.address) || 'Not on the map')}</span>
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
              {q.length < 3 ? (
                <p className="place-list-hint">Type at least 3 letters to search the map.</p>
              ) : <>
                <div className="place-list-label">
                  On the map{searching && <span className="place-list-busy" role="status"> · Searching…</span>}
                </div>
                {shownResults?.map((r, i) => (
                  <button type="button" key={`${r.lat},${r.lon},${i}`} className="place-row" onClick={() => choose({ name: r.name, address: r.address, lat: r.lat, lon: r.lon })}>
                    <span className="place-row-icon" aria-hidden="true"><Icon name={TYPE_ICONS[r.type] ?? 'map-pin'} /></span>
                    <span className="place-row-text">
                      <span className="place-row-name">{r.name}</span>
                      <span className="place-row-meta">{[r.label, r.area || addressOnly(r.name, r.address)].filter(Boolean).join(' · ')}</span>
                    </span>
                  </button>
                ))}
                {shownResults?.length === 0 && searchedFor === q && !searching && <p className="place-list-hint">Nothing on the map for “{searchedFor}”.</p>}
                {typingFailed && !searching && <p className="place-list-hint">Searching while typing is not available right now. Press Enter to search.</p>}
              </>}
              {error && <p className="place-list-hint error-text">{error}</p>}
              <button type="button" className="place-row" onClick={() => choose({ name: q, address: '', lat: null, lon: null })}>
                <span className="place-row-icon" aria-hidden="true"><Icon name="pencil" /></span>
                <span className="place-row-text">
                  <span className="place-row-name">Use “{q}” as typed</span>
                  <span className="place-row-meta">Without a position on the map</span>
                </span>
              </button>
            </>}

            {value && (
              <button type="button" className="place-row place-row-muted" onClick={() => choose(null)}>
                <span className="place-row-icon" aria-hidden="true"><Icon name="x" /></span>
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
