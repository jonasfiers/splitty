import { useRef, useState } from 'react'
import Field from '../Field/Field.jsx'
import Picker from '../Picker/Picker.jsx'
import TicketCode from './TicketCode.jsx'
import CodeScanner from './CodeScanner.jsx'
import { TICKET_FORMATS, MAX_TICKETS, canReadCodes, canScanLive, readCodesFromFile } from '../../utils/barcode.js'

// The codes on an item's tickets, on the trip item form (2026-11-19): one per
// ticket (two people, two codes), each with an optional name ("Jonas", "1/2").
// Added by reading a screenshot, photo or PDF (every code in it), scanning
// with the camera, or pasting the text and picking its kind. Each shows a small
// preview of what the full-screen view will draw.
// `tickets` = [{ code, format, name }], `onChange(tickets)`.
export default function TicketCodeField({ tickets, onChange }) {
  const fileRef = useRef(null)
  const [reading, setReading] = useState(false)
  const [note, setNote] = useState(null) // { text, error }
  const [scanning, setScanning] = useState(false)
  const [focusLast, setFocusLast] = useState(false)
  const canRead = canReadCodes()
  const canScan = canScanLive()
  const full = tickets.length >= MAX_TICKETS

  // New codes go at the end; a code already in the list is not added again.
  const add = found => {
    const known = new Set(tickets.map(t => t.code))
    const fresh = found.filter(f => !known.has(f.text))
    const room = MAX_TICKETS - tickets.length
    const added = fresh.slice(0, room).map(f => ({ code: f.text, format: f.format, name: '' }))
    if (added.length) onChange([...tickets, ...added])
    const skipped = found.length - added.length
    setFocusLast(false)
    setNote(added.length === 0
      ? { text: fresh.length ? `An item keeps ${MAX_TICKETS} tickets at most.` : 'That code is already in the list.', error: true }
      : { text: `Added ${added.length === 1 ? 'a ticket' : `${added.length} tickets`}${skipped ? ` (${skipped} already in the list or over the limit)` : ''}.`, error: false })
  }

  const onFile = async e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setReading(true)
    setNote(null)
    try {
      add(await readCodesFromFile(file))
    } catch (err) {
      setNote({ text: err.message || 'Couldn’t read that file.', error: true })
    } finally {
      setReading(false)
    }
  }

  const update = (n, patch) => onChange(tickets.map((t, i) => (i === n ? { ...t, ...patch } : t)))
  const remove = n => { onChange(tickets.filter((_, i) => i !== n)); setNote(null) }
  const paste = () => { onChange([...tickets, { code: '', format: 'qr', name: '' }]); setFocusLast(true); setNote(null) }

  return (
    <Field
      label={tickets.length > 1 ? `Ticket codes (${tickets.length})` : 'Ticket code'}
      optional
      group
      hint={tickets.length === 0 ? (canRead
        ? 'The QR code or barcode on each ticket: from a screenshot, photo or PDF (all codes in it), or scanned with the camera.'
        : 'The text inside each ticket’s QR code or barcode.') : undefined}
    >
      {tickets.length > 0 && (
        <ul className="ticket-list">
          {tickets.map((t, n) => (
            <TicketRow
              key={n}
              ticket={t}
              number={n + 1}
              autoFocus={focusLast && n === tickets.length - 1}
              onChange={patch => update(n, patch)}
              onRemove={() => remove(n)}
            />
          ))}
        </ul>
      )}
      <div className="ticket-code-actions">
        {canRead && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()} disabled={reading || full}>
            {reading ? 'Reading…' : 'Read from file'}
          </button>
        )}
        {canScan && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setNote(null); setScanning(true) }} disabled={full}>Scan with camera</button>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={paste} disabled={full}>Paste the text</button>
      </div>
      {note && <p className={`field-note ${note.error ? 'error-text' : ''}`}>{note.text}</p>}
      <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={onFile} />
      {scanning && (
        <CodeScanner
          onResult={code => { setScanning(false); add([code]) }}
          onClose={() => setScanning(false)}
        />
      )}
    </Field>
  )
}

function TicketRow({ ticket, number, autoFocus, onChange, onRemove }) {
  const [drawError, setDrawError] = useState(null)
  return (
    <li className="ticket-row">
      <div className="ticket-code-fields">
        <input
          value={ticket.name}
          onChange={e => onChange({ name: e.target.value })}
          maxLength={40}
          placeholder={`Ticket ${number} · name (optional)`}
          aria-label={`Name of ticket ${number}`}
        />
        <textarea
          value={ticket.code}
          onChange={e => onChange({ code: e.target.value })}
          maxLength={2000}
          rows={2}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label={`Text in the code of ticket ${number}`}
          placeholder="Text in the code"
          className="ticket-code-text"
          autoFocus={autoFocus}
        />
        <div className="ticket-row-bottom">
          <Picker
            title="Kind of code"
            variant="field"
            value={ticket.format || 'qr'}
            onChange={f => onChange({ format: f })}
            options={TICKET_FORMATS}
          />
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove} aria-label={`Remove ticket ${number}`}>Remove</button>
        </div>
        {drawError && ticket.code && <p className="field-note error-text">This text doesn’t fit that kind of code.</p>}
      </div>
      {ticket.code && <TicketCode className="ticket-code-preview" format={ticket.format || 'qr'} text={ticket.code} onError={setDrawError} />}
    </li>
  )
}
