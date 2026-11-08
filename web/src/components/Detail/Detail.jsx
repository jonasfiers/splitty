// The building blocks of a detail page (an expense, a trip item), so both
// look alike: the head of the page, then label/value rows.

// Icon tile, title and a quiet line under it; `aside` sits on the right
// (an expense's amount). `iconStyle` tints the tile (settlements, transfers).
export function DetailHero({ icon, iconStyle, title, subtitle, aside }) {
  return (
    <div className="detail-hero">
      <div className="expense-icon detail-hero-icon" style={iconStyle}>{icon}</div>
      <div className="detail-hero-text">
        <div className="detail-hero-title">{title}</div>
        {subtitle && <div className="detail-hero-sub">{subtitle}</div>}
      </div>
      {aside && <div className="detail-hero-aside">{aside}</div>}
    </div>
  )
}

export function DetailRows({ children }) {
  return <div className="detail-rows">{children}</div>
}

export function DetailRow({ label, children }) {
  return (
    <div className="detail-row">
      <span className="detail-row-label">{label}</span>
      <span className="detail-row-value">{children}</span>
    </div>
  )
}

// A small secondary line under a row's value (a place's address).
export function DetailRowSub({ children }) {
  return <span className="detail-row-sub">{children}</span>
}

// A remove/unlink button at the end of a list row: a real tap target, and it
// never opens the row it sits in.
export function RowAction({ label, onClick }) {
  return (
    <button
      type="button"
      className="row-action"
      aria-label={label}
      title={label}
      onClick={event => { event.preventDefault(); event.stopPropagation(); onClick() }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg>
    </button>
  )
}
