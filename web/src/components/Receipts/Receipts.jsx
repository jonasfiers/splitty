import { useRef, useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router'
import client from '../../api/client'
import Icon from '../Icon/Icon.jsx'
import { useConfirm } from '../Confirm/ConfirmProvider.jsx'
import { isStandalone } from '../../utils/standalone.js'
import { useMediaQuery } from '../../utils/useMediaQuery.js'
import { shrinkImage, thumbnailOf } from '../../utils/shrinkImage.js'

// Receipts on an expense (api/receiptService.js): photos or PDFs of the bill,
// seen, added and removed by everyone in the group. Shown as thumbnails; a
// PDF as its icon and name.
export const MAX_RECEIPTS = 5
export const RECEIPT_TYPES = 'image/*,application/pdf'

// Uploads one file (a photo shrunk first, utils/shrinkImage.js) to the expense.
export async function uploadReceipt(expenseId, file) {
  const body = new FormData()
  body.append('file', await shrinkImage(file))
  return client.post(`/expenses/${expenseId}/receipts`, body, { timeout: 120000 })
}

export const uploadError = err => err?.response?.status === 413
  ? 'The file is too large (10 MB at most).'
  : err?.response?.data?.error || 'Failed to add the receipt.'

const isPdf = type => type === 'application/pdf'

// One receipt: its picture (or a PDF's icon and name), a tap opens it, ✕ removes it.
// The picture keeps the link it first loaded: the page refreshes its signed
// links every 4 minutes, and a new link would download the image again. Only
// when that link has expired (a page shown from cache) is the fresh one used.
function ReceiptTile({ name, type, src, href, onOpen, onRemove, title }) {
  const [shown, setShown] = useState(src)
  const face = isPdf(type) || !src
    ? <span className="receipt-tile-file"><Icon name="file-text" /><span>{name}</span></span>
    : <img src={shown || src} alt={name} loading="lazy" onError={() => { if (shown && shown !== src) setShown(src) }} />
  return (
    <li className="receipt-tile" title={title ?? name}>
      {href
        ? <a href={href} onClick={onOpen} {...(!onOpen && { target: '_blank', rel: 'noopener noreferrer' })} aria-label={`Open ${name}`}>{face}</a>
        : face}
      {onRemove && (
        <button type="button" className="receipt-tile-remove" aria-label={`Remove ${name}`} onClick={onRemove}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg>
        </button>
      )}
    </li>
  )
}

// "Take a photo" (the phone's own camera: a full-resolution still, with focus
// and flash) on touch screens, and "Choose a file" everywhere.
function AddButtons({ onFiles, busy, label }) {
  const camera = useRef(null)
  const picker = useRef(null)
  const touch = useMediaQuery('(pointer: coarse)')
  const take = e => { const files = [...(e.target.files ?? [])]; e.target.value = ''; if (files.length) onFiles(files) }
  return (
    <div className="receipt-add">
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={take} />
      <input ref={picker} type="file" accept={RECEIPT_TYPES} multiple hidden onChange={take} />
      {touch && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => camera.current?.click()} disabled={busy}>
          <Icon name="camera" /> {busy ? 'Adding…' : label ?? 'Take a photo'}
        </button>
      )}
      <button type="button" className={`btn btn-sm ${touch ? 'btn-ghost' : 'btn-secondary'}`} onClick={() => picker.current?.click()} disabled={busy}>
        {touch ? 'Choose a file' : busy ? 'Adding…' : 'Add a photo or PDF'}
      </button>
    </div>
  )
}

// On the new-expense form: files picked, not yet sent (uploaded once the
// expense is saved). Previews drawn from the files themselves, as data: URLs
// (the CSP refuses blob: images); a file shows its icon until its preview is ready.
const previews = new WeakMap() // File -> data: URL, so each is drawn once
export function PickedReceipts({ files, onChange }) {
  const [, redraw] = useState(0)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    for (const f of files) {
      if (previews.has(f)) continue
      previews.set(f, null)
      thumbnailOf(f).then(url => { previews.set(f, url); if (mounted.current) redraw(n => n + 1) })
    }
  }, [files])
  const urls = files.map(f => previews.get(f) ?? null)
  return <>
    {files.length > 0 && (
      <ul className="receipt-tiles">
        {files.map((f, i) => (
          <ReceiptTile key={`${f.name}-${f.lastModified}-${i}`} name={f.name} type={f.type} src={urls[i]}
            onRemove={() => onChange(files.filter((_, j) => j !== i))} />
        ))}
      </ul>
    )}
    {files.length < MAX_RECEIPTS && (
      <AddButtons label={files.length ? 'Take another' : undefined} onFiles={picked => onChange([...files, ...picked].slice(0, MAX_RECEIPTS))} />
    )}
  </>
}

// On the expense page: what is stored, with adding and removing.
export default function Receipts({ groupId, expenseId, receipts, onChange, onError }) {
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [uploading, setUploading] = useState(false)
  const standalone = useMemo(isStandalone, [])

  const handleAdd = async picked => {
    const files = picked.slice(0, MAX_RECEIPTS - receipts.length)
    if (!files.length || uploading) return
    setUploading(true)
    onError('')
    try {
      for (const file of files) await uploadReceipt(expenseId, file)
    } catch (err) {
      onError(uploadError(err))
    } finally {
      setUploading(false)
      onChange()
    }
  }

  const handleDelete = async r => {
    const ok = await confirm({ title: `Delete "${r.filename}"?`, confirmLabel: 'Delete', danger: true })
    if (!ok) return
    try {
      await client.delete(`/expenses/receipts/${r.id}`)
    } catch {
      onError('Failed to delete the receipt.')
    }
    onChange()
  }

  // In a browser tab: the browser's own viewer in a new tab. In the installed
  // app that would fill the window with no way back: Splitty's viewer.
  const viewer = r => `/groups/${groupId}/expenses/${expenseId}/receipts/${r.id}`

  return (
    <div className="receipts">
      <div className="section-label">Receipts</div>
      <div className="card">
        {receipts.length > 0 && (
          <ul className="receipt-tiles">
            {receipts.map(r => (
              <ReceiptTile
                key={r.id}
                name={r.filename}
                type={r.mimeType}
                src={`/api${r.url}`}
                href={standalone ? viewer(r) : `/api${r.url}`}
                onOpen={standalone ? e => { e.preventDefault(); navigate(viewer(r)) } : undefined}
                onRemove={() => handleDelete(r)}
                title={r.uploadedBy ? `${r.filename} · added by ${r.uploadedBy}` : r.filename}
              />
            ))}
          </ul>
        )}
        {receipts.length < MAX_RECEIPTS
          ? <AddButtons onFiles={handleAdd} busy={uploading} label={receipts.length ? 'Take another' : undefined} />
          : <p className="field-note">That’s the most an expense can have ({MAX_RECEIPTS}).</p>}
      </div>
    </div>
  )
}
