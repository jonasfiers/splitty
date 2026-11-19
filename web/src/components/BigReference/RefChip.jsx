import { useState } from 'react'

// The chips that open BigReference: the booking reference, and next to it,
// when the item has one, the ticket's own code. Separate screens, since the
// two hold different things. Used on the item page and the live day's rows.
//
// The reference chip has a copy button at its end: tapping the code opens it,
// the icon (with a wider target) copies it.
export function RefChip({ item, onClick }) {
  const [copied, setCopied] = useState(false)
  const open = (
    <button type="button" className="today-ref" onClick={onClick} title="Show big" aria-label={`Show booking reference ${item.confirmationRef} full screen`}>
      <span>{item.confirmationRef}</span>
    </button>
  )
  const doCopy = () => {
    navigator.clipboard?.writeText(item.confirmationRef)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <span className="ref-chip">
      {open}
      <button type="button" className="ref-chip-copy" onClick={doCopy} aria-label={copied ? 'Copied' : 'Copy booking reference'} title={copied ? 'Copied' : 'Copy'}>
        {copied ? (
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h8" /></svg>
        )}
      </button>
    </span>
  )
}

export function TicketChip({ count = 1, onClick }) {
  const label = count > 1 ? `${count} tickets` : 'Ticket'
  return (
    <button type="button" className="today-nav" onClick={onClick} title={count > 1 ? 'Show the tickets’ codes' : 'Show the ticket’s code'} aria-label={`${label}: show full screen`}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" />
      </svg>
      {label}
    </button>
  )
}
