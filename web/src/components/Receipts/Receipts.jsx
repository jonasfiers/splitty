import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router'
import client from '../../api/client'
import { useConfirm } from '../Confirm/ConfirmProvider.jsx'
import { isStandalone } from '../../utils/standalone.js'
import { FileTiles, FileTile, AddFileButtons, PickedFiles, uploadFile, uploadError as fileUploadError, usePreviews } from '../FileTiles/FileTiles.jsx'

// Receipts on an expense (api/receiptService.js): photos or PDFs of the bill,
// seen, added and removed by everyone in the group, as tiles (FileTiles).
export const MAX_RECEIPTS = 5

// Uploads one receipt: a photo is redrawn smaller first, and a preview goes with it.
export const uploadReceipt = (expenseId, file) => uploadFile(`/expenses/${expenseId}/receipts`, file, { shrink: true })
export const uploadError = err => fileUploadError(err, 'Failed to add the receipt.')

// On the new-expense form: picked, uploaded once the expense is saved.
export function PickedReceipts({ files, onChange }) {
  return <PickedFiles files={files} onChange={onChange} max={MAX_RECEIPTS} />
}

// On the expense page: what is stored, with adding and removing.
export default function Receipts({ groupId, expenseId, receipts, onChange, onError }) {
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [uploading, setUploading] = useState(false)
  const standalone = useMemo(isStandalone, [])
  const preview = usePreviews(receipts)

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
          <FileTiles>
            {receipts.map(r => (
              <FileTile
                key={r.id}
                name={r.filename}
                type={r.mimeType}
                src={r.thumbUrl ? `/api${r.thumbUrl}` : preview(r.id)}
                href={standalone ? viewer(r) : `/api${r.url}`}
                onOpen={standalone ? e => { e.preventDefault(); navigate(viewer(r)) } : undefined}
                onRemove={() => handleDelete(r)}
                removeLabel={`Delete ${r.filename}`}
                title={r.uploadedBy ? `${r.filename} · added by ${r.uploadedBy}` : r.filename}
              />
            ))}
          </FileTiles>
        )}
        {receipts.length < MAX_RECEIPTS
          ? <AddFileButtons onFiles={handleAdd} busy={uploading} takeLabel={receipts.length ? 'Take another' : 'Take a photo'} />
          : <p className="field-note">That’s the most an expense can have ({MAX_RECEIPTS}).</p>}
      </div>
    </div>
  )
}
