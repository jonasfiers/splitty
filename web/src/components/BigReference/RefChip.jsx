// The chips that open BigReference: the booking reference, and next to it,
// when the item has one, the ticket's own code. Separate screens, since the
// two hold different things. Used on the item page and the live day's rows.
export function RefChip({ item, onClick }) {
  return (
    <button type="button" className="today-ref" onClick={onClick} title="Show big" aria-label={`Show booking reference ${item.confirmationRef} full screen`}>
      <span>{item.confirmationRef}</span>
    </button>
  )
}

export function TicketChip({ onClick }) {
  return (
    <button type="button" className="today-nav" onClick={onClick} title="Show the ticket's code" aria-label="Show the ticket's code full screen">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" />
      </svg>
      Ticket
    </button>
  )
}
