import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react'
import LoadFailed from '../components/LoadFailed.jsx'
import { useParams, useNavigate, Link } from 'react-router'
import client from '../api/client'
import Loading from '../components/Loading.jsx'
import PageHeader from '../components/PageHeader/PageHeader.jsx'
import LinkExpenseSheet from '../components/TripForm/LinkExpenseSheet.jsx'
import BigReference from '../components/BigReference/BigReference.jsx'
import { DetailHero, DetailRows, DetailRow, DetailRowSub, RowAction } from '../components/Detail/Detail.jsx'
import { useConfirm } from '../components/Confirm/ConfirmProvider.jsx'
import { useMediaQuery } from '../utils/useMediaQuery.js'
import { isStandalone } from '../utils/standalone.js'

// Leaflet is only worth downloading when the map is shown (wide screens).
const TripMap = lazy(() => import('../components/TripMap/TripMap.jsx'))
const noop = () => {}
import { formatCurrency, formatDate } from '../utils/currency.js'
import { ListRow } from '../components/List/List.jsx'
import { leaveTo } from '../utils/history.js'
import { KINDS, TRANSPORT_MODES, itemIcon, dayOf, timeOf, formatDay, formatDuration, daysBetween, mapsLink, linkTarget, formatBytes, DEFAULT_CHECK_IN, DEFAULT_CHECK_OUT } from '../utils/trip.js'

const START_LABEL = { transport: 'Departure', stay: 'Check-in', activity: 'Starts' }
const END_LABEL = { transport: 'Arrival', stay: 'Check-out', activity: 'Ends' }

function PlaceValue({ place }) {
  const link = mapsLink(place)
  return (
    <>
      {link ? <a href={link.url} target={linkTarget(link.url)} rel="noopener noreferrer" title={link.label}>{place.name}</a> : place.name}
      {place.address && <DetailRowSub>{place.address}</DetailRowSub>}
    </>
  )
}

// Minutes between two 'YYYY-MM-DDTHH:MM' wall-clock moments.
const minutesBetween = (a, b) => {
  const at = m => { const [d, t] = m.split('T'); const [y, mo, day] = d.split('-').map(Number); const [h, mi] = t.split(':').map(Number); return new Date(y, mo - 1, day, h, mi) }
  return Math.round((at(b) - at(a)) / 60000)
}

// The item's time span as one block, like a boarding pass: start on the left,
// end on the right, what lies between in the middle (a duration, or nights for
// a stay). A journey shows its places under the times. Stays without times get
// the usual hotel times, shown softer. No duration for flights: times are local
// wall-clock without a zone, so across zones it would be wrong.
function Span({ item }) {
  const stay = item.kind === 'stay'
  const startTime = timeOf(item.start) || (stay ? DEFAULT_CHECK_IN : '')
  const endTime = item.end ? timeOf(item.end) || (stay ? DEFAULT_CHECK_OUT : '') : ''
  const sameDay = item.end && dayOf(item.end) === dayOf(item.start)
  // All on one day (or a single moment): the date once, above both times.
  // Across days (a stay, a night train) each time gets its own date.
  const oneDay = !stay && (!item.end || sameDay) && !!startTime
  let middle = null
  if (stay && item.end) {
    const nights = daysBetween(dayOf(item.start), dayOf(item.end))
    if (nights > 0) middle = `${nights} night${nights !== 1 ? 's' : ''}`
  } else if (item.end && timeOf(item.start) && timeOf(item.end) && item.mode !== 'flight') {
    const mins = minutesBetween(item.start, item.end)
    if (mins > 0) middle = formatDuration(mins)
  }
  const side = (label, day, time, assumed, place, end) => (
    <div className={`span-side${end ? ' end' : ''}`}>
      <div className="span-label">{label}</div>
      <div className={`span-time${assumed ? ' assumed' : ''}`} title={assumed ? 'Usual hotel time; no time set on this stay' : undefined}>
        {time || formatDay(day)}
      </div>
      {time && !oneDay && <div className="span-day">{formatDay(day)}</div>}
      {place && <div className="span-place"><PlaceValue place={place} /></div>}
    </div>
  )
  return (
    <>
    {oneDay && <div className="span-date">{formatDay(dayOf(item.start))}</div>}
    <div className="span">
      {side(START_LABEL[item.kind], dayOf(item.start), startTime, stay && !timeOf(item.start), item.kind === 'transport' ? item.from : null, false)}
      {item.end && (
        <>
          <div className="span-middle">
            <span className="span-line" />
            {middle && <span className="span-duration">{middle}</span>}
          </div>
          {side(END_LABEL[item.kind], dayOf(item.end), endTime, stay && !timeOf(item.end), item.kind === 'transport' ? item.to : null, true)}
        </>
      )}
    </div>
    </>
  )
}

