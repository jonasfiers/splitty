import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router'
import client from '../api/client'
import Loading from '../components/Loading.jsx'
import BackLink from '../components/BackLink.jsx'
import { formatCurrency, formatDate } from '../utils/currency.js'
import { KINDS, TRANSPORT_MODES, itemIcon, dayOf, formatMoment, mapsUrl, formatBytes } from '../utils/trip.js'

const START_LABEL = { transport: 'Departure', stay: 'Check-in', activity: 'Starts' }
const END_LABEL = { transport: 'Arrival', stay: 'Check-out', activity: 'Ends' }

function Row({ label, children }) {
  return (
    <div className="trip-row">
      <span className="trip-row-label">{label}</span>
      <span className="trip-row-value">{children}</span>
    </div>
  )
}

function PlaceValue({ place }) {
  const url = mapsUrl(place)
  return (
    <>
      {url ? <a href={url} target="_blank" rel="noopener noreferrer">{place.name}</a> : place.name}
      {place.address && <span className="trip-row-sub">{place.address}</span>}
    </>
  )
}

export default function TripItemDetailPage() {
  const { tripId, itemId } = useParams()
  const navigate = useNavigate()
  const fileInput = useRef(null)

  const [item, setItem] = useState(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data } = await client.get(`/trips/items/${itemId}`)
    setItem(data.item)
  }, [itemId])

  useEffect(() => {
    load()
      .catch(() => navigate(`/trips/${tripId}`, { state: { notice: 'This item no longer exists.' }, replace: true }))
      .finally(() => setLoading(false))
  }, [load])

  const handleDelete = async () => {
    const kept = item.expenses.length > 0 ? ' Its expenses stay in the group.' : ''
    if (!window.confirm(`Delete "${item.title}"?${kept}`)) return
    try {
      await client.delete(`/trips/items/${itemId}`)
      navigate(`/trips/${tripId}`, { state: { notice: `"${item.title}" was deleted.` } })
    } catch { setError('Failed to delete.') }
  }

  // The expense form does the splitting; it gets the item's details as a head
  // start and links the new expense back to this item once it is saved.
  const handleCreateExpense = () => {
    const remaining = item.price != null && item.currencyIso === item.groupIso
      ? Math.max(0, Number(item.price) - item.expenses.reduce((sum, e) => sum + Number(e.amountBase || 0), 0))
      : item.price
    navigate(`/groups/${item.groupId}/expenses/new`, {
      state: {
        tripItem: { id: item.id, tripId, title: item.title },
        prefill: {
          description: item.title,
          amount: item.expenses.length > 0 ? remaining : item.price,
          currencyIso: item.currencyIso,
        },
      },
    })
  }

  const handleUnlink = async expense => {
    if (!window.confirm(`Unlink "${expense.description}" from this item? The expense itself stays in the group.`)) return
    try {
      await client.delete(`/trips/items/${itemId}/expenses/${expense.id}`)
      await load()
    } catch { setError('Failed to unlink the expense.') }
  }

  const handleUpload = async e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || uploading) return
    setError('')
    setUploading(true)
    try {
      const body = new FormData()
      body.append('file', file)
      await client.post(`/trips/items/${itemId}/attachments`, body)
      await load()
    } catch (err) {
      setError(err?.response?.status === 413
        ? 'The file is too large (10 MB at most).'
        : err?.response?.data?.error || 'Failed to upload the file.')
    } finally {
      setUploading(false)
    }
  }

  const handleDeleteAttachment = async attachment => {
    if (!window.confirm(`Delete "${attachment.filename}"?`)) return
    try {
      await client.delete(`/trips/attachments/${attachment.id}`)
      await load()
    } catch { setError('Failed to delete the file.') }
  }

  const copyReference = () => {
    navigator.clipboard?.writeText(item.confirmationRef)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) return <Loading />
  if (!item) return null

  const mode = TRANSPORT_MODES.find(m => m.value === item.mode)
  const paid = item.expenses.reduce((sum, e) => sum + Number(e.amountBase || 0), 0)
  const sameDayEnd = item.end && dayOf(item.end) === dayOf(item.start)

  return (
    <>
      <div className="sub-header">
        <BackLink to={`/trips/${tripId}`} />
        <span className="sub-header-title">{item.kind === 'transport' ? (mode?.label ?? 'Transport') : KINDS[item.kind].label}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="sub-header-del" style={{ color: 'var(--accent)' }} onClick={() => navigate(`/trips/${tripId}/items/${itemId}/edit`)}>Edit</button>
          <button className="sub-header-del" onClick={handleDelete}>Delete</button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <div className="expense-icon" style={{ width: 56, height: 56, fontSize: 26, borderRadius: 'var(--r-lg)', flexShrink: 0 }}>
            {itemIcon(item)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)', marginBottom: 4, overflowWrap: 'anywhere' }}>{item.title}</div>
            <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
              <Link to={`/trips/${tripId}`} style={{ color: 'inherit' }}>{item.tripTitle}</Link>
            </div>
          </div>
        </div>

        <hr className="divider" style={{ margin: '0 0 16px' }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Row label={START_LABEL[item.kind]}>{formatMoment(item.start)}</Row>
          {item.end && (
            <Row label={END_LABEL[item.kind]}>
              {sameDayEnd && item.end.length > 10 ? item.end.slice(11, 16) : formatMoment(item.end)}
            </Row>
          )}
          {item.from && <Row label="From"><PlaceValue place={item.from} /></Row>}
          {item.to && <Row label="To"><PlaceValue place={item.to} /></Row>}
          {item.place && <Row label="Where"><PlaceValue place={item.place} /></Row>}
          {(item.carrier || item.number) && (
            <Row label={item.mode === 'flight' ? 'Flight' : item.mode === 'car' ? 'Rental' : 'Operator'}>
              {[item.carrier, item.number].filter(Boolean).join(' ')}
            </Row>
          )}
          {item.price != null && item.currencyIso && (
            <Row label="Price">
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{formatCurrency(item.price, item.currencyIso)}</span>
            </Row>
          )}
          {item.confirmationRef && (
            <Row label="Booking reference">
              <button type="button" className="trip-ref" onClick={copyReference} title="Copy">
                {item.confirmationRef} <span>{copied ? 'copied' : 'copy'}</span>
              </button>
            </Row>
          )}
          {item.url && (
            <Row label="Link">
              <a href={item.url} target="_blank" rel="noopener noreferrer">{item.url.replace(/^https?:\/\/(www\.)?/i, '').split('/')[0]}</a>
            </Row>
          )}
        </div>

        {item.notes && <p className="trip-notes" style={{ margin: '16px 0 0' }}>{item.notes}</p>}
      </div>

      <div className="section-label">Paid for with</div>
      {item.expenses.length > 0 && (
        <div className="expense-list">
          {item.expenses.map(e => (
            <div key={e.id} className="expense-item" onClick={() => navigate(`/groups/${item.groupId}/expenses/${e.id}`)}>
              <div className="expense-icon" style={{ background: 'var(--green-light)', color: 'var(--green-dark)' }}>✓</div>
              <div className="expense-info">
                <div className="expense-name">{e.description}</div>
                <div className="expense-meta">Paid by {e.paidByName ?? '—'}{e.date ? ` · ${formatDate(e.date)}` : ''}</div>
              </div>
              <div className="expense-amounts">
                <div className="expense-share">{formatCurrency(e.amount, e.currencyIso)}</div>
                <button
                  type="button"
                  className="trip-unlink"
                  onClick={event => { event.stopPropagation(); handleUnlink(e) }}
                >
                  unlink
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {item.expenses.length > 1 && (
        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '-8px 0 12px', textAlign: 'right' }}>
          {formatCurrency(paid, item.groupIso)} paid in total
        </p>
      )}
      <button className="btn-pill-outline" style={{ width: '100%', padding: '10px' }} onClick={handleCreateExpense}>
        {item.expenses.length > 0 ? 'Add another expense' : 'Create expense'}
      </button>

      <div className="section-label">Tickets and documents</div>
      {item.attachments.length > 0 && (
        <div className="expense-list">
          {item.attachments.map(a => (
            // A plain link, so the browser's own PDF and image viewers open it.
            <a key={a.id} className="expense-item" href={`/api${a.url}`} target="_blank" rel="noopener noreferrer">
              <div className="expense-icon">{a.mimeType === 'application/pdf' ? '📄' : '🖼️'}</div>
              <div className="expense-info">
                <div className="expense-name">{a.filename}</div>
                <div className="expense-meta">{formatBytes(a.size)}</div>
              </div>
              <button
                type="button"
                className="trip-unlink"
                onClick={event => { event.preventDefault(); event.stopPropagation(); handleDeleteAttachment(a) }}
              >
                delete
              </button>
            </a>
          ))}
        </div>
      )}
      <input ref={fileInput} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" hidden onChange={handleUpload} />
      <button className="btn-pill-outline" style={{ width: '100%', padding: '10px' }} onClick={() => fileInput.current?.click()} disabled={uploading}>
        {uploading ? 'Uploading…' : 'Add a file'}
      </button>
      <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>PDF or image, 10 MB at most.</p>
    </>
  )
}
