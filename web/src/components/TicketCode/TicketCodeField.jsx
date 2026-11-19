import { useRef, useState } from 'react'
import Field from '../Field/Field.jsx'
import Picker from '../Picker/Picker.jsx'
import TicketCode from './TicketCode.jsx'
import { TICKET_FORMATS, canReadCodes, readCodeFromFile } from '../../utils/barcode.js'

// The ticket's own code on the trip item form (2026-11-19): read from a
// screenshot, photo or PDF of the ticket where the browser can (BarcodeDetector),
// or pasted as text with its format picked. A small preview shows what the
// full-screen view will draw. `code` / `format` / `onChange({ ticketCode, ticketFormat })`.
export default function TicketCodeField({ code, format, onChange }) {
  const fileRef = useRef(null)
  const [reading, setReading] = useState(false)
  const [problem, setProblem] = useState('')
  const [drawError, setDrawError] = useState(null)
  const [typing, setTyping] = useState(false)
  const canRead = canReadCodes()

  const onFile = async e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setReading(true)
    setProblem('')
    try {
      const { text, format: found } = await readCodeFromFile(file)
      onChange({ ticketCode: text, ticketFormat: found })
    } catch (err) {
      setProblem(err.message || 'Couldn’t read that file.')
    } finally {
      setReading(false)
    }
  }

  const readButton = canRead && (
    <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()} disabled={reading}>
      {reading ? 'Reading…' : code ? 'Read again' : 'Read from ticket'}
    </button>
  )
  const fileInput = <input ref={fileRef} type="file" accept="image/*,application/pdf" hidden onChange={onFile} />

  if (!code && !typing) {
    return (
      <Field label="Ticket code" optional group hint={canRead ? 'The QR code or barcode on the ticket, from a screenshot, photo or PDF.' : 'The text inside the ticket’s QR code or barcode.'}>
        <div className="ticket-code-actions">
          {readButton}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTyping(true)}>Paste the text</button>
        </div>
        {fileInput}
        {problem && <p className="field-note error-text">{problem}</p>}
      </Field>
    )
  }

  return (
    <Field label="Ticket code" optional group>
      <div className="ticket-code-edit">
        <div className="ticket-code-fields">
          <textarea
            value={code}
            onChange={e => onChange({ ticketCode: e.target.value, ticketFormat: format || 'qr' })}
            maxLength={2000}
            rows={2}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label="Text in the code"
            className="ticket-code-text"
            autoFocus={typing && !code}
          />
          <Picker
            title="Kind of code"
            variant="field"
            value={format || 'qr'}
            onChange={f => onChange({ ticketCode: code, ticketFormat: f })}
            options={TICKET_FORMATS}
          />
          <div className="ticket-code-actions">
            {readButton}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { onChange({ ticketCode: '', ticketFormat: '' }); setTyping(false); setProblem('') }}>Remove</button>
          </div>
          {problem && <p className="field-note error-text">{problem}</p>}
          {drawError && code && <p className="field-note error-text">This text doesn’t fit that kind of code.</p>}
        </div>
        {code && <TicketCode className="ticket-code-preview" format={format || 'qr'} text={code} onError={setDrawError} />}
      </div>
      {fileInput}
    </Field>
  )
}