export default function TripItemDetailPage() {
  const confirm = useConfirm()
  const { tripId, itemId } = useParams()
  const navigate = useNavigate()
  const fileInput = useRef(null)

  const [item, setItem] = useState(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showBigRef, setShowBigRef] = useState(false)
  const closeBigRef = useCallback(() => setShowBigRef(false), [])
  const [linking, setLinking] = useState(false)
  // Same breakpoint as the other two-column pages (see index.css).
  const wide = useMediaQuery('(min-width: 1180px)')
  const standalone = useMemo(isStandalone, [])
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data } = await client.get(`/trips/items/${itemId}`)
    setItem(data.item)
  }, [itemId])

  // Loading failed (not "no such item": that is a 404): the "couldn't load" state.
  const [loadError, setLoadError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => { setLoading(true); setAttempt(n => n + 1) }, [])
  useEffect(() => {
    setLoadError(null)
    load()
      .catch(err => {
        if (err.response?.status === 404) navigate(`/trips/${tripId}`, { state: { notice: 'This item no longer exists.' }, replace: true })
        else setLoadError(err)
      })
      .finally(() => setLoading(false))
  }, [load, attempt])

  // Attachment links are signed for 5 minutes (FILE_LINK_TTL in the API):
  // refresh them while the page is open, and on coming back to it, so a tap
  // never hits an expired link. Failures are ignored; the next round retries.
  const loadedAt = useRef(Date.now())
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      load().then(() => { loadedAt.current = Date.now() }).catch(() => {})
    }
    const timer = setInterval(refresh, 4 * 60 * 1000)
    const onVisible = () => { if (Date.now() - loadedAt.current > 60 * 1000) refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [load])

  // In the installed app files open in Splitty's viewer: with a PDF on this
  // item, fetch the viewer and pdf.js while the phone is idle, so the tap is
  // instant instead of waiting for about half a megabyte.
  const hasPdf = !!item?.attachments?.some(a => a.mimeType === 'application/pdf')
  useEffect(() => {
    if (!standalone || !hasPdf) return
    const idle = window.requestIdleCallback ?? (fn => setTimeout(fn, 1500))
    const cancel = window.cancelIdleCallback ?? clearTimeout
    const handle = idle(() => {
      import('./FileViewerPage.jsx').catch(() => {})
      import('../utils/pdf.js').then(m => m.warmUp()).catch(() => {})
    })
    return () => cancel(handle)
  }, [standalone, hasPdf])

  const handleDelete = async () => {
    const ok = await confirm({
      title: `Delete "${item.title}"?`,
      message: item.expenses.length > 0 ? 'Its expenses stay in the group.' : null,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    try {
      await client.delete(`/trips/items/${itemId}`)
      leaveTo(navigate, `/trips/${tripId}`, { notice: `"${item.title}" was deleted.` })
    } catch { setError('Failed to delete.') }
  }

  // What it costs lives in the expense: the expense form does the amount and
  // the splitting, gets the item's name as a head start, and links the new
  // expense back to this item once it is saved.
  const handleCreateExpense = () => {
    navigate(`/groups/${item.groupId}/expenses/new`, {
      state: {
        tripItem: { id: item.id, tripId, title: item.title },
        prefill: { description: item.title },
      },
    })
  }

  const handleUnlink = async expense => {
    const ok = await confirm({
      title: `Unlink "${expense.description}"?`,
      message: 'The expense itself stays in the group.',
      confirmLabel: 'Unlink',
      danger: true,
    })
    if (!ok) return
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
      await client.post(`/trips/items/${itemId}/attachments`, body, { timeout: 120000 })
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
    const ok = await confirm({ title: `Delete "${attachment.filename}"?`, confirmLabel: 'Delete', danger: true })
    if (!ok) return
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

  // The item's own place(s) for the map, in the shape TripMap takes; memoised
  // so the map is not rebuilt on every render.
  const mapData = useMemo(() => {
    if (!item) return null
    const places = [item.from, item.to, item.place].filter(p => p && p.lat != null && p.lon != null)
    if (places.length === 0) return null
    return { places, items: [{ ...item, placeId: item.place?.id, fromPlaceId: item.from?.id, toPlaceId: item.to?.id }] }
  }, [item])

  // While loading or when it fails: the bar with its way back stays.
  const bare = <PageHeader compact crumbs={[{ to: '/trips', label: 'Trips' }, { to: `/trips/${tripId}`, label: 'Trip' }]} name="Item" />
  if (loading || (!item && !loadError)) return <>{bare}<Loading /></>
  if (loadError) return <>{bare}<LoadFailed error={loadError} what="this item" onRetry={retry} /></>

  const mode = TRANSPORT_MODES.find(m => m.value === item.mode)
  const paid = item.expenses.reduce((sum, e) => sum + Number(e.amountBase || 0), 0)
  // Directions: to where a journey leaves from, otherwise to the item's place.
  const goLink = mapsLink(item.kind === 'transport' ? item.from : item.place)

  return (
    <>
      <PageHeader
        compact
        crumbs={[{ to: '/trips', label: 'Trips' }, { to: `/trips/${tripId}`, label: item.tripTitle || 'Trip' }]}
        name={item.kind === 'transport' ? (mode?.label ?? 'Transport') : KINDS[item.kind].label}
        actions={wide ? [] : [
          { label: 'Edit', onClick: () => navigate(`/trips/${tripId}/items/${itemId}/edit`), primary: true },
          { label: 'Delete', onClick: handleDelete, danger: true },
        ]}
      />
      {error && <p className="error">{error}</p>}

      <div className="item-layout">
        <div className="item-main">
          <div className="card">
            <DetailHero
              icon={itemIcon(item)}
              title={item.title}
              subtitle={<Link to={`/trips/${tripId}`}>{item.tripTitle}</Link>}
            />

            {(item.confirmationRef || goLink) && (
              <div className="today-actions item-quick">
                {item.confirmationRef && (
                  <>
                    <button type="button" className="today-ref" onClick={() => setShowBigRef(true)} title="Show big" aria-label={`Show booking reference ${item.confirmationRef} full screen`}>
                      <span>{item.confirmationRef}</span>
                    </button>
                    <button type="button" className="today-nav" onClick={copyReference} aria-label="Copy booking reference" title={copied ? 'Copied' : 'Copy'}>
                      {copied ? (
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h8" /></svg>
                      )}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </>
                )}
                {goLink && (
                  <a className="today-nav" href={goLink.url} target={linkTarget(goLink.url)} rel="noopener noreferrer" title={goLink.label}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l18-8-8 18-2-8-8-2z" /></svg>
                    Go
                  </a>
                )}
                {showBigRef && (
                  <BigReference value={item.confirmationRef} label={`${item.title} · Booking reference`} onClose={closeBigRef} />
                )}
              </div>
            )}

            <hr className="divider" style={{ margin: '20px 0 16px' }} />

            <Span item={item} />

            <DetailRows>
              {item.place && <DetailRow label="Where"><PlaceValue place={item.place} /></DetailRow>}
              {(item.carrier || item.number) && (
                <DetailRow label={item.mode === 'flight' ? 'Flight' : item.mode === 'car' ? 'Rental' : 'Operator'}>
                  {[item.carrier, item.number].filter(Boolean).join(' ')}
                </DetailRow>
              )}
              {item.url && (
                <DetailRow label="Link">
                  <a href={item.url} target="_blank" rel="noopener noreferrer">{item.url.replace(/^https?:\/\/(www\.)?/i, '').split('/')[0]}</a>
                </DetailRow>
              )}
            </DetailRows>

            {item.notes && <p className="trip-notes" style={{ margin: '16px 0 0' }}>{item.notes}</p>}
          </div>
          {wide && mapData && (
            <Suspense fallback={<Loading />}>
              <TripMap places={mapData.places} items={mapData.items} onOpenItem={noop} />
            </Suspense>
          )}
        </div>

        <aside className="item-aside">
          {wide && (
            <div className="item-actions">
              <button className="btn btn-primary" onClick={() => navigate(`/trips/${tripId}/items/${itemId}/edit`)}>Edit item</button>
              <button className="btn btn-ghost" onClick={handleDelete}>Delete</button>
            </div>
          )}
          <div className="section-label">Tickets and documents</div>
          {item.attachments.length > 0 && (
            <div className="list">
              {item.attachments.map(a => (
                // In a browser tab: a plain link, so the browser's own PDF and
                // image viewers open it in a new tab. In the installed app that
                // would fill the window with no way back: Splitty's viewer.
                <ListRow
                  key={a.id}
                  href={standalone ? `/trips/${tripId}/items/${itemId}/files/${a.id}` : `/api${a.url}`}
                  {...(standalone
                    ? { onClick: event => { event.preventDefault(); navigate(`/trips/${tripId}/items/${itemId}/files/${a.id}`) } }
                    : { target: '_blank', rel: 'noopener noreferrer' })}
                  icon={a.mimeType === 'application/pdf' ? '📄' : '🖼️'}
                  title={a.filename}
                  meta={formatBytes(a.size)}
                  end={<RowAction label={`Delete ${a.filename}`} onClick={() => handleDeleteAttachment(a)} />}
                />
              ))}
            </div>
          )}
          <input ref={fileInput} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" hidden onChange={handleUpload} />
          <button className="btn btn-secondary btn-block" onClick={() => fileInput.current?.click()} disabled={uploading}>
            {uploading ? 'Uploading…' : 'Add a file'}
          </button>
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>PDF or image, 10 MB at most.</p>
          <div className="section-label">Paid for with</div>
          {item.expenses.length > 0 && (
            <div className="list">
              {item.expenses.map(e => (
                <ListRow
                  key={e.id}
                  to={`/groups/${item.groupId}/expenses/${e.id}`}
                  icon="✓"
                  title={e.description}
                  meta={<>Paid by {e.paidByName ?? '—'}{e.date ? ` · ${formatDate(e.date)}` : ''}</>}
                  aside={<span className="list-row-amt">{formatCurrency(e.amount, e.currencyIso)}</span>}
                  end={<RowAction label={`Unlink ${e.description}`} onClick={() => handleUnlink(e)} />}
                />
              ))}
            </div>
          )}
          {item.expenses.length > 1 && (
            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '-8px 0 12px', textAlign: 'right' }}>
              {formatCurrency(paid, item.groupIso)} paid in total
            </p>
          )}
          <div className="trip-expense-actions">
            <button className="btn btn-secondary" onClick={handleCreateExpense}>
              {item.expenses.length > 0 ? 'Add another expense' : 'Create expense'}
            </button>
            <button className="btn btn-secondary" onClick={() => setLinking(true)}>Link existing expense</button>
          </div>
          {linking && (
            <LinkExpenseSheet
              itemId={itemId}
              groupId={item.groupId}
              linkedIds={item.expenses.map(e => e.id)}
              onClose={() => setLinking(false)}
              onLinked={async () => { setLinking(false); await load() }}
            />
          )}

        </aside>
      </div>
    </>
  )
}
