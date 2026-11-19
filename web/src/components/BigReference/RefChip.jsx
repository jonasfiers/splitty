// The chip that opens BigReference: the booking reference, with a small QR
// mark when the item also has its ticket's code ("Ticket" when that is all
// there is). Used on the item page and on the live day's rows.
export default function RefChip({ item, onClick }) {
  const ref = item.confirmationRef
  const what = ref ? `booking reference ${ref}` : 'ticket code'
  return (
    <button type="button" className="today-ref" onClick={onClick} title="Show big" aria-label={`Show ${what} full screen`}>
      {item.ticketCode && (
        <svg className="today-ref-code" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" />
        </svg>
      )}
      <span>{ref || 'Ticket'}</span>
    </button>
  )
}
