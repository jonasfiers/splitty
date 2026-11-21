import { useRef, useState, useMemo } from 'react'
import { useNavigate } from 'react-router'
import client from '../../api/client'
import { ListRow } from '../List/List.jsx'
import { RowAction } from '../Detail/Detail.jsx'
import Icon from '../Icon/Icon.jsx'
import { useConfirm } from '../Confirm/ConfirmProvider.jsx'
import { isStandalone } from '../../utils/standalone.js'
import { formatBytes } from '../../utils/trip.js'
import { shrinkImage } from '../../utils/shrinkImage.js'

// Receipts on an expense (api/receiptService.js): photos or PDFs of the bill,
// seen, added and removed by everyone in the group.
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

const fileIcon = r => <Icon name={r.mimeType === 'application/pdf' ? 'file-text' : 'image'} />

export default function Receipts({ groupId, expenseId, receipts, onChange, onError }) {
  const confirm = useConfirm()
  const navigate = useNavigate()
  const fileInput = useRef(null)
  const [uploading, setUploading] = useState(false)
  const standalone = useMemo(isStandalone, [])
  const full = receipts.length >= MAX_RECEIPTS

  const handleAdd = async e => {
    const files = [...(e.target.files ?? [])].slice(0, MAX_RECEIPTS - receipts.length)
    e.target.value = ''
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

  const viewer = r => `/groups/${groupId}/expenses/${expenseId}/receipts/${r.id}`

  return (
    <div className="receipts">
      <div className="section-label">Receipts</div>
      {receipts.length > 0 && (
        <div className="list">
          {receipts.map(r => (
            // In a browser tab: the browser's own viewer in a new tab. In the
            // installed app that would fill the window with no way back:
            // Splitty's viewer (as for trip files).
            <ListRow
              key={r.id}
              href={standalone ? viewer(r) : `/api${r.url}`}
              {...(standalone
                ? { onClick: event => { event.preventDefault(); navigate(viewer(r)) } }
                : { target: '_blank', rel: 'noopener noreferrer' })}
              icon={fileIcon(r)}
              title={r.filename}
              meta={[formatBytes(r.size), r.uploadedBy && `added by ${r.uploadedBy}`].filter(Boolean).join(' · ')}
              end={<RowAction label={`Delete ${r.filename}`} onClick={() => handleDelete(r)} />}
            />
          ))}
        </div>
      )}
      {!full && <>
        <input ref={fileInput} type="file" accept={RECEIPT_TYPES} multiple hidden onChange={handleAdd} />
        <button type="button" className="btn btn-secondary btn-block" onClick={() => fileInput.current?.click()} disabled={uploading}>
          {uploading ? 'Adding…' : receipts.length ? 'Add another receipt' : 'Add a receipt'}
        </button>
        <p className="field-note">A photo of the bill or a PDF. Photos are made smaller before they’re sent.</p>
      </>}
    </div>
  )
}
