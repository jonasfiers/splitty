import { useState, useEffect } from 'react'
import client from '../api/client'
import IconCard from '../components/IconCard/IconCard.jsx'
import Loading from '../components/Loading.jsx'
import TabHeader from '../components/PageHeader/TabHeader.jsx'

function getCurrencyInfo(iso) {
  try {
    const fmt = new Intl.NumberFormat('en', { style: 'currency', currency: iso })
    const symbol = fmt.formatToParts(0).find(p => p.type === 'currency')?.value ?? iso
    const decimals = fmt.resolvedOptions().maximumFractionDigits
    const name = new Intl.DisplayNames(['en'], { type: 'currency' }).of(iso) ?? iso
    return { symbol, decimals, name }
  } catch {
    return { symbol: iso, decimals: 2, name: iso }
  }
}

export default function CurrenciesPage() {
  const [currencies, setCurrencies] = useState([])
  const [iso, setIso] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = () =>
    client.get('/currencies').then(r => setCurrencies(r.data.currencies || []))

  useEffect(() => {
    load().finally(() => setLoading(false))
  }, [])

  const handleCreate = async e => {
    e.preventDefault()
    setError('')
    try {
      await client.post('/currencies', { iso })
      await load()
      setIso('')
      setShowForm(false)
    } catch {
      setError('Failed to create currency.')
    }
  }

  const handleDelete = async iso => {
    if (!window.confirm(`Delete ${iso}?`)) return
    setError('')
    try {
      await client.delete(`/currencies/${iso}`)
      setCurrencies(cs => cs.filter(c => c.iso !== iso))
    } catch {
      setError('Failed to delete currency.')
    }
  }

  if (loading) return <Loading />

  return (
    <>
      <TabHeader
        title="Currencies"
        aside={
          <button
            className="btn btn-secondary"
            onClick={() => { setShowForm(s => !s); setError('') }}
          >
            {showForm ? 'Cancel' : '+ New currency'}
          </button>
        }
      />

      {showForm && (
        <div className="panel">
          <h3>New currency</h3>
          <form onSubmit={handleCreate}>
            <div className="form-group">
              <label>ISO code</label>
              <input
                value={iso}
                onChange={e => setIso(e.target.value.toUpperCase())}
                placeholder="e.g. JPY"
                maxLength={3}
                required
              />
            </div>
            {error && <p className="error">{error}</p>}
            <div className="panel-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              <button type="submit" className="btn btn-secondary">Create</button>
            </div>
          </form>
        </div>
      )}

      {currencies.length === 0 ? (
        <div className="empty"><p>No currencies yet.</p></div>
      ) : (
        <div className="currency-grid">
          {currencies.map(c => {
            const { symbol, decimals, name } = getCurrencyInfo(c.iso)
            return (
              <IconCard
                key={c.iso}
                icon={symbol}
                iconStyle={{ fontWeight: 700, color: 'var(--accent)' }}
                title={name}
                subtitle={`${c.iso} · ${decimals} decimal${decimals !== 1 ? 's' : ''}`}
                actions={
                  <button className="btn btn-danger btn-sm" onClick={() => handleDelete(c.iso)} title="Delete">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                      <path d="M10 11v6M14 11v6"/>
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                    </svg>
                  </button>
                }
              />
            )
          })}
        </div>
      )}
    </>
  )
}