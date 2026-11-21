import { useRef, useState, useEffect } from 'react'
import client from '../../api/client'
import Icon from '../Icon/Icon.jsx'
import { useMediaQuery } from '../../utils/useMediaQuery.js'
import { shrinkImage, thumbnailOf, thumbnailBlob } from '../../utils/shrinkImage.js'
import { isOffline } from '../../utils/connection.js'
import './FileTiles.css'

// Files as tiles (2026-11-21), the same everywhere: trip item files, trip
// documents, expense receipts. Each tile shows the file's preview (a photo
// scaled down, a PDF's first page), or its icon until there is one; under it
// optionally its name and a line about it; a ✕ or a row of actions.
//
// Previews (api/fileUpload.js) are drawn on the phone and sent with the file.
// A file uploaded without one gets it from the first phone that shows it
// (usePreviews below), so every file ends up with a tile.

export const FILE_TYPES = 'application/pdf,image/jpeg,image/png,image/webp'
const isPdf = type => type === 'application/pdf'

// Uploads a file with its preview: multipart `file` + `thumbnail` (+ fields).
// shrink: redraw a photo smaller first (receipts; tickets keep every pixel,
// a barcode in a photo must stay readable).
export async function uploadFile(url, file, { shrink = false, fields = {} } = {}) {
  const body = new FormData()
  const sent = shrink ? await shrinkImage(file) : file
  body.append('file', sent)
  const preview = await thumbnailBlob(sent)
  if (preview) body.append('thumbnail', preview, 'thumbnail.jpg')
  for (const [k, v] of Object.entries(fields)) body.append(k, v)
  return client.post(url, body, { timeout: 120000 })
}

export const uploadError = (err, fallback = 'Upload failed.') => err?.response?.status === 413
  ? 'The file is too large (10 MB at most).'
  : err?.response?.data?.error || fallback

// ── Previews for files that have none ──
// Files listed with a url but no thumbUrl: one at a time, the phone fetches
// the file, draws its preview, shows it at once and sends it to the server
// (POST /trips/files/:id/thumb, refused if another phone was first). Once per
// file per visit; not offline, and not for very large files.
const BACKFILL_MAX_BYTES = 8 * 1024 * 1024
const tried = new Set()
const drawn = new Map() // id -> data: URL, for this visit
const listeners = new Set()
let queue = Promise.resolve()

function backfill(f) {
  if (tried.has(f.id)) return
  tried.add(f.id)
  queue = queue.then(async () => {
    if (isOffline()) { tried.delete(f.id); return }
    try {
      const res = await fetch(`/api${f.url}`)
      if (!res.ok) { tried.delete(f.id); return }
      const file = new File([await res.blob()], f.filename || 'file', { type: f.mimeType })
      const [url, blob] = await Promise.all([thumbnailOf(file), thumbnailBlob(file)])
      if (!url || !blob) return
      drawn.set(f.id, url)
      listeners.forEach(fn => fn())
      const body = new FormData()
      body.append('thumbnail', blob, 'thumbnail.jpg')
      await client.post(`/trips/files/${f.id}/thumb`, body).catch(() => {})
    } catch { tried.delete(f.id) }
  })
}

// The preview to show for each file: { id: src | null }. Starts the
// backfill for files without one (unless `enabled` is false: offline copies).
export function usePreviews(files, { enabled = true } = {}) {
  const [, redraw] = useState(0)
  useEffect(() => {
    const fn = () => redraw(n => n + 1)
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }, [])
  useEffect(() => {
    if (!enabled) return
    for (const f of files ?? []) {
      if (!f.thumbUrl && f.url && (isPdf(f.mimeType) || f.mimeType?.startsWith('image/')) && !(f.size > BACKFILL_MAX_BYTES)) backfill(f)
    }
  }, [files, enabled])
  return id => drawn.get(id) ?? null
}

// ── Tiles ──
export function FileTiles({ children, className = '' }) {
  return <ul className={`file-tiles ${className}`.trim()}>{children}</ul>
}

