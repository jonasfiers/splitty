import { useState } from 'react'

export default function CategoryPicker({ value, onChange, categories, nullable = true }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const parentIds = new Set(categories.map(c => c.parentId).filter(Boolean))
  const leafCategories = categories.filter(c => !parentIds.has(c.id))

  const selected = categories.find(c => c.id === value) ?? null
  const filtered = leafCategories.filter(c => (c.full_name ?? '').toLowerCase().includes(search.toLowerCase()))

  const pick = id => {
    onChange(id)
    setOpen(false)
    setSearch('')
  }

  return (
    <div style={{ position: 'relative' }}>
      <button type="button" className="cat-picker-trigger" onClick={() => setOpen(p => !p)}>
        {selected ? (
          <><span className="cat-picker-option-icon">{selected.icon}</span><span style={{ flex: 1, textAlign: 'left' }}>{selected.full_name}</span></>
        ) : (
          <span style={{ flex: 1, textAlign: 'left', color: 'var(--text-3)' }}>None</span>
        )}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>

      {open && (
        <>
          <div className="cat-picker-overlay" onClick={() => { setOpen(false); setSearch('') }} />
          <div className="cat-picker-dropdown">
            <div className="cat-picker-search-wrap">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                className="cat-picker-search"
                placeholder="Search categories…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                autoFocus
              />
            </div>
            <div className="cat-picker-list">
              {nullable && (
                <div
                  className={`cat-picker-option${!value ? ' selected' : ''}`}
                  onClick={() => pick(null)}
                >
                  <span className="cat-picker-option-icon" style={{ color: 'var(--text-3)' }}>—</span>
                  <span>None</span>
                </div>
              )}
              {filtered.map(c => (
                <div
                  key={c.id}
                  className={`cat-picker-option${value === c.id ? ' selected' : ''}`}
                  onClick={() => pick(c.id)}
                >
                  <span className="cat-picker-option-icon">{c.icon}</span>
                  <span>{c.full_name}</span>
                </div>
              ))}
              {filtered.length === 0 && (
                <div className="cat-picker-empty">No matches</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}