// One file. src: the preview (null: the icon). href/onOpen: opens it (a new
// tab without onOpen). name/meta under it when caption. onRemove: a ✕ on the
// tile; actions: buttons under it. dim: listed but not available (offline).
// The picture keeps the address it first loaded: pages refresh their signed
// links every 4 minutes, and a new one would download the preview again.
export function FileTile({ name, type, src, href, onOpen, caption = false, meta, onRemove, removeLabel, actions, dim = false, title }) {
  const [shown, setShown] = useState(src)
  useEffect(() => { if (!shown && src) setShown(src) }, [src, shown])
  const face = src
    ? <img src={shown || src} alt={name} loading="lazy" onError={() => { if (shown !== src) setShown(src) }} />
    : <span className="file-tile-icon"><Icon name={isPdf(type) ? 'file-text' : 'image'} />{!caption && <span>{name}</span>}</span>
  return (
    <li className={`file-tile${dim ? ' dim' : ''}`} title={title ?? name}>
      <div className="file-tile-face">
        {href
          ? <a href={href} onClick={onOpen} {...(!onOpen && { target: '_blank', rel: 'noopener noreferrer' })} aria-label={`Open ${name}`}>{face}</a>
          : face}
        {onRemove && (
          <button type="button" className="file-tile-remove" aria-label={removeLabel ?? `Remove ${name}`} onClick={onRemove}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg>
          </button>
        )}
      </div>
      {caption && (
        <div className="file-tile-caption">
          <span className="file-tile-name">{name}</span>
          {meta && <span className="file-tile-meta">{meta}</span>}
        </div>
      )}
      {actions && <div className="file-tile-actions">{actions}</div>}
    </li>
  )
}

// ── Adding ──
// "Take a photo" (the phone's own camera: a full-resolution still, with focus
// and flash) on touch screens, and "Choose a file" everywhere.
export function AddFileButtons({ onFiles, busy, multiple = true, accept = FILE_TYPES, takeLabel = 'Take a photo', pickLabel = 'Add a photo or PDF' }) {
  const camera = useRef(null)
  const picker = useRef(null)
  const touch = useMediaQuery('(pointer: coarse)')
  const take = e => { const files = [...(e.target.files ?? [])]; e.target.value = ''; if (files.length) onFiles(files) }
  return (
    <div className="file-add">
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={take} />
      <input ref={picker} type="file" accept={accept} multiple={multiple} hidden onChange={take} />
      {touch && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => camera.current?.click()} disabled={busy}>
          <Icon name="camera" /> {busy ? 'Adding…' : takeLabel}
        </button>
      )}
      <button type="button" className={`btn btn-sm ${touch ? 'btn-ghost' : 'btn-secondary'}`} onClick={() => picker.current?.click()} disabled={busy}>
        {touch ? 'Choose a file' : busy ? 'Adding…' : pickLabel}
      </button>
    </div>
  )
}

// Files picked but not sent yet (a form uploads them when it is saved):
// previews drawn from the files themselves, as data: URLs (the CSP refuses
// blob: images); a file shows its icon until its preview is ready.
const picked = new WeakMap() // File -> data: URL, so each is drawn once
export function PickedFiles({ files, onChange, max, takeLabel }) {
  const [, redraw] = useState(0)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    for (const f of files) {
      if (picked.has(f)) continue
      picked.set(f, null)
      thumbnailOf(f).then(url => { picked.set(f, url); if (mounted.current) redraw(n => n + 1) })
    }
  }, [files])
  return <>
    {files.length > 0 && (
      <FileTiles>
        {files.map((f, i) => (
          <FileTile key={`${f.name}-${f.lastModified}-${i}`} name={f.name} type={f.type} src={picked.get(f) ?? null}
            onRemove={() => onChange(files.filter((_, j) => j !== i))} />
        ))}
      </FileTiles>
    )}
    {files.length < max && (
      <AddFileButtons takeLabel={files.length ? 'Take another' : takeLabel} onFiles={more => onChange([...files, ...more].slice(0, max))} />
    )}
  </>
}
